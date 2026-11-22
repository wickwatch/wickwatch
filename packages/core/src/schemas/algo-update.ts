import Type from "typebox";
import { ParameterIssue } from "./config";
import { rolloutProgress } from "./platform";

const AlgoRef = Type.Object({ id: Type.Integer(), name: Type.String(), version: Type.String() });

/** Deploying the instances moved to another algo version, in the background, or done. */
export const AlgoRollout = Type.Object({ algo: AlgoRef, ...rolloutProgress });
export type AlgoRollout = Type.Static<typeof AlgoRollout>;

/** An instance on another version of the algo, and what moving it to this one does to its parameters. */
export const AlgoUpdateCandidate = Type.Object({
  name: Type.String(),
  account: Type.Object({ id: Type.Integer(), number: Type.String(), displayName: Type.String() }),
  /** The version its current configuration uses. */
  from: Type.Object({ id: Type.Union([Type.Integer(), Type.Null()]), version: Type.String() }),
  configVersion: Type.Integer(),
  /** Whether wickwatch runs it in a container, which a rollout would replace. */
  deployed: Type.Boolean(),
  /** Parameters the version adds; they take its default. */
  added: Type.Array(Type.String()),
  /** Parameters the version no longer has; their values are left out. */
  dropped: Type.Array(Type.String()),
  /** Values at the old default that follow the new one. */
  newDefaults: Type.Array(Type.Object({ parameter: Type.String(), from: Type.Unknown(), to: Type.Unknown() })),
  /** Values that do not fit the version; they take its default. */
  rejected: Type.Array(ParameterIssue),
  /** What is still wrong afterwards; such an instance needs a manual edit and cannot be moved here. */
  issues: Type.Array(ParameterIssue),
});
export type AlgoUpdateCandidate = Type.Static<typeof AlgoUpdateCandidate>;

export const AlgoUpdatePreview = Type.Object({
  algo: AlgoRef,
  instances: Type.Array(AlgoUpdateCandidate),
});
export type AlgoUpdatePreview = Type.Static<typeof AlgoUpdatePreview>;

export const AlgoUpdateInput = Type.Object({
  algoId: Type.Integer(),
  instances: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { minItems: 1, maxItems: 200 }),
  /** Deploy the moved instances afterwards, one after the other; needs `confirm: "all"`. */
  deploy: Type.Optional(Type.Boolean()),
  confirm: Type.Optional(Type.String()),
  /** The comment of the new configuration versions. */
  comment: Type.Optional(Type.String({ maxLength: 500 })),
});
export type AlgoUpdateInput = Type.Static<typeof AlgoUpdateInput>;

export const AlgoUpdateResult = Type.Object({
  /** Instances with a new configuration version on the algo. */
  saved: Type.Array(Type.String()),
  failed: Type.Array(Type.Object({ name: Type.String(), error: Type.String() })),
  /** With `deploy`: the rollout started for the saved ones that run in a container. */
  rollout: Type.Optional(AlgoRollout),
});
export type AlgoUpdateResult = Type.Static<typeof AlgoUpdateResult>;
