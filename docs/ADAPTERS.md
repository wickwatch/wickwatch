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
- Adapters throw `AdapterError` with one of the codes `auth_failed`, `not_found`, `unsupported`, `invalid_input`, `timeout`, `unavailable`. The message is for logs only and must never contain secrets.

## First implementations
- **demo** (all three): fake data, deterministic, used for development, tests and screenshots.
- **docker** runtime ([`packages/adapter-docker`](../packages/adapter-docker)): dockerode via `tecnativa/docker-socket-proxy`; one container per instance.
  - Discovery: containers with the label `<prefix>.instance`. Containers without it are treated as not found, so the API can never start or stop unrelated containers (the proxy, Wickwatch itself).
  - Status: `running` (`error` if the health check reports unhealthy), `restarting`, `stopped` for exit code 0 or a stop signal (130, 137, 143), `error` for other exit codes and dead containers.
  - Logs: Docker's timestamps; the level is guessed from the text (`error`, `failed`, `warn` …), `WW-SETUP` lines are parsed.
  - Host status: load, memory and disk of the machine Wickwatch runs on; NTP state is not reported.
  - `create`, `update` and `remove` answer `unsupported` for now; define instances in a compose file.
  - Socket proxy needs `CONTAINERS=1` and `POST=1`.
  - Integration test against a real daemon: `WICKWATCH_DOCKER_TEST=1 pnpm --filter @wickwatch/adapter-docker test`.
- **ctrader-cli** broker: batch commands with `--pwd-file`, interactive commands with `--password` + `-q` as one-shot calls; a queue limits parallel calls, timeouts and retries with backoff.
- **cbotset** config; `.optset` export in phase 2 (reverse-engineer format from a file exported by cTrader Desktop).

## Contract tests
Every adapter runs the same suites from `@wickwatch/core/testing` against its implementation: `describeRuntimeAdapter`, `describeBrokerAdapter` and `describeConfigAdapter`. The demo adapter runs them on every test run ([`packages/adapter-demo/test/contract.test.ts`](../packages/adapter-demo/test/contract.test.ts)); real adapters run them optionally with credentials from env.

Tests that close positions, cancel orders or trigger the emergency stop only run with `destructive: true`. **Never enable this against a live account.**
