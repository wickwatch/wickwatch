/** Where wickwatch runs the CLI for its own queries. */
export const CTRADER_CLI_MODES = ["local", "container"] as const;
export type CtraderCliMode = (typeof CTRADER_CLI_MODES)[number];

/** Upper bound of the session idle time: well below what a timer can hold (about 24 days). */
const DAY_SECONDS = 86_400;

/** The adapter's settings from the environment (CTRADER_*). */
export interface CtraderCliSettings {
  /** `local`: `cliPath` on this machine; `container`: the CLI of `image` via the runtime. */
  cli: CtraderCliMode;
  /** CLI executable for `cli: "local"`. */
  cliPath: string;
  /** Image instances run with; the adapter's tested version when unset. */
  image?: string;
  /** A shell session without commands for this long is closed; the adapter's default when unset. */
  sessionIdleMs?: number;
}

/**
 * Reads CTRADER_IMAGE, CTRADER_CLI, CTRADER_CLI_PATH and CTRADER_SESSION_IDLE_SECONDS through `get` (unset or empty: undefined) and adds a
 * message to `problems` for every invalid value. `isPinnedImage` is the runtime's rule for a pinned image reference.
 */
export function readCtraderCliSettings(
  get: (name: string) => string | undefined,
  problems: string[],
  isPinnedImage: (image: string) => boolean,
): CtraderCliSettings {
  const image = get("CTRADER_IMAGE");
  if (image && !isPinnedImage(image)) problems.push("CTRADER_IMAGE must be pinned to a version or digest, not latest");
  const cli = get("CTRADER_CLI") ?? "local";
  if (!(CTRADER_CLI_MODES as readonly string[]).includes(cli)) problems.push("CTRADER_CLI must be local or container");
  const idle = get("CTRADER_SESSION_IDLE_SECONDS");
  const idleSeconds = idle === undefined ? undefined : Number(idle);
  if (idleSeconds !== undefined && !(Number.isInteger(idleSeconds) && idleSeconds > 0 && idleSeconds <= DAY_SECONDS)) {
    problems.push("CTRADER_SESSION_IDLE_SECONDS must be a whole number of seconds from 1 to 86400");
  }
  return {
    // Not a mode only with a problem reported: loading the configuration fails then.
    cli: cli as CtraderCliMode,
    cliPath: get("CTRADER_CLI_PATH") ?? "ctrader-cli",
    ...(image ? { image } : {}),
    ...(idleSeconds ? { sessionIdleMs: idleSeconds * 1000 } : {}),
  };
}
