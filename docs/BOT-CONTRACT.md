# Bot contract

What helps Wickwatch attribute trades, survive restarts and analyse setups. Strategy-independent. **None of it is required:** Wickwatch also works with bots you cannot change (third-party `.algo` files); some features are then limited, as noted below.

## Attributing trades to instances

Wickwatch has to know which positions, orders and deals of an account belong to which instance. Per instance, the container labels choose how (`<prefix>` is `LABEL_PREFIX`, default `wickwatch`):

| `<prefix>.attribution` | Rule | Use when |
| --- | --- | --- |
| `auto` (default) | Order label equals `<prefix>.order-label` (default: the instance name). Otherwise: the **only instance on the account** takes every trade there, whatever the symbol; with several instances on the account, the only one on the trade's symbol takes it. | Almost always. One bot per account (typical for prop challenges) works even with third-party bots and bots trading several symbols. |
| `label` | Only the order label, never the symbol. | Several of your own bots, or manual trades, on the same account and symbol. |
| `label-pattern` | The order label matches the regular expression in `<prefix>.order-label`. | Third-party bots on one account and symbol that use recognisable labels. |
| `account-symbol` | Every trade on the account and symbol. | Explicitly "this account and symbol belong to this bot". Two instances on the same account and symbol with this mode are reported as a conflict. |

Notes:
- In `auto` and `account-symbol` mode, manual trades on the same account and symbol count for the instance.
- The symbol must be the broker's symbol name (e.g. `US100.cash`), as in `<prefix>.symbol`.
- Trades that match no instance stay "not attributed"; account totals still include them.
- **Manual corrections:** on the instance page, admins can mark a position as "not from this bot" (e.g. a manual trade). This applies to the position and all its deals, is audit-logged and can be undone under "Excluded trades". Manual corrections win over every rule.

## Recommendations for bots you write

1. **Order label.** Give every order the instance name as label (or a label you put into `<prefix>.order-label`). Then attribution works even with several bots on one account and symbol. If your bot has a parameter for the label, set it to the instance name in the parameter set.
2. **Adopt own positions on start.** In `OnStart`, find open positions with the own label and continue managing them (trailing, session close). A restart must never orphan a position.
3. **Version.** Provide a parameter `BotVersion` (default = the version string) and log it on start, e.g. `MyBot 1.5.0 started, adopted positions: 1`. Without it, Wickwatch identifies versions by the SHA-256 of the `.algo` file and its build time.
4. **Structured setup log.** When the bot enters a trade, log one line with a fixed prefix and JSON:
   ```
   WW-SETUP {"label":"alpha-ger40-a","positionId":"12345","signal":"long","features":{"atr":38.2,"session":"eu"}}
   ```
   `features` is free-form key/value data. Wickwatch recognises these lines in the live log today (filter "Setups"); storing them per trade and showing them in the trade details comes with the setup analysis (phase 3). Without these lines, setup analysis is not available for the bot.
5. **Daily equity stop inside the bot, one that survives a restart.** The hard protection against breaching daily loss limits must live in the bot, which sees every tick. Take the day-start value from the account history (balance minus today's realised result), not from the equity when the bot starts: bots restart (new configuration, crash, host restart), and a stop that starts counting again at every start lets the day's loss grow past the limit. For bots where you cannot check this (third-party bots), switch on the optional **protection** in the account's challenge profile: Wickwatch then runs the emergency stop when a loss limit is used up to a share you choose, checked every `ACCOUNT_POLL_SECONDS`, once per trading day. It is a second line of defence, not a replacement.
6. **No secrets in logs.**
7. **End on purpose with `Stop()`.** When the bot ends itself (its own daily limit, a schedule), call `Stop()`. cTrader logs "cBot stopped itself", and Wickwatch then leaves the instance stopped, also after a host or Docker restart. A bot that is stopped from outside or simply exits counts as interrupted and is started again ([CONFIGURATION.md](CONFIGURATION.md#bots-after-a-restart)).
8. **A value for every text parameter.** The cTrader CLI has no empty text: it refuses to start a bot while a text parameter is empty, and Wickwatch asks for a value before it saves. Give text parameters a non-empty default and document a value that means "not set" (e.g. `-`); treating blank text as unset also helps.
