# Adapter contracts

The core only knows these interfaces. Adapters translate to and from a concrete platform.

**Source of truth is the code** in [`packages/core/src`](../packages/core/src):

| File | Content |
| --- | --- |
| `schemas/*.ts` | Neutral domain types as [TypeBox](https://github.com/sinclairzx81/typebox) schemas. Each schema is also exported as a TypeScript type of the same name, so one definition gives static types, runtime validation of adapter output and Fastify/OpenAPI schemas. |
| `adapters.ts` | `RuntimeAdapter`, `BrokerAdapter`, `ConfigAdapter`, `Credentials`, `LogOptions` |
| `errors.ts` | `AdapterError` with a translatable `code` |
| `labels.ts` | Label keys and helpers for the configurable prefix |
| `attribution.ts` | `createAttributor()`: which instance a position, order or deal belongs to (modes `auto`, `label`, `label-pattern`, `account-symbol`, see [BOT-CONTRACT.md](BOT-CONTRACT.md)) |
| `parameters.ts` | `validateParameters()`, format-independent, reusable by every config adapter |
| `setup-log.ts` | `parseSetupLine()` for `WW-SETUP` lines (see [BOT-CONTRACT.md](BOT-CONTRACT.md)) |
| `overview.ts` | `buildOverview()`: combines runtime and broker data into accounts, instances and alerts (pure, no I/O) |
| `operations.ts` | `emergencyStopAccount()`: stops the account's instances first, then closes positions and cancels orders |
| `challenge.ts` | `evaluateChallenge()` (pure): a challenge profile against balance, equity and the recorded days; `tradingDays()`: the days a position was opened; `profileDay()` |
| `trading-day.ts` | Trading days with a reset time and IANA time zone: `tradingDayStart()`, `tradingDayKey()`, `tradingDayStartOf()` |
| `risk.ts` | `dealRisk()`, `dealR()`, `withRisk()`: risk in money and % and the result in R from `entryPrice` and `initialStopLoss` |
| `stats.ts` | `dealStats()`: key figures of a list of deals (win rate, profit factor, average and total R …) |
| `money.ts` | `dealResult()` (P&L plus commission and swap), `round2()` |
| `instance-detail.ts` | `buildInstanceDetail()`: one instance with its positions, orders, deals and figures (pure) |
| `rules.ts` | Input rules shared by server and web: `MIN_PASSWORD_LENGTH`, `INSTANCE_NAME`, `SAFE_NAME`, `isUp()` |
| `errors.ts` | `AdapterError`, `isAdapterError()`, `errorCode()` |
| `json.ts`, `group-by.ts` | `isObject()`, `groupBy()` (keeps insertion order) |
| `schemas/` | TypeBox schemas of the adapter contracts and of the API responses; the web imports them as types |
| `testing/` | Contract test suites, exported as `@wickwatch/core/testing` |

The web app imports types from `@wickwatch/core` and runtime code only through the dependency-free subpaths `parameters`, `rules`, `money`, `trading-day` and `group-by`.

## Changes from the first draft
- Every adapter has a readonly `id`.
- `logs()` takes `follow` and an `AbortSignal` for live logs via SSE; the options are optional.
- `hostStatus()` returns `HostStatus`: `cpu` as a fraction 0..1, memory and disk as used/total bytes, and `ntpSynced` when the adapter can tell. When it cannot (Docker: a container does not see the host's time sync), the server measures the clock against `CLOCK_CHECK_URL` and adds `clockOffsetMs` (positive: the server runs ahead) and `ntpSynced` (offset within 2 s) itself, or `clockCheck: "unavailable"` when the check had no usable answer lately. With `CLOCK_CHECK_URL=off` none of the three is set.
- `ConfigAdapter.validate()` returns issues as `{ parameter, code }` instead of English strings, so the UI can translate them (`parameterIssue.*` in `i18n/`).
- `ConfigAdapter.parse(content, schema)` reads an uploaded parameter file for an algo and `serialize(values, schema, chart)` writes one; they work on bytes, not paths (the first draft had `read(path)`/`write(path)`). `parse` converts the file's values to the schema's types (`valuesFromFile` in the core: numbers and booleans stored as text, enums stored as numbers via `ParameterSchema.optionValues` or the option's position) and reports `issues`, `unknown` and `missing` instead of guessing; a file that is not in the format at all is `invalid_input`.
- `ParameterSchema.type` includes `color`: text `#AARRGGBB` (alpha first), `#RRGGBB` or a colour name.
- `ParameterSchema` gained the type `period` (timeframe parameters) and optional `label` and `group` for display.
- `IsoTime` must be UTC with a `Z` suffix; the schema enforces it.
- `Position`, `PendingOrder` and `Deal` volumes are in lots; monetary values in the account currency.
- `BrokerAdapter.emergencyStop()` only covers the broker side (close positions, cancel orders). Stopping the instances is orchestrated by the core via the runtime adapter.
- `RuntimeAdapter.create()` takes a neutral `InstanceSpec`: name, pinned image, command, labels and files. The broker adapter's optional `launch()` provides image, command and files (e.g. the algo and a password file); the core adds the labels, including `managed` and `config-version`.
- `BrokerAdapter.periods()` (optional) lists the timeframes an instance can run on; the instance form offers them and the server checks against them. Without it the timeframe is free text. `defaultPeriod` (optional) is the one a new instance is set up with.
- `BrokerAdapter.algoFormats()` names the file extensions of the algos `algoMetadata()` reads (e.g. `algo`); the upload offers them and stored algo files are named with the first one, so server and web need no platform file names.
- `RuntimeAdapter.runTool()` (optional) runs a helper program next to the instances, e.g. a broker CLI in a throwaway container: a `ToolSpec` (pinned image, command, files like `InstanceSpec`) gives a `ToolProcess` with `write()`, `onOutput()`, `exit` and `kill()`. Tools are never listed as instances.
- `BrokerAdapter.redactLog()` (optional) hides secrets the platform prints in an instance's log; the server applies it to every line it reads, before anything shows or stores it.
- `LaunchInput.algo.parameters` is the algo's schema, so a broker can write the parameters the way its platform expects.
- `BrokerAdapter.logEvent()` (optional) recognises platform events in a line an instance logged (`connection_lost`, `connection_restored`, `algo_crashed`, `algo_stopped`). `algo_stopped` means the bot ended itself (not stopped from outside); the instance keeper then no longer starts it again after a restart. The server adds them to every `LogLine` as `event` and shows a running instance whose log last said `connection_lost` as "connection lost" (`InstanceSummary.connectionLostSince`, alert `instance_disconnected`): the container keeps running meanwhile, so its status alone does not show it. `algo_crashed` lines are counted per start (`InstanceSummary.crashes`); a crash in the last hour raises the alert `instance_crashed`.
- `Deal.entryPrice` and `Deal.initialStopLoss` (optional): the price the position opened at and the stop it opened with (not a later, trailed one). With both, the core computes the trade's risk in money (the stop distance valued like the trade's own price move, so no contract sizes are needed), its risk in % of the balance before it, and its result in R. Leave them out when unknown; risk and R then stay empty.
- `Deal.openedAt` and `Position.openedAt`: when the position was opened. Challenge profiles count a trading day by it, as prop firms do; a deal without `openedAt` counts on its closing day.
- `Capabilities.requiresTextValues` (optional): the runtime cannot start a bot with an empty or missing text parameter. `validateParameters()` and `ConfigAdapter.validate(values, schema, options)` then report such parameters with the code `required` (`ValidateOptions.requireText`); the forms and the server enforce it.
- `AlgoMetadata.fullAccess` tells whether the algo must be started with unrestricted access rights.
- `BrokerAdapter.algoMetadataVersion` (optional, default 0) versions what `algoMetadata()` reads. Bump it whenever the reader extracts more or fixes a type: at the next start the server reads every stored algo again whose metadata came from another reader (`<adapter>:<version>`), keeping name and version. No re-upload, no repair migration.
- Adapters throw `AdapterError` with one of the codes `auth_failed`, `not_found`, `unsupported`, `invalid_input`, `timeout`, `unavailable`. The message is for logs only and must never contain secrets.

## First implementations
- **demo** (all three): fake data, deterministic, used for development, tests and screenshots.
- **docker** runtime ([`packages/adapter-docker`](../packages/adapter-docker)): dockerode via `tecnativa/docker-socket-proxy`; one container per instance.
  - Discovery: containers with the label `<prefix>.instance`. Containers without it are treated as not found, so the API can never start or stop unrelated containers (the proxy, wickwatch itself).
  - Status: `running` (`error` if the health check reports unhealthy), `restarting`, `stopped` for exit code 0 or a stop signal (130, 137, 143), `error` for other exit codes and dead containers.
  - Logs: Docker's timestamps; the level is guessed from the text (`error`, `failed`, `warn` …), `WW-SETUP` lines are parsed.
  - Host status: load, memory and disk of the machine wickwatch runs on; NTP state is not reported.
  - Tools (`runTool`): a container with the label `<prefix>.tool`, open stdin, `AutoRemove`, no log driver, `CapDrop ALL`, `no-new-privileges`; files are copied in before the start, stdin/stdout go through `attach` (works through docker-socket-proxy with `CONTAINERS=1`, `POST=1`). Tools left over from an earlier run are killed before the first new one.
  - `create` pulls the image if needed, creates a stopped container (restart policy from `INSTANCE_RESTART_POLICY`, no extra capabilities, `no-new-privileges`, log rotation) and copies the spec's files into it through the Docker API (a tar archive), so passwords never appear in `docker inspect` or host folders. It sets `<prefix>.managed=true`.
  - `update` builds the replacement under a temporary name, then swaps it in; a running (or restarting) instance is started again, a stopped or crashed one stays stopped. `update` and `remove` refuse containers without `<prefix>.managed=true`, so compose-defined containers are never touched.
  - Socket proxy needs `CONTAINERS=1`, `IMAGES=1` and `POST=1`.
  - Integration test against a real daemon: `WICKWATCH_DOCKER_TEST=1 pnpm --filter @wickwatch/adapter-docker test`.
- **ctrader-cli** broker ([`packages/adapter-ctrader-cli`](../packages/adapter-ctrader-cli), tested with CLI 5.9):
  - `launch()`: `run <algo> <parameters.cbotset> --ctid --pwd-file --account --symbol --period --exit-on-stop [--full-access]` in `CTRADER_IMAGE`; algo, password and parameters are files copied to `/mnt/wickwatch/` in the container (mode 0400 for password and parameters), so `docker inspect` shows neither the password nor parameter values such as licence keys. Parameter names must be plain identifiers.
  - `requiresTextValues`: `run` refuses to start while a text parameter is empty (`""`) or missing ("All custom parameters must have a value"); `--Name=` on the command line fails too, so there is no empty value at all (CLI 5.9.11, also with an export from cTrader Desktop). The forms and the server then require a value for every text parameter, and a saved version that has none cannot be applied.
  - `redactLog()`: `run` prints every parameter with its value before the cBot starts (`| Name | Value | Source |`); values of parameters whose name looks like a secret (key, token, secret, password, licence, credential, api) are replaced by `••••••`.
  - Batch commands (`accounts`, `symbols`, `metadata`) with `--pwd-file`; the password is written to a private temp file, never passed as an argument.
  - Where the CLI runs is a `CliRunner`: `localRunner` (installed CLI, temp directory for files) or `toolRunner` (`CTRADER_CLI=container`: the official image through `RuntimeAdapter.runTool`, files copied to `/mnt/wickwatch/`). Tested through docker-socket-proxy: `metadata` ≈ 1 s, a new shell session ≈ 2 s, commands in a warm session ≈ 20 ms.
  - Settings: `readCtraderCliSettings()` reads and checks `CTRADER_IMAGE`, `CTRADER_CLI` and `CTRADER_CLI_PATH`. The server's adapter registry ([`apps/server/src/adapters.ts`](../apps/server/src/adapters.ts), `readAdapterSettings`) calls it at start, so the server's own configuration names no platform.
  - One long-running interactive shell per account for `account`, `positions`, `orders`, `deals`, `orders-history`: login once (≈ 4 s), then answers in milliseconds. History commands return nothing as the first command of a session, so every session starts with a warm-up query.
  - Closed accounts are still listed by batch `accounts` but fail with a misleading "not available on this cTrader build"; they are reported as `active: false`.
  - `deals <from> <to>` takes whole UTC days (positional dates) with an exclusive end; the adapter asks one day more and filters. `orders-history <from> <to>` (14 days more before the range) gives the order that opened each position: its stop loss is the deal's `initialStopLoss`, its fill time (`closeTime`) the deal's `openedAt`. If it fails, deals come without both.
  - `logEvent()`: "The connection has been lost. Reconnecting..." → `connection_lost`; "… established." / "… restored." → `connection_restored`. "<time> | Error | Crashed in <handler> event with <exception>: …" → `algo_crashed` (the cBot keeps running). "cBot stopped itself" (the cBot called `Stop()`) → `algo_stopped`; "… stopped by user." after a SIGTERM (e.g. a host restart) is not a self-stop. Only platform lines count, not the cBot's own `Print` output (`<time> | Info | …`). `run` notices a lost connection only after about 60 s, then keeps reconnecting without exiting.
  - Trading actions in the account's shell session: `position close <id> yes`, `order cancel <id> yes`; the emergency stop runs `order cancel all yes`, then `position close all yes`. The CLI's answer is not documented, so each action counts only when a fresh `positions`/`orders` listing no longer shows it; ids must be digits (they go into a command line). `positions` fields (recorded 2026-09-28): `id, symbolName, tradeSide, volume, volumeLots, entryPrice, currentPrice, pips, grossProfit, netProfit, swap, commission, stopLoss, takeProfit, openTime, label, comment`; right after a session starts the prices and P&L are `null` for a moment, so the adapter asks again (up to 6 times, 0.5 s apart). `orders` fields (recorded 2026-09-28): `id, symbolName, tradeSide, orderType, volume, volumeLots, targetPrice, limitPrice, stopLoss, takeProfit, expiration, label, comment`.
  - Integration test against the real CLI (read-only): `WICKWATCH_CTRADER_TEST=1 CTRADER_CTID=… CTRADER_PWD_FILE=… CTRADER_ACCOUNT=… [CTRADER_ALGO=<path to an .algo>] pnpm --filter @wickwatch/adapter-ctrader-cli test`; with `CTRADER_ALGO` it also reads that algo's metadata.
- **cbotset** config ([`packages/adapter-cbotset`](../packages/adapter-cbotset)): cTrader's `.cbotset`, JSON `{ "Chart": { "Symbol", "Period" }, "Parameters": { … } }`, sometimes with a byte order mark. Exports from cTrader Desktop store typed values, the files it keeps for its own backtests store every value as text; enums are numbers in both, colours `#AARRGGBB`. Checked against 316 real files (all read, lossless round trip). Writes like an export (typed, BOM). `.optset` export in phase 2.

## Contract tests
Every adapter runs the same suites from `@wickwatch/core/testing` against its implementation: `describeRuntimeAdapter`, `describeBrokerAdapter` and `describeConfigAdapter`. The demo adapter runs them on every test run ([`packages/adapter-demo/test/contract.test.ts`](../packages/adapter-demo/test/contract.test.ts)); real adapters run them optionally with credentials from env.

Tests that close positions, cancel orders or trigger the emergency stop only run with `destructive: true`. **Never enable this against a live account.**
