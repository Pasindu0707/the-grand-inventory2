# Data Migration Plan

**Project:** The Grand - inventory management system
**Version:** 1.0 · [FILL: date]
**Status:** For sign-off

---

## 1. The decision this document records

**No historical transactions are migrated.** The system starts from a physical
count on cutover day.

This is a deliberate choice and it is worth defending, because clients almost
always ask for the history to come across.

The existing stock figures live in a spreadsheet that is updated from memory,
sometimes days after the event, by more than one person, with no record of who
changed what. Importing that history would import its unreliability - and worse,
it would give the new system's numbers a false pedigree. Every variance report
for the first six months would be measuring against a starting point nobody
believes.

Starting from a physical count means every figure in the system is traceable to
something a named person actually saw on a shelf on a known date.

**What is migrated:** the master data - items, packs, suppliers, prices, rooms,
people. **What is not:** any past movement.

## 2. What moves, and how

| # | Data | Source today | Method | Owner | Volume |
|---|---|---|---|---|---|
| 1 | Branches | Known | Typed into Setup → Branches | Admin | 1 |
| 2 | Sections (rooms) | Physical walk | Typed into Setup → Sections. **Include a Quarantine section per branch** | Admin | ~6 |
| 3 | Item categories | Agreed in Phase 0 | Typed into Setup → Categories | Admin | ~8 |
| 4 | **Items** | Phase 0 spreadsheet | **Typed into Setup → Products, one at a time** | Admin | [FILL: ~150] |
| 5 | **Packs** | Phase 0 spreadsheet | Typed per item | Admin | [FILL: ~200] |
| 6 | Suppliers | Existing supplier list | Typed into Setup → Suppliers | Admin | [FILL: ~25] |
| 7 | Agreed prices | Existing agreements | Typed into Setup → Supplier prices | Admin | [FILL: ~150] |
| 8 | Users | New | Typed into Logins | Admin | [FILL: ~15] |
| 9 | **Opening stock** | **A physical count on cutover day** | Advanced → Opening stock, per section | Storekeeper / management | [FILL: ~150 lines] |
| - | Past deliveries, issues, wastage, counts | Spreadsheet | **Not migrated** | - | - |
| - | Past purchase orders | Order book | **Not migrated** | - | - |

## 3. There is no CSV import

**FR-DAT-04.** Phase 1 has no bulk import. Every item, pack, supplier and price
is typed in through the setup screens.

For [FILL: 150] items with packs, expect **one full working day** with two
people - one reading from the Phase 0 spreadsheet, one typing. That is a day,
not a developer.

Two options if that is unacceptable:

| Option | Cost | Note |
|---|---|---|
| TriniphiX types it in | [FILL] (Payment Schedule O1) | We work from your signed Phase 0 sheet. You still check it |
| A CSV import is built | [FILL] (Payment Schedule O6) | A Change Request. Only worth it above ~300 items or if you expect to do this again at other branches |

For a single site of this size, typing it in is usually the right answer, and
it has a hidden benefit: the person typing notices the things that are wrong.

## 4. Phase 0 - the source data

Everything above depends on one spreadsheet, produced by walking the store.

### 4.1 What it must contain

| Column | Meaning | Example | Mandatory |
|---|---|---|---|
| `code` | Unique item code | `DRY-0007` | Yes |
| `name` | What people call it | `Sugar - white` | Yes |
| `category` | Which category | `Dry goods` | Yes |
| `stock_unit` | **The smallest unit**: `g`, `ml` or `ea` | `g` | Yes |
| `pack_name` | How it arrives | `50 kg sack` | Yes |
| `qty_in_stock_unit` | **How many stock units in one pack** | `50000` | Yes |
| `is_default_purchase` | The pack normally bought | `TRUE` | Yes, one per item |
| `par_level` | Target holding, in stock units | `100000` | Yes |
| `reorder_point` | Buy when at or below, in stock units | `40000` | Yes |
| `shelf_life_days` | If tracked | `365` | No |
| `is_critical` | Counted daily | `TRUE` | Yes |

An item with two pack sizes gets two rows. Sugar in 1 kg packs and 50 kg sacks
is two rows with the same code and the same stock unit.

### 4.2 The rule Phase 0 exists to enforce

**Every `qty_in_stock_unit` must be physically verified, not assumed.**

Not "a sack is 50 kg because it says so on the invoice". Weighed, or counted, or
confirmed by opening one. This is the single most important number in the entire
data set.

If a 25 kg sack is recorded as 50 kg, then from cutover onwards the system
believes every delivery brings twice what it does. Stock reads high. The
variance report shows the kitchen over-issuing every week. Someone gets
accused. Nobody finds the cause for months, and when they do, every figure
since cutover is unusable.

There is no software fix for this. It is why Phase 0 is two weeks.

### 4.3 Sign-off

The Phase 0 spreadsheet is signed by the storekeeper and by management before
any data entry begins. Signature means: *we have physically checked every pack
conversion on this sheet.*

| | |
|---|---|
| Storekeeper | ______________________ Date: __________ |
| Management | ______________________ Date: __________ |

## 5. Cutover sequence

Order matters. Each step needs the one before it.

```
1. Deploy, and confirm backups AND a successful restore
2. Freeze demo use - tell everyone to stop
3. Run the reset script: psql "$DB" -f db/reset.sql
4. VERIFY: select count(*) from stock_ledger;  →  must be 0
5. Create the first admin (terminal - the reset took every login with it)
6. Sign in as admin and build the system:
     6.1 Branches and sections
     6.2 Categories, then items with their packs      ← the long one
     6.3 Suppliers, with agreed prices
     6.4 Logins for the real people
7. Opening stock, per section, counted physically     ← storekeeper/management
8. First real delivery
```

### 5.1 Why step 5 needs a terminal

The reset deletes every demonstration row, including the login that would have
created the next one. Creating the first admin is therefore the one step that
cannot be done in the app:

```bash
node scripts/add-user.mjs --name "[FILL: admin name]" --role admin --pin [FILL]
```

### 5.2 Why 6.3 matters more than it looks

Agreed supplier prices are what the first delivery is measured against. Without
them, the first surprise price looks exactly like a normal price, and the price
movement report has nothing to compare to for weeks.

### 5.3 Opening stock - the rules

**FR-OPN-02.** A section can be opened **once**, and only while it has never
held stock. After that the instrument is a stock count, because after day one a
difference is a discrepancy rather than a starting point.

Practically: count each room, room by room, and enter it before that room does
anything else. Do not open a section and then leave it a week.

For each item on the shelf, enter the quantity **and what it is worth**. The
value sets the starting weighted-average cost, so a wrong value here makes
every issue from that item mis-valued until the next delivery corrects it.

## 6. An alternative that is often what is actually wanted

Between "finished trialling" and "ready for the runbook above" there is a third
state: an empty system that keeps its branches and sections, so five outlets do
not have to be re-typed to test one flow.

```bash
node scripts/wipe-and-admins.mjs             # says what it would delete, stops
node scripts/wipe-and-admins.mjs --confirm   # does it
```

This empties everything the reset does and more - it ignores the demo flag, so
trial data entered by hand goes too - but keeps branches, sections, item
categories and wastage reason codes. It then creates one admin login per branch,
because the wipe takes every user with it. PINs are printed once, at the end.

The branches come out of it with their demo flag cleared, which also puts them
beyond the reach of the cutover reset later. A cutover must not take the
branches with it.

## 7. Verification

Before the first real delivery, all of these must pass.

| # | Check | How | Expected |
|---|---|---|---|
| V1 | The ledger is empty after reset | `select count(*) from stock_ledger` | **0** |
| V2 | No demo rows survive anywhere | Reset script's own report | 0 across all tables |
| V3 | Item count matches Phase 0 | Setup → Products | [FILL: N] |
| V4 | Pack count matches Phase 0 | Setup → Products | [FILL: N] |
| V5 | **Every pack conversion matches the signed sheet** | Line-by-line read-back, two people | 100% |
| V6 | Supplier count and prices match | Setup → Suppliers | [FILL: N] |
| V7 | Every real person has a login and has signed in once | Login screen | [FILL: N] |
| V8 | Every section has an opening balance | Reports → Valuation | All sections non-zero |
| V9 | Opening stock value is credible to management | Reports → Valuation | Signed off by owner |
| V10 | Backup ran last night and a restore succeeded | Backup log + restore evidence | Both |

**V5 is done out loud, by two people, reading every row.** It is tedious and it
is the last chance to catch the error that would otherwise take six months to
find.

## 8. Roles on cutover day

| Who | Does |
|---|---|
| TriniphiX | Deploy, backup, restore drill, run the reset, create the first admin, stand by |
| Client admin | All setup data entry |
| Storekeeper | Count every shelf; read back pack conversions for V5 |
| Management | Enter or supervise opening stock; sign off V9 |

## 9. Rollback

If something goes wrong before the first real delivery, rollback is trivial:
restore last night's backup, or re-run the reset and start the data entry
again. Nothing of value has been created yet.

**After the first real delivery, there is no rollback.** The ledger is immutable
for real. That is the point of it, and it is why the verification in §7 happens
before that delivery and not after.

## 10. Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | A pack conversion is wrong | **Catastrophic and silent** | Phase 0 physical verification; V5 two-person read-back |
| R2 | Opening count is taken while stock is still moving | Opening figure wrong from day one | Count outside service hours; freeze movements during the count |
| R3 | A section is opened before it is counted | Cannot be re-opened; must be corrected by a count | Count first, enter second, room by room |
| R4 | Data entry takes longer than a day | Go-live slips | Two people; start with categories and the critical items |
| R5 | Agreed prices unavailable at cutover | Price movement report is blind for weeks | Chase in Phase 0; enter what exists and add the rest |
| R6 | An item is missed entirely | It cannot be received until the admin adds it | V3 count check; the admin is on site on day one |
| R7 | Opening values are guessed | Issues mis-valued until the next delivery | Use the most recent invoice price per item |

---

## Sign-off

**The Client confirms that no historical transaction data will be migrated, and
that the system will start from a physical count taken on cutover day.**

**For [FILL: client legal entity name]**

| | |
|---|---|
| Name | |
| Title | |
| Signature | |
| Date | |

**For TriniphiX (Pvt) Ltd**

| | |
|---|---|
| Name | |
| Signature | |
| Date | |
