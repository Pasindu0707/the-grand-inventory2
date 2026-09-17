# Backup & Disaster Recovery Plan

**Project:** The Grand - inventory management system
**Version:** 1.0 · [FILL: date]
**Status:** Internal - but §7 is demonstrated to the Client and is a condition of go-live

---

## 1. The rule this document exists to enforce

> **An untested backup is a belief, not a backup.**

Before a single real delivery is entered, there must be a nightly dump **and** a
restore that has actually been performed. Not scripted. Not scheduled.
Performed, watched, and evidenced.

This is **NFR-BAK-03** in the SRS and it is a condition of go-live. It is the
one item on the whole project that TriniphiX will not sign an acceptance
certificate without.

## 2. What has to survive

| # | Asset | Where | Recoverable from |
|---|---|---|---|
| A1 | **The database** | PostgreSQL volume | Nightly dump |
| A2 | **Uploaded photographs** | Local disk | Nightly sync |
| A3 | Application code | Git repository | Origin |
| A4 | Configuration and secrets | `.env` on the server | **Secure offline copy - see §3.3** |
| A5 | Server configuration | Docker Compose, Caddyfile | Git repository |
| A6 | TLS certificates | Caddy volume | Reissued automatically |

**A1 is the only one that is irreplaceable.** Everything else can be rebuilt.
The ledger cannot: it is an append-only record of things that physically
happened, and there is no second copy anywhere in the world.

## 3. Backup arrangements

### 3.1 Database

| | |
|---|---|
| Method | `pg_dump` - custom format, compressed |
| Frequency | Nightly at **[FILL: 03:00]** Asia/Colombo |
| Destination | [FILL: object storage provider], bucket `[FILL]` |
| Transport | HTTPS |
| Encryption at rest | [FILL: provider-managed / customer-managed key] |
| Retention | **30 days**, rolling |
| Naming | `grand-YYYY-MM-DD-HHMM.dump` |
| Verification | Exit status checked; file size compared against the previous night |
| On failure | **Alert to [FILL: number]** |

Why 03:00: the business day starts at 06:00, so 03:00 is the quietest point and
a dump taken then contains a complete previous business day.

Why 30 days: long enough to notice a corruption that happened during a quiet
period, short enough to keep costs and personal-data retention sensible (DPA
§11.3).

### 3.2 Uploaded photographs

| | |
|---|---|
| Method | Incremental sync of the uploads directory |
| Frequency | Nightly, after the database dump |
| Retention | 30 days |

These matter more than they look. A photograph of a short or damaged delivery
is taken once, at the door, and cannot be taken again afterwards.

### 3.3 Configuration and secrets

`.env` holds the database password, the JWT secret and the storage credentials.
It is **not** in the repository and it is **not** in the database dump.

| | |
|---|---|
| Method | Manual, on change |
| Held by | [FILL: password manager / sealed envelope, and who holds it] |
| Also recorded in | The Handover Note, delivered to the Client |

**This is the gap that turns a two-hour recovery into a two-day one.** The
database can be restored perfectly and the application still will not start
without the JWT secret. Confirm this copy exists as part of every restore drill.

## 4. Objectives

| Objective | Target | What it means in practice |
|---|---|---|
| **RPO** - how much data we can lose | **24 hours** | Worst case: everything since last night's dump. At this business, roughly one day of deliveries, issues, wastage and counts |
| **RTO** - how long to be running again | **4 hours** | From declaring a disaster to people using the system |

### 4.1 What a 24-hour RPO actually costs

Being concrete, so the Client can decide whether to pay for better.

Losing a day means re-entering: that day's deliveries (invoices are on paper -
recoverable, though **any photographs taken at the door would be lost**), issues
(the kitchen would have to remember), wastage, and any count taken that day.

The painful one is **stock counts**. A count is a physical observation that
cannot be reconstructed. It has to be done again.

**If the Client wants better than 24 hours,** point-in-time recovery via
continuous WAL archiving reduces RPO to minutes. It is a Change Request, costs
more in storage, and is worth discussing once the business depends on this
system. It is not needed on day one.

## 5. Failure scenarios

| # | Scenario | Likelihood | Response | Expected recovery |
|---|---|---|---|---|
| F1 | Database corruption | Low | Restore last night's dump (§6) | 2-4 hours |
| F2 | **Accidental data destruction** | Medium | The ledger cannot be deleted. Master data can - restore | 2-4 hours |
| F3 | Server failure / VPS loss | Low | Rebuild from Compose, restore | 4 hours |
| F4 | Provider region outage | Very low | Rebuild in another region | 4-8 hours |
| F5 | Ransomware / compromise | Low | Rebuild clean, restore, rotate every secret | 8 hours |
| F6 | Application bug writes bad data | Medium | **The ledger cannot be edited.** Correct with reversals - no restore needed | Minutes |
| F7 | Uploads lost | Low | Restore from sync | 1 hour |
| F8 | Backup itself failed silently | **Medium** | Alerting + monthly drill (§7) | Prevention only |

### 5.1 Two scenarios the architecture handles for free

**F2 and F6.** The ledger's immutability means the most common disaster in a
stock system - someone or something quietly corrupting history - cannot happen.
A bad document is corrected with a reversal, which takes minutes and leaves both
rows visible. No restore, no downtime, no arguing about what the number used to
be.

This is worth naming because it is a real operational benefit of a design choice
usually justified on integrity grounds alone.

### 5.2 The scenario that actually worries us

**F8.** A backup that has been silently failing for six weeks is discovered on
the day it is needed. The controls are: an alert on failure, a size check
against the previous night, and a **monthly** restore drill that proves the
files are real.

## 6. Restore procedure

> Print this. In a real incident the wiki may be on the machine that is down.

### 6.1 Before touching anything

1. **Stop the application.** `docker compose stop api caddy`. Do not let writes
   land during a restore.
2. **Take a dump of the current state anyway**, however broken. It costs two
   minutes and it is the only way back if the restore is worse.
3. **Write down the time and what you observed.** The incident report needs it,
   and memory is unreliable at 3am.

### 6.2 Restore

```bash
# 1. Fetch the chosen dump
[FILL: object storage download command] grand-YYYY-MM-DD-HHMM.dump ./restore.dump

# 2. Confirm it is what you think it is - size, date, and that it opens
pg_restore --list ./restore.dump | head

# 3. Recreate the database
docker compose exec postgres psql -U postgres -c "drop database if exists grand;"
docker compose exec postgres psql -U postgres -c "create database grand;"

# 4. Restore
docker compose exec -T postgres pg_restore -U postgres -d grand --no-owner < ./restore.dump

# 5. Verify BEFORE starting the application - see 6.3
```

### 6.3 Verify before opening the doors

| # | Check | Command | Expected |
|---|---|---|---|
| V1 | Ledger row count | `select count(*) from stock_ledger;` | Matches the last known figure. **It only ever grows** |
| V2 | Most recent movement | `select max(business_date) from stock_ledger;` | The expected date |
| V3 | Users present | `select count(*) from users where is_active;` | Matches |
| V4 | Items present | `select count(*) from items where is_active;` | Matches |
| V5 | Immutability intact | Attempt an `update stock_ledger set note='x' where id=1;` | **Rejected** |
| V6 | Stock reads correctly | `select * from current_stock_valued limit 5;` | Plausible figures |
| V7 | API health | `curl localhost:3000/api/v1/health` | `{"status":"ok","db":"up","ledgerRows":…}` |

**V1 and V5 are the two that matter.** V1 catches a restore of the wrong file.
V5 catches a restore that lost the triggers - which would leave a system that
looks perfect and has quietly stopped being trustworthy.

### 6.4 Restart and tell people

```bash
docker compose start api caddy
```

Then: sign in, check the Today screen, check one report, and **tell the
storekeeper and management what was lost** so they can re-enter it. Specifically
name any stock count taken since the backup - that one has to be redone
physically.

## 7. The restore drill

### 7.1 Before go-live - mandatory, with the Client watching

| Step | |
|---|---|
| 1 | Take a backup |
| 2 | Restore it to a **separate** database |
| 3 | Run every check in §6.3 |
| 4 | Start the application against the restored database and sign in |
| 5 | **Record the wall-clock time it took** |
| 6 | Both parties sign the evidence sheet below |

This is demonstrated in the Client's presence. It is what turns "we have
backups" into something the owner has actually seen work.

### 7.2 Ongoing

| Frequency | Drill |
|---|---|
| **Monthly** | Restore the latest dump to a scratch database; confirm V1, V5 and V7 |
| **Annually** | Full drill including a rebuilt server from scratch |
| After any change to the backup arrangement | Full drill |

Under the AMC.

### 7.3 Evidence sheet

Completed and retained for every drill.

| | |
|---|---|
| Date | |
| Performed by | |
| Witnessed by | |
| Backup file restored | |
| Backup file date | |
| Ledger rows expected | |
| Ledger rows restored | |
| V1 · V2 · V3 · V4 · V5 · V6 · V7 | ☐ ☐ ☐ ☐ ☐ ☐ ☐ |
| **Time taken, start to running** | |
| Issues found | |
| **Result** | ☐ Pass ☐ Fail |

**Signed:** TriniphiX ____________  Client ____________  Date __________

## 8. Monitoring

| # | Alert | Trigger | To |
|---|---|---|---|
| M1 | Backup failed | Non-zero exit | [FILL] |
| M2 | Backup suspiciously small | < 80% of the previous night | [FILL] |
| M3 | **No backup ran** | Heartbeat missed | [FILL] |
| M4 | Application down | Health check fails twice | [FILL] |
| M5 | Disk above 85% | | [FILL] |
| M6 | Certificate expiring | 14 days | [FILL] |

**M3 is the important one.** M1 catches a failure. M3 catches the job that
stopped being scheduled at all, which is the failure mode that goes unnoticed
for months.

## 9. Roles

| Who | Responsibility |
|---|---|
| TriniphiX | Operates backups, monitors, performs drills, executes restores - under the AMC |
| Client | Provides or funds the hosting and storage; witnesses the pre-go-live drill; holds a copy of the credentials from the Handover Note |

If the AMC lapses, **backup operation passes to the Client**, and this document
becomes their runbook. That transition should be an explicit conversation, not a
discovery.

## 10. Cost

| Item | Monthly (LKR) |
|---|---|
| Object storage, 30 days retention | [FILL] |
| Transfer | [FILL] |
| Monitoring | [FILL] |
| **Total** | **[FILL]** |

Set against re-counting every shelf in the building and losing every supplier
price, this is the cheapest line in the project.
