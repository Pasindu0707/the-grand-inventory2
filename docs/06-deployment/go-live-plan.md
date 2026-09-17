# Deployment & Go-Live Plan

**Project:** The Grand - inventory management system
**Version:** 1.0 · [FILL: date]
**Go-live date:** [FILL]

---

## 1. The one thing that must be true first

> **Do not start this until Phase 0 is finished** - every item, unit and pack
> conversion confirmed by walking the store with the storekeeper, and the sheet
> signed.
>
> **And do not start it until a backup has been restored successfully in front
> of the Client.** An untested backup is a belief, not a backup.

No amount of software recovers from a wrong pack conversion, and nothing
recovers from data loss with no restore.

## 2. Go / no-go

Every one of these must be ticked before cutover begins. Any single "no" stops
the go-live.

| # | Gate | Owner | Ticked |
|---|---|---|---|
| G1 | UAT Sign-off Certificate signed | Client | ☐ |
| G2 | No open Severity 1 or 2 defects | Both | ☐ |
| G3 | **Phase 0 sheet signed by the storekeeper and management** | Client | ☐ |
| G4 | Production server deployed with HTTPS | TriniphiX | ☐ |
| G5 | Nightly backup running and verified | TriniphiX | ☐ |
| G6 | **A restore performed successfully in the Client's presence** | Both | ☐ |
| G7 | Alerting configured to a nominated phone | TriniphiX | ☐ |
| G8 | Devices in place and connected to Wi-Fi | Client | ☐ |
| G9 | Wi-Fi working in the store, kitchen and bar | Client | ☐ |
| G10 | Training completed and the attendance sheet signed | Both | ☐ |
| G11 | Manuals delivered | TriniphiX | ☐ |
| G12 | Materiality floors and issue windows confirmed by the Client | Client | ☐ |
| G13 | Wastage reason codes agreed in the Client's own words | Client | ☐ |
| G14 | Everyone told the system goes live on [FILL: date] | Client | ☐ |
| G15 | Supplier agreed prices available | Client | ☐ |

**Go / no-go decision:** ______________ **Date:** __________
**Taken by:** Client ______________ TriniphiX ______________

## 3. Timing

Pick a day that is **not** a busy one, and a time when stock is not moving.

**Recommended: [FILL: a Monday morning, or the quietest day of the week],
starting after the morning delivery and before service.**

| Slot | Activity | Duration |
|---|---|---|
| Day −7 | Deploy, backups, restore drill, alerting | 1 day |
| Day −3 | Training | Half a day |
| Day −1 | Go / no-go. Freeze demo use | 1 hour |
| **Day 0, 08:00** | Reset and verify the ledger is empty | 30 min |
| **Day 0, 08:30** | Create the first admin | 15 min |
| **Day 0, 08:45** | Setup data entry - the long one | 6-8 hours |
| **Day 0, 16:00** | Opening stock, room by room | 2 hours |
| **Day 1** | First real delivery. TriniphiX on site | Full day |
| Days 2-5 | On-site support | As needed |
| Day 30 | Review | 2 hours |

## 4. Cutover runbook

Follow this in order. Each step needs the one before it.

### Step 1 - Freeze demo use

Tell everyone to stop. Confirm nobody is signed in.

☐ Done at __________ by ______________

### Step 2 - Final backup of the demonstration database

Costs two minutes. It is the only way back if something goes wrong in the next
ten.

☐ Done · file: ______________

### Step 3 - Reset

```bash
psql "$DB" -f db/reset.sql
```

☐ Done at __________

### Step 4 - Verify the ledger is empty

```sql
select count(*) from stock_ledger;
```

**Must be `0`.** If it is not, **stop.** Do not proceed. Call TriniphiX.

☐ Result: __________ ☐ Verified by ______________

> This check exists because an earlier version of the schema used a rule that
> silently discarded deletes. Cutover would have appeared to succeed while
> leaving 10,800 demonstration rows in the live ledger, and nobody would have
> known until the first report looked strange.

### Step 5 - Create the first admin

The only step that still needs a terminal, because the reset took every login
with it - including the one that would have created the next one.

```bash
node scripts/add-user.mjs --name "[FILL: admin name]" --role admin --pin [FILL]
```

☐ Done · admin name: ______________

### Step 6 - Build the system

Sign in as that admin. **This order matters - each step needs the one before
it.**

| # | Step | Screen | Who | Done |
|---|---|---|---|---|
| 6.1 | **Branches and sections.** The branch arrives with its main store; add the kitchen, bar, bakery and cleaning sections it really has, **and a Quarantine section** - nothing can be returned without one | Setup → Branches and sections | Admin | ☐ |
| 6.2 | **Categories, then every item with its packs.** This is the long one - Phase 0's spreadsheet being typed in | Setup → Products | Admin | ☐ |
| 6.3 | **Suppliers, with the prices already agreed** | Setup → Suppliers | Admin | ☐ |
| 6.4 | **Logins for the real people** | Logins | Admin | ☐ |

**6.2 is a full day.** Two people: one reading from the signed Phase 0 sheet,
one typing. Then read it back, out loud, line by line - see §5.

**6.3 matters more than it looks.** Those prices are what the first delivery is
measured against. Without them the first surprise price looks exactly like the
normal price.

### Step 7 - Opening stock

Room by room, as the storekeeper or a manager. **Count the shelf, enter what is
on it and what it is worth.**

| Section | Counted by | Entered by | Time | Value (LKR) | Done |
|---|---|---|---|---|---|
| Main store | | | | | ☐ |
| Kitchen | | | | | ☐ |
| Bakery | | | | | ☐ |
| Bar | | | | | ☐ |
| Cleaning store | | | | | ☐ |
| Quarantine | *(empty at go-live)* | | | | ☐ |
| | | | **Total** | | |

> **A section can be opened once, and only while it has never held anything.**
> After that the instrument is a stock count, because after day one a difference
> is a discrepancy rather than a starting point.
>
> Count the room, then enter it, then move to the next. Do not open a section
> and leave it for a week.

**Management confirms the total is credible:** ______________

### Step 8 - First real delivery

☐ Done at __________ by ______________

**After this, the ledger is immutable for real. That is the point.**

## 5. Verification before the first delivery

| # | Check | Expected | Result |
|---|---|---|---|
| V1 | Ledger was empty after reset | 0 | |
| V2 | Item count matches the Phase 0 sheet | [FILL] | |
| V3 | Pack count matches the sheet | [FILL] | |
| V4 | **Every pack conversion read back aloud, two people** | 100% | |
| V5 | Supplier count and prices match | [FILL] | |
| V6 | Every real person has a login and has signed in once | [FILL] | |
| V7 | Every section has an opening balance | All | |
| V8 | Total stock value is credible to management | Signed | |
| V9 | Backup ran last night | Yes | |
| V10 | Health check responds | `{"status":"ok"}` | |

**V4 is done out loud, by two people, reading every row.** It is tedious and it
is the last chance to catch the error that would otherwise take six months to
find and cost the credibility of the whole system.

## 6. Rollback

| When | What is possible |
|---|---|
| Before step 8 | Restore the backup from step 2, or re-run the reset and start again. Nothing of value has been created |
| **After step 8** | **No rollback.** The ledger is immutable. Errors are corrected with reversals |

This is why every check in §5 happens before that first delivery.

## 7. The first week

| Day | TriniphiX | Client |
|---|---|---|
| 1 | **On site all day.** Watch the first delivery, the first issue, the first count | Use it. Ask everything |
| 2-3 | On site or immediately reachable | Use it |
| 4-5 | Reachable, checking in twice a day | Use it |
| 7 | Review call: what is working, what is being avoided | Be honest about what is being avoided |

**The thing to watch for is not errors. It is avoidance** - a step somebody has
quietly stopped doing because it is inconvenient. That is what kills a system in
week three, and it is only visible if you are standing there.

## 8. Day-30 review

| # | Question |
|---|---|
| 1 | Is every delivery going in? Check against the invoice file |
| 2 | Is every issue being recorded, or is the store still open all day? |
| 3 | Are counts happening on schedule? |
| 4 | Is anyone sharing a login? |
| 5 | Are the reports being opened? Which ones? |
| 6 | **Are the materiality floors right?** Too much noise, or too little? |
| 7 | Are the issue windows the real ones? |
| 8 | What is being worked around? |
| 9 | What was missed at cutover? |

Item 6 in particular is expected to need adjusting. The starting values were
informed guesses, and thirty days of real data is the first chance to set them
properly.

## 9. Communication

| Who | Told what | When | By |
|---|---|---|---|
| All staff | The date, and that the old way stops | Day −7 | Client |
| Storekeeper | Their day-0 role: counting every shelf | Day −7 | Client |
| Admin | Their day-0 role: all the data entry | Day −7 | Client |
| Suppliers | Nothing changes for them | - | - |
| Management | The go/no-go, and the day-30 review | Day −1 | TriniphiX |

## 10. Risks on the day

| # | Risk | Mitigation |
|---|---|---|
| 1 | Data entry over-runs | Start early, two people. If it slips past 16:00, **postpone the opening count to the next morning** rather than counting tired |
| 2 | Reset does not empty the ledger | Stop. Do not proceed. This is a TriniphiX problem, not a Client one |
| 3 | An item is missed | The admin is on site on day one and can add it |
| 4 | Wi-Fi fails in a room | Have a phone with mobile data as a fallback |
| 5 | Stock moves during the opening count | Count outside service; freeze movements per room |
| 6 | Someone enters a real delivery before opening stock | Brief everyone: **nothing goes in until the admin says so** |
| 7 | Opening values guessed | Use the most recent invoice price per item |

## 11. Sign-off

**Cutover complete and the first real delivery entered.**

| | |
|---|---|
| Date | |
| Ledger rows after reset | 0, verified by ____________ |
| Items entered | |
| Sections opened | |
| Opening stock value | LKR |
| First delivery reference | |

**Client:** ______________________ Date: __________
**TriniphiX:** ______________________ Date: __________
