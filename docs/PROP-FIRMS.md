# Prop-firm accounts

Prop firms have rules about software, devices, IP addresses and data access. They differ between firms and change often. Read them before you connect a challenge or funded account to wickwatch, and ask the firm in writing when a rule is unclear. This page is a starting point, not legal advice.

wickwatch is meant to be self-hosted for **your own accounts**. Running it for other people's accounts conflicts with the platform licence (cTrader: "personal and non-commercial use") and with the rules of every firm below.

## What wickwatch does on an account

With the cTrader adapter, everything runs on your server, so the broker sees one IP address:

- **Logins:** one long-lived CLI session per account for reading and trading actions, plus one login per running bot (each instance is its own `ctrader-cli run`). Listing the accounts of a login, or the symbols of an account, logs in briefly once more. After a failed login (wrong password, broker maintenance) wickwatch waits 1 minute before the next one, doubling up to 5 minutes (a rejected password holds every login of that cTrader ID); trading actions such as the emergency stop log in regardless.
- **Reading:** balance and equity every `ACCOUNT_POLL_SECONDS` (default 60), deals and positions every 5 minutes, and the overview's figures every 30 seconds while a dashboard page is open and visible. All of this runs one command at a time in the account's session; it reads the same data every cTrader client and every cBot receives.
- **Trading:** only when you (or the loss guard of a challenge profile) close a position, cancel an order or run the emergency stop. Polling sends no orders.

## What to check with your firm

- **Automated trading:** are bots (EAs, cBots) allowed on this program, and on which platforms?
- **Third-party software:** is software allowed that you run yourself to control your account?
- **Request limits:** what counts towards them? Usually orders and order changes, not reading.
- **Devices and IP addresses:** may several of your accounts trade from one server? Are logins from different places on the same day (server and home) a problem?
- **VPS and location:** allowed, and from which countries?
- **Platform terms:** some firms require you to follow the trading platform's terms as well.

## Notes on firms with templates

Checked on 2026-10-03 from the firms' public pages. Check the sources again before you rely on them.

**FTMO**
- Bots and third-party software are allowed ([FAQ](https://ftmo.com/en/faq/), [terms](https://ftmo.com/en/terms-and-conditions/) 4.8).
- The limit of 2,000 server requests per day counts trades and pending orders "being opened, modified, or closed" ([forbidden trading practices](https://ftmo.com/en/forbidden-trading-practices/)); reading does not count.
- VPS and VPN are allowed; do not change your location to the United States ([FAQ](https://ftmo.com/en/faq/can-i-travel-or-use-vpn-vps/)).

**The Trading Pit**
- Expert advisors and a VPS are allowed ([help center](https://support.thetradingpit.com/can-i-use-an-expert-advisor-0)).
- **Several accounts from one IP address or network are not allowed**, and an IP address that changes several times a day can raise a suspicion of account sharing ([device and IP policy](https://support.thetradingpit.com/trading-device-ip-network-policy)). If you have more than one account there, ask before you run them from one wickwatch server.
- The [terms](https://www.thetradingpit.com/general-terms-and-conditions) (4.5.2) prohibit automated data retrieval such as scraping without permission; reading your own account through the platform's official client is what every platform does, but ask if in doubt.
