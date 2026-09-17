# Deploying The Grand on Oracle Cloud (free tier)

Everything needed to put this system on a free Oracle server and reach it from
a browser. Follow it top to bottom the first time.

The stack is three containers on one machine: PostgreSQL, the Fastify API, and
Caddy serving the Angular console and forwarding `/api/*` to the API. Because
Caddy serves both, everything is same-origin — there is no CORS to configure
and no API hostname compiled into the front end.

---

## 1. Create the server

In the Oracle console: **Compute → Instances → Create instance**.

| Setting | Value | Why |
|---|---|---|
| Shape | **VM.Standard.A1.Flex** | The Ampere shape is the free one |
| OCPUs / memory | **2 OCPU, 12 GB** | The whole free allowance since June 2026 |
| Image | **Canonical Ubuntu 22.04** | What the setup script is written against |
| Boot volume | 50 GB | Well inside the 200 GB free storage |
| SSH key | Add your public key | Password login is not offered |

Two things to know before you click:

- **Ampere A1 is arm64, not x86.** Every image used here (`node:22-alpine`,
  `postgres:16-alpine`, `caddy:2-alpine`) publishes arm64, so this builds
  natively on the server. Do not build images on a Windows laptop and push
  them — they will be the wrong architecture.
- **"Out of capacity" is normal.** The free A1 shape is often unavailable in a
  given region. Retry, or try another availability domain. This is the single
  most common reason people give up on the free tier.

## 2. Open the ports — in two places

This trips up nearly everyone. There are **two** firewalls, and the failure
mode is silent: the site simply never responds, and nothing logs why.

**Oracle's virtual network** — Networking → Virtual Cloud Networks → your VCN →
Security Lists → Default Security List → **Add Ingress Rules**:

| Source | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

**The host firewall** — handled for you by `setup-oracle.sh` in the next step.
Oracle's images ship with a REJECT rule partway down the chain, so the script
*inserts* the accept rules above it rather than appending. Appending is the
usual mistake and looks like it worked.

Note there is no rule for 5432. Postgres is reachable only from the other
containers. To inspect it from your laptop, tunnel over SSH:

```bash
ssh -L 5433:localhost:5432 ubuntu@<public-ip>
```

## 3. Install and configure

```bash
ssh ubuntu@<public-ip>
sudo git clone https://github.com/Pasindu0707/the-grand-inventory2.git /opt/thegrand
sudo bash /opt/thegrand/deploy/setup-oracle.sh
```

The script installs Docker, opens the host firewall, adds 2 GB of swap, and
creates `deploy/.env` from the example. Log out and back in afterwards so your
user picks up docker group membership.

Now fill in the secrets. **Generate them, do not invent them:**

```bash
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 48   # JWT_SECRET
```

```bash
sudo nano /opt/thegrand/deploy/.env
```

For the first run, leave `SITE_ADDRESS=:80` and set `PUBLIC_URL` to
`http://<your-public-ip>`. That gets it working over plain HTTP before DNS
exists. HTTPS comes in step 6.

The API refuses to start in production if `JWT_SECRET` is still the development
default — that is deliberate, not a bug.

## 4. Start it

```bash
cd /opt/thegrand
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

First build takes roughly 5–10 minutes on two Ampere cores — the Angular
production build is most of it.

Watch it come up:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env ps
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs -f api
```

The `migrate` service runs `db/migrations/*.sql` once and exits 0. The API will
not start until it has, so a failed migration stops the deploy rather than
leaving a server running against a schema it does not understand.

## 5. Create the first administrator

```bash
cd /opt/thegrand
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
  run --rm api node scripts/add-user.mjs
```

Then open `http://<public-ip>` and sign in.

**Smoke test before trusting it:**

```bash
curl -i http://<public-ip>/health          # API is alive behind the proxy
curl -i http://<public-ip>/                # Angular console is served
```

## 6. Switch to HTTPS

Point a DNS record at the server — an A record for `inventory.thegrand.lk`
(or whichever sub-address) to the public IP. Wait for it to resolve, then:

```bash
sudo nano /opt/thegrand/deploy/.env
#   SITE_ADDRESS=inventory.thegrand.lk
#   PUBLIC_URL=https://inventory.thegrand.lk

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d
```

Caddy requests a Let's Encrypt certificate on first start and renews it by
itself. There is no certbot cron job to forget.

Do this only once DNS actually resolves — a failed certificate request counts
against Let's Encrypt rate limits, and repeated failures will lock you out for
an hour.

## 7. Nightly backups

```bash
sudo crontab -e
15 2 * * * /opt/thegrand/deploy/backup.sh >> /var/log/thegrand-backup.log 2>&1
```

Set `RCLONE_REMOTE` in `.env` first (`rclone config` on the server). Without
it the script still runs but warns loudly, because a dump sitting on the same
machine as the database is not a backup — it is a second copy of the same risk.

**Then restore one, before you need to.** An untested backup is a belief.

```bash
gunzip -c /opt/thegrand/backups/thegrand_<date>.sql.gz | \
  docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
  exec -T db psql -U grand -d thegrand
```

---

## The thing that will actually bite you: idle reclamation

Oracle reclaims free instances it judges idle. All three of these must be true
over a rolling 7-day window:

- CPU (95th percentile) under 20%
- Network under 20%
- Memory under 20% — *this criterion applies to A1 shapes*

A quiet inventory system fails the first two comfortably. **Memory is the way
out**, because all three must hold. `PG_SHARED_BUFFERS=3GB` in `.env` is set
for exactly this reason: 3 GB of 12 GB is comfortably over the 20% line, and it
is a sensible figure for this database anyway.

That reduces the risk. It does not eliminate it, and Oracle publishes no notice
period before reclaiming. Keep the backups off-server and the migration path
ready.

Two related facts worth knowing:

- The June 2026 cut reduced the free allowance **to** 2 OCPU / 12 GB. A server
  built today at that size is already compliant — the people whose instances
  were stopped were running the older 4 OCPU / 24 GB shape.
- Free-tier-only accounts get no support and no uptime guarantee. That is the
  real cost of free, not the specification.

## Moving to a paid server later

Nothing here is Oracle-specific except `setup-oracle.sh`. The same compose file
runs unchanged on Vultr or DigitalOcean:

1. Restore the latest dump into the new server's database.
2. Copy the uploads archive into the `uploads` volume.
3. Point DNS at the new IP.

On a 1 GB machine, drop `PG_SHARED_BUFFERS` to `256MB` and
`PG_EFFECTIVE_CACHE` to `768MB` first — the 3 GB figure will not start there.

Lower the DNS TTL to 300 seconds **before** you need to move. Otherwise staff
keep reaching the old address for up to a day after the new server is live.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Site never responds, no logs | Oracle VCN ingress rules missing (step 2) |
| Responds on the server via `curl localhost` but not remotely | Host firewall — rerun `setup-oracle.sh` |
| `JWT_SECRET is still the development default` | `.env` not filled in |
| API restarts in a loop | Usually `DATABASE_URL`; check `logs db` first |
| Certificate fails | DNS not resolving yet, or port 80 closed — Let's Encrypt needs 80 |
| Build killed part way | Out of memory during the Angular build; the swap step covers this |
| `out of capacity` creating the instance | Oracle has no free A1 in that region right now; retry |

Useful commands:

```bash
cd /opt/thegrand
C="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env"

$C ps                    # what is running
$C logs -f api           # follow the API
$C logs migrate          # what the migrations did
$C restart api           # restart just the API
$C down                  # stop everything (volumes survive)
$C up -d --build         # rebuild and restart after a git pull
```
