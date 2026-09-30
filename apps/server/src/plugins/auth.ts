import cookie from "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { Db } from "../db";
import { findSession, SESSION_COOKIE, SESSION_MAX_AGE_S, type SessionUser } from "../auth/sessions";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | undefined;
  }
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Protects everything under <base>/api/ except <base>/api/v1/auth/*.
 * State-changing requests from another origin are rejected (CSRF), on top of SameSite=Strict cookies.
 */
export const auth = fp<{ db: Db; basePath: string }>(async (app, { db, basePath }) => {
  await app.register(cookie);
  app.decorateRequest("user", undefined);

  const apiPrefix = `${basePath}/api/`;
  const publicPrefix = `${basePath}/api/v1/auth/`;

  app.addHook("onRequest", async (request, reply) => {
    // The router decodes the path before matching (/%61pi/ reaches /api/), so decide by the matched
    // route and fall back to the raw path only when no route matched.
    const rawPath = request.url.split("?")[0] ?? "";
    const target = request.routeOptions.url ?? rawPath;
    if (!target.startsWith(apiPrefix) && !rawPath.startsWith(apiPrefix)) return;

    if (UNSAFE_METHODS.has(request.method) && !sameOrigin(request)) {
      return reply.code(403).send({ error: "forbidden_origin" });
    }

    const token = request.cookies[SESSION_COOKIE];
    if (token) request.user = await findSession(db, token);
    if (!request.user && !target.startsWith(publicPrefix)) {
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

export function setSessionCookie(reply: FastifyReply, token: string, basePath: string): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    path: `${basePath}/`,
    httpOnly: true,
    sameSite: "strict",
    secure: "auto",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export function clearSessionCookie(reply: FastifyReply, basePath: string): void {
  void reply.clearCookie(SESSION_COOKIE, { path: `${basePath}/` });
}

export const isAdmin = (request: FastifyRequest): boolean => request.user?.role === "admin";

/** preHandler for routes that change state: viewers may only read. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAdmin(request)) await reply.code(403).send({ error: "forbidden" });
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
