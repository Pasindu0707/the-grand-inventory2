# Coding Standards

**Project:** The Grand - inventory management system
**Version:** 1.0 · [FILL: date]
**Status:** Internal

---

## 1. The point of this document

Not to make code look uniform - a formatter does that. This document exists to
record the handful of rules that, if broken, quietly destroy a property the
system depends on.

Section 2 is the load-bearing part. Everything after it is ordinary good
practice and you could disagree with any of it without much harm.

---

## 2. The rules that are not negotiable

### R1 - Never write to `stock_ledger` from anywhere but `services/ledger.ts`

Not from a route. Not from a script. Not "just this once for a data fix".

**Enforced by** an ESLint `no-restricted-imports` rule that fails the build.
Not by code review, because a convention lasts until the first person in a
hurry, and this one is load-bearing.

```ts
// The only way in:
postDocument(tx, {
  doc: 'grn', docId, locationId, businessDate,
  lines: [...], createdBy, isDemo,
})
```

If you need a new document type, you write a new service function. There is
deliberately no generic writer.

### R2 - Corrections are reversals, never edits

```ts
// Wrong - and the database will refuse it anyway
await db.updateTable('stock_ledger').set({ qty_base: 5 })...

// Right
await reverseDocument('wastage', docId, reason, userId)
```

### R3 - Never introduce a stored quantity

There is no `stock_qty` column and there must never be one. Not as a cache, not
"for report performance", not as a materialised view someone forgets to refresh.

Stock is `sum(qty_base)` over the ledger, computed on read. A cached quantity is
a number that eventually disagrees with the movements behind it, and nobody can
tell you when it started lying.

If a report is slow, add an index. If an index is not enough, come and discuss
it - the answer is probably partitioning, not caching.

### R4 - One document, one transaction

Every ledger row belonging to a document is written in a single transaction,
along with the cost-state update and the audit row. A partially written document
must be impossible.

```ts
await db.transaction().execute(async (tx) => {
  const docId = await insertDocument(tx, …)
  await postDocument(tx, { …, docId })
})
```

### R5 - Packs convert once, server-side

The API accepts packs. Conversion to stock units happens in the service layer.

**If a quantity in grams reaches a field a human types into, something has gone
wrong.** There is no endpoint that accepts a stock-unit quantity from a user for
a receipt.

### R6 - Warn, do not block

Price jumps, issue windows, cash discrepancies: these return a warning in the
response body alongside a successful result. They do not throw.

Only two things block, and each is documented in the SRS with a reason:
wastage without a reason, and closing a count twice. **Do not add a third
without a conversation.**

### R7 - Nothing is deleted

Users, items, suppliers and sections deactivate. Ledger rows cannot be deleted
at all. `DELETE` appears in this codebase in exactly one place: the cutover
script.

### R8 - Scope from the token, never from a parameter

```ts
// Wrong
const locationId = Number(req.query.locationId)

// Right
const locationId = req.locationId   // validated against the token by the auth plugin
```

---

## 3. TypeScript

| # | Rule |
|---|---|
| T1 | `strict: true`. No exceptions |
| T2 | No `any`. Use `unknown` and narrow |
| T3 | No non-null assertion `!` except where a runtime check immediately precedes it |
| T4 | Database types are **generated** by `kysely-codegen`. Never hand-written, never edited |
| T5 | API types flow one way: Zod schema → OpenAPI → generated `api-types.ts` → Angular |
| T6 | `type` for shapes, `interface` only when declaration merging is needed |
| T7 | Exported functions carry explicit return types |
| T8 | ES modules with `.js` extensions in import paths - this is a Node ESM requirement, not a preference |

## 4. API layer

| # | Rule |
|---|---|
| A1 | Every route declares a Zod schema for headers, params, query, body and response |
| A2 | Every route declares its role guard as a `preHandler` |
| A3 | Routes contain no business logic. They validate, call a service, and shape a response |
| A4 | Every document POST requires `Idempotency-Key` |
| A5 | Errors are thrown as `AppError` subclasses with a status and a human message |
| A6 | Error messages are written for the person on the screen: `"You raised this. Someone else must release it."` not `"forbidden"` |
| A7 | Never log a PIN or an authorization header. The redaction list exists; keep it correct |

## 5. Database access

| # | Rule |
|---|---|
| D1 | Kysely everywhere. No string-concatenated SQL |
| D2 | Raw SQL via the `sql` template tag only, which parameterises |
| D3 | Migrations are numbered, forward-only, plain `.sql`. **Never edit a migration that has run anywhere** |
| D4 | Every new table gets `is_demo boolean not null default false` |
| D5 | Every new foreign key gets an index. Postgres does not create them |
| D6 | Money is `numeric(14,2)`, quantities `numeric(14,3)`, costs `numeric(14,4)`. Never `float` |
| D7 | Regenerate Kysely types with every migration, or the schema-drift test fails |

## 6. Tests

| # | Rule |
|---|---|
| X1 | Tests run against a **real PostgreSQL**, never a mock. The behaviours worth testing here *are* database behaviours |
| X2 | Every new document type gets: the happy path, the role guard, idempotency, and the reversal |
| X3 | Every report gets a test that it **finds** its fault and, where relevant, that it **stays silent** on things it should not flag |
| X4 | Test names are sentences that describe behaviour, not method names |
| X5 | Anything a permission guard refuses gets a test asserting the refusal |

### 6.1 Test naming

Read the existing suite before adding to it. The style is a sentence you could
say to the Client:

```
it('freezes expected at open, and a later movement does not absorb the variance')
it('warns when a pack price jumps, without blocking the delivery')
it('refuses to let the counter verify their own count')
it('does NOT appear in the shrinkage report')
```

Not:

```
it('should work correctly')
it('test close count')
```

The first set doubles as documentation and appears in the traceability matrix.
The second set tells nobody anything.

### 6.2 Negative assertions

The most valuable test in this codebase asserts that a report **does not** fire:
documented spoilage must never appear in the unexplained-loss report.

That failure mode - a report that accuses people of theft over a crate of
lettuce - is the one that gets systems abandoned, and it is the one nobody
writes a test for. **Look for the negative assertion whenever you add a
report.**

## 7. Comments

Comment **why**, not what. The code says what.

```ts
// Bad
// Loop through the lines
for (const line of lines) { … }

// Good
// Fractional packs are real: half a sack gets delivered.
qtyPacks: z.number().positive().max(100_000),
```

Where a decision looks wrong at first glance, leave the reason. Most of the
existing comments in this codebase exist because someone would otherwise
"simplify" the code and break something. Examples worth reading:

- The `ledger_guard()` comment explaining why a trigger and not a rule
- The `qty_expected` comment explaining why it is frozen
- The two-threshold comment on the shrinkage report

## 8. Angular

| # | Rule |
|---|---|
| N1 | Standalone components. No NgModules |
| N2 | Signals for state. No new RxJS state stores |
| N3 | Types come from generated `api-types.ts`. Never hand-declared to match the API |
| N4 | Every list has a defined loading, empty and error state |
| N5 | Every empty state says what to do next, never "no data" |
| N6 | Every disabled control says why it is disabled |
| N7 | Route guards read `allowed` from route data; the server enforces regardless |
| N8 | Money and quantity formatting goes through the shared helpers, never inline |

### 8.1 The two front ends

`beautech-master-web-app` and `grand-inventory-web` share `core/` **by copy** -
API client, session store, guards, types.

**A change to the API contract is two edits.** If you change one, change the
other in the same commit. This duplication is deliberate and temporary; if it
outlives the second front end's evaluation, collapse it rather than living with
it.

## 9. Commits and branches

| # | Rule |
|---|---|
| C1 | One logical change per commit |
| C2 | Subject line says what changed and why, in plain language. This project's history reads as sentences - match it |
| C3 | A commit that changes behaviour changes a test |
| C4 | A migration and its regenerated types go in the same commit |
| C5 | `main` is deployable. Work on branches |
| C6 | Never commit `.env`, dumps, or `seed.sql` |

## 10. Definition of done

A change is not done until all of these are true.

| # | |
|---|---|
| 1 | `npm run typecheck` passes |
| 2 | `npm run lint` passes - **including the no-ledger-import rule** |
| 3 | `npm test` passes in full |
| 4 | New behaviour has a test |
| 5 | New refusals have a test asserting the refusal |
| 6 | A schema change has a migration, regenerated types, and a passing drift test |
| 7 | The SRS requirement it implements is referenced in the commit or the PR |
| 8 | The traceability matrix is updated if a requirement's coverage changed |
| 9 | User-facing wording matches the UI Specification's standards |

## 11. Before you change something that looks wrong

Some of this codebase looks odd until you know why. Before "fixing" any of the
following, read the reason and, if you still disagree, raise it as a
conversation rather than a commit.

| Looks like | Actually |
|---|---|
| The ledger triggers are over-engineered | They are the product. The original used a rule that silently discarded statements, which would have left 10,800 demo rows in the live ledger at cutover |
| Recomputing stock on every read is wasteful | It is the reason the numbers can be trusted. See R3 |
| The shrinkage report's two thresholds are redundant | Neither alone works. One produced 44-cent alerts; the other buried two real bottles in fifteen false ones |
| Expected quantity could be recomputed at close | A movement during the count would silently absorb the gap |
| The demo PIN salt is hardcoded | So `seed.sql` stays byte-identical and the suite stays deterministic. Real PINs use a random salt |
| Two front ends duplicating `core/` | Deliberate and temporary. See §8.1 |
| The empty-body content-type parser is a hack | Several endpoints are pure commands. Failing a bodyless POST is a trap, not a safety feature |
