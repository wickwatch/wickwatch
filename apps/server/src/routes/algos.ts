import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AlgoMetadata, isAdapterError, ParameterSchema } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import Value from "typebox/value";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import type { AlgosTable } from "../db/schema";
import { requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import { audit } from "../services/audit";

const MAX_ALGO_BYTES = 64 * 1024 * 1024;

const Algo = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  version: Type.String(),
  sha256: Type.String(),
  size: Type.Integer(),
  buildTime: Type.Optional(Type.String()),
  fullAccess: Type.Boolean(),
  parameters: Type.Array(ParameterSchema),
  uploadedAt: Type.String(),
});
type Algo = Type.Static<typeof Algo>;

/** Folder and version names end up in paths; keep them to safe characters. */
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const safe = (value: string) =>
  value
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 100);

function toAlgo(
  row: Pick<
    AlgosTable,
    "name" | "version" | "sha256" | "size" | "build_time" | "full_access" | "metadata" | "uploaded_at"
  > & { id: number },
): Algo {
  const metadata: unknown = JSON.parse(row.metadata);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    sha256: row.sha256,
    size: row.size,
    ...(row.build_time ? { buildTime: row.build_time } : {}),
    fullAccess: row.full_access === 1,
    parameters: Value.Check(AlgoMetadata, metadata) ? metadata.parameters : [],
    uploadedAt: row.uploaded_at,
  };
}

/** Default version: the bot's own `BotVersion` default, else its build time, else the hash. */
function defaultVersion(metadata: AlgoMetadata, sha256: string): string {
  const botVersion = metadata.parameters.find((p) => p.name === "BotVersion")?.default;
  if (typeof botVersion === "string" && SAFE.test(botVersion)) return botVersion;
  if (metadata.buildTime) return metadata.buildTime.slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return sha256.slice(0, 12);
}

export const algoRoutes: FastifyPluginAsyncTypebox<{ db: Db; adapters: Adapters; algosDir: string }> = async (
  app,
  { db, adapters, algosDir },
) => {
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: MAX_ALGO_BYTES },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.get(
    "/algos",
    { schema: { tags: ["algos"], summary: "Uploaded algo versions", response: { 200: Type.Array(Algo) } } },
    async () =>
      (await db.selectFrom("algos").selectAll().orderBy("name").orderBy("uploaded_at", "desc").execute()).map(toAlgo),
  );

  app.post(
    "/algos",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["algos"],
        summary: "Upload an algo file (body: the file, application/octet-stream)",
        description:
          "The name comes from the algo's metadata. `version` defaults to the bot's BotVersion parameter, else its build time.",
        querystring: Type.Object({
          fileName: Type.String({ minLength: 1, maxLength: 255 }),
          version: Type.Optional(Type.String({ pattern: SAFE.source })),
        }),
        response: { 201: Algo, 400: ErrorBody, 403: ErrorBody, 409: ErrorBody },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: "algo_empty" });
      const sha256 = createHash("sha256").update(body).digest("hex");
      const same = await db
        .selectFrom("algos")
        .select(["id", "name", "version"])
        .where("sha256", "=", sha256)
        .executeTakeFirst();
      if (same) return reply.code(409).send({ error: "algo_duplicate", message: `${same.name} ${same.version}` });

      // Read the metadata from a temporary copy that keeps the original file name.
      const incoming = join(algosDir, ".incoming", randomBytes(8).toString("hex"));
      const temp = join(incoming, safe(request.query.fileName) || "upload.algo");
      await mkdir(incoming, { recursive: true });
      try {
        await writeFile(temp, body, { mode: 0o640 });
        let metadata: AlgoMetadata;
        try {
          metadata = await adapters.broker.algoMetadata(temp);
        } catch (error) {
          request.log.warn({ err: error, fileName: request.query.fileName }, "Algo metadata unreadable");
          return await reply
            .code(400)
            .send({ error: "algo_unreadable", ...(isAdapterError(error) ? { message: error.code } : {}) });
        }
        const name = safe(metadata.name);
        const version = request.query.version ?? defaultVersion(metadata, sha256);
        if (!SAFE.test(name) || !SAFE.test(version)) return await reply.code(400).send({ error: "invalid_input" });
        const exists = await db
          .selectFrom("algos")
          .select("id")
          .where("name", "=", name)
          .where("version", "=", version)
          .executeTakeFirst();
        if (exists) return await reply.code(409).send({ error: "algo_version_exists" });

        const filePath = join(name, version, `${name}.algo`);
        const target = join(algosDir, filePath);
        await mkdir(dirname(target), { recursive: true });
        await rename(temp, target);
        const now = new Date().toISOString();
        const row = {
          name,
          version,
          sha256,
          file_path: filePath,
          size: body.length,
          build_time: metadata.buildTime ?? null,
          full_access: metadata.fullAccess ? 1 : 0,
          metadata: JSON.stringify(metadata),
          uploaded_by: request.user?.id ?? null,
          uploaded_at: now,
        };
        const { id } = await db.insertInto("algos").values(row).returning("id").executeTakeFirstOrThrow();
        await audit(db, {
          action: "algo.upload",
          target: `${name} ${version}`,
          details: { sha256 },
          userId: request.user?.id,
        });
        return await reply.code(201).send(toAlgo({ id, ...row }));
      } finally {
        await rm(incoming, { recursive: true, force: true });
      }
    },
  );

  app.delete(
    "/algos/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["algos"],
        summary: "Delete an algo version and its file",
        params: Type.Object({ id: Type.Integer() }),
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const row = await db.selectFrom("algos").selectAll().where("id", "=", request.params.id).executeTakeFirst();
      if (!row) return reply.code(404).send({ error: "not_found" });
      await db.deleteFrom("algos").where("id", "=", row.id).execute();
      await rm(dirname(join(algosDir, row.file_path)), { recursive: true, force: true });
      await audit(db, { action: "algo.delete", target: `${row.name} ${row.version}`, userId: request.user?.id });
      return reply.code(204).send(null);
    },
  );
};
