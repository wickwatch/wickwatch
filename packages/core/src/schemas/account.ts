import Type from "typebox";
import { BrokerAccount } from "./broker";

// Accounts and broker logins as the dashboard stores them.

/**
 * The size of an account to check an algo's account size parameter against (AlgoSettings): the challenge's start
 * balance (`challengeStart`), else the balance at the start of the latest recorded trading day (`dayStart`).
 */
export const AccountSize = Type.Object({
  value: Type.Number(),
  basis: Type.Union([Type.Literal("challengeStart"), Type.Literal("dayStart")]),
});
export type AccountSize = Type.Static<typeof AccountSize>;

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
  /** What an algo's account size parameter is checked against; missing while nothing is known yet. */
  accountSize: Type.Optional(AccountSize),
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
