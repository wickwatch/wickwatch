import { ParameterTemplate, ParameterTemplateInput, ParameterTemplateUpdate } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import type { Db } from "../db";
import { actor, isAdmin, requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import type { Cipher } from "../security/cipher";
import { audit } from "../services/audit";
import { canonicalParameters } from "../services/instance-configs";
import { listTemplates, PURPOSE, templateQuery, toTemplate } from "../services/parameter-templates";

const IdParams = Type.Object({ id: Type.Integer() });

export const parameterTemplateRoutes: FastifyPluginAsyncTypebox<{ db: Db; cipher: Cipher | undefined }> = async (
  app,
  { db, cipher },
) => {
  const byId = (id: number) => templateQuery(db).where("parameter_templates.id", "=", id).executeTakeFirst();

  /** Another template of the same algo already has this name. */
  const nameTaken = async (algoName: string, name: string, except?: number) => {
    let query = db
      .selectFrom("parameter_templates")
      .select("id")
      .where("algo_name", "=", algoName)
      .where("name", "=", name);
    if (except !== undefined) query = query.where("id", "!=", except);
    return (await query.executeTakeFirst()) !== undefined;
  };

  app.get(
    "/parameter-templates",
    {
      schema: {
        tags: ["algos"],
        summary: "Parameter templates, by algo and name",
        description: "Values only for admins, as with configurations: they may hold licence keys.",
        querystring: Type.Object({ algo: Type.Optional(Type.String({ description: "Only this algo's templates" })) }),
        response: { 200: Type.Array(ParameterTemplate) },
      },
    },
    async (request) => {
      const admin = isAdmin(request);
      return (await listTemplates(db, request.query.algo)).map((row) => toTemplate(row, cipher, admin));
    },
  );

  app.get(
    "/parameter-templates/:id",
    {
      schema: {
        tags: ["algos"],
        summary: "One parameter template",
        description: "Values only for admins, as in the list.",
        params: IdParams,
        response: { 200: ParameterTemplate, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const row = await byId(request.params.id);
      if (!row) return reply.code(404).send({ error: "not_found" });
      return toTemplate(row, cipher, isAdmin(request));
    },
  );

  app.post(
    "/parameter-templates",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["algos"],
        summary: "Save parameter values as a template, e.g. from a configuration version or a parameter file",
        description: "The values are not checked against a version of the algo; applying the template does that.",
        body: ParameterTemplateInput,
        response: { 201: ParameterTemplate, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const { algoName, parameters, source } = request.body;
      const name = request.body.name.trim();
      const algo = await db.selectFrom("algos").select("id").where("name", "=", algoName).executeTakeFirst();
      if (!algo) return reply.code(404).send({ error: "algo_not_found" });
      if (!name || (await nameTaken(algoName, name))) {
        return reply.code(409).send({ error: "parameter_template_exists" });
      }
      const now = new Date().toISOString();
      const userId = request.user?.id ?? null;
      const { id } = await db
        .insertInto("parameter_templates")
        .values({
          algo_name: algoName,
          name,
          parameters: cipher.encrypt(canonicalParameters(parameters), PURPOSE),
          source: source ? JSON.stringify(source) : null,
          created_by: userId,
          created_at: now,
          updated_by: userId,
          updated_at: now,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await audit(db, {
        action: "parameter_template.create",
        target: name,
        details: { algo: algoName, parameters: Object.keys(parameters).length, ...(source ? { source } : {}) },
        ...actor(request),
      });
      const row = await byId(id);
      if (!row) throw new Error(`Parameter template ${String(id)} vanished`);
      return reply.code(201).send(toTemplate(row, cipher, true));
    },
  );

  app.patch(
    "/parameter-templates/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["algos"],
        summary: "Rename a parameter template or replace its values",
        params: IdParams,
        body: ParameterTemplateUpdate,
        response: { 200: ParameterTemplate, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const row = await byId(request.params.id);
      if (!row) return reply.code(404).send({ error: "not_found" });
      const { parameters, source } = request.body;
      const name = request.body.name?.trim();
      if (name !== undefined && (!name || (await nameTaken(row.algo_name, name, row.id)))) {
        return reply.code(409).send({ error: "parameter_template_exists" });
      }
      await db
        .updateTable("parameter_templates")
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(parameters ? { parameters: cipher.encrypt(canonicalParameters(parameters), PURPOSE) } : {}),
          // New values come from somewhere else; the old source would be wrong.
          ...(parameters ? { source: source ? JSON.stringify(source) : null } : {}),
          updated_by: request.user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .where("id", "=", row.id)
        .execute();
      await audit(db, {
        action: "parameter_template.update",
        target: name ?? row.name,
        details: {
          algo: row.algo_name,
          ...(name !== undefined && name !== row.name ? { renamedFrom: row.name } : {}),
          ...(parameters ? { parameters: Object.keys(parameters).length } : {}),
          ...(parameters && source ? { source } : {}),
        },
        ...actor(request),
      });
      const updated = await byId(row.id);
      if (!updated) return reply.code(404).send({ error: "not_found" });
      return toTemplate(updated, cipher, true);
    },
  );

  app.delete(
    "/parameter-templates/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["algos"],
        summary: "Delete a parameter template; configurations saved from it stay as they are",
        params: IdParams,
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const row = await byId(request.params.id);
      if (!row) return reply.code(404).send({ error: "not_found" });
      await db.deleteFrom("parameter_templates").where("id", "=", row.id).execute();
      await audit(db, {
        action: "parameter_template.delete",
        target: row.name,
        details: { algo: row.algo_name },
        ...actor(request),
      });
      return reply.code(204).send(null);
    },
  );
};
