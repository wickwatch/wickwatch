import Type from "typebox";
import { ATTRIBUTION_MODES } from "../attribution";
import { ParameterValues } from "./config";
import { InstanceStatus } from "./runtime";

// Instances the dashboard creates and deploys, with their versioned configurations.

export const Attribution = Type.Object({
  mode: Type.Enum(ATTRIBUTION_MODES),
  /** Expected order label (`label`, default: the instance name) or regular expression (`label-pattern`). */
  orderLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});
export type Attribution = Type.Static<typeof Attribution>;

/** A new configuration version, as sent by the client. */
export const InstanceConfigInput = Type.Object({
  algoId: Type.Integer(),
  symbol: Type.String({ minLength: 1, maxLength: 100 }),
  period: Type.String({ minLength: 1, maxLength: 50 }),
  /** Parameters left out are stored with the algo's default. */
  parameters: ParameterValues,
  attribution: Attribution,
  comment: Type.Optional(Type.String({ maxLength: 500 })),
  /** The parameter template the values were taken from; named in the audit log. */
  template: Type.Optional(Type.Integer()),
});
export type InstanceConfigInput = Type.Static<typeof InstanceConfigInput>;

export const InstanceConfig = Type.Object({
  version: Type.Integer(),
  /** `id` is null when this algo version was deleted since. */
  algo: Type.Object({ id: Type.Union([Type.Integer(), Type.Null()]), name: Type.String(), version: Type.String() }),
  symbol: Type.String(),
  period: Type.String(),
  parameters: ParameterValues,
  attribution: Attribution,
  comment: Type.Optional(Type.String()),
  createdAt: Type.String(),
  createdBy: Type.Optional(Type.String()),
});
export type InstanceConfig = Type.Static<typeof InstanceConfig>;

/** The runtime instance of the same name, if there is one. */
export const Deployment = Type.Object({
  status: InstanceStatus,
  /** Created by wickwatch; false for a container of the same name defined elsewhere. */
  managed: Type.Boolean(),
  /** Configuration version the instance runs with (from its labels). */
  configVersion: Type.Optional(Type.Integer()),
});
export type Deployment = Type.Static<typeof Deployment>;

export const ManagedInstance = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  account: Type.Object({ id: Type.Integer(), number: Type.String(), displayName: Type.String() }),
  createdAt: Type.String(),
  config: InstanceConfig,
  deployment: Type.Optional(Deployment),
});
export type ManagedInstance = Type.Static<typeof ManagedInstance>;

export const ManagedInstanceDetail = Type.Intersect([
  ManagedInstance,
  Type.Object({ history: Type.Array(InstanceConfig, { description: "All versions, newest first" }) }),
]);
export type ManagedInstanceDetail = Type.Static<typeof ManagedInstanceDetail>;
