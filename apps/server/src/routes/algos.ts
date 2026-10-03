import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  Algo,
  AlgoSettings,
  AlgoSettingsInput,
  isAdapterError,
  ParameterFile,
  type AlgoMetadata,
} from "@wickwatch/core";
import { numberParameters } from "@wickwatch/core/parameters";
import { SAFE_NAME } from "@wickwatch/core/rules";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import type { AlgosTable } from "../db/schema";
import { actor, requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import { metadataReader, schemaOf } from "../services/algo-metadata";
import { audit } from "../services/audit";
import { latestConfigIds } from "../services/instance-configs";
import { algoSettingsOf } from "../services/parameter-checks";

const MAX_ALGO_BYTES = 64 * 1024 * 1024;

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
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    sha256: row.sha256,
    size: row.size,
    ...(row.build_time ? { buildTime: row.build_time } : {}),
    fullAccess: row.full_access === 1,
    parameters: schemaOf(row.metadata),
    uploadedAt: row.uploaded_at,
  };
}

/** Default version: the bot's own `BotVersion` default, else its build time, else the hash. */
function defaultVersion(metadata: AlgoMetadata, sha256: string): string {
  const botVersion = metadata.parameters.find((p) => p.name === "BotVersion")?.default;
  if (typeof botVersion === "string" && SAFE_NAME.test(botVersion)) return botVersion;
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
    "/algos/:id/parameter-file",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["algos"],
        summary: "Read a parameter file (e.g. .cbotset) for this algo (body: the file, application/octet-stream)",
        description:
          "Stores nothing. Values come converted to the algo's parameter types; `issues`, `unknown` and `missing` tell what did not fit.",
        params: Type.Object({ id: Type.Integer() }),
        response: { 200: ParameterFile, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: "parameter_file_invalid" });
      const algo = await db
        .selectFrom("algos")
        .select("metadata")
        .where("id", "=", request.params.id)
        .executeTakeFirst();
      if (!algo) return reply.code(404).send({ error: "not_found" });
      try {
        return adapters.config.parse(new Uint8Array(body), schemaOf(algo.metadata));
      } catch (error) {
        if (isAdapterError(error) && error.code === "invalid_input") {
          return await reply.code(400).send({ error: "parameter_file_invalid" });
        }
        throw error;
      }
    },
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
          version: Type.Optional(Type.String({ pattern: SAFE_NAME.source })),
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
      const extension = adapters.broker.algoFormats()[0] ?? "bin";
      const incoming = join(algosDir, ".incoming", randomBytes(8).toString("hex"));
      const temp = join(incoming, safe(request.query.fileName) || `upload.${extension}`);
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
        if (!SAFE_NAME.test(name) || !SAFE_NAME.test(version))
          return await reply.code(400).send({ error: "invalid_input" });
        const exists = await db
          .selectFrom("algos")
          .select("id")
          .where("name", "=", name)
          .where("version", "=", version)
          .executeTakeFirst();
        if (exists) return await reply.code(409).send({ error: "algo_version_exists" });

        const filePath = join(name, version, `${name}.${extension}`);
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
          metadata_reader: metadataReader(adapters.broker),
          uploaded_by: request.user?.id ?? null,
          uploaded_at: now,
        };
        const { id } = await db.insertInto("algos").values(row).returning("id").executeTakeFirstOrThrow();
        await audit(db, {
          action: "algo.upload",
          target: `${name} ${version}`,
          details: { sha256 },
          ...actor(request),
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
        summary: "Delete an algo version and its file (not while an instance uses it)",
        params: Type.Object({ id: Type.Integer() }),
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
      },
    },
    async (request, reply) => {
      const row = await db.selectFrom("algos").selectAll().where("id", "=", request.params.id).executeTakeFirst();
      if (!row) return reply.code(404).send({ error: "not_found" });
      // Old configuration versions keep name and version; the current ones need the file.
      const current = await db
        .selectFrom("instance_configs")
        .select("id")
        .where("algo_id", "=", row.id)
        .where("id", "in", latestConfigIds(db))
        .executeTakeFirst();
      if (current) return reply.code(409).send({ error: "algo_in_use" });
      await db.deleteFrom("algos").where("id", "=", row.id).execute();
      await rm(dirname(join(algosDir, row.file_path)), { recursive: true, force: true });
      await audit(db, { action: "algo.delete", target: `${row.name} ${row.version}`, ...actor(request) });
      return reply.code(204).send(null);
    },
  );

  app.get(
    "/algo-settings",
    {
      schema: {
        tags: ["algos"],
        summary: "Settings of the algos, by name; algos without any are left out",
        response: { 200: Type.Array(AlgoSettings) },
      },
    },
    async () => (await db.selectFrom("algo_settings").selectAll().orderBy("algo_name").execute()).map(algoSettingsOf),
  );

  app.put(
    "/algo-settings/:name",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["algos"],
        summary: "Change the settings of an algo, for all its versions",
        description:
          "`accountSizeParameter` names the parameter holding the account size the algo calculates with; wickwatch warns when it is far off the account's. `riskParameter` names the one holding the risk per trade in percent; wickwatch shows it in money and against the challenge's loss limits. Both must be number parameters of the newest version; fields left out stay as they are, null switches one off.",
        params: Type.Object({ name: Type.String({ minLength: 1, maxLength: 100 }) }),
        body: AlgoSettingsInput,
        response: { 200: AlgoSettings, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const algoName = request.params.name;
      const [newest, stored] = await Promise.all([
        db
          .selectFrom("algos")
          .select("metadata")
          .where("name", "=", algoName)
          .orderBy("uploaded_at", "desc")
          .orderBy("id", "desc")
          .executeTakeFirst(),
        db.selectFrom("algo_settings").selectAll().where("algo_name", "=", algoName).executeTakeFirst(),
      ]);
      if (!newest) return reply.code(404).send({ error: "algo_not_found" });
      // Fields left out stay as they are. A saved parameter the newest version no longer has may stay; a new choice
      // must be one of its numbers.
      const numbers = new Set(numberParameters(schemaOf(newest.metadata)).map((p) => p.name));
      const choose = (value: string | null | undefined, current: string | null = null) =>
        value === undefined ? current : value;
      const row = {
        account_size_parameter: choose(request.body.accountSizeParameter, stored?.account_size_parameter),
        risk_parameter: choose(request.body.riskParameter, stored?.risk_parameter),
        updated_by: request.user?.id ?? null,
        updated_at: new Date().toISOString(),
      };
      const fine = (value: string | null, current: string | null | undefined) =>
        value === null || value === current || numbers.has(value);
      if (
        !fine(row.account_size_parameter, stored?.account_size_parameter) ||
        !fine(row.risk_parameter, stored?.risk_parameter)
      ) {
        return reply.code(400).send({ error: "setting_parameter_invalid" });
      }
      await db
        .insertInto("algo_settings")
        .values({ algo_name: algoName, ...row })
        .onConflict((c) => c.column("algo_name").doUpdateSet(row))
        .execute();
      await audit(db, {
        action: "algo.settings",
        target: algoName,
        details: { accountSizeParameter: row.account_size_parameter, riskParameter: row.risk_parameter },
        ...actor(request),
      });
      return algoSettingsOf({ algo_name: algoName, ...row });
    },
  );
};
