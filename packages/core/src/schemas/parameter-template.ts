import Type from "typebox";
import { ParameterValues } from "./config";

// Named parameter values of an algo, to apply to any instance of it (e.g. on another account or timeframe).

/** Where the values came from; for display only. */
export const ParameterTemplateSource = Type.Union([
  Type.Object({
    kind: Type.Literal("instance"),
    instance: Type.String({ minLength: 1, maxLength: 63 }),
    version: Type.Integer({ minimum: 1 }),
  }),
  Type.Object({ kind: Type.Literal("file"), file: Type.String({ minLength: 1, maxLength: 255 }) }),
]);
export type ParameterTemplateSource = Type.Static<typeof ParameterTemplateSource>;

const TemplateName = Type.String({ minLength: 1, maxLength: 100 });

export const ParameterTemplateInput = Type.Object({
  /** Bound to the algo's name, not a version, so it survives updates of the algo. */
  algoName: Type.String({ minLength: 1, maxLength: 100 }),
  name: TemplateName,
  parameters: ParameterValues,
  source: Type.Optional(ParameterTemplateSource),
});
export type ParameterTemplateInput = Type.Static<typeof ParameterTemplateInput>;

/** Rename, or replace the values (e.g. with a newer configuration version). */
export const ParameterTemplateUpdate = Type.Object({
  name: Type.Optional(TemplateName),
  parameters: Type.Optional(ParameterValues),
  source: Type.Optional(ParameterTemplateSource),
});
export type ParameterTemplateUpdate = Type.Static<typeof ParameterTemplateUpdate>;

export const ParameterTemplate = Type.Object({
  id: Type.Integer(),
  algoName: Type.String(),
  name: Type.String(),
  /** Empty for viewers (values may hold licence keys) and without the master key. */
  parameters: ParameterValues,
  /** How many values it holds, also for viewers. */
  count: Type.Integer(),
  source: Type.Optional(ParameterTemplateSource),
  createdAt: Type.String(),
  createdBy: Type.Optional(Type.String()),
  updatedAt: Type.String(),
  updatedBy: Type.Optional(Type.String()),
});
export type ParameterTemplate = Type.Static<typeof ParameterTemplate>;
