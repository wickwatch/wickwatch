# Roadmap

Wickwatch is built in phases. Order and scope may change; issues and pull requests are welcome.

## Phase 1 – MVP
- **Overview:** instance table (account, symbol, timeframe, status, uptime, open positions, today's P&L, last log line), account tiles (balance, equity, today's P&L), alerts for stopped instances and login failures. Mobile-friendly, including the emergency stop.
- **Instance actions:** start, stop, restart, edit, duplicate, delete.
- **Instance detail:** parameters compared with the algo metadata, open positions and pending orders (by order label), deal history with equity curve and key figures, live logs via SSE, change history.
- **Create and edit:** form generated from the algo metadata, parameter file upload with validation and diff, download of the active configuration.
- **Accounts and challenge profiles:** accounts with encrypted credentials; optional prop-challenge profile per account (profit target, daily loss, max drawdown, minimum trading days) with a traffic light; profile templates as JSON files in `templates/challenges/`.
- **Operations and safety:** built-in login with TOTP, audit log, emergency stop per account, pinned runtime image versions, host status (CPU, RAM, disk, NTP), parameter and algo versioning with rollback, "data outdated" marker.
- **Adapters:** Docker runtime (via docker-socket-proxy), cTrader CLI broker, `.cbotset` config.
- **Availability alerts:** generic webhook and heartbeat URL (e.g. Healthchecks.io, Telegram).
- **Operations:** log rotation, backups, data retention.

## Phase 2
- Backtests and optimisation runs started from an instance, backtest vs. live comparison, `.optset` export.
- Notifications for challenge limits, targets and daily summaries.
- Schedules (holidays, weekends, news pauses), exposure across accounts, canary rollout of algo versions.
- Trade journal, statistics across instances, bots, symbols and accounts.
- OIDC login, role management UI.
- API tokens (hashed, revocable, with expiry and role) for scripts and external clients.
- Read-only MCP endpoint (`<base>/mcp`) on top of the core services: instances, accounts and challenge status, logs, alerts, audit log, host status. No write actions, since bot logs reach the model as untrusted text.

## Phase 3
- Analysis by setup features that bots log (`WW-SETUP`, see [BOT-CONTRACT.md](BOT-CONTRACT.md)).
- MAE/MFE, Monte Carlo robustness tests, long-term backtest vs. live comparison.
