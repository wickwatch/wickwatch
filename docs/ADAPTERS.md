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
| `testing/` | Contract test suites, exported as `@wickwatch/core/testing` |

## Changes from the first draft
- Every adapter has a readonly `id`.
- `logs()` takes `follow` and an `AbortSignal` for live logs via SSE; the options are optional.
- `hostStatus()` returns `HostStatus`: `cpu` as a fraction 0..1, memory and disk as used/total bytes.
- `ConfigAdapter.validate()` returns issues as `{ parameter, code }` instead of English strings, so the UI can translate them (`parameterIssue.*` in `i18n/`).
- `ParameterSchema` gained the type `period` (timeframe parameters) and optional `label` and `group` for display.
- `IsoTime` must be UTC with a `Z` suffix; the schema enforces it.
- `Position`, `PendingOrder` and `Deal` volumes are in lots; monetary values in the account currency.
- `BrokerAdapter.emergencyStop()` only covers the broker side (close positions, cancel orders). Stopping the instances is orchestrated by the core via the runtime adapter.
- `RuntimeAdapter.create()` takes a neutral `InstanceSpec`: name, pinned image, command, labels and files. The broker adapter's optional `launch()` provides image, command and files (e.g. the algo and a password file); the core adds the labels, including `managed` and `config-version`.
- `BrokerAdapter.periods()` (optional) lists the timeframes an instance can run on; the instance form offers them and the server checks against them. Without it the timeframe is free text.
- `RuntimeAdapter.runTool()` (optional) runs a helper program next to the instances, e.g. a broker CLI in a throwaway container: a `ToolSpec` (pinned image, command, files like `InstanceSpec`) gives a `ToolProcess` with `write()`, `onOutput()`, `exit` and `kill()`. Tools are never listed as instances.
- `BrokerAdapter.logEvent()` (optional) recognises platform events in a line an instance logged (`connection_lost`, `connection_restored`, `algo_crashed`). The server adds them to every `LogLine` as `event` and shows a running instance whose log last said `connection_lost` as "connection lost" (`InstanceSummary.connectionLostSince`, alert `instance_disconnected`): the container keeps running meanwhile, so its status alone does not show it. `algo_crashed` lines are counted per start (`InstanceSummary.crashes`); a crash in the last hour raises the alert `instance_crashed`.
- `AlgoMetadata.fullAccess` tells whether the algo must be started with unrestricted access rights.
- Adapters throw `AdapterError` with one of the codes `auth_failed`, `not_found`, `unsupported`, `invalid_input`, `timeout`, `unavailable`. The message is for logs only and must never contain secrets.

## First implementations
- **demo** (all three): fake data, deterministic, used for development, tests and screenshots.
- **docker** runtime ([`packages/adapter-docker`](../packages/adapter-docker)): dockerode via `tecnativa/docker-socket-proxy`; one container per instance.
  - Discovery: containers with the label `<prefix>.instance`. Containers without it are treated as not found, so the API can never start or stop unrelated containers (the proxy, Wickwatch itself).
  - Status: `running` (`error` if the health check reports unhealthy), `restarting`, `stopped` for exit code 0 or a stop signal (130, 137, 143), `error` for other exit codes and dead containers.
  - Logs: Docker's timestamps; the level is guessed from the text (`error`, `failed`, `warn` …), `WW-SETUP` lines are parsed.
  - Host status: load, memory and disk of the machine Wickwatch runs on; NTP state is not reported.
  - Tools (`runTool`): a container with the label `<prefix>.tool`, open stdin, `AutoRemove`, no log driver, `CapDrop ALL`, `no-new-privileges`; files are copied in before the start, stdin/stdout go through `attach` (works through docker-socket-proxy with `CONTAINERS=1`, `POST=1`). Tools left over from an earlier run are killed before the first new one.
  - `create` pulls the image if needed, creates a stopped container (restart policy from `INSTANCE_RESTART_POLICY`, no extra capabilities, `no-new-privileges`, log rotation) and copies the spec's files into it through the Docker API (a tar archive), so passwords never appear in `docker inspect` or host folders. It sets `<prefix>.managed=true`.
  - `update` builds the replacement under a temporary name, then swaps it in; a running instance is started again. `update` and `remove` refuse containers without `<prefix>.managed=true`, so compose-defined containers are never touched.
  - Socket proxy needs `CONTAINERS=1`, `IMAGES=1` and `POST=1`.
  - Integration test against a real daemon: `WICKWATCH_DOCKER_TEST=1 pnpm --filter @wickwatch/adapter-docker test`.
- **ctrader-cli** broker ([`packages/adapter-ctrader-cli`](../packages/adapter-ctrader-cli), tested with CLI 5.9):
  - `launch()`: `run <algo> --ctid --pwd-file --account --symbol --period --exit-on-stop [--full-access] --Name=Value…` in `CTRADER_IMAGE`; algo and password file are copied to `/mnt/wickwatch/` in the container. Parameter names must be plain identifiers and values free of control characters.
  - Batch commands (`accounts`, `symbols`, `metadata`) with `--pwd-file`; the password is written to a private temp file, never passed as an argument.
  - Where the CLI runs is a `CliRunner`: `localRunner` (installed CLI, temp directory for files) or `toolRunner` (`CTRADER_CLI=container`: the official image through `RuntimeAdapter.runTool`, files copied to `/mnt/wickwatch/`). Tested through docker-socket-proxy: `metadata` ≈ 1 s, a new shell session ≈ 2 s, commands in a warm session ≈ 20 ms.
  - One long-running interactive shell per account for `account`, `positions`, `orders`, `deals`: login once (≈ 4 s), then answers in milliseconds. History commands return nothing as the first command of a session, so every session starts with a warm-up query.
  - Closed accounts are still listed by batch `accounts` but fail with a misleading "not available on this cTrader build"; they are reported as `active: false`.
  - `deals --from/--to` take whole UTC days with an exclusive end; the adapter asks one day more and filters.
  - `logEvent()`: "The connection has been lost. Reconnecting..." → `connection_lost`; "… established." / "… restored." → `connection_restored`. "<time> | Error | Crashed in <handler> event with <exception>: …" → `algo_crashed` (the cBot keeps running). Only platform lines count, not the cBot's own `Print` output (`<time> | Info | …`). `run` notices a lost connection only after about 60 s, then keeps reconnecting without exiting.
  - Trading actions in the account's shell session: `position close <id> yes`, `order cancel <id> yes`; the emergency stop runs `order cancel all yes`, then `position close all yes`. The CLI's answer is not documented, so each action counts only when a fresh `positions`/`orders` listing no longer shows it; ids must be digits (they go into a command line). `orders` fields (recorded 2026-09-28): `id, symbolName, tradeSide, orderType, volume, volumeLots, targetPrice, limitPrice, stopLoss, takeProfit, expiration, label, comment`.
  - Integration test against the real CLI (read-only): `WICKWATCH_CTRADER_TEST=1 CTRADER_CTID=… CTRADER_PWD_FILE=… CTRADER_ACCOUNT=… pnpm --filter @wickwatch/adapter-ctrader-cli test`.
- **cbotset** config; `.optset` export in phase 2 (reverse-engineer format from a file exported by cTrader Desktop).

## Contract tests
Every adapter runs the same suites from `@wickwatch/core/testing` against its implementation: `describeRuntimeAdapter`, `describeBrokerAdapter` and `describeConfigAdapter`. The demo adapter runs them on every test run ([`packages/adapter-demo/test/contract.test.ts`](../packages/adapter-demo/test/contract.test.ts)); real adapters run them optionally with credentials from env.

Tests that close positions, cancel orders or trigger the emergency stop only run with `destructive: true`. **Never enable this against a live account.**
