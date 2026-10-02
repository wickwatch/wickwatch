# Installing wickwatch on a Linux server

A step-by-step guide for a fresh install with Docker, behind nginx-proxy with acme-companion, using the cTrader CLI adapter. For other proxies see [`README.md`](README.md).

## 1. Check the server

You need Docker with Compose v2.24 or newer, a synchronised clock and a DNS record for the dashboard's host name pointing at the server.

```bash
. /etc/os-release && echo "$PRETTY_NAME"; nproc; free -h; df -h /
docker version --format 'Docker {{.Server.Version}}'
docker compose version
timedatectl | grep -E 'synchronized|NTP service'
getent hosts bots.example.com; curl -s -4 https://ifconfig.me; echo
```

- **Resources:** 2 vCPU and 4 GB RAM are enough for the dashboard and a few bots. Each bot is its own .NET process; measure with `docker stats` once the first instance runs. Without swap the kernel kills a process when memory runs out, which can be a bot; a small swap file is a cheap safety net:

  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf && sudo sysctl vm.swappiness=10
  ```

- **Clock:** `System clock synchronized: yes`. Trading and daily challenge limits depend on it; wickwatch also checks the clock hourly (`CLOCK_CHECK_URL`).
- **Operating system:** use a release that still gets security updates.
- **Firewall:** ports published by containers bypass ufw. The setup below publishes no port of its own; only the reverse proxy listens on 80 and 443. The socket proxy (2375) must never be published.
- **Reverse proxy:** find the network your nginx-proxy container is attached to; wickwatch joins it.

  ```bash
  for c in $(docker ps -q); do docker inspect -f '{{.Name}}: {{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$c"; done
  ```

  Both the single-container nginx-proxy and the older three-container setup (nginx, docker-gen, letsencrypt companion) read `VIRTUAL_HOST`, `VIRTUAL_PORT` and `LETSENCRYPT_HOST`.

## 2. Get the image

Pull a pinned wickwatch version (never `latest` in production) and the cTrader image your bots run with (`CTRADER_IMAGE`):

```bash
docker pull ghcr.io/wickwatch/wickwatch:0.4.0
docker pull ghcr.io/spotware/ctrader-console:5.9.11
```

## 3. Folders and compose files

One folder holds the compose file, `.env` and the data. The container runs as UID 1000, so `data/` must belong to it:

```bash
sudo mkdir -p /opt/wickwatch/data
sudo chown "$USER": /opt/wickwatch
sudo chown 1000:1000 /opt/wickwatch/data
cd /opt/wickwatch
touch .env && chmod 600 .env
```

Write `compose.yml`: [`compose.standalone.yml`](compose.standalone.yml) and [`compose.nginx-proxy.yml`](compose.nginx-proxy.yml) merged, with the version pinned, your host name and the proxy's network (here `webproxy`):

```yaml
services:
  wickwatch:
    image: ghcr.io/wickwatch/wickwatch:0.4.0
    restart: unless-stopped
    env_file: .env
    environment:
      DOCKER_HOST: tcp://socket-proxy:2375
      VIRTUAL_HOST: bots.example.com
      VIRTUAL_PORT: "3000"
      LETSENCRYPT_HOST: bots.example.com
      LETSENCRYPT_EMAIL: you@example.com
    volumes:
      - ./data:/app/data
    logging: &logging
      driver: json-file
      options: { max-size: "10m", max-file: "5" }
    networks: [internal, webproxy]

  socket-proxy:
    image: tecnativa/docker-socket-proxy
    restart: unless-stopped
    environment:
      CONTAINERS: 1
      IMAGES: 1
      POST: 1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    logging: *logging
    networks: [internal]

networks:
  internal:
  webproxy:
    external: true
```

- No `ports:`: only the proxy reaches wickwatch, and the socket proxy stays on the internal network.
- `LETSENCRYPT_EMAIL` is needed when the companion has no `DEFAULT_EMAIL`; check how your other sites set it: `docker inspect <container> -f '{{range .Config.Env}}{{println .}}{{end}}' | grep LETSENCRYPT`.
- Bots need no host folders: wickwatch copies algo and parameter files into their containers through the Docker API.

Check the file with `docker compose config --quiet && echo OK`.

## 4. Configuration (`.env`)

For bots on the cTrader CLI, set up and run from wickwatch (all variables: [`docs/CONFIGURATION.md`](../docs/CONFIGURATION.md)):

```bash
cd /opt/wickwatch
cat > .env <<'EOF'
TRUST_PROXY=1
DEFAULT_LOCALE=en
LOG_LEVEL=info
RUNTIME_ADAPTER=docker
BROKER_ADAPTER=ctrader-cli
CONFIG_ADAPTER=cbotset
CTRADER_CLI=container
CTRADER_IMAGE=ghcr.io/spotware/ctrader-console:5.9.11
INSTANCE_RESTART_POLICY=on-failure
EOF
printf 'MASTER_KEY=%s\n' "$(openssl rand -base64 32)" >> .env
chmod 600 .env
```

- `TRUST_PROXY=1`: one proxy in front. wickwatch then sees the client IP (rate limiting, logs) and sets `Secure` cookies.
- `MASTER_KEY` goes straight into the file, not through the terminal or the shell history. **Back it up separately now** (e.g. in a password manager): without it, stored broker passwords, TOTP secrets and parameter values cannot be decrypted, not even from a backup.
- Database and backups need no entry: the defaults (`data/wickwatch.db`, daily backups in `data/backups`, 7 kept) are inside the mounted folder.
- `DOCKER_HOST` comes from `compose.yml`.

## 5. First start and admin account

```bash
cd /opt/wickwatch
docker compose up -d
docker compose ps
docker compose exec wickwatch node -e 'fetch("http://127.0.0.1:3000/healthz").then(r=>r.text()).then(console.log)'
```

If the log shows `SqliteError: unable to open database file`, `data/` is not writable for UID 1000: `docker compose stop wickwatch && sudo chown -R 1000:1000 data && docker compose up -d`.

The proxy picks the container up by itself; the certificate usually follows within a minute or two:

```bash
docker logs --tail 30 <letsencrypt-companion> 2>&1 | grep bots.example.com
curl -sI https://bots.example.com/healthz | head -1
```

Then create the admin:

1. Read the setup token from the log: `docker compose logs wickwatch | grep "setup token"`. Keep it to yourself.
2. Open `https://bots.example.com/setup`, enter the token, create the admin account and scan the QR code with an authenticator app.

The token is valid until the admin exists; after a restart without an admin, a new one is printed.

## 6. Broker login, account, algo and instance

In the dashboard, follow [`docs/USER-GUIDE.md`](../docs/USER-GUIDE.md) sections 2–5: broker login, account, algo upload, instance, **Create and start**. Start with a demo account and a bot that does not trade. Never run the same instance on two servers at once: when moving a bot from another machine, stop it there first.

Fetching the accounts is the first call of the cTrader CLI in a helper container (label `wickwatch.tool`, removes itself). Once the instance runs:

```bash
docker ps -a --filter label=wickwatch.managed=true --format '{{.Names}}\t{{.Status}}'
docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
```

For reference: wickwatch about 100 MB, the socket proxy about 20 MB, a minimal bot about 180 MB once running, at about 2 % CPU. Right after its start a bot uses more than one CPU for a while.

## 7. Restart behaviour

After a host or Docker restart, Docker brings wickwatch and the socket proxy back (`restart: unless-stopped`), but not the bots: they ended cleanly with exit code 0, which `on-failure` leaves alone. wickwatch starts the instances that were meant to run again within about 15 seconds and logs `instance.autostart` in the audit log (details: [Bots after a restart](../docs/CONFIGURATION.md#bots-after-a-restart)). A bot that stopped itself, e.g. after its own daily loss rule, stays stopped.

To try it without rebooting the host, stop wickwatch, end the bot the way a reboot would, and start wickwatch again:

```bash
docker compose stop wickwatch
docker stop <instance>          # SIGTERM, exit code 0
docker compose start wickwatch
sleep 30; docker inspect <instance> -f '{{.State.Status}} since {{.State.StartedAt}}'
```

## 8. Backups off the server

wickwatch writes a consistent copy of the database to `data/backups/` every day ([Backups and restore](../docs/CONFIGURATION.md#backups-and-restore)). Those copies sit on the same disk, so copy them elsewhere as well, encrypted (e.g. with restic or age): they hold the encrypted broker credentials and all account and trading data.

| What | Where | Off the server |
| --- | --- | --- |
| Database backups | `data/backups/` | yes, encrypted |
| Uploaded algos | `data/algos/` (not in the database) | yes |
| `MASTER_KEY` | `.env` | separately, e.g. in a password manager; never next to the backups |
| `compose.yml` | `/opt/wickwatch` | in your own (private) repository |

## 9. Monitoring

Use both channels ([Notifications](../docs/CONFIGURATION.md#notifications)): the webhook reports what wickwatch sees, the heartbeat reports when wickwatch or the whole server is gone. Add them with an editor (`nano .env`), so tokens stay out of the shell history:

```bash
HEARTBEAT_URL=https://hc-ping.com/<uuid>
ALERT_WEBHOOK_URL=https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat id>
# optional: one summary a day
DAILY_SUMMARY_TIME=21:30
DAILY_SUMMARY_TIMEZONE=Europe/Berlin
```

Then `docker compose up -d --force-recreate wickwatch`; running bots keep running.

- **Heartbeat** (e.g. Healthchecks.io): period 1 minute (`ALERT_CHECK_SECONDS`), grace time a few minutes longer than a restart of wickwatch takes, e.g. 10 minutes for bots on M30 and above. Send its "down" notification to the same chat. Pause the check during longer planned maintenance.
- **Telegram chat ID:** write to your bot, then read the ID with `curl -s "https://api.telegram.org/bot<token>/getUpdates"` (`"chat":{"id":…}`; group IDs are negative). If another program polls the same bot, `getUpdates` stays empty; a separate bot for wickwatch avoids that.
- **Test:** stop an instance in the dashboard; within `ALERT_CHECK_SECONDS` the chat gets the alert, and after starting it again a "Resolved" message.

## 10. Updates

Pin the new version in `compose.yml`, then:

```bash
cd /opt/wickwatch
docker compose pull wickwatch    # while the old version still runs
docker compose stop wickwatch
sudo cp -p data/wickwatch.db data/backups/before-update-<version>.db
docker compose up -d wickwatch
docker compose logs --tail 30 wickwatch
curl -s https://bots.example.com/healthz   # {"status":"ok","version":"<version>"}
```

wickwatch is down only between `stop` and `up`, about 15 seconds.

- Database migrations run at start; the log names each one it applies. They only go forward: to go back to the old version, restore the copy (see [Backups and restore](../docs/CONFIGURATION.md#backups-and-restore)).
- Bots keep running while wickwatch is stopped; it takes them over again at start.
- Read [`CHANGELOG.md`](../CHANGELOG.md) before updating. A new `CTRADER_IMAGE` is a separate change: set it in `.env`, then apply each instance again from the dashboard.
