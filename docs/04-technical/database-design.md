# Database Design & Data Dictionary

**Project:** The Grand - inventory management system
**Database:** PostgreSQL 16
**Version:** 1.0 · [FILL: date]
**Status:** Internal

---

## 1. Principles the schema encodes

These are not conventions. They are enforced, and the enforcement is the
product.

| # | Principle | How the schema enforces it |
|---|---|---|
| 1 | Stock history is append-only | Triggers on `stock_ledger` reject `UPDATE`, `DELETE` and `TRUNCATE` |
| 2 | Corrections are reversals | `is_reversal`, `reverses_id` - a new row, never an edit |
| 3 | Stock is derived, never stored | **No quantity column exists.** `current_stock` is a view |
| 4 | The store is just another section | `sections.is_store`; every movement is section-to-section |
| 5 | Everything in the small unit | `items.stock_unit`; conversion lives on `item_packs` |
| 6 | One item, several pack sizes | `item_packs` is a separate table, never a factor on the item |
| 7 | Demo and real share every code path | `is_demo` on every table |
| 8 | Nothing is deleted | `is_active` flags throughout |

## 2. Migrations

Numbered, forward-only, plain SQL. No DSL between an engineer and the ledger
rules.

| File | Contents |
|---|---|
| `0001_init.sql` | Master data, the ledger and its guards, documents, Phase 2 tables, cleaning, support, audit, indexes |
| `0002_auth.sql` | `login_attempts`, PIN authentication support |
| `0003_simple_roles.sql` | Eight roles collapsed to five; `purchase_orders`, `purchase_order_lines`; the request workflow |
| `0004_partial_counts.sql` | Partial stock counts |
| `0005_setup_and_purchasing.sql` | Retiring master data, section kinds, orders that can be received, `opening_stock` |
| `0006_drop_cleaning_tasks_and_market.sql` | Withdraws the cleaning checklist and the cash market purchase (CR-001) |
| `0007_returns.sql` | Section and supplier returns, the quarantine section kind, and usage variance netted of returns (CR-003) |

```bash
npm run db:reset-all   # drop, migrate, regenerate seed, load
npm run db:verify      # 12 checks: schema → seed → immutability → cutover → re-seed
```

## 3. Entity overview

```
locations ──┬── sections ──────────────── stock_ledger ◀── every document
            ├── users                          ▲
            └── settings                       │  item_cost_state
                                               │
item_categories ── items ──┬── item_packs ── supplier_prices ── suppliers
                           └── recipe_lines ── products ── production_log

Documents, each writing to the ledger:
  grn / grn_lines · issues / issue_lines
  wastage · transfers · stock_counts / _lines · opening_stock / _lines
  section_returns · supplier_returns / _lines
  purchase_orders / _lines

Support: idempotency_keys · audit_log · login_attempts · reason_codes
Views:   current_stock · current_stock_valued · usage_variance
```

---

## 4. Data dictionary

Every table carries `is_demo boolean not null default false` unless stated.
Demo rows and real rows share every table, every query and every screen, so you
are never testing against a structure you will not ship.

### 4.1 Master data

#### `locations` - branches

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `code` | text, unique | `GB`, `ESP`, `TCL`, `KAT`, `BANQ` |
| `name` | text | |
| `day_start` | time, default `06:00` | **The business-day cut-off.** A 24-hour site sets `04:00` and the ledger's `business_date` follows |
| `is_active` | boolean | |

#### `sections` - rooms where stock sits

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `location_id` | int FK | |
| `code` | text | `STORE`, `KITCHEN`, `CLEAN`, `QUARANTINE`. Bar and Bakery retired by CR-004 |
| `name` | text | The room's own name - a branch may have two kitchens |
| `is_store` | boolean | |
| - | unique | `(location_id, code)` |

> **The main store is a section like any other.** That single choice makes every
> movement a section-to-section transfer and removes special-casing from the
> ledger entirely.

#### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `location_id` | int FK, nullable | **Null means all branches** - management and admin |
| `name` | text | The tile on the sign-in screen |
| `phone` | text, nullable | |
| `role` | `app_role` | `admin` · `management` · `storekeeper` · `kitchen` · `cleaning` |
| `pin_hash` | text | **bcrypt only.** Never plain text, never recoverable |
| `is_active` | boolean | Deactivate, never delete - the ledger does not forget |

#### `items`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `code` | text, unique | `DRY-0007` |
| `name` | text | |
| `name_si` | text, nullable | Reserved. UI is English |
| `category_id` | int FK | |
| `stock_unit` | text | **`g`, `ml` or `ea` - always the small unit** |
| `par_level` | numeric(14,3) | In stock units |
| `reorder_point` | numeric(14,3) | In stock units |
| `shelf_life_days` | int, nullable | |
| `is_critical` | boolean | True ⇒ counted daily |
| `is_active` | boolean | |

#### `item_packs`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `item_id` | int FK | |
| `pack_name` | text | `"50 kg sack"` |
| `qty_in_stock_unit` | numeric(14,3) | **`50000`. The most dangerous number in the database** |
| `is_default_purchase` | boolean | |

> **Never store a conversion factor on the item itself.** Sugar arrives in 1 kg
> packs *and* 50 kg sacks. One item, several packs, is not an edge case - it is
> the normal case.
>
> If `qty_in_stock_unit` is wrong, every figure about that item is wrong,
> silently, forever. This is what Phase 0 exists to verify physically.

#### `suppliers`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name`, `phone`, `vat_no`, `payment_terms` | text | |
| `is_active` | boolean | |

#### `item_categories`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text, unique | |
| `storage` | `storage_type` | `dry` · `chiller` · `freezer` · `bar` · `chemical` · `packaging` · `gas` |

#### `supplier_prices` - agreed prices

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `supplier_id` | int FK | |
| `item_pack_id` | int FK | Price is per **pack**, not per stock unit |
| `price` | numeric(14,2) | |
| `effective_from` | date | |

> Without these, the first surprise price at cutover looks exactly like a normal
> price and the price-movement report has nothing to compare against.

---

### 4.2 The ledger

#### `stock_ledger` - the heart of the system

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `occurred_at` | timestamptz | Wall clock |
| `business_date` | date | **Derived from `locations.day_start`**, not from the calendar |
| `location_id` | int FK | |
| `section_id` | int FK | Which room |
| `item_id` | int FK | |
| `qty_base` | numeric(14,3) | **Signed**, in `items.stock_unit`. Negative leaves, positive arrives |
| `unit_cost` | numeric(14,4) | See below |
| `doc` | `doc_type` | `grn` · `issue` · `return` · `wastage` · `transfer` · `count` · `production` · `opening`. `return` covers both return documents. `market` remains a member of the enum with no writer left - see CR-001 |
| `doc_id` | bigint | The document this row belongs to |
| `doc_line` | int, nullable | |
| `reason_code` | text FK, nullable | Wastage reasons, count adjustments |
| `created_by` | int FK | **Who did this. The whole point of the system** |
| `is_reversal` | boolean | |
| `reverses_id` | bigint FK, nullable | Points at the row this undoes |
| `note` | text, nullable | |

**`unit_cost` carries two different meanings, and the distinction matters:**

- On a **receipt** (`grn`, `opening`) it is **the price actually
  paid**. It appears nowhere else, and it is what the price-movement report
  reads.
- On **every other movement** it is the **weighted average at the time it
  happened** - the cost of what left.

The running average itself lives in `item_cost_state`.

**Indexes**

```sql
(item_id, section_id, business_date)
(business_date, location_id)
(doc, doc_id)
(business_date) where not is_demo   -- reports run over real data after cutover
(reverses_id) where reverses_id is not null
(created_by)
```

#### The immutability guards

```sql
create function ledger_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'stock_ledger is append-only; correct it with a reversal row (id=%)', old.id
      using errcode = 'restrict_violation';
  end if;

  -- Only db/reset.sql sets this, and only inside its own transaction.
  if old.is_demo and coalesce(current_setting('grand.allow_demo_reset', true), '') = 'on' then
    return old;
  end if;

  raise exception 'stock_ledger rows cannot be deleted (id=%, is_demo=%)', old.id, old.is_demo
    using errcode = 'restrict_violation';
end $$;

create trigger ledger_no_update before update on stock_ledger
  for each row execute function ledger_guard();
create trigger ledger_no_delete before delete on stock_ledger
  for each row execute function ledger_guard();
create trigger ledger_no_truncate before truncate on stock_ledger
  for each statement execute function ledger_no_truncate();
```

**Three things to understand about this code.**

**It raises; it does not shrug.** The original schema used
`create rule ... do instead nothing`, which *silently discards* the statement.
That blocked `reset.sql` as well, so cutover would have appeared to succeed
while leaving 10,800 demonstration rows in the live ledger.

**`TRUNCATE` needs its own trigger.** Truncation bypasses row-level `DELETE`
triggers entirely. Without the statement-level trigger, one
`truncate stock_ledger` defeats every guarantee above.

**The escape hatch is as narrow as it can be.** Only demo rows, only when a
session GUC is set, and only `db/reset.sql` sets it, inside its own
transaction. Real rows are immutable under every code path, including a
superuser at a `psql` prompt.

#### `item_cost_state` - weighted-average cost

| Column | Type | Notes |
|---|---|---|
| `item_id`, `location_id` | int, composite PK | |
| `qty_on_hand` | numeric(14,3) | |
| `avg_cost` | numeric(14,4) | |
| `updated_at` | timestamptz | |

Maintained by the receipt service **in the same transaction as the ledger
write**:

```
new_avg = (qty_on_hand × old_avg + qty_received × receipt_cost)
          ÷ (qty_on_hand + qty_received)
```

Receipts move the average. Issues, wastage and count adjustments only read it.

---

### 4.3 Documents

Each writes one or more ledger rows through `services/ledger.ts`, and only
through it.

#### `grn` / `grn_lines` - supplier delivery

| `grn` | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `location_id`, `supplier_id` | int FK | |
| `invoice_no`, `invoice_date` | text, date | |
| `received_at` | timestamptz | |
| `received_by` | int FK | |
| `photo_url` | text, nullable | A short or damaged delivery, photographed at the door |
| `total` | numeric(14,2) | |

| `grn_lines` | Type | Notes |
|---|---|---|
| `grn_id` | bigint FK | |
| `item_pack_id` | int FK | **Packs, not items** |
| `qty_packs` | numeric(14,3) | Fractional allowed - half a sack gets delivered |
| `pack_price` | numeric(14,2) | Per pack |
| `expiry_date` | date, nullable | |

#### `section_returns` - a room hands stock back

| Column | Type | Notes |
|---|---|---|
| `from_section_id` / `to_section_id` | int FK | Out of the room, into quarantine |
| `qty_base` | numeric(14,3) | Positive; the ledger carries the signs |
| `reason_code` | text FK | `doc = 'return'` reasons only, never a wastage one |
| `issue_id` | bigint FK, nullable | The release it came from, when anybody can say |
| `approved_by` | int FK, nullable | Approval follows the movement, as with wastage |

#### `supplier_returns` / `_lines` - back to the vendor

| Column | Type | Notes |
|---|---|---|
| `grn_id` | bigint FK | **Every line must belong to this delivery.** That is what lets the credit be priced from what was paid |
| `status` | `supplier_return_status` | `raised` · `approved` · `rejected` · `sent` · `settled` |
| `outcome` | `supplier_return_outcome`, nullable | `credit` · `replacement` · `written_off`. Null until settled |
| `credit_note_no`, `credit_value` | text, numeric(14,2) | What the supplier **allowed**, which may be less than was asked |

| `supplier_return_lines` | Type | Notes |
|---|---|---|
| `grn_line_id` | bigint FK | Carries the pack, the conversion and the price |
| `qty_packs` / `qty_base` | numeric(14,3) | Entered in packs, converted once |
| `pack_price` | numeric(14,2) | **Copied** from the GRN line, not joined: a price list changes, what was invoiced does not |
| `line_credit` | numeric(14,2) | What is being asked for on this line |
| `section_return_id` | bigint FK, nullable | The internal return it came from, when it came from one |

**Stock moves on `sent` and nowhere else.** Raising and approving are paperwork;
the goods are still in quarantine and still the restaurant's.

#### `issues` / `issue_lines` - store to section

| Column | Type | Notes |
|---|---|---|
| `to_section_id` | int FK | |
| `requested_by`, `issued_by` | int FK | **Two different people** (SRS FR-ROL-06) |
| `status` | text | `requested` → `released` → `received`, or `cancelled` |
| `qty_requested`, `qty_issued` | numeric(14,3) | Different when the store was short |

#### `wastage`

| Column | Type | Notes |
|---|---|---|
| `section_id`, `item_id`, `qty_base` | | |
| `reason_code` | text FK, **not null** | The reason is the point |
| `photo_url` | text, nullable | |
| `logged_by`, `approved_by` | int FK | Approval is a review, not a gate |

#### `transfers`

`from_section_id` → `to_section_id`, `sent_by` / `received_by`,
`sent_at` / `received_at`. Works between branches as well as within one.

#### `stock_counts` / `stock_count_lines`

| `stock_counts` | Type | Notes |
|---|---|---|
| `section_id` | int FK | |
| `count_type` | text | `daily_critical` · `weekly_full` · `monthly_full` |
| `business_date` | date | |
| `counted_by`, `verified_by` | int FK | **Must differ** (FR-CNT-07) |
| `closed_at` | timestamptz, nullable | Null means open |

| `stock_count_lines` | Type | Notes |
|---|---|---|
| `qty_expected` | numeric(14,3) | **Frozen from the ledger at open. Never re-read** |
| `qty_counted` | numeric(14,3) | |
| `variance_value` | numeric(14,2) | Computed at close |

> **Why `qty_expected` is stored rather than recomputed.** If expected were
> re-read at close, a movement posted while someone walked the shelves would
> silently absorb the gap. Freezing it is what makes the variance mean
> something.
>
> And it is never sent to the counting screen. Show a tired storekeeper that the
> system expects 4,500 and they will type 4,500 - which confirms a theft rather
> than finding it.

#### `purchase_orders` / `purchase_order_lines`

| Column | Type | Notes |
|---|---|---|
| `issue_id` | bigint FK, nullable | Set when the order came out of a request the store could not fill, so the two read together |
| `raised_by` | int FK | Storekeeper or management |
| `needed_by` | date, nullable | |
| `reason` | text | |
| `status` | `po_status` | `requested` → decided → received / closed |
| `decided_by`, `decided_at`, `decision_note` | | **Management only** |

| Lines | Notes |
|---|---|
| `qty_base` | What is wanted |
| `qty_in_store` | **What the store had at the time**, so management can see how short it was |
| `est_price` | |

#### `opening_stock` / `opening_stock_lines`

One per section, once, and only while that section has never held stock. After
that the instrument is a stock count.


### 4.4 Phase 2

| Table | Notes |
|---|---|
| `products` | What is made. `yield_qty` - the recipe makes this many |
| `recipe_lines` | `qty_base` per `yield_qty` |
| `production_log` | "42 chocolate cakes, 180 fish buns", per section per day |

### 4.5 Support

| Table | Notes |
|---|---|
| `idempotency_keys` | `key` PK, `endpoint`, `request_hash`, stored `response` and `status_code`. Same key + same hash ⇒ replay the response. Same key + different hash ⇒ **409, do not guess** |
| `settings` | `(location_id, key)` → `jsonb`. Issue windows live here |
| `reason_codes` | `code` PK, `doc`, `label`. A reason belongs to one document type |
| `login_attempts` | Failed PIN attempts; five locks for fifteen minutes |
| `audit_log` | `user_id`, `action`, `entity`, `entity_id`, `before`/`after` jsonb |

---

## 5. Views

### `current_stock`

```sql
select s.location_id, l.section_id, l.item_id, sum(l.qty_base) as qty_base
from stock_ledger l
join sections s on s.id = l.section_id
group by s.location_id, l.section_id, l.item_id;
```

**This is the entire stock model.** There is no quantity column anywhere in the
database. A cached quantity is a number that eventually disagrees with the
movements behind it, and nobody can tell you when it started lying.

### `current_stock_valued`

`current_stock` joined to `item_cost_state`, giving `avg_cost` and `value`.

> Valuation is deliberately taken from the *current* average, not from summing
> `qty × cost_at_time_of_move`. The latter does not return to zero when an item
> is fully depleted at a different average, which is a bug that hides for months
> and then makes a valuation report indefensible.

### `usage_variance`

A full outer join of theoretical consumption (from `production_log` exploded
through `recipe_lines`) against actual issues, producing `variance_qty` and
`variance_pct`.

Actual intake is **the positive leg of an issue** - the store's negative leg
carries the same `doc_id` in the store section.

> The original version of this view computed theoretical only and never joined
> actual, so it could not produce a variance at all. It is the Phase 2 headline
> report, and it was half-built.

## 6. Reset and cutover

### `db/reset.sql`

Deletes every `is_demo` row, including branches. Opens with:

```sql
set local grand.allow_demo_reset = 'on';
```

which is the only thing that satisfies the ledger guard's escape clause.

**After running it, verify:**

```sql
select count(*) from stock_ledger;   -- must be 0
```

### `scripts/wipe-and-admins.mjs`

The harder wipe: empties everything `reset.sql` does **and ignores `is_demo`**,
so trial data entered by hand goes too - but keeps `locations`, `sections`, item
categories and reason codes. Then creates one admin login per branch, because
the wipe takes every user with it including the one who would create the next
one.

The branches come out of it with `is_demo` cleared, which also puts them beyond
the reach of `reset.sql` later. **A cutover must not take the branches with
it.**

## 7. Verification

```bash
npm run db:verify   # 12 checks
```

Proves the whole cycle - schema → seed → immutability probes → cutover →
re-seed - in one command. If `reset.sql` ever stops emptying the ledger, this
catches it.

Separately, `api/test/ledger.test.ts` carries a **schema drift** test asserting
that every table in the generated Kysely types exists in the database with
matching columns. A migration that lands without regenerating types fails the
suite.

## 8. Rules for future changes

| # | Rule |
|---|---|
| 1 | Never add a stored quantity column. Not "for performance". That is the drift the design exists to prevent |
| 2 | Never relax the ledger triggers. If a correction is needed, it is a reversal |
| 3 | Never put a conversion factor on `items`. It belongs on `item_packs` |
| 4 | Never delete a user, item or supplier. Deactivate |
| 5 | Every new table gets `is_demo` |
| 6 | Every new foreign key gets an index. Postgres does not create them |
| 7 | Money is `numeric(14,2)`; quantities are `numeric(14,3)`; costs are `numeric(14,4)`. Never floating point |
| 8 | Migrations are forward-only. Fix a mistake with a new migration, never by editing an old one |
| 9 | Regenerate the Kysely types with every migration, or the drift test fails |
| 10 | A new `doc_type` value needs a service function and a reason-code set. There is no generic writer |
