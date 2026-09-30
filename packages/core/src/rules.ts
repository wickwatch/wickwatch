// Input rules shared by the server and the dashboard. Dependency-free, so the SPA can import them at runtime
// (`@wickwatch/core/rules`) without pulling in the rest of the core.

export { ATTRIBUTION_MODES } from "./attribution";
export { DEFAULT_LABEL_PREFIX } from "./labels";

/** Shortest password accepted for a login. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Instance names: lower case, digits and dashes, usable as a container name and host name. Also the default order
 * label. Use `.source` where a JSON Schema pattern is needed.
 */
export const INSTANCE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Algo names and versions end up in folder names and paths; keep them to safe characters. */
export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
