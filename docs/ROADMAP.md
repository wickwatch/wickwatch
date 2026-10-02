# Roadmap

wickwatch is built in phases. Order and scope may change; issues and pull requests are welcome.

## Phase 1 – MVP
Status: largely done; open items are unchecked.

- [x] **Overview:** instance table (account, symbol, timeframe, status, uptime, open positions, today's P&L, last log line), account tiles (balance, equity, today's P&L, open positions and pending orders), alerts for stopped instances and unreachable accounts (e.g. login failures). Mobile-friendly, including the emergency stop.
- [x] **Instance actions:** start, stop, restart, edit, duplicate, delete.
- [x] **Instance detail:** parameters compared with the algo metadata, open positions and pending orders (by order label), deal history with a realised P&L curve and key figures, live logs via SSE, change history.
- [x] **Create and edit:** form generated from the algo metadata, parameter file upload with validation, download of the active configuration.
- [x] **Accounts and challenge profiles:** accounts with encrypted credentials; optional prop-challenge profile per account (profit target, daily loss, max drawdown, minimum trading days, duration) with a traffic light; profile templates as JSON files in `templates/challenges/` (FTMO, The Trading Pit).
- **Operations and safety:**
  - [x] built-in login with TOTP, emergency stop per account, pinned runtime image versions, parameter and algo versioning with rollback, "data outdated" marker
  - [x] audit log (written for every change and trading action)
  - [x] audit log view in the web app (admins, user menu → Audit log)
  - [x] host status: CPU, RAM, disk
  - [x] host status: clock with the Docker runtime (measured hourly against `CLOCK_CHECK_URL`, alert above 2 s)
- [x] **Adapters:** Docker runtime (via docker-socket-proxy), cTrader CLI broker, `.cbotset` config.
- [x] **Availability alerts:** generic webhook and heartbeat URL (e.g. Healthchecks.io, Telegram).
- [x] **Operations:** log rotation, backups, data retention.

Added along the way:
- Optional loss guard per challenge profile: runs the emergency stop when the daily or max loss limit is used up to a set share.
- Max drawdown trailing on the highest equity or on the end-of-day balance; trading days counted by the day a position opened, as prop firms do.
- Bots set up in wickwatch are started again after a host or Docker restart ([CONFIGURATION.md](CONFIGURATION.md#bots-after-a-restart)).
- Account page with all bots, positions and orders of an account.
- Risk in % and R per trade from the initial stop loss; a details panel per position, order and trade.
- Password change in the profile.

## Phase 2
- Backtests and optimisation runs started from an instance, backtest vs. live comparison, `.optset` export.
- [x] Daily summaries (`DAILY_SUMMARY_TIME`); notifications for challenge limits, breaches, passed challenges and the loss guard exist too.
- Schedules (holidays, weekends, news pauses), exposure across accounts, canary rollout of algo versions.
- Trade journal, statistics across instances, bots, symbols and accounts.
- OIDC login, role management UI.
- [x] API tokens (hashed, revocable, with expiry and role) for scripts and external clients.
- [x] Read-only MCP endpoint (`<base>/mcp`) on top of the core services: instances, accounts and challenge status, logs, alerts, audit log, host status. No write actions, since bot logs reach the model as untrusted text.

## Phase 3
- Analysis by setup features that bots log (`WW-SETUP`, see [BOT-CONTRACT.md](BOT-CONTRACT.md)).
- MAE/MFE, Monte Carlo robustness tests, long-term backtest vs. live comparison.
