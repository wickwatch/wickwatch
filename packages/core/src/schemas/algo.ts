import Type from "typebox";
import { ParameterSchema } from "./broker";

/** An uploaded algo version. */
export const Algo = Type.Object({
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
export type Algo = Type.Static<typeof Algo>;

/** Settings of an algo, by its name: they hold for all its versions. */
export const AlgoSettings = Type.Object({
  algoName: Type.String(),
  /**
   * The parameter holding the account size the algo calculates with, e.g. a starting capital; checked against the
   * account's (challenge start balance, else balance) so a wrong value is noticed before it trades.
   */
  accountSizeParameter: Type.Optional(Type.String()),
});
export type AlgoSettings = Type.Static<typeof AlgoSettings>;

export const AlgoSettingsInput = Type.Object({
  /** null: no check. */
  accountSizeParameter: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
});
export type AlgoSettingsInput = Type.Static<typeof AlgoSettingsInput>;
