import type {
  Account,
  Algo,
  ApiToken,
  AuditPage,
  Credential,
  InstanceConfigInput,
  ManagedInstance,
  ManagedInstanceDetail,
  OfferedAccount,
  ParameterFile,
  ParameterIssue,
  AccountDetail,
  ChallengeProfile,
  ChallengeTemplate,
  CreatedApiToken,
  EmergencyStopReport,
  HostStatus,
  InstanceDetail,
  InstanceStatus,
  LogPeriod,
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

export type {
  ApiToken,
  AuditPage,
  AuditRecord,
  CreatedApiToken,
  ManagedInstanceDetail,
  OfferedAccount,
} from "@wickwatch/core";

export interface SessionUser {
  username: string;
  role: "admin" | "viewer";
  totpEnabled: boolean;
  /** API tokens the user created; they outlive a password change unless deleted with it. */
  apiTokens: number;
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
  /** Needs the password and a current code. */
  totpDisable: (password: string, code: string) => post<undefined>("auth/totp/disable", { password, code }),
  /** Logs out the user's other sessions; this one stays. `deleteApiTokens` also deletes the user's API tokens. */
  changePassword: (current: string, next: string, deleteApiTokens = false) =>
    post<undefined>("auth/password", { current, next, ...(deleteApiTokens ? { deleteApiTokens } : {}) }),
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
  /** The log as a text file; `period` is how far back. */
  logDownloadUrl: (ref: string, period: LogPeriod) =>
    url(`instances/${encodeURIComponent(ref)}/logs/download?period=${period}`).toString(),
  closePosition: (account: string, positionId: string) =>
    post<undefined>(`accounts/${encodeURIComponent(account)}/positions/${encodeURIComponent(positionId)}/close`, {
      confirm: positionId,
    }),
  cancelOrder: (account: string, orderId: string) =>
    post<undefined>(`accounts/${encodeURIComponent(account)}/orders/${encodeURIComponent(orderId)}/cancel`, {
      confirm: orderId,
    }),
  algos: () => request<Algo[]>("algos"),
  audit: (query: { action?: string; target?: string; since?: string; before?: number }) => {
    const params = new URLSearchParams();
    if (query.action) params.set("action", query.action);
    if (query.target) params.set("target", query.target);
    if (query.since) params.set("since", query.since);
    if (query.before !== undefined) params.set("before", String(query.before));
    const qs = params.toString();
    return request<AuditPage>(`audit${qs ? `?${qs}` : ""}`);
  },
  apiTokens: () => request<ApiToken[]>("api-tokens"),
  /** The answer holds the token itself, which is not shown again. Without `expiresInDays` it does not expire. */
  /** Needs the password and, with 2FA on, a current code. */
  createApiToken: (body: {
    name: string;
    role: "admin" | "viewer";
    expiresInDays?: number;
    password: string;
    code?: string;
  }) => post<CreatedApiToken>("api-tokens", body),
  deleteApiToken: (id: number) => send<undefined>("DELETE", `api-tokens/${String(id)}`),
  /** Address of the read-only MCP endpoint, for AI clients with an API token. */
  mcpUrl: () => new URL("mcp", document.baseURI).toString(),
  uploadAlgo: (file: File, version?: string) =>
    request<Algo>(
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
  managedInstances: () => request<ManagedInstance[]>("managed-instances"),
  managedInstance: (name: string) => request<ManagedInstanceDetail>(`managed-instances/${encodeURIComponent(name)}`),
  createManagedInstance: (body: { name: string; accountId: number; config: InstanceConfigInput }) =>
    post<ManagedInstance>("managed-instances", body),
  saveInstanceConfig: (name: string, config: InstanceConfigInput) =>
    post<ManagedInstance>(`managed-instances/${encodeURIComponent(name)}/configs`, config),
  deleteManagedInstance: (name: string) =>
    send<undefined>("DELETE", `managed-instances/${encodeURIComponent(name)}`, { confirm: name }),
  /** Creates or replaces the container with the current configuration; `start` also starts it. */
  deployInstance: (name: string, start: boolean) =>
    post<{ status: InstanceStatus; configVersion: number }>(`managed-instances/${encodeURIComponent(name)}/deploy`, {
      confirm: name,
      start,
    }),
  accountSymbols: (id: number) => request<string[]>(`accounts/${String(id)}/symbols`),
  accounts: () => request<Account[]>("accounts"),
  createAccount: (body: { number: string; displayName: string; credentialId: number }) =>
    post<Account>("accounts", body),
  updateAccount: (id: number, body: { displayName?: string; credentialId?: number }) =>
    send<Account>("PATCH", `accounts/${String(id)}`, body),
  deleteAccount: (id: number) => send<undefined>("DELETE", `accounts/${String(id)}`),
  credentials: () => request<Credential[]>("credentials"),
  createCredential: (body: { label: string; login: string; secret: string }) => post<Credential>("credentials", body),
  updateCredential: (id: number, body: { label?: string; login?: string; secret?: string }) =>
    send<Credential>("PATCH", `credentials/${String(id)}`, body),
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

/** Starts the download of a file the server sends as an attachment (parameter file, log), as a download link would. */
export function downloadFile(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = "";
  link.click();
}
