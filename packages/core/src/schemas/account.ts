import Type from "typebox";
import { BrokerAccount } from "./broker";

// Accounts and broker logins as the dashboard stores them.

export const Account = Type.Object({
  id: Type.Integer(),
  adapter: Type.String(),
  number: Type.String(),
  broker: Type.String(),
  currency: Type.String(),
  displayName: Type.String(),
  credentialId: Type.Union([Type.Integer(), Type.Null()]),
  /** Label of the login (never the secret), so viewers can see which login an account uses. */
  credentialLabel: Type.Union([Type.String(), Type.Null()]),
  timezone: Type.Union([Type.String(), Type.Null()]),
  hasChallenge: Type.Boolean(),
});
export type Account = Type.Static<typeof Account>;

/** A stored broker login; never contains the secret. */
export const Credential = Type.Object({
  id: Type.Integer(),
  label: Type.String(),
  login: Type.String(),
  createdAt: Type.String(),
  /** Number of accounts using this login. */
  accounts: Type.Integer({ minimum: 0 }),
});
export type Credential = Type.Static<typeof Credential>;

/** An account the broker offers for a login, and whether it is added already. */
export const OfferedAccount = Type.Intersect([BrokerAccount, Type.Object({ added: Type.Boolean() })]);
export type OfferedAccount = Type.Static<typeof OfferedAccount>;
