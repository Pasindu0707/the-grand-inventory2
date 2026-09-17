# The Grand - implementation plan

Pilot: The Grand Gastrobar, Negombo. Inventory only, no POS.

**Locked decisions:** Postgres 16 · TypeScript end-to-end · cloud VPS · online-only ·
vertical slice first · frontend built on the **beautech-master-web-app** template
(Angular 19 + PrimeNG).

**Since added:** **returns** (CR-003) - a section hands stock back into a
quarantine section, and the store hands it on to the supplier who delivered it,
priced from that delivery. The `return` doc type reserved in `0001_init` is what
both post under. Three existing reports had to be taught to net returns off, or
a kitchen would have read as consuming what it sent back.

**Since narrowed:** **CR-004** retires the `BAKERY` and `BAR` section kinds -
the Gastrobar runs one kitchen, and three rooms that behaved identically bought
a "which one am I?" decision and split one sack of flour across three balances.
A branch that genuinely works a pastry bench makes a second section *of kind
KITCHEN*. **CR-005** takes releasing, quarantining and sending stock away from
management: *management decides, the store handles stock, and neither does both*.
Both are in the demo data, the tests and the permission matrix.

**Since withdrawn:** the cash **market purchase** and the **cleaning checklist**
were built in slice 3 and removed again in `db/migrations/0006`. Every purchase
goes through a supplier who invoices, and the cleaning checklist was a screen
nobody filled in. The cleaning *role* and the cleaning store remain - they ask
the store for supplies like any other section. Sections below are left as they
were written, because a plan is a record of what was decided at the time.

---

## 1. What the template actually is

It is not a skin. It is **VendEasy POS** - a working multi-tenant POS app. That is good news
and bad news, and the plan turns on telling the two apart.

**Genuinely valuable, reuse as-is:**

| Asset | Path | Why it matters |
|---|---|---|
| JWT + refresh interceptor | `pos/core/auth.interceptor.ts` | Single-flight refresh on concurrent 401s, retry on transient GET failures. This is the piece people get wrong; it is already right. |
| Route guards | `pos/core/guards.ts` | `authGuard` + data-driven `roleGuard` reading `allowed` / `routeKey` |
| Auth store | `pos/stores/auth.store.ts` | Signals-based session state |
| Layout shell | `layout/` | Sidebar, topbar, breadcrumb, **tab layout**, theme configurator |
| Design system | `shared/design-system/` | `kpi-card`, `table`, `empty-state`, `error-state`, `status-badge`, `form-header` |
| Helpers | `pos/core/` | `money.ts`, `uuid.ts`, `notify.service.ts`, `live-query.ts`, `pagination` |

**Dead weight for this project - remove:** the sales half. `register` (cart/checkout),
`transactions`, `customers`, `discounts`, `gift-cards`, `payment-modal`, `receipt-overlay`,
`cart.store`, `checkout/payments/discounts/gift-cards/sales` services, the SaaS plan gating
(`features.ts`, `upgrade.component`) and tenant onboarding (`admin/`).

**Blocked on a refactor, not a delete:** `app.routes.ts` and `app.config.ts` import the guards
and interceptor from *inside* `pos/core/`. Deleting `src/app/pos/` breaks the build. The
shared infrastructure gets lifted to `app/core/` first, then the sales pages go.

### The four contract mismatches

These are the whole reason the frontend cannot simply be "pointed at a new API".

1. **Stock is not a number on a product.** `ApiProduct.stockQty` is a scalar the POS mutates.
   In The Grand, stock is `sum(qty_base)` over `stock_ledger` per **section**, and that is the
   entire point of the design. `ApiProduct` and `LocalProduct` must not be reused - new types.
2. **Roles: 3 → 8.** Template has `OWNER | MANAGER | CASHIER`. The schema has eight, including
   `storekeeper`, `chef`, `bar`, `baker`, `cleaning`, `purchasing`.
3. **Auth: email + password → PIN.** The schema stores a 4-6 digit bcrypt `pin_hash`. The JWT
   machinery is kept exactly as-is; only the credential form and the login screen change.
4. **Tenant → location/section.** The POS is multi-tenant with one branch dimension. The Grand
   is one business, five **locations**, each with **sections** (store, kitchen, bakery, bar,
   cleaning). `x-tenant-id` becomes `x-location-id` carrying the *active* location; the JWT
   carries the set the user is allowed, and the server validates membership on every request.

**IDs stay integers.** The template assumes UUID strings; the schema uses `serial`/`bigserial`
and the 10,800-row seed depends on them. `bigint` is also materially cheaper on a ledger that
only grows. The API exposes numbers; client-generated UUIDs remain only for idempotency keys.

**Dexie stays out of v1.** You chose online-only. The offline stack
(`sync-worker`, `sync.store`, `sync-audit`) is built solely around `payload_type: 'TRANSACTION'`
and does not transfer to documents. Removed now, and the plan notes where it would slot back in
if Phase 4 needs it.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| DB | Postgres 16 | Schema already assumes it: rules, enums, `numeric`, `timestamptz` |
| Query layer | **Kysely** + `kysely-codegen` | This system *is* SQL - ledger maths, variance windows, moving average. An ORM fights all three. |
| API | **Fastify 5** + `fastify-type-provider-zod` | Zod schemas serve as runtime validation *and* generated OpenAPI |
| Migrations | Numbered plain `.sql` + small runner | `schema.sql` becomes `0001_init.sql` unchanged. No DSL between you and the ledger rules. |
| Tests | Vitest + Testcontainers | The 5 planted anomalies become the acceptance suite |
| Web | The existing Angular 19 + PrimeNG app | Already pruned: 30 → 14 deps, 1.33 MB initial bundle |
| Deploy | Docker Compose + Caddy, one VPS | Singapore or Mumbai region. Replicable per outlet for Phase 4. |
| Backup | Nightly `pg_dump` → object storage, 30-day retention | With a restore drill that is actually run |

**Repo layout.** Two independent apps, no pnpm workspace - Angular CLI does not take kindly to
being hoisted, and the risk buys nothing:

```
db/                       schema.sql, migrations/, reset.sql
seed/                     items.csv, generate.ts
api/                      Fastify service
beautech-master-web-app/  the Angular app
```

Type sharing runs **API → web, one direction**: the backend emits OpenAPI from its Zod schemas,
and a script generates `src/app/core/api-types.ts`. Drift becomes impossible without a build
step failing, and neither app has to know how the other is packaged.

---

## 3. Phase A - fix the foundation (before any app code)

**Status: complete and verified.** `npm run db:verify` proves the whole cycle -
schema → seed → immutability probes → cutover → re-seed - in one command, 12 checks.

Ten defects in the build pack, plus an eleventh found while verifying. All small, all
unfixable later.

**A1. `reset.sql` cannot run - highest severity.**
[schema.sql:139](db/schema.sql:139) is `create rule ledger_no_delete as on delete to stock_ledger
do instead nothing`. It blocks *every* delete, including the cutover script itself. Go-live
would silently leave all 10,800 demo rows in the live ledger. Replace both rules with a trigger
that raises, plus one narrow escape:

```sql
create function ledger_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'stock_ledger is append-only; correct with a reversal row';
  end if;
  if old.is_demo and current_setting('grand.allow_demo_reset', true) = 'on' then
    return old;                       -- only reset.sql sets this GUC
  end if;
  raise exception 'stock_ledger rows cannot be deleted (id=%)', old.id;
end $$;
```

`reset.sql` opens with `set local grand.allow_demo_reset = 'on';`. Real rows stay immutable
under every code path - the property the README is actually protecting.

**A2. Sequences are never advanced.** [generate.ts:417](seed/generate.ts:417) calls `setval` for
the ledger only. Every other table gets explicit IDs while its sequence sits at 1 - the first
real GRN after seeding collides on the primary key. Emit `setval` for all serial columns,
generated by querying `pg_class` rather than hand-listed.

**A3. Weighted-average cost is a fiction.** The generator writes a flat `it.cost`; nothing
recomputes. Add `item_cost_state (item_id, location_id, qty_on_hand, avg_cost)` maintained
inside the receipt service in the same transaction as the ledger write:

```
new_avg = (qty_on_hand * old_avg + qty_received * receipt_cost) / (qty_on_hand + qty_received)
```

Issues, wastage and count adjustments *read* the average; they never change it. Without this
every rupee figure in every variance report is wrong.

**A4. `usage_variance` is half-built.** [schema.sql:302](db/schema.sql:302) computes theoretical
only and never joins actual issues - and it is the Phase 2 headline report. Rewrite as
theoretical vs actual with variance qty, value and percentage.

**A5. `supplier_prices` is never seeded.** Anomaly C (oil +32%) is visible only in
`grn_lines.pack_price`. Backfill from GRN lines during seed so the price-movement report reads a
real table instead of reverse-engineering history.

**A6. Demo PINs do not work.** `pin_hash` is the literal `'$demo$'`. Generate real bcrypt
hashes; document the demo PINs.

**A7. Missing Phase-1 tables.** The cleaning module is in scope with no schema:
`cleaning_areas`, `cleaning_tasks`, `cleaning_log`. Plus `idempotency_keys` and `settings`
(issue windows 06:00/11:00/17:00, warn-not-block).

**A8. `current_stock` has no `location_id`.** Add it via `sections`, plus `current_stock_valued`
carrying value at current average cost.

**A9. Indexes.** Every foreign key is unindexed. Add them, plus a partial index on
`stock_ledger (business_date) where not is_demo` for post-cutover report speed.

**A10. Housekeeping.** Move files into the `db/` and `seed/` paths the README already claims.

**A11. Anomaly C was never actually planted** - found while verifying, not by reading.
Sunflower oil (`DRY-022`) appears in no recipe, so it is never issued, never falls below its
reorder point, and is therefore never purchased: **zero** GRN lines against it across all 60
days. The generator's `cost *= 1.32` on day 35 mutated a variable that no later document read.
The README described the fault as "buried in a routine GRN" when no such GRN existed, so the
Phase D test for C would have failed against any report, however correct.

Fixed at the source rather than by forcing a purchase: sunflower oil is the kitchen's bulk
frying oil and now appears in the fried-rice and chicken-curry recipes, so it depletes,
restocks, and carries the price rise into a real delivery. The seed now shows
45,880 → 60,561.60 - exactly +32% - on 2026-07-30.

Two further consequences worth knowing. Adding a recipe line shifts the PRNG call sequence, so
every figure in the dataset moved slightly; the README's anomaly table has been updated to the
values the data now actually contains. And the price rise is *detected* on day 50, not day 35 -
the supplier raises the price on 35, you find out at the next delivery. Same for anomaly B,
which happens on days 28 and 44 but only surfaces at the following Sunday bar count. **A report
that insists on flagging faults on the day they occur would miss both.**

**Exit criterion (met):** `schema → seed → reset → re-seed` runs clean twice in a row, and
`select count(*) from stock_ledger` is 0 after reset.

---

## 4. Phase B - the ledger core

> *"Never write to `stock_ledger` from a controller. One service function per document type;
> the document is the API, the ledger is a consequence."* - README

One module, `api/src/services/ledger.ts`, exporting a single private writer. Nothing else may
insert into `stock_ledger`, enforced by an ESLint `no-restricted-imports` rule so the constraint
survives the second developer rather than living in a code review.

```ts
postDocument(tx, {
  doc: 'grn', docId, locationId, businessDate,
  lines: [{ sectionId, itemId, qtyBase, unitCost, docLine, reasonCode }],
  createdBy, isDemo,
})
```

Responsibilities: derive `business_date` from `locations.day_start` (already correct for the
04:00 Coffee Lounge in Phase 4), recompute moving-average cost on receipts, write every row in
one transaction, write `audit_log`.

`reverseDocument(docType, docId, reason, userId)` emits mirrored rows with `is_reversal = true`
and `reverses_id` set - never an UPDATE.

**Idempotency.** Every document POST takes a client-generated `Idempotency-Key` (the template's
`uuid.ts` already produces one). Roughly thirty lines, no sync layer, no client complexity - and
the difference between a flaky 4G connection at the delivery door creating one GRN or three.

---

## 5. Phase C - template refactor and auth

**C1. Lift shared infrastructure out of `pos/`.** Move `core/` (api, auth.interceptor, guards,
notify, money, uuid, live-query) and `stores/auth.store.ts` to `app/core/`; move `pagination`
into the design system. Update the two imports in `app.routes.ts` and `app.config.ts`. Build
must stay green after this step, before anything is deleted.

**C2. Delete the sales half.** Pages, stores and services listed in §1, plus the plan-gating and
tenant-onboarding machinery. Strip `features.ts` gating to a pass-through - a single restaurant
group has no upgrade tiers.

**C3. Roles.** Extend `Role` to the schema's eight, update `canAccess`, the `allowed` arrays in
route data, and the `gate()` calls in `app.menu.ts`.

| Role | Can |
|---|---|
| storekeeper | GRN, market purchase, issue, count, transfer |
| chef / baker / bar | request issue, wastage, production log, own-section count |
| manager | all above + approve wastage, verify counts, all reports |
| owner | read-only across all locations + approvals over threshold |
| purchasing | suppliers, prices, POs (Phase 3) |
| cleaning | cleaning log only |

**C4. PIN login.** Keep the JWT + refresh mechanism untouched. Replace the credential form:
pick a location, pick your face from a tile grid, enter a PIN on a numeric keypad. Nobody types
an email address on a wet tablet in a store room. Rate-limited; five failures locks for fifteen
minutes.

**C5. Location/section context.** `x-tenant-id` → `x-location-id` in the interceptor, carrying
the active location. Server validates it against the JWT's allowed set on every request. Every
list is scoped from the token, never from a query parameter.

---

## 6. Phase D - reports, tested against the planted faults

The README is explicit: *"If a report can't find its fault, the report is wrong."* So each
report ships with a Vitest test asserting detection against `seed.sql`.

| Report | Must detect | Assertion |
|---|---|---|
| Theoretical vs actual usage | **A** - chicken breast over-issued ~18% from day 20 | Flags `MEA-001` from day 20±2; issued/day steps 4,389 g → 5,152 g with flat production |
| Count variance / shrinkage | **B** - 2 gin bottles gone, days 28 & 44 | Bar weekly count shows two 750 ml gaps, ~Rs 5,216 each, **no matching wastage document** |
| Supplier price movement | **C** - sunflower oil +32% on day 35 | Flags `DRY-022` above the 10% threshold on day 35 |
| Wastage by reason | **D** - lettuce spoilage days 38-44 | Appears under **spoilage**, and **must not** appear in the shrinkage report |
| Stock-out / below reorder | **E** - prawns hit zero on day 41 | `SEA-001` on-hand = 0 on day 41; below-reorder fires ahead of it |

**D is the acceptance gate.** The test asserts the *absence* of a theft flag. A variance report
that screams about honest lettuce waste is a report the owner stops opening by week three - and
that failure mode is the one nobody writes a test for.

---

## 7. Phase E - screens

Built around what the person is holding: storekeeper on a phone at the delivery door, manager on
a tablet, owner on a laptop. All reuse the template's layout, tab system and design system.

| Route | Screen | Roles |
|---|---|---|
| `/login` | Location → user tiles → PIN pad | all |
| `/today` | Low stock, pending issues, open counts (`kpi-card`) | all |
| `/grn` | Supplier → items → **packs**, price change warned inline | storekeeper, manager |
| `/issues` | Request and fulfil; issue windows warn, never block | all sections |
| `/wastage` | Reason code + photo | sections, manager approves |
| `/count/daily` | Critical items, one per screen, large touch targets | storekeeper, sections |
| `/count/full` | Weekly/monthly full count | storekeeper, manager |
| `/transfers` | Between sections and outlets | storekeeper |
| `/reports/*` | The five reports (chart patterns from `reports.component`) | manager, owner |
| `/items` | Item master + CSV import for Phase 0 cutover | manager |

**Non-negotiable UI rules from the README:**
- Users enter **packs**. If grams reach a field a human types into, something is wrong.
- Wastage and a short delivery both take a photo. A photograph taken at the time is what settles an argument later.
- Issue outside a window warns and asks for a note. It does not block.

---

## 8. Phase F - deploy and cutover

Docker Compose (postgres, api, caddy) on the VPS. Replace the template's GitLab CI, k8s manifests
and `vercel.json` - all of which target Beautech's pipeline. GitHub Actions builds, tests against
a real Postgres, pushes, deploys over SSH. Nightly `pg_dump` to object storage **with a restore
drill that is actually run once**, plus uptime and error alerting to the owner's phone.

**Cutover runbook:** freeze demo → `reset.sql` → verify the ledger is empty → import the real
item master from the same `items.csv` shape → opening count in every section → first real GRN.
After that first real GRN the ledger is immutable for real. That is the point.

---

## 9. Sequencing

| Slice | Work | Est. |
|---|---|---|
| 0 | ~~Phase A schema fixes, `api/` scaffold, CI, seeded local DB~~ **done** | 3-4 days |
| 1 | ~~**Vertical slice:** template refactor (C1-C2) + PIN auth + ledger core + GRN + stock view + first tests~~ **done** | 1 week |
| 2 | ~~Issue, wastage, transfer, count + approvals~~ **done** | 1 week |
| 3 | ~~Market purchase + photo upload + cleaning module~~ **done, then withdrawn** - see the banner above; photo upload stayed | 3-4 days |
| 4 | ~~Reports A-E + the anomaly acceptance suite~~ **done** | 1 week |
| 5 | Roles/RBAC hardening (**done** - CR-005), deploy, backup and restore drill | 4-5 days |
| - | **Phase 1 complete** | **~5 weeks** - matches the README estimate |
| 6 | Phase 2: products, recipes, production log, theoretical vs actual | ~4 weeks |

Slice 1 proves the ledger service pattern once, on one document type, before it is replicated
across six. The ledger is append-only by design - a flaw there cannot be edited out later.

Phase 0 (two weeks walking the store with the storekeeper, confirming every item, unit and pack
conversion) runs in parallel and is not engineering work. The README is right that it decides
whether the system is trusted: no amount of code recovers from a wrong pack conversion.

---

## 10. Scope fences

Held to the README's "Not in scope", because each of these gets requested and each kills
adoption: real-time depletion per plate · barcode scanning on vegetables · supplier portals ·
demand forecasting.

À-la-carte kitchen items stay on issue-vs-count control. A chef will not log every plate, and
pretending otherwise makes the whole variance report untrustworthy. Bar is the strongest case -
spirits are countable by bottle and millilitre, which is exactly why anomaly B is detectable at
all.
