# Adapter contracts

The core only knows these interfaces. Adapters translate to and from a concrete platform.

**Source of truth is the code** in [`packages/core/src`](../packages/core/src):

| File | Content |
| --- | --- |
| `schemas/*.ts` | Neutral domain types as [TypeBox](https://github.com/sinclairzx81/typebox) schemas. Each schema is also exported as a TypeScript type of the same name, so one definition gives static types, runtime validation of adapter output and Fastify/OpenAPI schemas. |
| `adapters.ts` | `RuntimeAdapter`, `BrokerAdapter`, `ConfigAdapter`, `Credentials`, `LogOptions` |
| `errors.ts` | `AdapterError` with a translatable `code` |
| `labels.ts` | Label keys and helpers for the configurable prefix |
| `parameters.ts` | `validateParameters()`, format-independent, reusable by every config adapter |
| `setup-log.ts` | `parseSetupLine()` for `WW-SETUP` lines (see [BOT-CONTRACT.md](BOT-CONTRACT.md)) |
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
- **docker** runtime: dockerode via `tecnativa/docker-socket-proxy`; one container per instance, discovery via labels.
- **ctrader-cli** broker: batch commands with `--pwd-file`, interactive commands with `--password` + `-q` as one-shot calls; a queue limits parallel calls, timeouts and retries with backoff.
- **cbotset** config; `.optset` export in phase 2 (reverse-engineer format from a file exported by cTrader Desktop).

## Contract tests
Every adapter runs the same suites from `@wickwatch/core/testing` against its implementation: `describeRuntimeAdapter`, `describeBrokerAdapter` and `describeConfigAdapter`. The demo adapter runs them on every test run ([`packages/adapter-demo/test/contract.test.ts`](../packages/adapter-demo/test/contract.test.ts)); real adapters run them optionally with credentials from env.

Tests that close positions, cancel orders or trigger the emergency stop only run with `destructive: true`. **Never enable this against a live account.**
