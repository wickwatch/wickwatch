# Configuration

wickwatch is configured with environment variables only (see [`.env.example`](../.env.example)). Invalid values stop the server at start with a list of all problems. Empty values count as unset. `pnpm start` and `pnpm dev:server` read `.env` in the repo root; its values win over variables exported in the shell (the names of replaced ones are printed at start).

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Address to listen on. |
| `PORT` | `3000` | Port to listen on. |
| `BASE_PATH` | `/` | Path prefix when served under a sub-path, e.g. `/bots`. UI, API and cookies use it; `/healthz` also answers at the root. |
| `TRUST_PROXY` | `false` | Behind a reverse proxy: `true`, a hop count (`1`) or a comma-separated list of proxy IPs/CIDRs. Needed for correct client IPs (rate limiting, logs) and for `Secure` cookies behind TLS-terminating proxies. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Logs are JSON on stdout. |
| `MASTER_KEY` | – | **Required.** 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts broker credentials, TOTP secrets and the parameter values of instance configurations (values stored in plaintext by earlier versions are encrypted at the first start with a key). Without it, nobody can log in, and instances can be neither saved nor deployed. Back it up: without it, stored secrets cannot be decrypted. Changing it is not supported yet. |
| `DATABASE_URL` | `file:./data/wickwatch.db` | SQLite file, relative to the working directory (`/app` in the image). Postgres is planned. |
| `LABEL_PREFIX` | `wickwatch` | Prefix of the container labels used to find instances, e.g. `wickwatch.instance`. |
| `DEFAULT_LOCALE` | `en` | `en` or `de`; used when the browser language is not supported. |
| `RUNTIME_ADAPTER` | `demo` | Runs bot instances. Available: `demo`, `docker` (finds containers with the label `<LABEL_PREFIX>.instance` and creates containers for instances set up in wickwatch). |
| `DOCKER_HOST` | local socket | Docker API for the `docker` runtime, e.g. `tcp://socket-proxy:2375` (recommended) or `unix:///var/run/docker.sock`. |
| `BROKER_ADAPTER` | `demo` | Accounts and trading data. Available: `demo` (demo accounts are added to an empty database) and `ctrader-cli` (accounts, balances, positions, orders, deals, algo metadata, starting bots in the official CLI image, closing positions, cancelling orders, emergency stop). |
| `CTRADER_IMAGE` | `ghcr.io/spotware/ctrader-console:5.9.11` | Image instances run with (`BROKER_ADAPTER=ctrader-cli`). Must be pinned to a version or digest, never `latest`; change it deliberately and re-apply the instances. |
| `INSTANCE_RESTART_POLICY` | `on-failure` | Docker restart policy of created instances: `on-failure` restarts after a crash but leaves a bot stopped that stopped itself (e.g. after its own daily loss rule); `unless-stopped` always restarts; `no` never. A host or Docker restart ends bots cleanly, so `on-failure` alone does not bring them back; wickwatch does, see [Bots after a restart](#bots-after-a-restart). |
| `CTRADER_CLI` | `local` (`container` in the image) | How wickwatch runs the cTrader CLI for its own queries (accounts, balances, positions, algo metadata). `local`: `CTRADER_CLI_PATH` on the same machine. `container`: the CLI of `CTRADER_IMAGE` in a throwaway container per call or shell session, through `RUNTIME_ADAPTER=docker`; the wickwatch image does not contain the proprietary CLI. |
| `CTRADER_CLI_PATH` | `ctrader-cli` | cTrader CLI executable for `CTRADER_CLI=local`. It must be installed where the server runs. |
| `CONFIG_ADAPTER` | `demo` | Parameter files for upload and download. Available: `demo` (JSON) and `cbotset` (cTrader's `.cbotset`; use it with `BROKER_ADAPTER=ctrader-cli`). |
| `ACCOUNT_POLL_SECONDS` | `60` | How often balance and equity of every account are sampled (10–3600). Needed for daily loss and trailing drawdown; deals (for trading days) are checked every 5 minutes, and right away when a challenge profile is saved; until the days since its start date are loaded, the profile shows "loading …" instead of a count. Also the interval of the optional loss guard of challenge profiles. |
| `ALGOS_DIR` | `data/algos` | Where uploaded algo files are stored, one folder per name and version (`<name>/<version>/<name>.algo`). Keep it on a persistent volume. |
| `CHALLENGE_TEMPLATES_DIR` | `templates/challenges` | Directory with challenge templates (`*.json`, see its README). |
| `WEB_DIST_DIR` | next to the server | Directory of the built web app. Only needed when running the server outside the image. |
| `ALERT_WEBHOOK_URL` | – | Receives a JSON `POST` whenever an alert appears or goes away, and when an API token is created, see [Notifications](#notifications). May contain a token; it is never logged. |
| `HEARTBEAT_URL` | – | Called with `GET` after every successful alert check, e.g. a Healthchecks.io ping URL. When the calls stop, that service reports the whole server as down. |
| `ALERT_CHECK_SECONDS` | `60` | How often alerts are checked for the two URLs above (10–3600). |
| `ALERT_DISCONNECT_GRACE_SECONDS` | `180` | A lost broker connection of a bot or an account the broker does not answer for (timeout, unavailable; a failed login is posted at once) reaches `ALERT_WEBHOOK_URL` only once it lasted this long (0–3600), so drops that pass by themselves stay quiet. `0` posts it at the next check. The dashboard shows it at once either way. |
| `ALERT_DISCONNECT_GRACE_CLOSED_SECONDS` | `1800` | The same while the market is closed (0–86400), when brokers do their maintenance: of the instance's symbol, for an account of all its instances' symbols. A bot still disconnected half an hour after is reported, short drops are not. `off` holds it until the market opens; then `ALERT_DISCONNECT_GRACE_SECONDS` applies. Without known market hours (or instances) the market counts as open. |
| `ALERT_RESOLVE_DELAY_SECONDS` | `120` | A posted alert is resolved only once it stayed away this long (0–3600), so an alert that comes back right away does not send "Resolved" and a new alert each time. |
| `DAILY_SUMMARY_TIME` | – | Local time of day (`HH:MM`) for a daily summary to `ALERT_WEBHOOK_URL`, see [Notifications](#notifications). Off when unset; needs `ALERT_WEBHOOK_URL`. |
| `DAILY_SUMMARY_TIMEZONE` | `UTC` | IANA time zone of `DAILY_SUMMARY_TIME`, e.g. `Europe/Berlin`. |
| `CLOCK_CHECK_URL` | `https://www.cloudflare.com/cdn-cgi/trace` | Time reference for the hourly clock check with `RUNTIME_ADAPTER=docker` (a container cannot see whether the host syncs its clock): an answer with a `ts=<unix time>` line or a `Date` header. The header shows it as an icon (up to 1 s fine, up to 2 s worth watching, beyond that an alert). `off` switches it off; the icon is then not shown. |
| `MCP` | `on` | The read-only MCP endpoint at `<base>/mcp` for AI clients with an API token, see [MCP.md](MCP.md). `off` switches it off: `/mcp` then answers 404, and API tokens still work for the REST API. |
| `API_TOKENS_REQUIRE_2FA` | `off` | `on`: only users with 2FA switched on may create API tokens (their creation always asks for the password, and the code when 2FA is on). Existing tokens stay valid. |
| `SOURCE_URL` | `https://github.com/wickwatch/wickwatch` | Source code link in the footer. wickwatch is AGPL-3.0: if you run a changed version for others, point this at its source. |
| `SUPPORT_URL` | `https://ko-fi.com/mmohrx` | "Support the project" link in the footer; `off` hides it. |
| `BACKUP_INTERVAL_HOURS` | `24` | How often the database is backed up (`VACUUM INTO`, consistent while running); `0` turns backups off. A start writes one right away when the last is older. |
| `BACKUP_KEEP` | `7` | How many backups are kept; older ones are deleted. |
| `BACKUP_DIR` | `backups` next to the database | Where backups go, e.g. `/app/data/backups` in the image. Files are `wickwatch-<UTC time>.db`, readable only by the owner. |
| `AUDIT_RETENTION_DAYS` | `365` | Audit entries older than this are deleted (checked hourly); `0` keeps them forever. Expired sessions are deleted hourly as well. |
| `WICKWATCH_VERSION` | from the build | Version shown in the UI and `/healthz`; set by the image build. |

## Bots after a restart

Docker's `on-failure` restarts a bot that crashed, but not one that ended cleanly. On a host or Docker restart every bot receives SIGTERM, logs "stopped by user" and exits with 0, so it would stay down. wickwatch keeps track of which instances it set up are meant to run and checks them every 15 seconds:

- An instance that is running is meant to run. wickwatch takes running instances over only at its first check after it started (e.g. ones started while it was down); later it changes "meant to run" only through its own actions.
- Start, restart and applying a configuration with start set it; stop, the emergency stop and the loss guard clear it before stopping the container.
- An instance that ended cleanly while meant to run is started again and audit-logged (`instance.autostart`).
- An instance that stopped itself (the broker adapter recognises it in the log, for cTrader "cBot stopped itself") is no longer meant to run and stays stopped, e.g. after its own daily loss rule. See [`BOT-CONTRACT.md`](BOT-CONTRACT.md).
- An instance that ends again within 10 minutes of an automatic start is left stopped (`instance.autostart_gave_up`), so a broken configuration does not loop.
- A crash (exit code other than a stop signal's) is left to the restart policy.

This covers only instances set up in wickwatch, not containers from your own compose file. wickwatch itself needs `restart: unless-stopped`, as in the examples in `deploy/`.

## Backups and restore

The backups hold the whole database: users, accounts, encrypted credentials, challenge profiles, instances with their configuration versions (parameter values encrypted), audit log. They do **not** hold:

- `MASTER_KEY`: without it the stored credentials, TOTP secrets and instance parameter values cannot be decrypted. Keep it separately (see `SECURITY.md`).
- Uploaded algo files in `ALGOS_DIR` (`data/algos`).
- Bot containers and their logs.

Backups are only as safe as the disk they are on: copy `data/` (backups and algos) off the server, e.g. with restic or rsync.

To restore: stop wickwatch, replace `wickwatch.db` with a backup file (and remove `wickwatch.db-wal` / `-shm` if present), start it with the same `MASTER_KEY`. Newer migrations are applied at start.

Logs: bot containers created by wickwatch rotate their logs (json-file, 5 × 10 MB); the compose examples in `deploy/` do the same for wickwatch itself.

## Notifications

wickwatch checks the same alerts the overview shows every `ALERT_CHECK_SECONDS`: stopped or failed instances (not the ones stopped on purpose through wickwatch: stop, emergency stop, loss guard, or a version applied without starting; a bot that stopped itself still counts), a lost broker connection, bots that threw errors in their event handlers, unreachable accounts (e.g. a failed login), challenge limits, a breached or passed challenge, the loss guard having stopped an account, and attribution problems. Nobody has to have the dashboard open. A lost broker connection or an account the broker does not answer for is posted only once it lasted `ALERT_DISCONNECT_GRACE_SECONDS`, or `ALERT_DISCONNECT_GRACE_CLOSED_SECONDS` while the market is closed; one that passes before that is posted neither as alert nor as resolution. Any alert is resolved only once it stayed away for `ALERT_RESOLVE_DELAY_SECONDS`. A restart of wickwatch starts these times anew.

`ALERT_WEBHOOK_URL` gets one `POST` per change, as JSON:

```json
{
  "event": "alert_raised",
  "time": "2026-09-28T16:40:00.000Z",
  "level": "warning",
  "code": "instance_disconnected",
  "subject": "ger40-demo",
  "instance": "ger40-demo",
  "params": { "since": "2026-09-28T16:34:50.272Z" },
  "text": "Warning: ger40-demo: connection to the broker lost since 9/28/26, 4:34 PM UTC",
  "content": "Warning: ger40-demo: connection to the broker lost since 9/28/26, 4:34 PM UTC"
}
```

- `event` is `alert_raised` or `alert_resolved`. A resolved alert says what is fine again where that is known ("Resolved: ger40-demo is connected to the broker again"), otherwise it repeats the alert ("Resolved: …", e.g. when a lost connection turned into a stopped bot, which is then raised as its own alert). When the instance or account no longer exists, `text` starts with "Closed:" ("Closed: ger40-demo was removed").
- `instance` is set for instance alerts (`instance_*`), neither for host alerts (`host_clock`), `account` (the account number) for all others.
- `text` is in `DEFAULT_LOCALE` with times in UTC. It is also sent as `content`, so services that only read one of the two fields show the message as it is.
- Alerts already sent are stored in the database: a restart does not send them again. If the webhook does not answer with 2xx, the next check tries again.

With `DAILY_SUMMARY_TIME`, the same URL gets one summary a day (from that time on; a server that was down catches up the same day, a restart does not send it twice):

```json
{
  "event": "daily_summary",
  "time": "2026-09-30T19:30:00.000Z",
  "date": "2026-09-30",
  "accounts": [
    { "number": "7532555", "name": "Challenge US100", "currency": "USD", "balance": 9960.79, "equity": 9960.79,
      "dayPnl": -101.26, "openPositions": 0, "instances": { "total": 1, "running": 1 },
      "challenge": { "status": "running", "day": 185 } }
  ],
  "alerts": 1,
  "text": "wickwatch daily summary 2026-09-30\nChallenge US100 (7532555): balance 9,960.79 USD, …",
  "content": "…"
}
```

`text` has one line per account, the challenge rules under it, and the number of open alerts. Today's P&L is the UTC day, as on the dashboard.

When someone creates an API token, the same URL gets a notice at once, so access nobody meant to give shows up (sent once; the audit log keeps the record). It never holds the token itself:

```json
{
  "event": "api_token_created",
  "time": "2026-10-02T09:15:00.000Z",
  "user": "admin",
  "token": { "id": 3, "name": "claude", "role": "viewer", "expiresAt": "2026-12-31T09:15:00.000Z" },
  "text": "Security: admin created the API token claude with the role Viewer; it expires 12/31/26, 9:15 AM UTC.",
  "content": "…"
}
```

Examples:

| Service | `ALERT_WEBHOOK_URL` / `HEARTBEAT_URL` |
| --- | --- |
| Telegram | `ALERT_WEBHOOK_URL=https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat id>` (uses `text`; wickwatch sends it as HTML with `parse_mode`: headings bold, account numbers as code, so Telegram does not turn them into phone links) |
| Slack, Mattermost | incoming webhook URL (uses `text`) |
| Discord | channel webhook URL (uses `content`) |
| ntfy | `https://ntfy.sh/<topic>` shows the JSON; use ntfy's JSON publishing if you want only the text |
| Healthchecks.io | `HEARTBEAT_URL=https://hc-ping.com/<uuid>`: alarms when the pings stop, which also covers a dead server |

The webhook tells you about problems wickwatch can see; the heartbeat tells you when wickwatch itself is gone. Use both.

