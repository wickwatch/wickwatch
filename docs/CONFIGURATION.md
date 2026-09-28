# Configuration

Wickwatch is configured with environment variables only (see [`.env.example`](../.env.example)). Invalid values stop the server at start with a list of all problems. Empty values count as unset.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Address to listen on. |
| `PORT` | `3000` | Port to listen on. |
| `BASE_PATH` | `/` | Path prefix when served under a sub-path, e.g. `/bots`. UI, API and cookies use it; `/healthz` also answers at the root. |
| `TRUST_PROXY` | `false` | Behind a reverse proxy: `true`, a hop count (`1`) or a comma-separated list of proxy IPs/CIDRs. Needed for correct client IPs (rate limiting, logs) and for `Secure` cookies behind TLS-terminating proxies. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Logs are JSON on stdout. |
| `MASTER_KEY` | – | **Required.** 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts broker credentials and TOTP secrets. Back it up: without it, stored secrets cannot be decrypted. Changing it is not supported yet. |
| `DATABASE_URL` | `file:./data/wickwatch.db` | SQLite file, relative to the working directory (`/app` in the image). Postgres is planned. |
| `LABEL_PREFIX` | `wickwatch` | Prefix of the container labels used to find instances, e.g. `wickwatch.instance`. |
| `DEFAULT_LOCALE` | `en` | `en` or `de`; used when the browser language is not supported. |
| `RUNTIME_ADAPTER` | `demo` | Runs bot instances. Available: `demo`, `docker` (finds containers with the label `<LABEL_PREFIX>.instance` and creates containers for instances set up in Wickwatch). |
| `DOCKER_HOST` | local socket | Docker API for the `docker` runtime, e.g. `tcp://socket-proxy:2375` (recommended) or `unix:///var/run/docker.sock`. |
| `BROKER_ADAPTER` | `demo` | Accounts and trading data. Available: `demo` (demo accounts are added to an empty database) and `ctrader-cli` (accounts, balances, positions, orders, deals, algo metadata, starting bots in the official CLI image; closing positions and the emergency stop are not enabled yet). |
| `CTRADER_IMAGE` | `ghcr.io/spotware/ctrader-console:5.9.11` | Image instances run with (`BROKER_ADAPTER=ctrader-cli`). Must be pinned to a version or digest, never `latest`; change it deliberately and re-apply the instances. |
| `INSTANCE_RESTART_POLICY` | `on-failure` | Docker restart policy of created instances: `on-failure` restarts after a crash but leaves a bot stopped that stopped itself (e.g. after its own daily loss rule); `unless-stopped` always restarts; `no` never. |
| `CTRADER_CLI_PATH` | `ctrader-cli` | cTrader CLI executable for `BROKER_ADAPTER=ctrader-cli`. It must be installed where the server runs. |
| `CONFIG_ADAPTER` | `demo` | Parameter files. Available: `demo`. |
| `ACCOUNT_POLL_SECONDS` | `60` | How often balance and equity of every account are sampled (10–3600). Needed for daily loss and trailing drawdown; deals are checked every 5 minutes. |
| `ALGOS_DIR` | `data/algos` | Where uploaded algo files are stored, one folder per name and version (`<name>/<version>/<name>.algo`). Keep it on a persistent volume. |
| `CHALLENGE_TEMPLATES_DIR` | `templates/challenges` | Directory with challenge templates (`*.json`, see its README). |
| `WEB_DIST_DIR` | next to the server | Directory of the built web app. Only needed when running the server outside the image. |
| `ALERT_WEBHOOK_URL` | – | Receives a JSON `POST` whenever an alert appears or goes away, see [Notifications](#notifications). May contain a token; it is never logged. |
| `HEARTBEAT_URL` | – | Called with `GET` after every successful alert check, e.g. a Healthchecks.io ping URL. When the calls stop, that service reports the whole server as down. |
| `ALERT_CHECK_SECONDS` | `60` | How often alerts are checked for the two URLs above (10–3600). |
| `WICKWATCH_VERSION` | from the build | Version shown in the UI and `/healthz`; set by the image build. |

## Notifications

Wickwatch checks the same alerts the overview shows every `ALERT_CHECK_SECONDS`: stopped or failed instances, a lost broker connection, unreachable accounts (e.g. a failed login), challenge limits and attribution problems. Nobody has to have the dashboard open.

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

- `event` is `alert_raised` or `alert_resolved` (then `text` starts with "Resolved:").
- `instance` is set for instance alerts (`instance_*`), `account` (the account number) for all others.
- `text` is in `DEFAULT_LOCALE` with times in UTC. It is also sent as `content`, so services that only read one of the two fields show the message as it is.
- Alerts already sent are stored in the database: a restart does not send them again. If the webhook does not answer with 2xx, the next check tries again.

Examples:

| Service | `ALERT_WEBHOOK_URL` / `HEARTBEAT_URL` |
| --- | --- |
| Telegram | `ALERT_WEBHOOK_URL=https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat id>` (uses `text`) |
| Slack, Mattermost | incoming webhook URL (uses `text`) |
| Discord | channel webhook URL (uses `content`) |
| ntfy | `https://ntfy.sh/<topic>` shows the JSON; use ntfy's JSON publishing if you want only the text |
| Healthchecks.io | `HEARTBEAT_URL=https://hc-ping.com/<uuid>`: alarms when the pings stop, which also covers a dead server |

The webhook tells you about problems Wickwatch can see; the heartbeat tells you when Wickwatch itself is gone. Use both.

