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
