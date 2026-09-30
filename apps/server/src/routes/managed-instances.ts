import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AdapterError,
  InstanceConfigInput,
  InstanceStatus,
  ManagedInstance,
  ManagedInstanceDetail,
  managedLabels,
  parameterDefaults,
  ParameterIssue,
  ParameterValues,
  readLabels,
  type AttributionMode,
  type Deployment,
  type InstanceConfig,
  type RuntimeInstance,
} from "@wickwatch/core";
import { INSTANCE_NAME, isUp } from "@wickwatch/core/rules";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import Value from "typebox/value";
import { findAccountById, type AccountDirectory, type AccountEntry } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import type { InstanceConfigsTable } from "../db/schema";
import { isAdmin, requireAdmin, requireConfirmation } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import type { Cipher } from "../security/cipher";
import { schemaOf } from "../services/algo-metadata";
import { audit, auditOutcome } from "../services/audit";
import { decryptParameters, encryptParameters, latestConfigIds } from "../services/instance-configs";
import { setShouldRun } from "../services/instance-keeper";
import type { SymbolCache } from "../services/symbols";

/** A rejected configuration; `issues` and `unknown` are set for `invalid_parameters`. */
const ConfigErrorBody = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  issues: Type.Optional(Type.Array(ParameterIssue)),
  unknown: Type.Optional(Type.Array(Type.String())),
});
type ConfigErrorBody = Type.Static<typeof ConfigErrorBody>;

const NameParams = Type.Object({ name: Type.String({ pattern: INSTANCE_NAME.source }) });

type ConfigRow = Omit<InstanceConfigsTable, "id" | "instance_id"> & { created_by_name?: string | null };

/** Without the master key, encrypted parameter values cannot be read and are left out. */
function toConfig(row: ConfigRow, cipher: Cipher | undefined): InstanceConfig {
  const json = decryptParameters(cipher, row.parameters);
  const parameters: unknown = json === undefined ? {} : JSON.parse(json);
  return {
    version: row.version,
    algo: { id: row.algo_id, name: row.algo_name, version: row.algo_version },
    symbol: row.symbol,
    period: row.period,
    parameters: Value.Check(ParameterValues, parameters) ? parameters : {},
    attribution: {
      mode: row.attribution as AttributionMode,
      ...(row.order_label ? { orderLabel: row.order_label } : {}),
    },
    ...(row.comment ? { comment: row.comment } : {}),
    createdAt: row.created_at,
    ...(row.created_by_name ? { createdBy: row.created_by_name } : {}),
  };
}

/** For viewers: parameter values may hold licence keys. */
const withoutParameters = (config: InstanceConfig): InstanceConfig => ({ ...config, parameters: {} });

/** JSON with sorted keys, so equal parameter sets compare equal. */
const canonical = (values: ParameterValues) =>
  JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))));

/** `row.parameters` is the canonical JSON, encrypted only when stored. */
type Checked =
  | { ok: true; row: Omit<ConfigRow, "version" | "created_by" | "created_at"> }
  | { ok: false; status: 400 | 404; body: ConfigErrorBody };

export interface ManagedInstanceRouteOptions {
  adapters: Adapters;
  accounts: AccountDirectory;
  db: Db;
  /** Encrypts parameter values; without it they cannot be saved, deployed or downloaded. */
  cipher: Cipher | undefined;
  symbols: SymbolCache;
  labelPrefix: string;
  algosDir: string;
}

export const managedInstanceRoutes: FastifyPluginAsyncTypebox<ManagedInstanceRouteOptions> = async (
  app,
  { adapters, accounts, db, cipher, symbols, labelPrefix, algosDir },
) => {
  /** The runtime's rules for parameter values, e.g. no empty text for the cTrader CLI. */
  const validateOptions = { requireText: adapters.broker.capabilities().requiresTextValues === true };
  const configs = () =>
    db
      .selectFrom("instance_configs")
      .leftJoin("users", "users.id", "instance_configs.created_by")
      .select([
        "instance_configs.instance_id",
        "instance_configs.version",
        "instance_configs.algo_id",
        "instance_configs.algo_name",
        "instance_configs.algo_version",
        "instance_configs.symbol",
        "instance_configs.period",
        "instance_configs.parameters",
        "instance_configs.attribution",
        "instance_configs.order_label",
        "instance_configs.comment",
        "instance_configs.created_by",
        "instance_configs.created_at",
        "users.username as created_by_name",
      ]);

  function deployment(runtime: RuntimeInstance | undefined): Deployment | undefined {
    if (!runtime) return undefined;
    const labels = readLabels(labelPrefix, runtime.labels);
    const version = Number(labels["config-version"]);
    return {
      status: runtime.status,
      managed: labels.managed === "true",
      ...(Number.isInteger(version) && version > 0 ? { configVersion: version } : {}),
    };
  }

  /**
   * Managed instances of the active broker adapter with their current configuration. An unreachable runtime leaves
   * `deployment` out, or with `strict` fails the call.
   */
  async function load(name?: string, { strict = false } = {}): Promise<ManagedInstance[]> {
    const runtimeList = strict ? adapters.runtime.list() : adapters.runtime.list().catch(() => undefined);
    const [entryList, runtimes] = await Promise.all([accounts.list(), runtimeList]);
    const entries = new Map(entryList.map((a) => [a.id, a]));
    let query = db.selectFrom("instances").selectAll().orderBy("name");
    if (name !== undefined) query = query.where("name", "=", name);
    const rows = (await query.execute()).filter((r) => entries.has(r.account_id));
    if (!rows.length) return [];
    const latest = await configs().where("instance_configs.id", "in", latestConfigIds(db)).execute();
    const byInstance = new Map(latest.map((c) => [c.instance_id, c]));
    return rows.flatMap((row) => {
      const entry = entries.get(row.account_id);
      const config = byInstance.get(row.id);
      if (!entry || !config) return [];
      const deployed = deployment(runtimes?.find((i) => i.ref === row.name));
      return [
        {
          id: row.id,
          name: row.name,
          account: { id: entry.id, number: entry.number, displayName: entry.displayName },
          createdAt: row.created_at,
          config: toConfig(config, cipher),
          ...(deployed ? { deployment: deployed } : {}),
        },
      ];
    });
  }

  async function check(input: InstanceConfigInput, entry: AccountEntry): Promise<Checked> {
    const algo = await db.selectFrom("algos").selectAll().where("id", "=", input.algoId).executeTakeFirst();
    if (!algo) return { ok: false, status: 404, body: { error: "algo_not_found" } };
    const schema = schemaOf(algo.metadata);

    const periods = adapters.broker.periods?.();
    const period = periods
      ? periods.find((p) => p.toLowerCase() === input.period.toLowerCase())
      : input.period.trim() || undefined;
    if (!period) return { ok: false, status: 400, body: { error: "invalid_period" } };

    const offered = await symbols.get(entry);
    const symbol =
      offered.find((s) => s === input.symbol) ?? offered.find((s) => s.toLowerCase() === input.symbol.toLowerCase());
    if (!symbol) return { ok: false, status: 400, body: { error: "invalid_symbol" } };

    const result = adapters.config.validate(input.parameters, schema, validateOptions);
    if (result.errors.length || result.unknown.length) {
      return {
        ok: false,
        status: 400,
        body: { error: "invalid_parameters", issues: result.errors, unknown: result.unknown },
      };
    }

    const { mode, orderLabel } = input.attribution;
    if (mode === "label-pattern") {
      try {
        new RegExp(orderLabel ?? "");
      } catch {
        return { ok: false, status: 400, body: { error: "invalid_order_label" } };
      }
      if (!orderLabel) return { ok: false, status: 400, body: { error: "invalid_order_label" } };
    }
    return {
      ok: true,
      row: {
        algo_id: algo.id,
        algo_name: algo.name,
        algo_version: algo.version,
        symbol,
        period,
        // Complete: missing parameters get the algo's default, so a version never depends on defaults.
        parameters: canonical({
          ...parameterDefaults(schema),
          ...input.parameters,
        }),
        attribution: mode,
        // Only the label modes use it.
        order_label: mode === "label" || mode === "label-pattern" ? (orderLabel ?? null) : null,
        comment: input.comment?.trim() || null,
      },
    };
  }

  app.get(
    "/managed-instances",
    {
      schema: {
        tags: ["instances"],
        summary: "Instances set up in wickwatch, with their current configuration",
        description: "Parameter values only for admins, as with the parameter file: they may hold licence keys.",
        response: { 200: Type.Array(ManagedInstance) },
      },
    },
    async (request) => {
      const list = await load();
      return isAdmin(request) ? list : list.map((i) => ({ ...i, config: withoutParameters(i.config) }));
    },
  );

  app.get(
    "/managed-instances/:name/parameter-file",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["instances"],
        summary: "A configuration version as a parameter file (e.g. .cbotset), to open it in the platform",
        description:
          "Admins only: parameter sets may hold licence keys. `version` defaults to the current one. The body is the file.",
        params: NameParams,
        querystring: Type.Object({ version: Type.Optional(Type.Integer({ minimum: 1 })) }),
        response: { 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const [instance] = await load(request.params.name);
      if (!instance) return reply.code(404).send({ error: "not_found" });
      const version = request.query.version ?? instance.config.version;
      const row = await configs()
        .where("instance_configs.instance_id", "=", instance.id)
        .where("instance_configs.version", "=", version)
        .executeTakeFirst();
      if (!row) return reply.code(404).send({ error: "not_found" });
      // Enums are stored as numbers in platform files, so the algo's schema is needed.
      const algo =
        row.algo_id === null
          ? undefined
          : await db.selectFrom("algos").select("metadata").where("id", "=", row.algo_id).executeTakeFirst();
      if (!algo) return reply.code(409).send({ error: "algo_not_found" });
      const config = toConfig(row, cipher);
      const bytes = adapters.config.serialize(config.parameters, schemaOf(algo.metadata), {
        symbol: config.symbol,
        period: config.period,
      });
      const extension = adapters.config.formats()[0] ?? "txt";
      await audit(db, {
        action: "instance.parameter_file",
        target: instance.name,
        details: { version },
        userId: request.user?.id,
      });
      return (
        reply
          .header("content-type", "application/octet-stream")
          .header("content-disposition", `attachment; filename="${instance.name}-v${String(version)}.${extension}"`)
          // No response schema for 200 on purpose: the file goes out as it is, not serialised as JSON.
          .send(Buffer.from(bytes) as never)
      );
    },
  );

  app.get(
    "/managed-instances/:name",
    {
      schema: {
        tags: ["instances"],
        summary: "One managed instance with all configuration versions",
        description: "Parameter values only for admins, as with the parameter file: they may hold licence keys.",
        params: NameParams,
        response: { 200: ManagedInstanceDetail, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const [instance] = await load(request.params.name);
      if (!instance) return reply.code(404).send({ error: "not_found" });
      const history = await configs()
        .where("instance_configs.instance_id", "=", instance.id)
        .orderBy("instance_configs.version", "desc")
        .execute();
      const detail = { ...instance, history: history.map((c) => toConfig(c, cipher)) };
      if (isAdmin(request)) return detail;
      return { ...detail, config: withoutParameters(detail.config), history: detail.history.map(withoutParameters) };
    },
  );

  app.post(
    "/managed-instances",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["instances"],
        summary: "Set up an instance (saved only; nothing is started)",
        body: Type.Object({
          name: Type.String({ pattern: INSTANCE_NAME.source }),
          accountId: Type.Integer(),
          config: InstanceConfigInput,
        }),
        response: {
          201: ManagedInstance,
          400: ConfigErrorBody,
          403: ErrorBody,
          404: ErrorBody,
          409: ErrorBody,
          503: ErrorBody,
        },
      },
    },
    async (request, reply) => {
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const { name, accountId, config } = request.body;
      const entry = await findAccountById(accounts, accountId);
      if (!entry) return reply.code(404).send({ error: "not_found" });
      const taken =
        (await db.selectFrom("instances").select("id").where("name", "=", name).executeTakeFirst()) ??
        (await adapters.runtime.list()).find(
          (i) => i.ref === name || readLabels(labelPrefix, i.labels).instance === name,
        );
      if (taken) return reply.code(409).send({ error: "instance_exists" });
      const checked = await check(config, entry);
      if (!checked.ok) return reply.code(checked.status).send(checked.body);

      const now = new Date().toISOString();
      const userId = request.user?.id ?? null;
      await db.transaction().execute(async (trx) => {
        const { id } = await trx
          .insertInto("instances")
          .values({ name, account_id: entry.id, created_by: userId, created_at: now })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("instance_configs")
          .values({
            ...checked.row,
            parameters: encryptParameters(cipher, checked.row.parameters),
            instance_id: id,
            version: 1,
            created_by: userId,
            created_at: now,
          })
          .execute();
      });
      await audit(db, {
        action: "instance.create",
        target: name,
        details: { account: entry.number, algo: `${checked.row.algo_name} ${checked.row.algo_version}` },
        userId: request.user?.id,
      });
      const [created] = await load(name);
      if (!created) throw new AdapterError("not_found", `Instance ${name} vanished`);
      return reply.code(201).send(created);
    },
  );

  app.post(
    "/managed-instances/:name/configs",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["instances"],
        summary: "Save a new configuration version (also used to roll back to an old one)",
        description: "Nothing is restarted; a running instance keeps its configuration until it is redeployed.",
        params: NameParams,
        body: InstanceConfigInput,
        response: {
          201: ManagedInstance,
          400: ConfigErrorBody,
          403: ErrorBody,
          404: ErrorBody,
          409: ErrorBody,
          503: ErrorBody,
        },
      },
    },
    async (request, reply) => {
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const [instance] = await load(request.params.name);
      const entry = instance && (await findAccountById(accounts, instance.account.id));
      if (!instance || !entry) return reply.code(404).send({ error: "not_found" });
      const checked = await check(request.body, entry);
      if (!checked.ok) return reply.code(checked.status).send(checked.body);

      const current = instance.config;
      const unchanged =
        current.algo.id === checked.row.algo_id &&
        current.symbol === checked.row.symbol &&
        current.period === checked.row.period &&
        canonical(current.parameters) === checked.row.parameters &&
        current.attribution.mode === checked.row.attribution &&
        (current.attribution.orderLabel ?? null) === checked.row.order_label;
      if (unchanged) return reply.code(409).send({ error: "config_unchanged" });

      const version = current.version + 1;
      await db
        .insertInto("instance_configs")
        .values({
          ...checked.row,
          parameters: encryptParameters(cipher, checked.row.parameters),
          instance_id: instance.id,
          version,
          created_by: request.user?.id ?? null,
          created_at: new Date().toISOString(),
        })
        .execute();
      await audit(db, {
        action: "instance.config",
        target: instance.name,
        details: { version, algo: `${checked.row.algo_name} ${checked.row.algo_version}` },
        userId: request.user?.id,
      });
      const [updated] = await load(instance.name);
      if (!updated) throw new AdapterError("not_found", `Instance ${instance.name} vanished`);
      return reply.code(201).send(updated);
    },
  );

  app.post(
    "/managed-instances/:name/deploy",
    {
      preHandler: [requireAdmin, requireConfirmation("name")],
      schema: {
        tags: ["instances"],
        summary: "Create or replace the instance with its current configuration",
        description:
          "Replacing keeps a running instance running with the new configuration (a restart). `start` also starts a stopped one.",
        params: NameParams,
        body: Type.Object({
          confirm: Type.String({ description: "The instance name" }),
          start: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({ status: InstanceStatus, configVersion: Type.Integer() }),
          400: ErrorBody,
          403: ErrorBody,
          404: ErrorBody,
          409: ErrorBody,
          501: ErrorBody,
          502: ErrorBody,
          503: ErrorBody,
        },
      },
    },
    async (request, reply) => {
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const { name } = request.params;
      const [instance] = await load(name);
      const entry = instance && (await findAccountById(accounts, instance.account.id));
      if (!instance || !entry) return reply.code(404).send({ error: "not_found" });
      const launch = adapters.broker.launch?.bind(adapters.broker);
      if (!launch) return reply.code(501).send({ error: "launch_unsupported" });
      if (instance.deployment && !instance.deployment.managed) {
        return reply.code(409).send({ error: "instance_exists" });
      }
      const { config } = instance;
      const algo =
        config.algo.id === null
          ? undefined
          : await db.selectFrom("algos").selectAll().where("id", "=", config.algo.id).executeTakeFirst();
      if (!algo) return reply.code(409).send({ error: "algo_not_found" });
      const schema = schemaOf(algo.metadata);
      // Versions saved before the runtime's rules were known, e.g. empty text parameters for the cTrader CLI.
      if (adapters.config.validate(config.parameters, schema, validateOptions).errors.length) {
        return reply.code(400).send({ error: "parameters_incomplete" });
      }

      const replaced = instance.deployment !== undefined;
      const { runtime } = await auditOutcome(
        db,
        { action: "instance.deploy", target: name, userId: request.user?.id },
        async () => {
          const launched = await launch({
            credentials: await entry.credentials(),
            account: entry.number,
            algo: {
              name: algo.name,
              file: await readFile(join(algosDir, algo.file_path)),
              fullAccess: algo.full_access === 1,
              parameters: schema,
            },
            symbol: config.symbol,
            period: config.period,
            parameters: config.parameters,
          });
          const spec = {
            ...launched,
            name,
            labels: managedLabels(labelPrefix, {
              name,
              account: entry.number,
              symbol: config.symbol,
              period: config.period,
              algoVersion: config.algo.version,
              configVersion: config.version,
              attribution: config.attribution.mode,
              orderLabel: config.attribution.orderLabel,
            }),
          };
          let runtime = replaced ? await adapters.runtime.update(name, spec) : await adapters.runtime.create(spec);
          const started = request.body.start === true && runtime.status !== "running";
          if (started) {
            await adapters.runtime.start(name);
            runtime = (await adapters.runtime.list()).find((i) => i.ref === name) ?? runtime;
          }
          await setShouldRun(db, name, isUp(runtime.status));
          return { runtime, started, image: launched.image };
        },
        ({ started, image }) => ({ version: config.version, replaced, started, image }),
      );
      return { status: runtime.status, configVersion: config.version };
    },
  );

  app.delete(
    "/managed-instances/:name",
    {
      preHandler: [requireAdmin, requireConfirmation("name")],
      schema: {
        tags: ["instances"],
        summary: "Delete a managed instance, its container (stopping it) and its configuration history",
        params: NameParams,
        body: Type.Object({ confirm: Type.String({ description: "The instance name" }) }),
        response: { 204: Type.Null(), 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const { name } = request.params;
      await auditOutcome(
        db,
        { action: "instance.delete", target: name, userId: request.user?.id },
        async () => {
          // Strict: an unreachable runtime must fail the delete, not orphan a running container.
          const [instance] = await load(name, { strict: true });
          if (!instance) throw new AdapterError("not_found", `No managed instance ${name}`);
          // A container of the same name defined elsewhere stays untouched.
          const containerRemoved = instance.deployment?.managed === true;
          if (containerRemoved) await adapters.runtime.remove(name);
          await db.deleteFrom("instances").where("id", "=", instance.id).execute();
          return { versions: instance.config.version, containerRemoved };
        },
        (details) => details,
      );
      return reply.code(204).send(null);
    },
  );
};
