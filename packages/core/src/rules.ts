// Input rules shared by the server and the dashboard. Dependency-free, so the SPA can import them at runtime
// (`@wickwatch/core/rules`) without pulling in the rest of the core.

import type { InstanceStatus } from "./schemas/runtime";

export { ATTRIBUTION_MODES } from "./attribution";
export { DEFAULT_LABEL_PREFIX } from "./labels";

/** Shortest password accepted for a login. */
export const MIN_PASSWORD_LENGTH = 12;

/** Lifetimes offered for a new API token, in days; the server accepts any number up to the last one. */
export const API_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

/**
 * Instance names: lower case, digits and dashes, usable as a container name and host name. Also the default order
 * label. Use `.source` where a JSON Schema pattern is needed.
 */
export const INSTANCE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Algo names and versions end up in folder names and paths; keep them to safe characters. */
export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Running, or about to run again: counts as meant to run. */
export const isUp = (status: InstanceStatus | undefined): boolean => status === "running" || status === "restarting";
