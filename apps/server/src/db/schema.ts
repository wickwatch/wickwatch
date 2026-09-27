import type { Generated } from "kysely";

// Table types for Kysely. Timestamps are ISO 8601 strings in UTC.

export type Role = "admin" | "viewer";

export interface UsersTable {
  id: Generated<number>;
  username: string;
  password_hash: string;
  /** Encrypted with the master key; null until 2FA is set up. */
  totp_secret: string | null;
  totp_last_counter: number | null;
  role: Role;
  created_at: string;
  updated_at: string;
}

export interface CredentialsTable {
  id: Generated<number>;
  label: string;
  login: string;
  /** Encrypted with the master key; never logged. */
  secret: string;
  created_at: string;
  updated_at: string;
}

export interface AccountsTable {
  id: Generated<number>;
  /** Id of the broker adapter that serves this account. */
  adapter: string;
  number: string;
  broker: string;
  currency: string;
  display_name: string;
  credential_id: number | null;
  /** IANA time zone for daily resets and display, e.g. Europe/Berlin. */
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionsTable {
  /** SHA-256 (hex) of the token in the cookie. */
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

export interface AuditLogTable {
  id: Generated<number>;
  time: string;
  user_id: number | null;
  action: string;
  target: string | null;
  /** JSON object with action-specific details; never secrets. */
  details: string | null;
}

export interface Database {
  users: UsersTable;
  credentials: CredentialsTable;
  accounts: AccountsTable;
  audit_log: AuditLogTable;
  sessions: SessionsTable;
}
