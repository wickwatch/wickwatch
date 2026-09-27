import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyReply } from "fastify";
import fp from "fastify-plugin";

/**
 * Serves the built SPA under the base path. Unknown non-API GET requests get index.html
 * (client-side routing); a <base href> makes relative asset URLs work under any base path.
 */
export const web = fp<{ basePath: string; distDir: string | undefined }>(async (app, { basePath, distDir }) => {
  const indexFile = distDir && join(distDir, "index.html");
  if (!indexFile || !existsSync(indexFile)) {
    app.log.info({ distDir }, "No web build found; serving the API only");
    return;
  }

  const baseHref = `${basePath}/`;
  const html = readFileSync(indexFile, "utf8").replace("<head>", `<head>\n    <base href="${baseHref}" />`);

  await app.register(fastifyStatic, {
    root: distDir,
    prefix: baseHref,
    index: false,
    wildcard: true,
    setHeaders: (reply, path) => {
      if (path.includes("/assets/")) reply.header("Cache-Control", "public, max-age=31536000, immutable");
    },
  });

  const sendIndex = (reply: FastifyReply) =>
    reply.type("text/html; charset=utf-8").header("Cache-Control", "no-cache").send(html);

  app.get(baseHref, { schema: { hide: true } }, (_request, reply) => sendIndex(reply));
  if (basePath) app.get(basePath, { schema: { hide: true } }, (_request, reply) => reply.redirect(baseHref));

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    const isPage =
      request.method === "GET" &&
      path.startsWith(baseHref) &&
      !path.startsWith(`${basePath}/api/`) &&
      !path.startsWith(`${basePath}/assets/`);
    if (!isPage) return reply.code(404).send({ error: "not_found" });
    return sendIndex(reply);
  });
});
