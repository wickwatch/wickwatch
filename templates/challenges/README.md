# Challenge templates

One JSON file per firm and phase. Values must come from the firm's **official rules page**; always fill `source` and `asOf`, rules change often. `_example.json` shows the format with placeholder values; it is not a real firm. Files starting with `_` are ignored; invalid files are skipped with a warning in the server log.

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
| `maxLoss.limitPct`, `maxLoss.type` | Max drawdown in percent; `static` from the start balance or `trailing` from the highest equity recorded |
| `minTradingDays` | Required days with at least one closed trade |
| `durationDays` | Time limit in days, or `null` |
| `tradingDayDefinition` | Informational; Wickwatch counts days with a closed trade |
| `source`, `asOf` | Link to the official rules and the date they were checked |

Firms differ in exactly these points (reset time and zone, balance vs. equity, static vs. trailing), so check every field. Wickwatch watches and warns; the hard daily stop belongs into the bot (`docs/BOT-CONTRACT.md`). The optional protection of a profile (not part of templates) lets Wickwatch stop the account itself.
