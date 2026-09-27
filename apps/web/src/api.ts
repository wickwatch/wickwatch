import type { EmergencyStopReport, HostStatus, Overview, SystemInfo } from "@wickwatch/core";

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
    throw new ApiError(res.status, code);
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

export type InstanceAction = "start" | "stop" | "restart";

export const api = {
  system: () => request<SystemInfo>("system"),
  overview: () => request<Overview>("overview"),
  host: () => request<HostStatus>("host"),
  instanceAction: (ref: string, action: InstanceAction) =>
    post<undefined>(`instances/${encodeURIComponent(ref)}/${action}`),
  emergencyStop: (account: string) =>
    post<EmergencyStopReport>(`accounts/${encodeURIComponent(account)}/emergency-stop`, { confirm: account }),
};

export const errorKey = (error: unknown): string =>
  error instanceof ApiError
    ? ["network", "internal", "confirmation_required"].includes(error.code)
      ? `error.api.${error.code}`
      : `error.adapter.${error.code}`
    : "error.api.internal";
