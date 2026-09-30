# Context for Claude Code

Start with `README.md`, `docs/ROADMAP.md`, `docs/ADAPTERS.md` and `CONTRIBUTING.md`.

## What this is
Wickwatch: a self-hosted, open-source (AGPL-3.0) dashboard to monitor and control trading bots. Hobby project, no commercial variant. First target: cTrader CLI running bots in Docker containers.

## Non-negotiables
- **Core is broker- and strategy-neutral.** No cTrader types, paths or strategy names in core code. Everything cTrader-specific lives in adapters (`docs/ADAPTERS.md`).
- **i18n from day one.** English source strings, German translation. No UI strings in components; use `i18n/en.json`, `i18n/de.json`. Format numbers/dates with `Intl`.
- **Design tokens only.** Use `design/tokens.css` variables (`--ww-*`), never hard-coded colours. Dark and light mode must both work. Rules in `BRAND.md`.
- **Security:** credentials encrypted at rest (master key from env), never logged. Docker access only through docker-socket-proxy. Built-in auth (admin login, optional TOTP).
- **Proxy-agnostic:** configurable host/port/base path, `TRUST_PROXY`, `/healthz`. SSE sends `X-Accel-Buffering: no`.
- **Colour never carries meaning alone** (status always with text or sign).
- **Destructive actions** (emergency stop, close position) require confirmation and are audit-logged.

## Stack
TypeScript, Node, Fastify (REST + OpenAPI, SSE), Vue 3 + Vite SPA, vue-i18n, SQLite (Postgres optional), dockerode. Tests with Vitest.

## Conventions
- English for code, identifiers, commits, README. Conventional Commits, `Signed-off-by` on every commit (DCO).
- Internal time in UTC.
- Label prefix for runtime discovery configurable, default `wickwatch.*`.

## Scope of this repo
Dashboard only. Real deployments (instances, parameter sets, secrets) live outside this repo; `deploy/` has generic examples.

## Patterns (from the pre-release reviews)
- Auth decisions use the matched route (`request.routeOptions.url`), never the raw `request.url`.
- Write routes carry `preHandler: requireAdmin` (the auth plugin's hook is only a safety net); destructive ones
  add `requireConfirmation(param)` and wrap the action in `auditOutcome`.
- Look up accounts through the account directory (`findAccount`, `findAccountById`), not by number in SQL:
  numbers are unique only per adapter.
- Platform specifics (file extensions, periods, env vars) come from the adapter (`/system`, adapter settings);
  server and web never name them.
- Rules shared by server and web live in `@wickwatch/core/rules`, API schemas in `packages/core/src/schemas`;
  the web imports core types only, runtime code only via dependency-free subpaths.
- Broker CLI commands run one at a time per account: no extra broker calls on hot paths; the overview goes
  through `OverviewLoader`.
- Before writing a helper, check `apps/server/src/services`, `apps/web/src/composables` and `apps/web/src/format.ts`.
- Security fixes get a regression test that fails without the fix.
