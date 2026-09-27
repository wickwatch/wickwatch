import type {
  ParameterSchema,
  ChallengeProfile,
  ChallengeTemplate,
  EmergencyStopReport,
  HostStatus,
  InstanceDetail,
  Overview,
  SystemInfo,
} from "@wickwatch/core";

/** `code` is an i18n key suffix: error.adapter.* or error.api.* */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
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
    throw new ApiError(res.status, code);
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

const send = <T>(method: "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  request<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

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
  system: () => request<SystemInfo>("system"),
  overview: () => request<Overview>("overview"),
  host: () => request<HostStatus>("host"),
  instanceAction: (ref: string, action: InstanceAction) =>
    post<undefined>(`instances/${encodeURIComponent(ref)}/${action}`),
  instance: (ref: string, days: number) =>
    request<InstanceDetail>(`instances/${encodeURIComponent(ref)}?days=${String(days)}`),
  /** URL for an EventSource with the live log (history first, then new lines). */
  logStreamUrl: (ref: string, tail = 200) =>
    url(`instances/${encodeURIComponent(ref)}/logs/stream?tail=${String(tail)}`),
  closePosition: (account: string, positionId: string) =>
    post<undefined>(`accounts/${encodeURIComponent(account)}/positions/${encodeURIComponent(positionId)}/close`, {
      confirm: positionId,
    }),
  algos: () => request<AlgoRow[]>("algos"),
  uploadAlgo: (file: File, version?: string) =>
    request<AlgoRow>(
      `algos?fileName=${encodeURIComponent(file.name)}${version ? `&version=${encodeURIComponent(version)}` : ""}`,
      { method: "POST", body: file, headers: { "content-type": "application/octet-stream" } },
    ),
  deleteAlgo: (id: number) => send<undefined>("DELETE", `algos/${String(id)}`),
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
