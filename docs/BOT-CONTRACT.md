# Bot contract

What a bot should do so Wickwatch can attribute trades, survive restarts and analyse setups. Strategy-independent.

1. **Order label.** Every order and position carries a label equal to the instance name (`wickwatch.instance`). Wickwatch filters positions and deals per instance by this label.
2. **Adopt own positions on start.** In `OnStart`, find open positions with the own label and continue managing them (trailing, session close). A restart must never orphan a position.
3. **Version.** Provide a parameter `BotVersion` (default = the version string) and log it on start, e.g. `MyBot 1.5.0 started, adopted positions: 1`.
4. **Structured setup log.** When the bot enters a trade, log one line with a fixed prefix and JSON:
   ```
   WW-SETUP {"label":"alpha-ger40-a","positionId":"12345","signal":"long","features":{"atr":38.2,"session":"eu"}}
   ```
   `features` is free-form key/value data; Wickwatch stores it per trade for later analysis (phase 3).
5. **Daily equity stop inside the bot.** The dashboard only monitors (polling); the hard protection against breaching daily loss limits must live in the bot.
6. **No secrets in logs.**
