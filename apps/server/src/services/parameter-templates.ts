import { ParameterTemplateSource, ParameterValues, type ParameterTemplate } from "@wickwatch/core";
import Value from "typebox/value";
import type { Db } from "../db";
import type { ParameterTemplatesTable } from "../db/schema";
import type { Cipher } from "../security/cipher";

// Parameter values may hold licence keys, so they are encrypted like those of a configuration version.
export const PURPOSE = "template-parameters";

type TemplateRow = Omit<ParameterTemplatesTable, "id"> & {
  id: number;
  created_by_name: string | null;
  updated_by_name: string | null;
};

/** The values of a stored template; empty without the master key. */
function valuesOf(cipher: Cipher | undefined, stored: string): ParameterValues {
  if (!cipher) return {};
  const parsed: unknown = JSON.parse(cipher.decrypt(stored, PURPOSE));
  return Value.Check(ParameterValues, parsed) ? parsed : {};
}

export function toTemplate(row: TemplateRow, cipher: Cipher | undefined, withValues: boolean): ParameterTemplate {
  const parameters = valuesOf(cipher, row.parameters);
  const source: unknown = row.source === null ? undefined : JSON.parse(row.source);
  return {
    id: row.id,
    algoName: row.algo_name,
    name: row.name,
    parameters: withValues ? parameters : {},
    count: Object.keys(parameters).length,
    ...(Value.Check(ParameterTemplateSource, source) ? { source } : {}),
    createdAt: row.created_at,
    ...(row.created_by_name ? { createdBy: row.created_by_name } : {}),
    updatedAt: row.updated_at,
    ...(row.updated_by_name ? { updatedBy: row.updated_by_name } : {}),
  };
}

/** Templates with the names of who created and last changed them. */
export const templateQuery = (db: Db) =>
  db
    .selectFrom("parameter_templates")
    .leftJoin("users as creator", "creator.id", "parameter_templates.created_by")
    .leftJoin("users as updater", "updater.id", "parameter_templates.updated_by")
    .selectAll("parameter_templates")
    .select(["creator.username as created_by_name", "updater.username as updated_by_name"]);

/** All templates, or one algo's, by algo and name. */
export function listTemplates(db: Db, algo?: string) {
  let query = templateQuery(db).orderBy("parameter_templates.algo_name").orderBy("parameter_templates.name");
  if (algo !== undefined) query = query.where("parameter_templates.algo_name", "=", algo);
  return query.execute();
}

/** A template with the names of the parameters it sets instead of their values, which may hold licence keys. */
export function withParameterNames(
  row: TemplateRow,
  cipher: Cipher | undefined,
): Omit<ParameterTemplate, "parameters"> & { parameterNames: string[] } {
  const { parameters, ...template } = toTemplate(row, cipher, true);
  return { ...template, parameterNames: Object.keys(parameters) };
}
