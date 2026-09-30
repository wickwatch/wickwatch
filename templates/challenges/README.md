# Challenge templates

One JSON file per firm and phase. Values must come from the firm's **official rules page**; always fill `source` and `asOf`, rules change often. `_example.json` shows the format with placeholder values; it is not a real firm. Rules may have changed since `asOf`; check the source before you rely on a template. Files starting with `_` are ignored; invalid files are skipped with a warning in the server log.

| Field | Meaning |
| --- | --- |
| `id` | Unique, lowercase letters, digits and `-`, e.g. `firm-a-phase-1` |
| `firm`, `program`, `phase` | Shown in the profile |
| `name` | Display name per language, e.g. `{ "en": "…", "de": "…" }` |
| `profitTargetPct` | Profit target in percent of the start balance; omit or `0` for none |
| `dailyLoss.limitPct` | Daily loss limit in percent |
| `dailyLoss.reference` | Measured from `balance-or-equity-at-day-start` (the higher of both), `balance-at-day-start` or `equity-at-day-start` |
| `dailyLoss.resetTime`, `dailyLoss.timezone` | Start of the trading day, e.g. `"00:00"` and an IANA zone such as `"Europe/Prague"` or `"America/New_York"` (daylight saving time is handled; avoid fixed offsets like `GMT+2`) |
| `dailyLoss.limitBasis` | Optional: the percentage refers to the `initial-balance` (default) or the `day-start` reference |
| `maxLoss.limitPct`, `maxLoss.type` | Max drawdown in percent of the start balance; `static` from the start balance, `trailing` from the highest equity recorded, or `trailing-eod-balance` from the highest balance at a trading-day start (end-of-day trailing). Trailing limits never sit below the static one |
| `minTradingDays` | Required trading days: days on which a position was opened (closed or still open) |
| `durationDays` | Time limit in days, or `null` |
| `tradingDayDefinition` | Informational; Wickwatch counts the days a position was opened, falling back to the closing day when the broker gives no opening time |
| `source`, `asOf` | Link to the official rules and the date they were checked |

## Included templates

FTMO (2-Step, 1-Step, Free Trial) and The Trading Pit (CFD Prime 1-Phase and 2-Phase, Classic), checked on 2026-09-30. Where The Trading Pit uses different percentages or drawdown types per account size, the template name carries the size range. The FTMO Free Trials follow their Challenge with a 5 % profit target (2-Step also with 2 instead of 4 minimum trading days) and run 14 days. Not modelled, so check them yourself: FTMO's Best Day Rule (1-Step), The Trading Pit's consistency rule and profitable-day requirement for payouts, and The Trading Pit Instant accounts (daily drawdown trailing on the highest balance).

Firms differ in exactly these points (reset time and zone, balance vs. equity, static vs. trailing), so check every field. Wickwatch watches and warns; the hard daily stop belongs into the bot (`docs/BOT-CONTRACT.md`). The optional protection of a profile (not part of templates) lets Wickwatch stop the account itself.
