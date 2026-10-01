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

export interface ChallengeProfilesTable {
  account_id: number;
  template_id: string | null;
  /** ChallengeProfile as JSON. */
  profile: string;
  /** YYYY-MM-DD: trading days are marked completely from this day on (services/poller.ts); null before the first run. */
  trading_days_from: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyStatsTable {
  account_id: number;
  /** YYYY-MM-DD, local date of the trading-day reset. */
  day: string;
  start_balance: number | null;
  start_equity: number | null;
  min_equity: number | null;
  max_equity: number | null;
  first_sample_at: string | null;
  last_sample_at: string | null;
  /** 1 when at least one trade closed that day. */
  traded: Generated<number>;
}

export interface AttributionOverridesTable {
  account_id: number;
  position_id: string;
  /** Instance name, or null: the position belongs to no instance (e.g. a manual trade). */
  instance: string | null;
  user_id: number | null;
  created_at: string;
}

export interface AlgosTable {
  id: Generated<number>;
  name: string;
  version: string;
  sha256: string;
  /** Relative to ALGOS_DIR. */
  file_path: string;
  size: number;
  build_time: string | null;
  full_access: number;
  /** AlgoMetadata as JSON. */
  metadata: string;
  /** Reader that produced `metadata`, "<adapter>:<version>"; null for algos stored before it was recorded. */
  metadata_reader: string | null;
  uploaded_by: number | null;
  uploaded_at: string;
}

export interface InstancesTable {
  id: Generated<number>;
  name: string;
  account_id: number;
  created_by: number | null;
  created_at: string;
  /** 1 while the instance is meant to run (started through wickwatch, or seen running). */
  should_run: Generated<number>;
  /** 1 while it is stopped on purpose through wickwatch, so its stop raises no alert. */
  stopped_by_user: Generated<number>;
}

export interface InstanceConfigsTable {
  id: Generated<number>;
  instance_id: number;
  version: number;
  algo_id: number | null;
  algo_name: string;
  algo_version: string;
  symbol: string;
  period: string;
  /** ParameterValues as JSON. */
  parameters: string;
  attribution: string;
  order_label: string | null;
  comment: string | null;
  created_by: number | null;
  created_at: string;
}

/** An alert sent to ALERT_WEBHOOK_URL that has not been resolved yet. */
export interface DailySummariesTable {
  /** YYYY-MM-DD in DAILY_SUMMARY_TIMEZONE. */
  day: string;
  sent_at: string;
}

export interface NotifiedAlertsTable {
  /** `<code>:<subject>` */
  key: string;
  level: string;
  code: string;
  subject: string;
  /** JSON of the alert params. */
  params: string;
  raised_at: string;
}

/** The loss guard's action for an account and trading day. */
export interface GuardTripsTable {
  account_id: number;
  /** Trading day of the challenge profile, YYYY-MM-DD. */
  day: string;
  /** `dailyLoss` or `maxLoss`. */
  rule: string;
  /** Share of the limit used when it acted, 0..1+. */
  usage: number;
  /** 1 when the emergency stop went through; 0 is retried on the next check. */
  ok: number;
  at: string;
}

export interface Database {
  users: UsersTable;
  credentials: CredentialsTable;
  accounts: AccountsTable;
  audit_log: AuditLogTable;
  sessions: SessionsTable;
  challenge_profiles: ChallengeProfilesTable;
  daily_stats: DailyStatsTable;
  attribution_overrides: AttributionOverridesTable;
  algos: AlgosTable;
  instances: InstancesTable;
  instance_configs: InstanceConfigsTable;
  notified_alerts: NotifiedAlertsTable;
  daily_summaries: DailySummariesTable;
  guard_trips: GuardTripsTable;
}
