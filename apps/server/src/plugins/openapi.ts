import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";

/** OpenAPI description at <base>/api/openapi.json, interactive docs at <base>/api/docs. */
export const openapi = fp<{ basePath: string; version: string }>(async (app, { basePath, version }) => {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Wickwatch API",
        version,
        license: { name: "AGPL-3.0-only", url: "https://www.gnu.org/licenses/agpl-3.0.html" },
      },
      servers: [{ url: basePath || "/" }],
      tags: [
        { name: "system", description: "Health, version and capabilities" },
        { name: "overview", description: "Aggregated views" },
        { name: "instances", description: "Bot instances" },
        { name: "accounts", description: "Broker accounts" },
      ],
    },
    // Paths in the document are relative to the server URL above.
    transform: ({ schema, url }) => ({
      schema,
      url: basePath && url.startsWith(basePath) ? url.slice(basePath.length) : url,
    }),
  });
  await app.register(swaggerUi, { routePrefix: `${basePath}/api/docs` });
  app.get(`${basePath}/api/openapi.json`, { schema: { hide: true } }, () => app.swagger());
});
