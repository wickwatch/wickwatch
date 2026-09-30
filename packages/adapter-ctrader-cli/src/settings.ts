/** Where Wickwatch runs the CLI for its own queries. */
export const CTRADER_CLI_MODES = ["local", "container"] as const;
export type CtraderCliMode = (typeof CTRADER_CLI_MODES)[number];

/** The adapter's settings from the environment (CTRADER_*). */
export interface CtraderCliSettings {
  /** `local`: `cliPath` on this machine; `container`: the CLI of `image` via the runtime. */
  cli: CtraderCliMode;
  /** CLI executable for `cli: "local"`. */
  cliPath: string;
  /** Image instances run with; the adapter's tested version when unset. */
  image?: string;
}

/**
 * Reads CTRADER_IMAGE, CTRADER_CLI and CTRADER_CLI_PATH through `get` (unset or empty: undefined) and adds a
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
  return {
    // Not a mode only with a problem reported: loading the configuration fails then.
    cli: cli as CtraderCliMode,
    cliPath: get("CTRADER_CLI_PATH") ?? "ctrader-cli",
    ...(image ? { image } : {}),
  };
}
