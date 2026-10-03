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
  /**
   * The parameter holding the risk per trade in percent of the algo's capital (the account size parameter, else the
   * account's size); wickwatch shows it in money and against the challenge's loss limits.
   */
  riskParameter: Type.Optional(Type.String()),
});
export type AlgoSettings = Type.Static<typeof AlgoSettings>;

const SettingParameter = Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]);

/** Fields left out stay as they are; null switches one off. */
export const AlgoSettingsInput = Type.Object({
  accountSizeParameter: Type.Optional(SettingParameter),
  riskParameter: Type.Optional(SettingParameter),
});
export type AlgoSettingsInput = Type.Static<typeof AlgoSettingsInput>;
