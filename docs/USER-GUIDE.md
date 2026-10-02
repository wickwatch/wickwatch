# User guide

How to run your bots with wickwatch, from the first login to a running prop challenge. Button and menu names are those of the English UI; the German UI uses the same layout. Settings for the server (adapters, paths, notifications) are in [CONFIGURATION.md](CONFIGURATION.md), deployment in [`deploy/README.md`](../deploy/README.md).

Only an **admin** can change things (start, stop, set up, emergency stop). A **viewer** sees everything except parameter values (they may hold licence keys) but acts on nothing.

## 1. First login

1. Start wickwatch and copy the **setup token** from its log (`No admin yet. Open /setup and enter the setup token: …`).
2. Open wickwatch, enter the token, a user name and a password. This creates the admin.
3. Scan the QR code with an authenticator app and enter the code, or skip two-factor authentication for now.

Your user menu (top right) leads to **Profile**: set up or turn off 2FA (turning it off needs your password and a current code) and change the password there. Changing the password logs you out everywhere else.

## 2. Connect a broker account

Under **Accounts**:

1. **Broker logins → add a login:** a label, the user name at the broker (for cTrader: your cTrader ID) and the password. wickwatch stores it encrypted and never shows it again. One login can serve several accounts.
2. **Add account:** choose the login, **Get accounts from the broker**, and pick the account. Give it a name you recognise (e.g. "Challenge US100 - H1").

The account now appears as a card on the **Overview** and has its own page (click its name).

## 3. Upload an algo

Under **Algos → Upload algo**, choose the `.algo` file (e.g. exported from cTrader). wickwatch reads its parameters and stores it per version. The version comes from the form, the bot's `BotVersion` parameter or its build time. Old versions stay, so you can go back. An identical file is refused as a duplicate.

## 4. Set up an instance

An instance is one bot on one account, symbol and timeframe. **Overview → New instance**:

- **Basics:** the instance name (lower-case letters, digits and dashes; it is also the container name and the default order label), the account, the algo version, symbol and timeframe (both from the broker).
- **Parameters:** the form comes from the algo. Groups are folded; **Search parameters** and **Only changed** help with long lists. A changed value is marked, and the reset button next to it restores the default.
- **Load parameters from a file:** drop a `.cbotset` (e.g. exported from cTrader) to fill the form, including symbol and timeframe. wickwatch lists what it did not take and why. Nothing is saved until you press **Save**.
- **Load parameters from a template:** pick one of the algo's parameter templates (see [Parameter templates](#parameter-templates)) to fill the form the same way. Symbol and timeframe stay as they are.
- **Text parameters need a value (cTrader):** the cTrader CLI cannot start a bot while a text parameter is empty. Such fields are marked, and a loaded file lists them. Enter a value your bot reads as "not set" (e.g. `-`, or a value outside the valid range); the bot's documentation says which.
- **Trade attribution:** how wickwatch knows which trades belong to this bot. **Automatic** is right almost always; see [BOT-CONTRACT.md](BOT-CONTRACT.md) for the other modes.
- **Comment:** optional; it shows in the version history.

**Save** creates configuration version 1. Saving never starts or restarts anything.

## 5. Create and start the container

Open the instance, tab **Configuration**:

- **Create container** creates the bot's container from the current version and leaves it stopped; **Create and start** also starts it. Both ask for confirmation, because a started bot trades on the account.
- After you **Edit** and save again, the new version is not in effect yet. A banner says "Version N is saved, the container still uses version M" (also on the Overview tab) with **Apply version N**. On a running bot that is a restart. A stopped or crashed bot stays stopped until you start it.
- **Start, Stop, Restart** are in the page head, and in every row of the instance table on the Overview.
- The history lists every version with author, comment and what changed. **Restore…** takes an old version back as a new one. **Download .cbotset** gives the parameters of a version as a file.
- **Duplicate** (menu in the page head) starts a new instance with the same settings. **Delete** removes the instance with its history and its container; nothing changes at the broker.

If a version cannot start, e.g. because of empty text parameters, the Configuration tab says so and applying is blocked until you fix it with **Edit**.

### Parameter templates

A template is a named set of parameter values of an algo, e.g. "Conservative" and "Aggressive", or the settings for a news day. It belongs to the algo, not to an instance, so the same template works for every instance of that algo, on any account and timeframe. It holds parameter values only, not symbol or timeframe.

- **Save as template…** on any version in the history saves its values under a name. Using the name of an existing template of the algo replaces that template's values.
- **Apply template…** (Configuration tab, next to the current configuration) shows every value the template changes, as "current → template". Untick a value to keep the current one, e.g. a licence key that belongs to this account. Values that do not fit the current algo version (out of range, an unknown option) or that the algo does not know are listed and left out; parameters the template does not set keep their current value. **Save as version N** saves a new version with the comment "From template …"; apply it as usual (see above) to use it in the bot.
- **Algos page:** each algo lists its templates with the number of values, where they came from and when they were changed. **Template from file…** makes one from a `.cbotset`; templates can be renamed and deleted there. Deleting a template changes no configuration saved from it.

Like configurations, template values are encrypted on the server and visible to admins only, since they may hold licence keys. Saving, changing, deleting and applying a template is in the audit log.

## 6. Watch an instance

The **Overview** tab of an instance shows:

- key figures and the realised P&L curve of closed trades (7, 30 or 90 days, or all since the first trade);
- the **live log**, with the filters **Warnings & errors** and **Setups**. **Show larger** opens it almost full screen with a search; the download button saves the log of the last 24 hours, the last 7 days or everything the container still has as a text file (one line per log line: UTC time, then the text as the bot wrote it);
- **Open positions**, **Pending orders** and the **History** of closed trades, with risk in % of the balance and the result in R when the stop the position opened with is known;
- an info button in every row that opens the **details panel**: entry and exit, initial stop, opening and closing time with the holding time, gross result, commission, swap, net, risk and R, label and IDs.

Admins can **Close position** and **Cancel order** from the rows (with confirmation). **Not from this bot** removes a trade from this instance, e.g. a manual one; it is listed under "Excluded trades" and can be restored.

The **status** badge says whether the bot runs, is stopped, has no container yet, or has lost its broker connection (the container keeps running meanwhile). Errors the bot throws while it keeps running are counted and shown with the latest message.

## 7. Prop challenges

On the account page: **Add challenge profile**.

1. **Template:** pick your firm and program (FTMO, The Trading Pit). It fills the rules; check them against the firm's rules page linked below the field, since rules change. Or enter the rules yourself.
2. **Start date and start balance** of the challenge.
3. **Rules:** profit target, daily loss (measured from the balance, the equity or the higher of both at the day start; the reset time and time zone come from the firm), max drawdown (static, trailing on the highest equity, or trailing on the end-of-day balance), minimum trading days, duration. Leave a field empty if the rule does not apply.
4. **Protection (optional):** stop the account automatically when the daily or max loss limit is used up to a share you choose, e.g. 80 %. See below.

The account card and page then show each rule with a bar and its state: in words, not only in colour ("50 % of the limit used", "Reached", "Limit breached"). On the card the rules fold away behind the challenge's head and open by themselves when a limit needs attention.

**Trading days** count the days on which a position was opened, as prop firms do. After you save a profile, wickwatch loads the days since the start date; until then the count says "loading …".

wickwatch watches the account every minute. The hard daily stop still belongs into the bot ([BOT-CONTRACT.md](BOT-CONTRACT.md)).

## 8. Emergency stop and protection

**Emergency stop** (on the account card and page, when there is something to stop) stops all instances of the account, cancels all its orders and closes all its positions, manual ones too. It asks for confirmation and is written to the audit log.

With **Protection** switched on in the challenge profile, wickwatch runs the same emergency stop by itself when a loss limit reaches the chosen share, at most once per trading day. An alert says when and why. The instances stay stopped until you start them again, also after a restart of the server or Docker.

## 9. After a restart

When the host or Docker restarts, wickwatch starts the instances it set up again if they were running before. A bot that stopped itself (e.g. after its own daily limit), or one that was stopped by you, the emergency stop or the protection, stays stopped. Details: [CONFIGURATION.md](CONFIGURATION.md#bots-after-a-restart).

## 10. Audit log

Admins find the **Audit log** in the user menu: every login, change and trading action with time, user (and the API token, when it came through one), target and result, and what wickwatch did by itself (the protection, automatic restarts). Filter by action (or a whole group, e.g. all instance actions) and by target; instance and account targets link to their pages. Entries are kept for `AUDIT_RETENTION_DAYS` (default one year).

## 11. Alerts and notifications

Alerts show at the top of the Overview: stopped or crashed bots (a bot you stopped yourself, by emergency stop or the protection is no alert; one that stopped itself is), a lost broker connection, accounts that cannot be reached, challenge limits, a breached or passed challenge, the protection having acted, attribution problems, and a server clock that is off. The clock icon in the header shows whether the server time is right: green up to 1 s off, yellow up to 2 s, red beyond (then also an alert), a question mark when it could not be checked lately; the tooltip says how far off it is. With `ALERT_WEBHOOK_URL` and `DAILY_SUMMARY_TIME` you also get one summary a day per account (balance, equity, today's P&L, positions, instances, challenge). With `ALERT_WEBHOOK_URL` and `HEARTBEAT_URL` they also reach you without the dashboard open, e.g. on Telegram ([CONFIGURATION.md](CONFIGURATION.md#notifications)).

## 12. API tokens and MCP

Admins find **API tokens** in the user menu. A token lets a script or an AI client use wickwatch without a login: send it as `Authorization: Bearer <token>`. Give it a name (what uses it), a role and a lifetime (30, 90 or 365 days, or never), and confirm with your password and, with 2FA on, a code. With `API_TOKENS_REQUIRE_2FA=on` only users with 2FA can create tokens. The token is shown once, right after it was created; copy it then. The list keeps only its first characters, who created it, when it expires and when it was last used. Delete a token to cut off whatever uses it.

A request with a token acts as the user who created it (the audit log shows that user and the token), with at most the token's role: a **viewer** token only reads, whatever its user may do. If the user is no admin any more, an admin token only reads too. A token cannot change passwords or 2FA, and cannot list, create or delete tokens. It needs no 2FA code and stays valid when you change your password; when you change it because it may have leaked, tick **Also delete my API tokens** in the dialog. With `ALERT_WEBHOOK_URL` set, every new token is reported there ([CONFIGURATION.md](CONFIGURATION.md#notifications)).

The same page shows the address of the **MCP endpoint** (`<your wickwatch>/mcp`): AI clients that speak the Model Context Protocol read accounts, instances, logs and alerts there, read-only, and a viewer token is enough. Setup, the tools and troubleshooting: [MCP.md](MCP.md).
