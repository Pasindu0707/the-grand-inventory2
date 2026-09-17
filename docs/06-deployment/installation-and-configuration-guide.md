# Installation & Configuration Guide

**Project:** The Grand - inventory management system
**Version:** 1.0 · [FILL: date]
**Audience:** whoever has to stand this system up - including someone who has
never met us

---

## 1. What you need

| | Minimum | Notes |
|---|---|---|
| Server | 2 vCPU, 4 GB RAM, 40 GB SSD | A single VPS. Region: [FILL: Singapore / Mumbai] for latency to Sri Lanka |
| OS | Ubuntu 22.04 LTS or later | |
| Docker | 24+ with Compose v2 | |
| Domain | One A record | Pointed at the server before you start - Caddy needs it for the certificate |
| Ports open | 80, 443, and SSH | Nothing else |
| Object storage | Any S3-compatible bucket | For backups |

## 2. Local development

```bash
git clone [FILL: repository URL]
cd thegrand_inventory
docker compose up -d          # Postgres 16 on port 5433
npm install
npm run db:reset-all          # schema + 60 days of demo data
```

Then the API and the web app, in two terminals:

```bash
cd api && npm install && npm run dev
```

```bash
cd beautech-master-web-app && npm install && npm start
```

The web app runs on **4200** and proxies `/api` to the API on **3000**. Sign in
as any seeded user with PIN `1234`.

### 2.1 The second front end

There are two web apps against the same API, on different ports, so both can be
open at once.

```bash
cd grand-inventory-web && npm install && npm start   # port 4300
```

### 2.2 Useful commands

| Command | Does |
|---|---|
| `npm run db:reset-all` | Drops the schema, migrates, regenerates `seed.sql`, loads it |
| `npm run db:verify` | 12 checks: schema → seed → immutability → cutover → re-seed |
| `cd api && npm test` | 64 integration tests against a real Postgres |
| `cd api && npm run typecheck` | |
| `cd api && npm run lint` | **Includes the rule that no controller writes the ledger** |

The seed generator is TypeScript run through `tsx`. The bare
`node --experimental-strip-types` form needs Node 22+; this repo targets the
Node 20 LTS that is actually installed.

**Same PRNG seed every run**, so screenshots and test assertions stay stable.

## 3. Production install

### 3.1 Prepare the server

```bash
# As root, on a fresh Ubuntu box
adduser --disabled-password --gecos "" grand
usermod -aG docker grand
mkdir -p /home/grand/.ssh
# put your public key in /home/grand/.ssh/authorized_keys
chown -R grand:grand /home/grand/.ssh
chmod 700 /home/grand/.ssh && chmod 600 /home/grand/.ssh/authorized_keys
```

**Disable password authentication.** In `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin no
```

```bash
systemctl restart sshd
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

### 3.2 Get the code

```bash
su - grand
git clone [FILL: repository URL] app
cd app
```

### 3.3 Configuration

Create `/home/grand/app/.env`. **This file is never committed and is not in the
database backup.** Keep a copy somewhere safe - see §7.

```bash
NODE_ENV=production

# Database - the password is generated here and used nowhere else
DATABASE_URL=postgres://grand:[FILL: strong password]@postgres:5432/grand
POSTGRES_USER=grand
POSTGRES_PASSWORD=[FILL: same strong password]
POSTGRES_DB=grand

# Sessions. Generate with: openssl rand -base64 48
JWT_SECRET=[FILL]

# Who may call the API
CORS_ORIGIN=https://[FILL: domain]

# Uploads
MAX_UPLOAD_BYTES=10485760
UPLOAD_DIR=/data/uploads

# Backups
BACKUP_BUCKET=[FILL]
BACKUP_ACCESS_KEY=[FILL]
BACKUP_SECRET_KEY=[FILL]
BACKUP_ENDPOINT=[FILL]

# Alerting
ALERT_WEBHOOK=[FILL]
```

```bash
chmod 600 .env
```

**Generate the JWT secret rather than inventing one:**

```bash
openssl rand -base64 48
```

### 3.4 Caddy

`Caddyfile`:

```
[FILL: domain] {
    encode gzip

    handle /api/* {
        reverse_proxy api:3000
    }

    handle /uploads/* {
        root * /data
        file_server
    }

    handle {
        root * /srv/web
        try_files {path} /index.html
        file_server
    }
}
```

Caddy obtains and renews the TLS certificate automatically. **The DNS A record
must already point at this server** or the certificate request fails.

### 3.5 Start

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 3.6 Migrate

```bash
docker compose exec api npm run db:migrate
```

**Do not seed a production database.** Seeding loads sixty days of demonstration
data, and while the cutover script would remove it, there is no reason to put it
there.

### 3.7 Create the first admin

```bash
docker compose exec api node scripts/add-user.mjs \
  --name "[FILL: admin name]" --role admin --pin [FILL]
```

They appear on the login screen immediately. No restart.

### 3.8 Verify

| # | Check | Command | Expected |
|---|---|---|---|
| 1 | Containers up | `docker compose ps` | All healthy |
| 2 | API alive | `curl https://[domain]/api/v1/health` | `{"status":"ok","db":"up","ledgerRows":0}` |
| 3 | HTTPS valid | Open in a browser | Padlock, no warning |
| 4 | Login screen | Open the domain | The admin's tile |
| 5 | **Immutability** | See §4 | Refused |

## 4. Verify immutability on the live server

Do this once, on the production database, before anyone enters real data. It is
also UAT script U-91.

```bash
docker compose exec postgres psql -U grand -d grand
```

```sql
-- Insert one row first if the ledger is empty, or run this after the
-- first real document exists.
update stock_ledger set note = 'x' where id = 1;
-- ERROR: stock_ledger is append-only; correct it with a reversal row (id=1)

delete from stock_ledger where id = 1;
-- ERROR: stock_ledger rows cannot be deleted (id=1, is_demo=f)

truncate stock_ledger;
-- ERROR: stock_ledger cannot be truncated
```

**All three must fail.** If any succeeds, the migration did not apply the
triggers and **no real data may be entered** until it does.

## 5. Backups

### 5.1 Script

`/home/grand/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

STAMP=$(date +%Y-%m-%d-%H%M)
FILE="/tmp/grand-$STAMP.dump"

docker compose -f /home/grand/app/docker-compose.prod.yml \
  exec -T postgres pg_dump -U grand -Fc grand > "$FILE"

SIZE=$(stat -c%s "$FILE")
if [ "$SIZE" -lt 10000 ]; then
  echo "Backup suspiciously small: $SIZE bytes" >&2
  exit 1
fi

[FILL: upload command] "$FILE" "s3://$BACKUP_BUCKET/grand-$STAMP.dump"
[FILL: sync command] /data/uploads "s3://$BACKUP_BUCKET/uploads/"

rm "$FILE"
echo "Backup $STAMP ok, $SIZE bytes"
```

```bash
chmod 700 /home/grand/backup.sh
```

### 5.2 Schedule

```bash
crontab -e
```

```
0 3 * * * /home/grand/backup.sh >> /home/grand/backup.log 2>&1 || [FILL: alert command]
```

03:00 because the business day starts at 06:00, so a dump taken then contains a
complete previous business day.

### 5.3 Retention

Set a 30-day lifecycle rule on the bucket. Do not rely on the script to delete
old files - a script that both writes and deletes backups is a script that can
delete all of them.

### 5.4 Test it

**Before go-live**, and monthly thereafter. Full procedure in the
[Backup & Disaster Recovery Plan](../04-technical/backup-and-disaster-recovery.md).

## 6. Monitoring

| Alert | Trigger | Send to |
|---|---|---|
| Backup failed | Non-zero exit | [FILL] |
| **No backup ran** | Heartbeat missed | [FILL] |
| Application down | Health check fails twice | [FILL] |
| Disk above 85% | | [FILL] |
| Certificate expiring | 14 days | [FILL] |

The "no backup ran" alert matters most. A failure gets noticed; a job that
quietly stopped being scheduled does not.

## 7. What to keep somewhere safe

**The database backup is not enough to restore this system.** These are not in
it:

| # | Item | Where a copy lives |
|---|---|---|
| 1 | `.env` - including `JWT_SECRET` and the database password | [FILL: password manager] |
| 2 | SSH private keys | [FILL] |
| 3 | Domain registrar login | [FILL] |
| 4 | VPS provider login | [FILL] |
| 5 | Object storage credentials | [FILL] |
| 6 | Git repository access | [FILL] |

All of these are also recorded in the Handover Note given to the Client.

**Without `JWT_SECRET`, a perfectly restored database still will not let anyone
sign in.** Confirm this copy exists as part of every restore drill.

## 8. Updates

```bash
cd /home/grand/app
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml exec api npm run db:migrate
docker compose -f docker-compose.prod.yml up -d
curl https://[domain]/api/v1/health
```

**Take a backup first.** Migrations are forward-only; there is no down
migration, on purpose.

## 9. Troubleshooting

| Symptom | Likely cause | Do |
|---|---|---|
| No certificate | DNS not pointing here yet | Check the A record, then `docker compose restart caddy` |
| API unhealthy | Database not up, or wrong `DATABASE_URL` | `docker compose logs api` |
| Everyone signed out at once | `JWT_SECRET` changed | Restore the correct value from §7 |
| Uploads 404 | Volume not mounted, or wrong `UPDATE_DIR` | Check the mount and `UPLOAD_DIR` |
| Migration fails | Applied out of order, or a partially applied migration | **Restore the backup.** Do not hand-patch a production schema |
| An update or delete on the ledger succeeded | The triggers are missing | **Stop. Enter no data. Call TriniphiX.** |

The last row is the only genuine emergency in this table.

## 10. Ports and volumes

| Container | Port | Exposed |
|---|---|---|
| caddy | 80, 443 | **Yes** |
| api | 3000 | No - container network only |
| postgres | 5432 | **No.** Never expose the database |

| Volume | Holds |
|---|---|
| `postgres_data` | The database |
| `uploads` | Photographs |
| `caddy_data` | Certificates |
