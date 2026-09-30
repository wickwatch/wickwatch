import type {
  AttributionMode,
  ParameterFile,
  ParameterIssue,
  ParameterSchema,
  ParameterValues,
  AccountDetail,
  ChallengeProfile,
  ChallengeTemplate,
  EmergencyStopReport,
  HostStatus,
  InstanceDetail,
  InstanceStatus,
  Overview,
  SystemInfo,
} from "@wickwatch/core";

/** `code` is an i18n key suffix: error.adapter.* or error.api.* */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Parameter problems of a rejected configuration (`invalid_parameters`); `message` names a rejected field. */
    readonly details: { issues?: ParameterIssue[]; unknown?: string[]; message?: string } = {},
  ) {
    super(`API error ${status}: ${code}`);
  }
}

// Relative to <base href>, so the SPA works under any BASE_PATH.
const url = (path: string) => new URL(`api/v1/${path}`, document.baseURI);

let onUnauthenticated: (() => void) | undefined;

/** Called when the session has expired, e.g. to show the login page. */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url(path), { headers: { accept: "application/json" }, ...init });
  } catch {
    throw new ApiError(0, "network");
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const code = typeof body === "object" && body && "error" in body ? String(body.error) : "internal";
    if (res.status === 401 && code === "unauthenticated") onUnauthenticated?.();
    const details = typeof body === "object" && body ? (body as ApiError["details"]) : {};
    throw new ApiError(res.status, code, {
      ...(details.issues ? { issues: details.issues } : {}),
      ...(details.unknown ? { unknown: details.unknown } : {}),
      ...(typeof details.message === "string" ? { message: details.message } : {}),
    });
  }
  return body as T;
}

const send = <T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  request<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

const post = <T>(path: string, body?: unknown) => send<T>("POST", path, body);

export type InstanceAction = "start" | "stop" | "restart";

export interface AccountRow {
  id: number;
  adapter: string;
  number: string;
  broker: string;
  currency: string;
  displayName: string;
  credentialId: number | null;
  credentialLabel: string | null;
  timezone: string | null;
  hasChallenge: boolean;
}

export interface AlgoRow {
  id: number;
  name: string;
  version: string;
  sha256: string;
  size: number;
  buildTime?: string;
  fullAccess: boolean;
  parameters: ParameterSchema[];
  uploadedAt: string;
}

export interface Attribution {
  mode: AttributionMode;
  orderLabel?: string;
}

export interface InstanceConfigRow {
  version: number;
  /** `id` is null when this algo version was deleted since. */
  algo: { id: number | null; name: string; version: string };
  symbol: string;
  period: string;
  parameters: ParameterValues;
  attribution: Attribution;
  comment?: string;
  createdAt: string;
  createdBy?: string;
}

export interface Deployment {
  status: InstanceStatus;
  /** False for a container of the same name that Wickwatch did not create. */
  managed: boolean;
  configVersion?: number;
}

export interface ManagedInstanceRow {
  id: number;
  name: string;
  account: { id: number; number: string; displayName: string };
  createdAt: string;
  config: InstanceConfigRow;
  deployment?: Deployment;
}

export interface ManagedInstanceDetail extends ManagedInstanceRow {
  /** Newest first. */
  history: InstanceConfigRow[];
}

export interface ConfigInput {
  algoId: number;
  symbol: string;
  period: string;
  parameters: ParameterValues;
  attribution: Attribution;
  comment?: string;
}

export interface CredentialRow {
  id: number;
  label: string;
  login: string;
  createdAt: string;
  accounts: number;
}

export interface OfferedAccount {
  number: string;
  broker: string;
  currency: string;
  live: boolean;
  /** False for closed accounts the broker still lists. */
  active?: boolean;
  /** Name the broker shows, e.g. a challenge name. */
  name?: string;
  added: boolean;
}

export interface SessionUser {
  username: string;
  role: "admin" | "viewer";
  totpEnabled: boolean;
}

export interface SessionInfo {
  setupRequired: boolean;
  masterKeyConfigured: boolean;
  user?: SessionUser;
}

export interface TotpSetup {
  secret: string;
  uri: string;
  /** PNG data URL of the QR code. */
  qr: string;
}

export interface AuditRecord {
  id: number;
  time: string;
  user?: string;
  action: string;
  target?: string;
  details?: Record<string, unknown>;
}
export interface AuditPage {
  entries: AuditRecord[];
  more: boolean;
  actions: string[];
}

export const api = {
  session: () => request<SessionInfo>("auth/session"),
  /** Throws ApiError "totp_required" when 2FA is on and no code was given. */
  login: (body: { username: string; password: string; code?: string }) => post<SessionUser>("auth/login", body),
  logout: () => post<undefined>("auth/logout"),
  setupTotp: (body: { token: string; username: string }) => post<TotpSetup>("auth/setup/totp", body),
  /** Without `code` the admin is created without 2FA. */
  setup: (body: { token: string; username: string; password: string; code?: string }) =>
    post<SessionUser>("auth/setup", body),
  totpSetup: () => post<TotpSetup>("auth/totp/setup"),
  totpEnable: (code: string) => post<undefined>("auth/totp/enable", { code }),
  totpDisable: (password: string) => post<undefined>("auth/totp/disable", { password }),
  /** Logs out the user's other sessions; this one stays. */
  changePassword: (current: string, next: string) => post<undefined>("auth/password", { current, next }),
  system: () => request<SystemInfo>("system"),
  overview: () => request<Overview>("overview"),
  accountDetail: (number: string) => request<AccountDetail>(`accounts/${encodeURIComponent(number)}/detail`),
  host: () => request<HostStatus>("host"),
  instanceAction: (ref: string, action: InstanceAction) =>
    post<undefined>(`instances/${encodeURIComponent(ref)}/${action}`),
  /** `all`: everything since the instance's first trade. */
  instance: (ref: string, days: number | "all") =>
    request<InstanceDetail>(
      `instances/${encodeURIComponent(ref)}?${days === "all" ? "all=true" : `days=${String(days)}`}`,
    ),
  /** URL for an EventSource with the live log (history first, then new lines). */
  logStreamUrl: (ref: string, tail = 200) =>
    url(`instances/${encodeURIComponent(ref)}/logs/stream?tail=${String(tail)}`),
  closePosition: (account: string, positionId: string) =>
    post<undefined>(`accounts/${encodeURIComponent(account)}/positions/${encodeURIComponent(positionId)}/close`, {
      confirm: positionId,
    }),
  cancelOrder: (account: string, orderId: string) =>
    post<undefined>(`accounts/${encodeURIComponent(account)}/orders/${encodeURIComponent(orderId)}/cancel`, {
      confirm: orderId,
    }),
  algos: () => request<AlgoRow[]>("algos"),
  audit: (query: { action?: string; target?: string; since?: string; before?: number }) => {
    const params = new URLSearchParams();
    if (query.action) params.set("action", query.action);
    if (query.target) params.set("target", query.target);
    if (query.since) params.set("since", query.since);
    if (query.before !== undefined) params.set("before", String(query.before));
    const qs = params.toString();
    return request<AuditPage>(`audit${qs ? `?${qs}` : ""}`);
  },
  uploadAlgo: (file: File, version?: string) =>
    request<AlgoRow>(
      `algos?fileName=${encodeURIComponent(file.name)}${version ? `&version=${encodeURIComponent(version)}` : ""}`,
      { method: "POST", body: file, headers: { "content-type": "application/octet-stream" } },
    ),
  deleteAlgo: (id: number) => send<undefined>("DELETE", `algos/${String(id)}`),
  /** Reads a parameter file for an algo; the server stores nothing. */
  parseParameterFile: (algoId: number, file: File) =>
    request<ParameterFile>(`algos/${String(algoId)}/parameter-file`, {
      method: "POST",
      body: file,
      headers: { "content-type": "application/octet-stream" },
    }),
  /** Download link for a configuration version as a parameter file (admins). */
  parameterFileUrl: (name: string, version: number) =>
    url(`managed-instances/${encodeURIComponent(name)}/parameter-file?version=${String(version)}`).toString(),
  managedInstances: () => request<ManagedInstanceRow[]>("managed-instances"),
  managedInstance: (name: string) => request<ManagedInstanceDetail>(`managed-instances/${encodeURIComponent(name)}`),
  createManagedInstance: (body: { name: string; accountId: number; config: ConfigInput }) =>
    post<ManagedInstanceRow>("managed-instances", body),
  saveInstanceConfig: (name: string, config: ConfigInput) =>
    post<ManagedInstanceRow>(`managed-instances/${encodeURIComponent(name)}/configs`, config),
  deleteManagedInstance: (name: string) =>
    send<undefined>("DELETE", `managed-instances/${encodeURIComponent(name)}`, { confirm: name }),
  /** Creates or replaces the container with the current configuration; `start` also starts it. */
  deployInstance: (name: string, start: boolean) =>
    post<{ status: InstanceStatus; configVersion: number }>(`managed-instances/${encodeURIComponent(name)}/deploy`, {
      confirm: name,
      start,
    }),
  accountSymbols: (id: number) => request<string[]>(`accounts/${String(id)}/symbols`),
  accounts: () => request<AccountRow[]>("accounts"),
  createAccount: (body: { number: string; displayName: string; credentialId: number }) =>
    post<AccountRow>("accounts", body),
  updateAccount: (id: number, body: { displayName?: string; credentialId?: number }) =>
    send<AccountRow>("PATCH", `accounts/${String(id)}`, body),
  deleteAccount: (id: number) => send<undefined>("DELETE", `accounts/${String(id)}`),
  credentials: () => request<CredentialRow[]>("credentials"),
  createCredential: (body: { label: string; login: string; secret: string }) =>
    post<CredentialRow>("credentials", body),
  updateCredential: (id: number, body: { label?: string; login?: string; secret?: string }) =>
    send<CredentialRow>("PATCH", `credentials/${String(id)}`, body),
  deleteCredential: (id: number) => send<undefined>("DELETE", `credentials/${String(id)}`),
  brokerAccounts: (credentialId: number) =>
    request<OfferedAccount[]>(`credentials/${String(credentialId)}/broker-accounts`),
  challengeTemplates: () => request<ChallengeTemplate[]>("challenge-templates"),
  challenge: (account: string) => request<ChallengeProfile>(`accounts/${encodeURIComponent(account)}/challenge`),
  saveChallenge: (account: string, profile: ChallengeProfile) =>
    send<ChallengeProfile>("PUT", `accounts/${encodeURIComponent(account)}/challenge`, profile),
  deleteChallenge: (account: string) => send<undefined>("DELETE", `accounts/${encodeURIComponent(account)}/challenge`),
  /** `instance: null`: the position belongs to no instance (e.g. a manual trade). */
  setAttribution: (account: string, positionId: string, instance: string | null) =>
    send<undefined>(
      "PUT",
      `accounts/${encodeURIComponent(account)}/positions/${encodeURIComponent(positionId)}/attribution`,
      {
        instance,
      },
    ),
  clearAttribution: (account: string, positionId: string) =>
    send<undefined>(
      "DELETE",
      `accounts/${encodeURIComponent(account)}/positions/${encodeURIComponent(positionId)}/attribution`,
    ),
  emergencyStop: (account: string) =>
    post<EmergencyStopReport>(`accounts/${encodeURIComponent(account)}/emergency-stop`, { confirm: account }),
};

const ADAPTER_CODES = ["auth_failed", "not_found", "unsupported", "invalid_input", "timeout", "unavailable"];

/** i18n key for an error: adapter codes under error.adapter.*, everything else under error.api.* */
export const errorKey = (error: unknown): string =>
  error instanceof ApiError
    ? ADAPTER_CODES.includes(error.code)
      ? `error.adapter.${error.code}`
      : `error.api.${error.code}`
    : "error.api.internal";
