import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AdapterError,
  AlgoRollout,
  AlgoUpdateInput,
  AlgoUpdatePreview,
  AlgoUpdateResult,
  changeAlgoVersion,
  InstanceConfigInput,
  ImageRollout,
  InstanceStatus,
  ManagedInstance,
  deployedConfigVersion,
  ManagedInstanceDetail,
  managedLabels,
  parameterDefaults,
  ParameterIssue,
  readLabels,
  type AlgoUpdateCandidate,
  type Deployment,
  type InstanceConfig,
  type ParameterValues,
  type RuntimeInstance,
} from "@wickwatch/core";
import { groupBy } from "@wickwatch/core/group-by";
import { INSTANCE_NAME, isUp } from "@wickwatch/core/rules";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { findAccountById, type AccountDirectory, type AccountEntry } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import { actor, isAdmin, requireAdmin, requireConfirmation, type Actor } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import type { Cipher } from "../security/cipher";
import { schemaOf } from "../services/algo-metadata";
import { audit, auditOutcome } from "../services/audit";
import { parameterChecks } from "../services/parameter-checks";
import { findPeriod } from "../services/periods";
import { setLinks } from "../services/schedules";
import {
  canonicalParameters,
  configQuery,
  encryptParameters,
  latestConfigIds,
  loadConfigVersion,
  toConfig,
  type ConfigRow,
} from "../services/instance-configs";
import type { Images } from "../services/images";
import { endPause, setShouldRun } from "../services/instance-keeper";
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

/** For viewers: parameter values may hold licence keys. */
const withoutParameters = (config: InstanceConfig): InstanceConfig => ({ ...config, parameters: {} });

/** `row.parameters` is the canonical JSON, encrypted only when stored. */
type Checked =
  | { ok: true; row: Omit<ConfigRow, "version" | "created_by" | "created_at">; template?: string }
  | { ok: false; status: 400 | 404; body: ConfigErrorBody };

export interface ManagedInstanceRouteOptions {
  /** Which images an instance may be updated to. */
  images: Images;
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
  { images, adapters, accounts, db, cipher, symbols, labelPrefix, algosDir },
) => {
  /** The runtime's rules for parameter values, e.g. no empty text for the cTrader CLI. */
  const validateOptions = { requireText: adapters.broker.capabilities().requiresTextValues === true };
  function deployment(runtime: RuntimeInstance | undefined): Deployment | undefined {
    if (!runtime) return undefined;
    const version = deployedConfigVersion(labelPrefix, runtime.labels);
    return {
      status: runtime.status,
      managed: readLabels(labelPrefix, runtime.labels).managed === "true",
      ...(version !== undefined ? { configVersion: version } : {}),
      ...(runtime.image ? { image: runtime.image } : {}),
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
    const [latest, links] = await Promise.all([
      configQuery(db).where("instance_configs.id", "in", latestConfigIds(db)).execute(),
      // All links, or one instance's; few rows either way.
      (name === undefined
        ? db.selectFrom("instance_schedules")
        : db.selectFrom("instance_schedules").where("instance_id", "=", rows[0]?.id ?? -1)
      )
        .select(["instance_id", "schedule_id"])
        .orderBy("schedule_id")
        .execute(),
    ]);
    const byInstance = new Map(latest.map((c) => [c.instance_id, c]));
    const scheduleIdsOf = groupBy(links, (l) => l.instance_id);
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
          scheduleIds: (scheduleIdsOf.get(row.id) ?? []).map((l) => l.schedule_id),
          logRules: row.log_rules_off === 0,
        },
      ];
    });
  }

  async function check(input: InstanceConfigInput, entry: AccountEntry): Promise<Checked> {
    const algo = await db.selectFrom("algos").selectAll().where("id", "=", input.algoId).executeTakeFirst();
    if (!algo) return { ok: false, status: 404, body: { error: "algo_not_found" } };
    const schema = schemaOf(algo.metadata);

    let template: string | undefined;
    if (input.template !== undefined) {
      const found = await db
        .selectFrom("parameter_templates")
        .select(["name", "algo_name"])
        .where("id", "=", input.template)
        .executeTakeFirst();
      if (found?.algo_name !== algo.name) {
        return { ok: false, status: 404, body: { error: "parameter_template_not_found" } };
      }
      template = found.name;
    }

    const periods = adapters.broker.periods?.();
    const period = periods ? findPeriod(periods, input.period) : input.period.trim() || undefined;
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
        parameters: canonicalParameters({
          ...parameterDefaults(schema),
          ...input.parameters,
        }),
        attribution: mode,
        // Only the label modes use it.
        order_label: mode === "label" || mode === "label-pattern" ? (orderLabel ?? null) : null,
        comment: input.comment?.trim() || null,
      },
      ...(template !== undefined ? { template } : {}),
    };
  }

  /** Saves a checked configuration as the instance's next version; false when it equals the current one. */
  async function saveVersion(
    cipher: Cipher,
    instance: ManagedInstance,
    checked: Extract<Checked, { ok: true }>,
    who: Actor,
  ): Promise<boolean> {
    const current = instance.config;
    const unchanged =
      current.algo.id === checked.row.algo_id &&
      current.symbol === checked.row.symbol &&
      current.period === checked.row.period &&
      canonicalParameters(current.parameters) === checked.row.parameters &&
      current.attribution.mode === checked.row.attribution &&
      (current.attribution.orderLabel ?? null) === checked.row.order_label;
    if (unchanged) return false;

    const version = current.version + 1;
    await db
      .insertInto("instance_configs")
      .values({
        ...checked.row,
        parameters: encryptParameters(cipher, checked.row.parameters),
        instance_id: instance.id,
        version,
        created_by: who.userId ?? null,
        created_at: new Date().toISOString(),
      })
      .execute();
    await audit(db, {
      action: "instance.config",
      target: instance.name,
      details: {
        version,
        algo: `${checked.row.algo_name} ${checked.row.algo_version}`,
        ...(checked.template !== undefined ? { template: checked.template } : {}),
      },
      ...who,
    });
    return true;
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
      const { name } = request.params;
      const config = await loadConfigVersion({ db, accounts, cipher }, name, request.query.version);
      if (!config) return reply.code(404).send({ error: "not_found" });
      const { version } = config;
      // Enums are stored as numbers in platform files, so the algo's schema is needed.
      const algo =
        config.algo.id === null
          ? undefined
          : await db.selectFrom("algos").select("metadata").where("id", "=", config.algo.id).executeTakeFirst();
      if (!algo) return reply.code(409).send({ error: "algo_not_found" });
      const bytes = adapters.config.serialize(config.parameters, schemaOf(algo.metadata), {
        symbol: config.symbol,
        period: config.period,
      });
      const extension = adapters.config.formats()[0] ?? "txt";
      await audit(db, {
        action: "instance.parameter_file",
        target: name,
        details: { version },
        ...actor(request),
      });
      return (
        reply
          .header("content-type", "application/octet-stream")
          .header("content-disposition", `attachment; filename="${name}-v${String(version)}.${extension}"`)
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
      const history = await configQuery(db)
        .where("instance_configs.instance_id", "=", instance.id)
        .orderBy("instance_configs.version", "desc")
        .execute();
      const checks = await parameterChecks(db, instance.config.algo.name, instance.account.id);
      const detail = { ...instance, history: history.map((c) => toConfig(c, cipher)), ...checks };
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
        details: {
          account: entry.number,
          algo: `${checked.row.algo_name} ${checked.row.algo_version}`,
          ...(checked.template !== undefined ? { template: checked.template } : {}),
        },
        ...actor(request),
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

      if (!(await saveVersion(cipher, instance, checked, actor(request)))) {
        return reply.code(409).send({ error: "config_unchanged" });
      }
      const [updated] = await load(instance.name);
      if (!updated) throw new AdapterError("not_found", `Instance ${instance.name} vanished`);
      return reply.code(201).send(updated);
    },
  );

  type DeployResult =
    | { ok: true; status: InstanceStatus; configVersion: number }
    | { ok: false; code: 400 | 404 | 409 | 501 | 503; error: string };

  /**
   * Creates or replaces the instance with its current configuration, on `image` if given, else on the image it ran on
   * so far (so a new configuration does not change the platform version), else on the platform's.
   */
  async function deploy(
    name: string,
    options: { start: boolean; image?: string | undefined },
    who: Actor,
  ): Promise<DeployResult> {
    if (!cipher) return { ok: false, code: 503, error: "master_key_missing" };
    const [instance] = await load(name);
    const entry = instance && (await findAccountById(accounts, instance.account.id));
    if (!instance || !entry) return { ok: false, code: 404, error: "not_found" };
    const launch = adapters.broker.launch?.bind(adapters.broker);
    if (!launch) return { ok: false, code: 501, error: "launch_unsupported" };
    if (instance.deployment && !instance.deployment.managed) return { ok: false, code: 409, error: "instance_exists" };
    if (options.image !== undefined && !images.isAllowed(options.image)) {
      return { ok: false, code: 400, error: "invalid_image" };
    }
    const { config } = instance;
    const algo =
      config.algo.id === null
        ? undefined
        : await db.selectFrom("algos").selectAll().where("id", "=", config.algo.id).executeTakeFirst();
    if (!algo) return { ok: false, code: 409, error: "algo_not_found" };
    const schema = schemaOf(algo.metadata);
    // Versions saved before the runtime's rules were known, e.g. empty text parameters for the cTrader CLI.
    if (adapters.config.validate(config.parameters, schema, validateOptions).errors.length) {
      return { ok: false, code: 400, error: "parameters_incomplete" };
    }

    const replaced = instance.deployment !== undefined;
    const row = await db
      .selectFrom("instances")
      .select(["paused_until", "image"])
      .where("name", "=", name)
      .executeTakeFirst();
    const paused = row?.paused_until != null;
    const image = options.image ?? row?.image ?? instance.deployment?.image;
    const { runtime } = await auditOutcome(
      db,
      { action: "instance.deploy", target: name, ...who },
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
          ...(image ? { image } : {}),
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
        await db.updateTable("instances").set({ image: launched.image }).where("name", "=", name).execute();
        const started = options.start && runtime.status !== "running";
        if (started) {
          await adapters.runtime.start(name);
          runtime = (await adapters.runtime.list()).find((i) => i.ref === name) ?? runtime;
        }
        // A new version for an instance its schedule holds stopped keeps the pause: it starts when the pause ends.
        if (started || !paused) {
          await endPause(db, name);
          await setShouldRun(db, name, isUp(runtime.status), true);
        }
        return { runtime, started, image: launched.image };
      },
      ({ started, image }) => ({ version: config.version, replaced, started, image }),
    );
    return { ok: true, status: runtime.status, configVersion: config.version };
  }

  app.post(
    "/managed-instances/:name/deploy",
    {
      preHandler: [requireAdmin, requireConfirmation("name")],
      schema: {
        tags: ["instances"],
        summary: "Create or replace the instance with its current configuration",
        description:
          "Replacing keeps a running instance running with the new configuration (a restart). `start` also starts a stopped one. `image` updates it to another version of the platform image (one of `/platform` `versions`); without it the instance keeps the image it runs on.",
        params: NameParams,
        body: Type.Object({
          confirm: Type.String({ description: "The instance name" }),
          start: Type.Optional(Type.Boolean()),
          image: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
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
      const result = await deploy(
        request.params.name,
        { start: request.body.start === true, image: request.body.image },
        actor(request),
      );
      if (!result.ok) return reply.code(result.code).send({ error: result.error });
      return { status: result.status, configVersion: result.configVersion };
    },
  );

  /** The last "update all" to an image or an algo version: running in the background, or done (kept until the next one, for the page to show). */
  let rollout: ImageRollout | undefined;
  let algoRollout: AlgoRollout | undefined;
  /**
   * One rollout at a time: two would deploy the same instance twice. An algo update with `deploy` claims the slot before
   * it saves the configurations, so no other rollout starts in between.
   */
  let algoRolloutClaimed = false;
  const rolling = () => rollout?.running === true || algoRollout?.running === true || algoRolloutClaimed;

  /**
   * Deploys the pending instances again, one after the other, on `image` if given (else on the image each runs on),
   * after `prepare` (e.g. the runtime fetching the image); leaves those with an open position (or unknown positions)
   * alone. Updates `state` as it goes and writes one audit entry at the end.
   */
  async function runRollout(
    state: Omit<ImageRollout, "image">,
    who: Actor,
    options: { image?: string; prepare?: () => Promise<void>; action: string; target: string },
  ): Promise<void> {
    const skip = (name: string, reason: ImageRollout["skipped"][number]["reason"], error?: string) =>
      state.skipped.push({ name, reason, ...(error ? { error } : {}) });
    try {
      await options.prepare?.();
      const { instances, accounts: summaries } = await app.overview.overview();
      for (const name of [...state.pending]) {
        state.current = name;
        state.pending = state.pending.filter((n) => n !== name);
        const [instance] = await load(name);
        const summary = instances.find((i) => i.name === name);
        const account = summaries.find((a) => a.number === instance?.account.number);
        if (!instance || !summary || !account || account.error) skip(name, "positions_unknown");
        else if (summary.openPositions > 0) skip(name, "open_position");
        else {
          try {
            const result = await deploy(name, { start: false, image: options.image }, who);
            if (result.ok) state.updated.push(name);
            else skip(name, "failed", result.error);
          } catch (error) {
            skip(name, "failed", error instanceof AdapterError ? error.code : "internal");
          }
        }
      }
    } catch (error) {
      // The image could not be fetched: nothing was changed.
      for (const name of state.pending) skip(name, "failed", error instanceof AdapterError ? error.code : "internal");
      state.pending = [];
    } finally {
      delete state.current;
      state.running = false;
      state.finishedAt = new Date().toISOString();
      await audit(db, {
        action: options.action,
        target: options.target,
        details: { updated: state.updated, skipped: state.skipped.map((s) => `${s.name}: ${s.reason}`) },
        ...who,
      }).catch((error: unknown) => {
        app.log.warn({ err: error }, "Audit entry for the rollout failed");
      });
    }
  }

  app.post(
    "/managed-instances/update-images",
    {
      preHandler: [
        requireAdmin,
        async (request, reply) => {
          if ((request.body as { confirm?: unknown } | undefined)?.confirm !== "all") {
            await reply.code(400).send({ error: "confirmation_required" });
          }
        },
      ],
      schema: {
        tags: ["instances"],
        summary: "Update all instances to the platform image",
        description:
          "Starts deploying every managed instance that runs on another image than the platform's (`/platform`) again on it, in the background, one after the other once the runtime has the image; running ones restart. Instances with an open position, or whose positions are unknown, are left alone. Answers at once; `GET` shows the progress.",
        body: Type.Object({ confirm: Type.String({ description: "`all`" }) }),
        response: { 202: ImageRollout, 400: ErrorBody, 403: ErrorBody, 409: ErrorBody, 501: ErrorBody },
      },
    },
    async (request, reply) => {
      const image = adapters.broker.image?.();
      if (!image) return reply.code(501).send({ error: "image_unsupported" });
      if (rolling()) return reply.code(409).send({ error: "update_running" });
      const outdated = (await load()).filter((i) => i.deployment?.managed && i.deployment.image !== image);
      const state: ImageRollout = {
        image,
        running: true,
        startedAt: new Date().toISOString(),
        pending: outdated.map((i) => i.name),
        updated: [],
        skipped: [],
      };
      rollout = state;
      void runRollout(state, actor(request), {
        image,
        prepare: () => images.prepare(image),
        action: "instance.update_images",
        target: image,
      });
      return reply.code(202).send(state);
    },
  );

  app.get(
    "/managed-instances/update-images",
    {
      schema: {
        tags: ["instances"],
        summary: "Progress of the last update of all instances",
        response: { 200: Type.Object({ rollout: Type.Optional(ImageRollout) }) },
      },
    },
    async () => (rollout ? { rollout } : {}),
  );

  /**
   * The instances on another version of `algo`'s algo, each with the values it would get on `algo`
   * (`changeAlgoVersion`): set values stay, values at the old default follow the new one.
   */
  async function algoUpdates(
    algo: { id: number; name: string; metadata: string },
    list: ManagedInstance[],
  ): Promise<{ instance: ManagedInstance; candidate: AlgoUpdateCandidate; values: ParameterValues }[]> {
    const others = list.filter((i) => i.config.algo.name === algo.name && i.config.algo.id !== algo.id);
    const fromIds = [...new Set(others.flatMap((i) => (i.config.algo.id === null ? [] : [i.config.algo.id])))];
    const schemas = new Map(
      (fromIds.length
        ? await db.selectFrom("algos").select(["id", "metadata"]).where("id", "in", fromIds).execute()
        : []
      ).map((a) => [a.id, schemaOf(a.metadata)]),
    );
    const to = schemaOf(algo.metadata);
    return others.map((instance) => {
      const { config } = instance;
      const from = config.algo.id === null ? [] : (schemas.get(config.algo.id) ?? []);
      const { values, ...change } = changeAlgoVersion(config.parameters, from, to, validateOptions);
      return {
        instance,
        values,
        candidate: {
          name: instance.name,
          account: instance.account,
          from: { id: config.algo.id, version: config.algo.version },
          configVersion: config.version,
          deployed: instance.deployment?.managed === true,
          ...change,
        },
      };
    });
  }

  const algoRef = (algo: { id: number; name: string; version: string }) => ({
    id: algo.id,
    name: algo.name,
    version: algo.version,
  });

  app.get(
    "/managed-instances/algo-update",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["instances"],
        summary: "Preview: the instances on another version of an algo, and what moving them to this one changes",
        description:
          "Admins only, like parameter values. Values the user set stay; values left at the old version's default follow the new default (e.g. a version parameter); new parameters take their default; values that do not fit take the default. An instance with `issues` needs a manual edit.",
        querystring: Type.Object({ algoId: Type.Integer() }),
        response: { 200: AlgoUpdatePreview, 403: ErrorBody, 404: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const algo = await db
        .selectFrom("algos")
        .select(["id", "name", "version", "metadata"])
        .where("id", "=", request.query.algoId)
        .executeTakeFirst();
      if (!algo) return reply.code(404).send({ error: "algo_not_found" });
      const updates = await algoUpdates(algo, await load());
      return { algo: algoRef(algo), instances: updates.map((u) => u.candidate) };
    },
  );

  app.post(
    "/managed-instances/algo-update",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["instances"],
        summary: "Move instances to an algo version: a new configuration version each, deployed on request",
        description:
          'Saves a configuration version on the algo for each named instance, with the values the preview (`GET`) shows; symbol, timeframe and trade attribution stay. An instance that needs a manual edit, or is not on another version of the algo, is left out with an error. With `deploy` (and `confirm: "all"`) the saved ones that run in a container are deployed again afterwards, in the background, one after the other: running ones restart, stopped ones stay stopped, those with an open position are left alone. `GET /managed-instances/algo-rollout` shows the progress.',
        body: AlgoUpdateInput,
        response: {
          200: AlgoUpdateResult,
          400: ErrorBody,
          403: ErrorBody,
          404: ErrorBody,
          409: ErrorBody,
          503: ErrorBody,
        },
      },
    },
    async (request, reply) => {
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const { algoId, deploy: rollOut, confirm, comment } = request.body;
      if (rollOut && confirm !== "all") return reply.code(400).send({ error: "confirmation_required" });
      if (rollOut && rolling()) return reply.code(409).send({ error: "update_running" });
      const algo = await db
        .selectFrom("algos")
        .select(["id", "name", "version", "metadata"])
        .where("id", "=", algoId)
        .executeTakeFirst();
      if (!algo) return reply.code(404).send({ error: "algo_not_found" });

      if (rollOut) algoRolloutClaimed = true;
      try {
        const list = await load();
        const updates = new Map((await algoUpdates(algo, list)).map((u) => [u.instance.name, u]));
        const who = actor(request);
        const saved: string[] = [];
        const failed: AlgoUpdateResult["failed"] = [];

        /** Saves the instance's version on the algo; the error code when it cannot be moved. */
        const move = async (name: string): Promise<string | undefined> => {
          const update = updates.get(name);
          if (!update) {
            const onIt = list.some((i) => i.name === name && i.config.algo.id === algo.id);
            return onIt ? "config_unchanged" : "instance_not_found";
          }
          if (update.candidate.issues.length) return "parameters_incomplete";
          const { instance, values } = update;
          const entry = await findAccountById(accounts, instance.account.id);
          if (!entry) return "instance_not_found";
          const { config } = instance;
          const checked = await check(
            {
              algoId: algo.id,
              symbol: config.symbol,
              period: config.period,
              parameters: values,
              attribution: config.attribution,
              ...(comment?.trim() ? { comment: comment.trim() } : {}),
            },
            entry,
          );
          if (!checked.ok) return checked.body.error;
          return (await saveVersion(cipher, instance, checked, who)) ? undefined : "config_unchanged";
        };
        for (const name of new Set(request.body.instances)) {
          // One instance failing (e.g. the broker not answering for its symbols) leaves the others to go on.
          const error = await move(name).catch((e: unknown) => {
            request.log.warn({ err: e, instance: name }, "Moving an instance to another algo version failed");
            return e instanceof AdapterError ? e.code : "internal";
          });
          if (error) failed.push({ name, error });
          else saved.push(name);
        }

        const toDeploy = saved.filter((n) => updates.get(n)?.candidate.deployed);
        if (!rollOut || !toDeploy.length) return { saved, failed };
        const state: AlgoRollout = {
          algo: algoRef(algo),
          running: true,
          startedAt: new Date().toISOString(),
          pending: toDeploy,
          updated: [],
          skipped: [],
        };
        algoRollout = state;
        void runRollout(state, who, { action: "instance.update_algo", target: `${algo.name} ${algo.version}` });
        return { saved, failed, rollout: state };
      } finally {
        // The running rollout (if any) holds the slot from here.
        if (rollOut) algoRolloutClaimed = false;
      }
    },
  );

  app.get(
    "/managed-instances/algo-rollout",
    {
      schema: {
        tags: ["instances"],
        summary: "Progress of the last deployment after moving instances to an algo version",
        response: { 200: Type.Object({ rollout: Type.Optional(AlgoRollout) }) },
      },
    },
    async () => (algoRollout ? { rollout: algoRollout } : {}),
  );

  app.put(
    "/managed-instances/:name/schedules",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["schedules"],
        summary: "Choose the schedules that pause an instance; it is paused while any of them pauses",
        description:
          "The scheduler applies them within half a minute: during one of their pauses a running instance is paused at once. Without any, an instance they paused is started again.",
        params: Type.Object({ name: Type.String() }),
        body: Type.Object({ scheduleIds: Type.Array(Type.Integer(), { maxItems: 100 }) }),
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const { name } = request.params;
      const ids = [...new Set(request.body.scheduleIds)];
      const instance = await db.selectFrom("instances").select("id").where("name", "=", name).executeTakeFirst();
      if (!instance) return reply.code(404).send({ error: "not_found" });
      const schedules = ids.length
        ? await db.selectFrom("schedules").select(["id", "name"]).where("id", "in", ids).orderBy("name").execute()
        : [];
      if (schedules.length !== ids.length) return reply.code(404).send({ error: "schedule_not_found" });
      await setLinks(db, { instanceId: instance.id }, ids);
      await audit(db, {
        action: "instance.schedule",
        target: name,
        details: { schedules: schedules.map((s) => s.name) },
        ...actor(request),
      });
      return reply.code(204).send(null);
    },
  );

  app.put(
    "/managed-instances/:name/log-rules",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["instances"],
        summary: "Switch the log rules of the instance's algo on or off for this instance",
        params: Type.Object({ name: Type.String() }),
        body: Type.Object({ enabled: Type.Boolean() }),
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const { name } = request.params;
      const { enabled } = request.body;
      const updated = await db
        .updateTable("instances")
        .set({ log_rules_off: enabled ? 0 : 1 })
        .where("name", "=", name)
        .executeTakeFirst();
      if (!updated.numUpdatedRows) return reply.code(404).send({ error: "not_found" });
      await audit(db, { action: "instance.log_rules", target: name, details: { enabled }, ...actor(request) });
      return reply.code(204).send(null);
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
        { action: "instance.delete", target: name, ...actor(request) },
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
