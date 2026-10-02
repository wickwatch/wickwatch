# MCP endpoint

wickwatch has a read-only [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `<your wickwatch>/mcp`. AI clients that speak MCP can read the overview, accounts with their challenge status, instances with positions and deals, logs, alerts and the host status, and, with an admin token, the audit log. They cannot start, stop, change or trade anything.

## Set it up

1. In wickwatch, open the user menu → **API tokens** (admins) and create a token. **Viewer** is enough: the endpoint only reads. Confirm with your password (and the 2FA code, when it is on). Copy the token; it is shown only once.
2. Add wickwatch to your client with the address shown on that page and the header `Authorization: Bearer <token>`.

With Claude Code:

```sh
claude mcp add --transport http wickwatch https://wickwatch.example.com/mcp \
  --header "Authorization: Bearer ww_…"
```

Clients configured with JSON usually take:

```json
{
  "mcpServers": {
    "wickwatch": {
      "type": "http",
      "url": "https://wickwatch.example.com/mcp",
      "headers": { "Authorization": "Bearer ww_…" }
    }
  }
}
```

The endpoint is on by default. `MCP=off` switches it off ([CONFIGURATION.md](CONFIGURATION.md)); `/mcp` then answers 404, and API tokens still work for the REST API.

## Tools

All tools only read and give the same data as the REST API for the token's role. None returns parameter values of instance configurations (they may hold licence keys) or broker credentials. Each answers with one JSON text. Times are UTC, money is in the account currency.

| Tool | Arguments | What it returns | Role |
| --- | --- | --- | --- |
| `get_overview` | – | All accounts (balance, equity, today's P&L, open positions, challenge status), all instances (status, uptime, broker connection, crashes, open positions, today's P&L, last log line) and the current alerts. Names the account numbers and instance refs the other tools take. | viewer |
| `get_alerts` | – | The current alerts only: stopped, crashed or disconnected instances, broker errors, challenge limits and breaches, an unsynchronised clock. | viewer |
| `get_account` | `number` | One account: summary with the challenge evaluation (profit target, daily loss, max drawdown, trading days), its instances, open positions and pending orders with their instance. | viewer |
| `get_instance` | `ref`, `days` (1–366, default 30) | One instance: status, open positions, pending orders, the deals of the range with realised P&L curve and key figures (win rate, profit factor, drawdown, risk per trade). | viewer |
| `get_instance_logs` | `ref`, `lines` (1–1000, default 200), `since` (ISO time) | The last log lines of an instance, oldest first, each with its time. | viewer |
| `get_host_status` | – | CPU, memory and disk of the host, and whether its clock is in sync. | viewer |
| `get_audit_log` | `action` (exact, or a prefix ending in `.`), `target` (part of it), `since`, `before` (id, to page back), `limit` (1–200, default 50) | Audit log entries, newest first: who did what (`user`, and `token` when it came through an API token), and what wickwatch did by itself. | admin |

### Is a bot running?

`get_overview` (all instances) and `get_instance` (one) answer it with these fields of each instance:

| Field | Meaning |
| --- | --- |
| `status` | `running`, `stopped`, `restarting`, `error` or `unknown` (the runtime could not tell). |
| `startedAt` | When it started; the uptime is the time since. |
| `connectionLostSince` | It runs, but logged that its broker connection is lost, at this time. `status` still says `running`. |
| `crashes` | Errors the algo threw since it started, while it kept running: count, time and log line of the latest. |
| `stoppedByUser` | Stopped on purpose through wickwatch (stop, emergency stop, loss guard); such a stop raises no alert. |
| `restartCount` | How often the runtime restarted it. |

So "running and fine" is `status` `running` without `connectionLostSince` and `crashes`. `get_alerts` lists the instances that are not: `instance_stopped`, `instance_error`, `instance_disconnected` and `instance_crashed`, with the instance name as `subject`.

An unknown account or instance, or an invalid argument, comes back as a tool error (e.g. `Error: not_found`), so the model can correct itself. A viewer token does not see `get_audit_log` at all.

## Security

- **Tokens only.** The endpoint takes an API token as `Authorization: Bearer`, never the session cookie of the web app. Requests from another site's page (an `Origin` header of another host) are rejected, as the MCP specification asks against DNS rebinding.
- **Read-only.** There are no tools that change anything, on purpose: log lines, order labels and comments are written by bots and brokers and reach the model as untrusted text. A text in a log that reads like an instruction must not be able to stop a bot or close a position. The server also tells the client to treat such text as data.
- **Least privilege.** Use a viewer token. A request acts as the token's creator with at most the token's role; deleting the token cuts the client off at once. When it was last used shows in the token list.
- **Lifetime.** A token needs no 2FA code and outlives a password change; it ends when it expires or is deleted. Pick a lifetime when you create it. If the password may have leaked, tick **Also delete my API tokens** when you change it. With `ALERT_WEBHOOK_URL` set, every new token is reported there, so a token nobody meant to create shows up at once.

More on tokens and roles: [SECURITY.md](../SECURITY.md).

## Protocol

- Transport: Streamable HTTP, **stateless**. Every `POST /mcp` with a JSON-RPC message (or a batch) gets a JSON answer; notifications get `202 Accepted`. There are no sessions (`Mcp-Session-Id`) and no server-sent events: `GET` and `DELETE` answer `405`.
- Protocol versions: `2025-11-25`, `2025-06-18`, `2025-03-26`. A client asking for another one gets the newest and decides whether it can use it; an `MCP-Protocol-Version` header with an unsupported version answers `400`.
- Methods: `initialize`, `ping`, `tools/list`, `tools/call`. No resources, prompts or sampling.
- Authentication: a static bearer token, no OAuth. A missing or wrong token answers `401` with `WWW-Authenticate: Bearer`.

## Troubleshooting

- **The client wants to log in with OAuth, or reports an authorization error.** Some clients start an OAuth login when they get `401`. The cause is almost always the header: it is missing, the token is mistyped, deleted or expired, or `Bearer ` is missing in front of it. Check the token in the list (expired?) and the client's header setting.
- **`404`.** The endpoint is switched off (`MCP=off`), or the address lacks the base path (`BASE_PATH`): take the address from the API tokens page.
- **`403 forbidden_origin`.** The request came with an `Origin` of another host, e.g. from a web page. Desktop and command-line clients send none.
- **Behind a reverse proxy.** The proxy must pass `/mcp` (with the base path) and the `Authorization` header on to wickwatch. The answers are plain JSON, so no buffering settings are needed.
- **No audit log tool.** It is offered to admin tokens only, and only while their user is still an admin: a token never has more rights than its user.
- **No "Create token" button.** The server allows tokens only to users with 2FA (`API_TOKENS_REQUIRE_2FA=on`): set up 2FA in your profile first. Creating a token also fails with a wrong password or code; it asks for both again on purpose.
