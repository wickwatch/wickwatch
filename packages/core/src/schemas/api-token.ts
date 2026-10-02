import Type from "typebox";
import { IsoTime } from "./common";

/** A token for scripts and MCP clients; the token itself is only in `CreatedApiToken`, once. */
export const ApiToken = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  /** The first characters of the token, to recognise it. */
  prefix: Type.String(),
  role: Type.Union([Type.Literal("admin"), Type.Literal("viewer")]),
  /** The user who created it; requests with the token act as this user. */
  user: Type.String(),
  createdAt: IsoTime,
  /** Missing: does not expire. */
  expiresAt: Type.Optional(IsoTime),
  expired: Type.Boolean(),
  lastUsedAt: Type.Optional(IsoTime),
});
export type ApiToken = Type.Static<typeof ApiToken>;

export const CreatedApiToken = Type.Object({ ...ApiToken.properties, token: Type.String() });
export type CreatedApiToken = Type.Static<typeof CreatedApiToken>;
