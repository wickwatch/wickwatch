import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";
import { SESSION_COOKIE } from "../auth/sessions";
import { ErrorBody } from "./errors";

const DESCRIPTION = `REST API of wickwatch.

**Authentication:** log in with \`POST /api/v1/auth/login\` (password and TOTP code); the server sets the
\`${SESSION_COOKIE}\` cookie (HttpOnly, SameSite=Strict). All other endpoints except \`/healthz\` and
\`/api/v1/auth/*\` need it, or an API token as \`Authorization: Bearer <token>\` (admins create tokens in the web
app under *API tokens*). A token acts as the user who created it, with at most the token's role; it does not reach
\`/api/v1/auth/*\` or the token endpoints. Viewers may call GET endpoints only; state changes need the \`admin\` role.
State-changing requests with an \`Origin\` header from another site are rejected.

**MCP:** \`POST /mcp\` is a read-only Model Context Protocol endpoint (Streamable HTTP, stateless) for AI clients;
it takes an API token only.

**Errors** are JSON \`{ "error": "<code>" }\`. Codes of the broker/runtime adapters: \`auth_failed\`,
\`not_found\`, \`unsupported\`, \`invalid_input\`, \`timeout\`, \`unavailable\`. Others: \`unauthenticated\`,
\`forbidden\`, \`forbidden_origin\`, \`rate_limited\`, \`internal\` and endpoint-specific codes.

**Time** values are ISO 8601 in UTC; money is in the account currency.`;

const PUBLIC_PREFIXES = ["/healthz", "/api/v1/auth/"];

/** OpenAPI description at <base>/api/openapi.json, interactive docs at <base>/api/docs. */
export const openapi = fp<{ basePath: string; version: string }>(async (app, { basePath, version }) => {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "wickwatch API",
        version,
        description: DESCRIPTION,
        license: { name: "AGPL-3.0-only", url: "https://www.gnu.org/licenses/agpl-3.0.html" },
      },
      servers: [{ url: basePath || "/" }],
      tags: [
        { name: "auth", description: "Setup, login and session" },
        { name: "system", description: "Health, version and capabilities" },
        { name: "overview", description: "Aggregated views" },
        { name: "instances", description: "Bot instances" },
        { name: "accounts", description: "Broker accounts and stored credentials" },
        { name: "algos", description: "Uploaded bot versions" },
      ],
      components: {
        securitySchemes: {
          session: { type: "apiKey", in: "cookie", name: SESSION_COOKIE },
          token: { type: "http", scheme: "bearer" },
        },
      },
    },
    // Paths are relative to the server URL; protected routes get the session and token schemes (unless they name
    // their own) and a 401 answer.
    transform: ({ schema, url }) => {
      const path = basePath && url.startsWith(basePath) ? url.slice(basePath.length) : url;
      const isPublic = PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
      // Routes under /auth/ that need a session declare `security` themselves.
      if (isPublic) return { schema: { security: [], ...schema }, url: path };
      const response = { ...(schema.response as Record<string, unknown> | undefined), 401: ErrorBody };
      const security = schema.security ?? [{ session: [] }, { token: [] }];
      return { schema: { ...schema, security, response }, url: path };
    },
  });
  await app.register(swaggerUi, { routePrefix: `${basePath}/api/docs` });
  app.get(`${basePath}/api/openapi.json`, { schema: { hide: true } }, () => app.swagger());
});
