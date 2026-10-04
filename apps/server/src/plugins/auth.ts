import cookie from "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { Db } from "../db";
import { findApiToken } from "../auth/api-tokens";
import { findSession, REMEMBER_MAX_AGE_S, SESSION_COOKIE, type SessionUser } from "../auth/sessions";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | undefined;
    /** How `user` logged in: the session cookie, or an API token (`Authorization: Bearer`). */
    authMethod: "session" | "token" | undefined;
    /** The API token of a request with `authMethod` "token". */
    apiToken: { id: number; name: string } | undefined;
  }
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Protects everything under <base>/api/ except <base>/api/v1/auth/*, with the session cookie or an API token, and
 * <base>/mcp with an API token only. Under auth/ a token counts for nothing: it cannot change a password or 2FA.
 * State-changing requests from another origin are rejected (CSRF), on top of SameSite=Strict cookies.
 */
export const auth = fp<{ db: Db; basePath: string; mcp: boolean }>(async (app, { db, basePath, mcp: mcpOn }) => {
  await app.register(cookie);
  app.decorateRequest("user", undefined);
  app.decorateRequest("authMethod", undefined);
  app.decorateRequest("apiToken", undefined);

  const apiPrefix = `${basePath}/api/`;
  const publicPrefix = `${basePath}/api/v1/auth/`;
  // With MCP=off <base>/mcp is a path like any other: no route, answered 404 without asking for a token.
  const mcpPath = mcpOn ? `${basePath}/mcp` : undefined;

  app.addHook("onRequest", async (request, reply) => {
    // The router decodes the path before matching (/%61pi/ reaches /api/), so the matched route decides. The raw path
    // counts too where no API route matched (no route at all, or the SPA's static wildcard <base>/*): an unknown API
    // path needs a login as well instead of answering to anyone. Public is only a matched auth route, or with no
    // route at all a path under auth/ (answered 404).
    const route = request.routeOptions.url;
    const rawPath = request.url.split("?")[0] ?? "";
    const mcp = mcpPath !== undefined && (route === mcpPath || (route === undefined && rawPath === mcpPath));
    if (!mcp && !(route ?? "").startsWith(apiPrefix) && !rawPath.startsWith(apiPrefix)) return;
    const isPublic = !mcp && (route ?? rawPath).startsWith(publicPrefix);

    if (UNSAFE_METHODS.has(request.method) && !sameOrigin(request)) {
      return reply.code(403).send({ error: "forbidden_origin" });
    }

    // A request with a bearer token is judged by the token alone, never by a cookie it also carries.
    const bearer = bearerToken(request);
    if (bearer !== undefined) {
      if (!isPublic) {
        const login = await findApiToken(db, bearer);
        if (login) {
          request.user = login.user;
          request.authMethod = "token";
          request.apiToken = login.token;
        }
      }
    } else if (!mcp) {
      const token = request.cookies[SESSION_COOKIE];
      if (token) request.user = await findSession(db, token);
      if (request.user) request.authMethod = "session";
    }
    if (!request.user && !isPublic) {
      if (mcp || bearer !== undefined) void reply.header("www-authenticate", 'Bearer realm="wickwatch"');
      return reply.code(401).send({ error: "unauthenticated" });
    }
  });

  // Safety net behind `preHandler: requireAdmin` on the routes: a state-changing API route outside auth/ that
  // forgets it is still for admins only. preHandler, so a viewer's invalid body still answers 400 as before.
  app.addHook("preHandler", async (request, reply) => {
    const target = request.routeOptions.url ?? "";
    if (!UNSAFE_METHODS.has(request.method) || !target.startsWith(apiPrefix) || target.startsWith(publicPrefix)) return;
    if (!isAdmin(request)) return reply.code(403).send({ error: "forbidden" });
  });
});

/**
 * The token of an `Authorization: Bearer` header; undefined without one. Other schemes do not count, e.g. the Basic
 * auth of a reverse proxy in front of wickwatch, so the browser's session still works behind it.
 */
function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header || !/^bearer\s/i.test(header)) return undefined;
  return header.slice("bearer".length).trim();
}

function sameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true; // Non-browser clients; browsers always send Origin on unsafe requests.
  try {
    // Normalise both sides the same way, so default ports (:80/:443) compare equal.
    return new URL(origin).host === new URL(`${request.protocol}://${request.host}`).host;
  } catch {
    return false;
  }
}

/** Without `remember` a browser session cookie: closing the browser logs out. The server-side expiry holds either way. */
export function setSessionCookie(reply: FastifyReply, token: string, basePath: string, remember = false): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    path: `${basePath}/`,
    httpOnly: true,
    sameSite: "strict",
    secure: "auto",
    ...(remember ? { maxAge: REMEMBER_MAX_AGE_S } : {}),
  });
}

export function clearSessionCookie(reply: FastifyReply, basePath: string): void {
  void reply.clearCookie(SESSION_COOKIE, { path: `${basePath}/` });
}

/** Who acted, for the audit log: the user, and the API token when the request came with one. */
export const actor = (
  request: FastifyRequest,
): { userId: number | undefined; token?: { id: number; name: string } } => ({
  userId: request.user?.id,
  ...(request.apiToken ? { token: request.apiToken } : {}),
});

export const isAdmin = (request: FastifyRequest): boolean => request.user?.role === "admin";

/** preHandler for routes that change state: viewers may only read. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAdmin(request)) await reply.code(403).send({ error: "forbidden" });
}

/** preHandler for routes an API token must not reach, e.g. managing the tokens themselves. */
export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.authMethod !== "session") await reply.code(403).send({ error: "session_required" });
}

/**
 * preHandler for destructive actions (after requireAdmin): the body's `confirm` must repeat the route parameter
 * `param`, e.g. the instance name, as typed into the confirmation dialog.
 */
export const requireConfirmation =
  (param: string) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const confirm = (request.body as { confirm?: unknown } | undefined)?.confirm;
    if (confirm !== (request.params as Record<string, string>)[param]) {
      await reply.code(400).send({ error: "confirmation_required" });
    }
  };
