# System Architecture

**Project:** The Grand - inventory management system
**Version:** 1.0 · [FILL: date]
**Audience:** TriniphiX engineers, and whoever maintains this after us
**Status:** Internal - not signed

---

## 1. The one idea

Every movement of stock is a row in an append-only ledger. Stock levels are not
stored anywhere; they are recomputed from the ledger on every read.

Everything below is arrangement around that. If you read one file in this
codebase, read `api/src/services/ledger.ts` - the rest is scaffolding for what
that module guarantees.

## 2. Shape

```
      Browser                      Cloud VPS (single host)
 ┌──────────────────┐    ┌─────────────────────────────────────────┐
 │ Angular 19 SPA   │    │  Caddy - TLS, static files, reverse      │
 │ · signals store  │───▶│  proxy for /api                          │
 │ · JWT + refresh  │    │            │                             │
 │ · route guards   │    │            ▼                             │
 └──────────────────┘    │  Fastify 5 (Node 20) - API               │
                         │    routes → services → ledger            │
                         │            │                             │
                         │            ▼                             │
                         │  PostgreSQL 16                           │
                         │    ┌───────────────────────────────┐     │
                         │    │ stock_ledger                  │     │
                         │    │ triggers reject UPDATE,       │     │
                         │    │ DELETE and TRUNCATE           │     │
                         │    └───────────────────────────────┘     │
                         │  Uploads on local disk, served by Caddy  │
                         └──────────────────┬──────────────────────┘
                                            ▼
                                 Nightly pg_dump → object storage
```

One host. No message queue, no cache layer, no microservices. At one restaurant
with roughly 65,000 ledger rows a year, every one of those would be complexity
bought with nothing.

## 3. Stack, and why each piece

| Layer | Choice | Why this one |
|---|---|---|
| Database | **PostgreSQL 16** | The whole design leans on triggers, `numeric`, enums and `timestamptz`. The immutability guarantee is a database feature, not an application one |
| Query layer | **Kysely** + `kysely-codegen` | This system *is* SQL - ledger arithmetic, variance windows, moving averages. An ORM fights all three. Kysely gives type safety over SQL rather than instead of it |
| API | **Fastify 5** + `fastify-type-provider-zod` | Zod schemas serve as runtime validation *and* the generated type contract, so validation and types cannot drift |
| Migrations | Numbered plain `.sql` + a small runner | No DSL between an engineer and the ledger rules. The rules are the product |
| Tests | **Vitest** against a **real PostgreSQL** | The behaviours worth testing here are database behaviours. A mocked database would prove nothing about a trigger |
| Web | **Angular 19 + PrimeNG** | Built on a commercially licensed template; the auth interceptor, route guards and layout shell were already right |
| Deploy | **Docker Compose + Caddy**, one VPS | Replicable per branch for Phase 4 |
| Backup | Nightly `pg_dump` → object storage | With a restore drill that is actually run |

**IDs are integers**, not UUIDs. `bigint` is materially cheaper on a table that
only grows, and the ledger only grows. Client-generated UUIDs survive in exactly
one place: idempotency keys.

## 4. Layering, and the rule that holds it

```
routes/      HTTP surface. Zod schemas, role guards, pagination.
             Knows about requests. Knows nothing about the ledger.
               │
services/     One module per document type. Business rules live here.
               │
ledger.ts     The ONLY module that inserts into stock_ledger.
               │
PostgreSQL    Triggers that refuse to be argued with.
```

**The rule:** *never write to `stock_ledger` from a controller.* One service
function per document type; the document is the API and the ledger is a
consequence.

This is enforced by an ESLint `no-restricted-imports` rule that **fails the
build**. Not by a comment, and not by code review. A convention lasts until the
first person in a hurry, and this one is load-bearing.

### 4.1 The ledger writer

```ts
postDocument(tx, {
  doc: 'grn', docId, locationId, businessDate,
  lines: [{ sectionId, itemId, qtyBase, unitCost, docLine, reasonCode }],
  createdBy, isDemo,
})
```

Responsibilities, all in one transaction:

1. Derive `business_date` from `locations.day_start` - already correct for a
   24-hour site whose day starts at 04:00.
2. Recompute weighted-average cost on receipts.
3. Write every ledger row.
4. Write the audit log.

Corrections go through `reverseDocument(docType, docId, reason, userId)`, which
emits mirrored rows with `is_reversal = true` and `reverses_id` set. It never
issues an `UPDATE`, because it could not: the database would refuse.

## 5. The properties that must survive refactoring

If a future change breaks one of these, the change is wrong regardless of how
good the reason sounded.

| # | Property | Enforced by |
|---|---|---|
| 1 | The ledger cannot be updated, deleted or truncated | Postgres triggers `ledger_no_update`, `ledger_no_delete`, `ledger_no_truncate` |
| 2 | No stock quantity is stored | There is no such column. Views derive it |
| 3 | Only `ledger.ts` writes the ledger | ESLint rule, build fails |
| 4 | A document's rows are all-or-nothing | One transaction per document |
| 5 | A retried POST creates one document | `idempotency_keys` |
| 6 | Expected quantity is frozen when a count opens | `stock_count_lines.qty_expected` written at open |
| 7 | Documented waste is excluded from shrinkage | Report SQL, by construction - not a filter parameter |
| 8 | Branch scoping comes from the token, never a query parameter | `plugins/auth.ts` |

### 5.1 The immutability escape hatch, and why it exists

Exactly one narrow escape exists, and it is worth understanding because the
first version of this got it wrong:

```sql
if old.is_demo and coalesce(current_setting('grand.allow_demo_reset', true), '') = 'on' then
  return old;
end if;
```

`db/reset.sql` sets that setting inside its own transaction. Only demo rows can
be removed, and only by that script. Real rows are immutable under every code
path.

The original schema used `create rule ... do instead nothing`, which **silently
discards** the statement. It blocked `reset.sql` too - so cutover would have
appeared to succeed while leaving every demonstration row in the live ledger.
Triggers that raise beat rules that shrug.

`TRUNCATE` gets its own statement-level trigger, because truncation bypasses
row-level delete triggers entirely. Without it, one `truncate stock_ledger`
defeats everything above.

## 6. Data model in brief

Full detail in the [Database Design](database-design.md). The shape:

**Master data** - `locations`, `sections`, `users`, `items`, `item_packs`,
`item_categories`, `suppliers`, `supplier_prices`.

**The ledger** - `stock_ledger`, plus `item_cost_state` holding the running
weighted average per item and branch.

**Documents** - `grn`/`grn_lines`, `issues`/`issue_lines`, `wastage`,
`transfers`, `stock_counts`/`_lines`, `opening_stock`/`_lines`,
`purchase_orders`/`_lines`, `section_returns`,
`supplier_returns`/`_lines`.

**Phase 2** - `products`, `recipe_lines`, `production_log`, and the
`usage_variance` view.

**Support** - `idempotency_keys`, `settings`, `audit_log`, `login_attempts`,
`reason_codes`.

**Views** - `current_stock`, `current_stock_valued`, `usage_variance`.

### 6.1 Two design choices worth defending

**The store is just another section.** Not a special case. Every movement is a
section-to-section transfer, which removes special-casing from the ledger
entirely.

**Everything in the small unit.** Grams, millilitres, each. Packs convert once,
at entry, server-side. Conversion factors live on `item_packs`, never on the
item, because sugar arrives in 1 kg packs *and* 50 kg sacks.

## 7. Authentication and authorisation

**Credential:** a 4-6 digit PIN, bcrypt-hashed with a per-user random salt.
Five failures lock for fifteen minutes via `login_attempts`.

**Session:** JWT access token plus a refresh token. The refresh interceptor was
inherited from the template and is the piece most people get wrong - it
single-flights concurrent 401s so ten parallel requests produce one refresh, not
ten.

**Branch context:** the client sends `x-location-id` carrying the active branch.
The JWT carries the set the user is allowed. **The server validates membership
on every request.** Every list is scoped from the token, never from a query
parameter.

**Roles:** five - `admin`, `management`, `storekeeper`, `kitchen`, `cleaning`.
Enforced by `app.requireRole(...)` as a route `preHandler`.

**Section kinds** decide which rooms a role can reach: `STORE`, `KITCHEN`,
`CLEAN`, `QUARANTINE`, defined in one constant, `SECTION_KINDS`, which both the
permission checks and the setup form read. `BAKERY` and `BAR` were retired by
CR-004; a pastry bench is a second section of kind `KITCHEN`.

Adding a fifth kind is deliberately a code change in that one place. A section
of an unknown kind is a room no role can reach: created successfully, visible to
nobody.

### 7.1 The known limit

**Read access is not restricted by role.** Any signed-in user can call the API
directly and see stock quantities for their branch. The menu hides screens a
role has no use for, but that is presentation, not security. Money and reports
*are* restricted.

On a shared store-room tablet this is a reasonable trade. Tightening it is a
change to the route guards, not to the UI. Recorded in the SRS as FR-ROL-11 so
that it is a decision rather than an oversight.

## 8. Idempotency

Every document POST carries a client-generated `Idempotency-Key` header.

```
key present ──▶ seen before?
                  │
                  ├── no  ──▶ process, store (key, endpoint, request hash, response)
                  │
                  ├── yes, same request hash ──▶ return the stored response
                  │
                  └── yes, different hash ──▶ 409. Do not guess
```

Roughly thirty lines of code, no sync layer, no client complexity. It is the
difference between a flaky 4G connection at the delivery door creating one GRN
or three.

## 9. Two front ends, one API

| App | Port | What it is |
|---|---|---|
| `beautech-master-web-app` | 4200 | The first build: inventory screens inside a purchased CRM template |
| `grand-inventory-web` | 4300 | The console: a shell built for this system, Administration as a first-class group |

They share `core/` **by copy** - API client, session store, guards, types. A
change to the API contract is two edits, not two rewrites. The screens and the
shell are the parts that differ.

This is a deliberate, temporary duplication. If it outlives the second front
end's evaluation, collapse it.

## 10. Type flow

```
Zod schemas in routes/ ──▶ OpenAPI ──▶ generated api-types.ts ──▶ Angular
```

One direction, API to web. Drift between the two becomes impossible without a
build step failing, and neither app needs to know how the other is packaged.

Separately, `ledger.test.ts` carries a **schema drift** test asserting that
every table in the generated Kysely types exists in the database with matching
columns. A migration that lands without regenerating types fails the suite.

## 11. Deployment

```
docker compose:
  ├── caddy       TLS termination, static SPA, reverse proxy /api, serves /uploads
  ├── api         Node 20, Fastify
  └── postgres    16, volume-mounted data
```

Uploads land on local disk and are served by Caddy. This is the correct answer
at one site; at five it becomes object storage, and that is a Phase 4 change.

CI builds, runs the suite against a real Postgres, and deploys over SSH.

## 12. What this architecture does not do, on purpose

| Not present | Why |
|---|---|
| Caching layer | Stock is derived on read (P2). A cache here would reintroduce exactly the drift the design exists to prevent |
| Message queue | Nothing is asynchronous. Everything is one transaction |
| Microservices | One restaurant. Splitting this would add network calls between things that must share a transaction |
| Offline sync | Client chose online-only. The template's Dexie sync stack was built around POS transactions and does not transfer to documents |
| Soft deletes | Nothing is deleted. Records deactivate |
| An ORM | See §3 |
| Horizontal scaling | 65,000 rows a year. A single host has three orders of magnitude of headroom |

## 13. Where it would strain

Honest limits, so nobody discovers them under pressure.

| Pressure | At roughly | What breaks first | Fix |
|---|---|---|---|
| Ledger growth | ~5M rows | Report queries over long ranges | Partition `stock_ledger` by year; the partial index on real rows already helps |
| Branch count | ~10 branches on one host | Report contention | One host per branch, or a read replica |
| Concurrent users | ~100 | Node event loop under report load | Move reports to a read replica |
| Upload volume | Local disk fills | Everything | Object storage |

None of these is close. They are written down so that when someone asks "will
it scale", the answer is a number rather than a shrug.

## 14. Where things live

```
db/migrations/     schema and its changes, numbered, forward-only
db/reset.sql       the cutover wipe - demo rows only
seed/items.csv     the 100-item master, and the Phase 0 template
seed/generate.ts   demo data generator, including the five planted faults
scripts/           migrate, seed, verify, add-user, wipe-and-admins
api/src/services/  the business rules - ledger.ts is the important one
api/src/routes/    HTTP surface and role guards
api/test/          64 tests; anomalies.test.ts is the acceptance suite
beautech-master-web-app/src/app/pages/    the screens
```
