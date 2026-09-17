# API Documentation

**Project:** The Grand - inventory management system
**Base URL:** `https://[FILL: host]/api/v1`
**Version:** 1.0 · [FILL: date]
**Status:** Internal

---

## 1. Conventions

| | |
|---|---|
| Protocol | HTTPS only |
| Format | JSON, UTF-8 |
| Prefix | `/api/v1` |
| Auth | `Authorization: Bearer <access token>` |
| Branch context | `x-location-id: <branch id>` on every authenticated request |
| Idempotency | `Idempotency-Key: <uuid>` on every document POST |
| Dates | `YYYY-MM-DD` |
| Timestamps | ISO 8601 with offset |
| Money | Number, two decimal places, LKR |
| Quantities | Number, three decimal places, in the item's stock unit |

**Validation.** Every request and response is validated against a Zod schema at
the boundary. The same schemas generate the web application's types, so drift
between API and client cannot happen without a build failing.

**An empty body is `{}`.** Several endpoints are pure commands - approve, close,
verify, cancel - and take no body. A POST that declares `application/json` and
sends nothing is accepted. Failing those with a parse error is a trap, not a
safety feature.

## 2. Authentication

### Flow

```
GET  /auth/bootstrap     branches and the people on each - no auth
POST /auth/login         branch + user + PIN → access token, refresh token
GET  /auth/me            who am I, and what may I reach
POST /auth/refresh       refresh token → new access token
```

`GET /auth/bootstrap` is unauthenticated by necessity - it draws the sign-in
screen. It returns active users' names, roles and branches. **It never returns
PIN hashes**, and there is a test asserting exactly that.

### `POST /auth/login`

```json
{ "locationId": 1, "userId": 4, "pin": "1234" }
```

```json
{
  "accessToken": "…",
  "refreshToken": "…",
  "user": { "id": 4, "name": "Sunil Fernando", "role": "storekeeper" },
  "location": { "id": 1, "code": "GB", "name": "The Grand Gastrobar" },
  "sections": [ { "id": 1, "code": "STORE", "kind": "STORE" } ]
}
```

| Failure | Status | Meaning |
|---|---|---|
| Wrong PIN | 401 | Attempt recorded |
| Five wrong PINs | 423 | Locked for 15 minutes |
| Branch the user is not assigned to | 403 | |

### Branch scoping

Every authenticated request carries `x-location-id`. **The server validates it
against the set in the token and rejects anything outside it** - a user cannot
reach another branch by editing a header. Every list is scoped from the token,
never from a query parameter.

A refresh token presented as an access token is rejected.

### Roles

`admin` · `management` · `storekeeper` · `kitchen` · `cleaning`

Enforced per route by `app.requireRole(...)`. See the SRS permission matrix
(§4.2) for the authoritative mapping.

**Read endpoints are not role-restricted** (SRS FR-ROL-11) except for money and
reports. This is a deliberate, documented trade for a shared store-room tablet.

## 3. Idempotency

Every document POST requires `Idempotency-Key` (8-128 characters; a UUID is
ideal).

| Situation | Response |
|---|---|
| New key | Processed. Key, request hash and response stored |
| Same key, same body | **The stored response is replayed.** No second document |
| Same key, different body | **409.** The server does not guess which one you meant |
| No key on a document POST | 400 |

This is the difference between a flaky 4G connection at the delivery door
creating one GRN or three.

## 4. Errors

```json
{ "error": "conflict", "message": "That request has already been released" }
```

| Status | Used for |
|---|---|
| 400 | Validation failure, malformed JSON |
| 401 | Missing or invalid token |
| 403 | Role or branch not permitted |
| 404 | Not found, or not visible to this user |
| 409 | Conflict - already released, already closed, already reversed, idempotency clash |
| 423 | Account locked |
| 429 | Rate limited |
| 500 | Unexpected |

**Messages are written for a person.** `"You cannot verify a count you
performed"` rather than `"forbidden"`. The web application shows them directly.

## 5. Pagination

List endpoints take `page` and `pageSize` and return:

```json
{ "items": [ … ], "page": 1, "pageSize": 25, "total": 143 }
```

---

## 6. Endpoints

### 6.1 Health

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | `{"status":"ok","db":"up","ledgerRows":11498}` |

`ledgerRows` only ever grows. If it falls, something is very wrong.

### 6.2 Auth

| Method | Path | Roles |
|---|---|---|
| GET | `/auth/bootstrap` | none |
| POST | `/auth/login` | none |
| POST | `/auth/refresh` | none (refresh token) |
| GET | `/auth/me` | any |

### 6.3 Items and suppliers (read)

| Method | Path | Roles |
|---|---|---|
| GET | `/items` | any |
| GET | `/suppliers` | any |

### 6.4 Stock

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/stock` | any (scoped) | Filters: `sectionId`, `categoryId`, `belowReorder`, `search`. Value shown to management only |

Quantities are computed from the ledger on every call. Nothing is cached.

### 6.5 Goods receipt

| Method | Path | Roles |
|---|---|---|
| POST | `/grn` | storekeeper, management |
| GET | `/grn` | storekeeper, management |

```http
POST /api/v1/grn
Idempotency-Key: 8b1e…
```
```json
{
  "supplierId": 3,
  "poId": null,
  "invoiceNo": "INV-8891",
  "invoiceDate": "2026-07-30",
  "photoUrl": null,
  "lines": [
    { "itemPackId": 12, "qtyPacks": 2, "packPrice": 24500, "expiryDate": null }
  ]
}
```
```json
{
  "id": "412",
  "total": 49000,
  "businessDate": "2026-07-30",
  "lineCount": 1,
  "priceWarnings": [
    {
      "itemPackId": 12, "itemName": "Sunflower oil", "packName": "20 L can",
      "previousPrice": 45880, "newPrice": 60561.60, "changePct": 32
    }
  ]
}
```

**`priceWarnings` is informational.** The delivery is already recorded. The
lorry has gone; refusing the record would not undo the delivery.

Quantities go in as **packs**. Conversion to stock units happens once,
server-side. There is no endpoint that accepts a quantity in grams.

### 6.6 Uploads

| Method | Path | Roles |
|---|---|---|
| POST | `/uploads` | any authenticated |

Multipart, one file, size-limited. Returns a URL for use as `photoUrl`.

### 6.7 Requests and issues

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/me/context` | any | The sections this user can act in |
| GET | `/issue-windows` | any | Configured windows for the branch |
| POST | `/requests/check` | any | What the store holds, before asking |
| POST | `/requests` | any | Raise a request |
| GET | `/requests` | any (scoped) | |
| GET | `/requests/:id` | any (scoped) | Includes what the store holds per line |
| POST | `/requests/:id/release` | storekeeper, management | Moves the stock |
| POST | `/requests/:id/confirm` | the requester | |
| POST | `/requests/:id/cancel` | requester, management | Only while `requested` |

**Release** moves stock out of the store section and into the requesting section
in one transaction. Where the store holds less than asked, it issues what exists
and reports the shortfall. **Stock never goes negative.**

Outside an issue window, the response carries a warning and the release still
happens.

| Refusal | Status | Message |
|---|---|---|
| Releasing your own request | 403 | `"You raised this. Someone else must release it."` |
| Confirming an issue you released | 403 | |
| Releasing twice | 409 | `"That request has already been released"` |
| Cancelling after release | 409 | The stock has already moved |

### 6.8 Wastage

| Method | Path | Roles |
|---|---|---|
| GET | `/reason-codes` | any |
| POST | `/wastage` | kitchen, storekeeper, management |
| GET | `/wastage` | any (scoped) |
| POST | `/wastage/:id/approve` | management |

`reasonCode` is required, must exist, and **must belong to the `wastage`
document type** - a reason code from another document is rejected rather than
quietly accepted.

The ledger is written when the wastage is recorded, not when it is approved.
The food is already in the bin.

### 6.9 Transfers

| Method | Path | Roles |
|---|---|---|
| POST | `/transfers` | storekeeper, management |
| POST | `/transfers/:id/receive` | receiving section |

Both legs post at once. A transfer to the same section is rejected.

**API only in Phase 1 - there is no screen** (SRS FR-TRF-04).

### 6.10 Stock counts

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/counts/open` | kitchen, storekeeper, management | **Freezes expected** |
| PUT | `/counts/:id/lines` | the counter | Counted quantities |
| POST | `/counts/:id/close` | the counter | Computes variance, writes the adjustment |
| POST | `/counts/:id/verify` | management, **not the counter** | |
| GET | `/counts/:id` | scoped | |
| GET | `/counts` | scoped | |

**`/counts/open` never returns expected quantities.** They are stored on the
count lines and are not in any response the counting screen can reach. This is
the single most important property of these endpoints.

| Refusal | Status |
|---|---|
| Closing twice | 409 |
| Verifying your own count | 403 |

A partial count adjusts only the lines that were counted. Skipped lines are left
alone.

### 6.11 Returns

Two documents, and the difference between them is *when* the ledger moves.

| Method | Path | Roles |
|---|---|---|
| POST | `/returns` | management, storekeeper, kitchen, cleaning |
| GET | `/returns` | any (scoped to your own sections) |
| POST | `/returns/:id/approve` | **management only**, never your own |

A section return posts **both legs immediately** - out of the section, into the
branch's quarantine. The destination is resolved server-side; the request names
only the section it came from, so a login that cannot see quarantine can still
return into it. Returning more than the section holds is a 400.

| Method | Path | Roles |
|---|---|---|
| GET | `/supplier-returns/suggested` | management, storekeeper |
| GET | `/grn/:id/returnable` | management, storekeeper |
| POST | `/supplier-returns` | management, storekeeper |
| GET | `/supplier-returns` | management, storekeeper |
| POST | `/supplier-returns/:id/decide` | **management only** |
| POST | `/supplier-returns/:id/send` | management, storekeeper |
| POST | `/supplier-returns/:id/settle` | **management only** |

`/supplier-returns/suggested` is what the screen opens on: everything in
quarantine, grouped by the delivery it should go back on, with the reason carried
from the section return and pack quantities rounded **down** so the proposal is
always submittable. The delivery is the most recent one for that item with packs
still returnable, which is a guess because the ledger does not tie a crate to an
invoice, and one the screen presents as such.

`/grn/:id/returnable` is the data source once a delivery is chosen: each line of that
delivery with what it brought, what has already gone back, what quarantine
holds, and the pack price. Returnable is computed from the return lines
themselves rather than a stored counter.

Lines are entered **in packs** and priced from the pack price on the original
GRN line, copied at raise. A later change to the supplier's price list does not
alter what is owed for goods already invoiced.

**Status is the whole document:** `raised` → `approved` → `sent` → `settled`,
or `rejected`. **`POST /send` is the only call that writes stock**, and it is a
409 until management has approved. Settling before sending is a 409. A credit
outcome requires the note number and the amount actually allowed, which may be
less than was asked for.

### 6.12 Purchase orders

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/purchase-orders` | storekeeper, management | |
| GET | `/purchase-orders` | storekeeper, management | |
| GET | `/purchase-orders/suggested` | storekeeper, management | Everything at or below reorder, in whole packs |
| POST | `/purchase-orders/:id/decide` | **management only** | Approve or reject, with a reason |
| POST | `/purchase-orders/:id/close` | **management only** | Close short, with a reason |

An order is closed by a GRN against it. A short delivery leaves it open on the
balance. A delivery from a supplier the order was not placed with is rejected.

Kitchen and cleaning roles get 403 on all of these.

### 6.13 Opening stock

| Method | Path | Roles |
|---|---|---|
| GET | `/opening-stock` | storekeeper, management |
| POST | `/opening-stock` | storekeeper, management |

A section can be opened once, and only while it has never held stock. A second
attempt is 409. **The admin cannot do this** - setup and stock are deliberately
different jobs.

### 6.14 Documents and reversals

| Method | Path | Roles |
|---|---|---|
| POST | `/documents/:doc/:id/reverse` | **management only** |

Writes mirrored rows with `is_reversal = true` and `reverses_id` set. Never an
`UPDATE` - the database would refuse one anyway.

Reversing the same document twice is 409.

### 6.15 Reports - management only

| Method | Path | The question it answers |
|---|---|---|
| GET | `/reports/usage-variance` | Did we use more than we should have? |
| GET | `/reports/usage-variance/:itemId` | For this item, over time |
| GET | `/reports/shrinkage` | What has gone with no explanation? |
| GET | `/reports/price-movement` | Which supplier prices moved? |
| GET | `/reports/wastage` | What are we throwing away, and why? |
| GET | `/reports/wastage/:itemId` | For this item |
| GET | `/reports/stock-outs` | What ran out, and what is about to? |
| GET | `/reports/open-purchase-orders` | What have we ordered and not received? |
| GET | `/reports/service-level` | How much of what was asked for did we give? |
| GET | `/reports/supplier-performance` | Which suppliers deliver short or dear? |
| GET | `/reports/valuation` | What is the stock worth? |
| GET | `/reports/dead-stock` | What has not moved? |
| GET | `/reports/consumption` | What did each room use? |
| GET | `/reports/count-accuracy` | Whose counts agree with the system? |

All take `from` and `to` and are scoped to the branch.

**`/reports/shrinkage` takes two floors**, both defaulting from
`DEFAULT_SHRINKAGE_FLOOR_LKR` (100) and `DEFAULT_SHRINKAGE_FLOOR_PCT` (2):

```
GET /reports/shrinkage?from=2026-06-10&to=2026-08-08&minValue=100&minPct=2
```

Two thresholds, because one is not enough. Ordinary 0.5% counting noise in the
store is worth Rs 100-175 a day, so a money floor alone produces fifteen false
alarms on expensive gin that bury the two real bottles. Noise is proportional to
what is on the shelf; theft is not.

**Documented wastage is excluded from shrinkage by construction**, in the SQL,
not by a parameter a caller could omit. An owner accused of theft over a crate
of lettuce stops opening reports by week three.

### 6.16 Administration - admin only

| Method | Path |
|---|---|
| GET | `/admin/branches` |
| GET | `/admin/users` |
| POST | `/admin/users` |
| PATCH | `/admin/users/:id` |
| POST | `/admin/users/:id/unlock` |

`POST /admin/users` returns the generated PIN **once**, in plain text. It is
never retrievable again. That is deliberate: hiding it produces a sticky note
stuck to the tablet.

`PATCH` deactivates and reactivates. **Nothing deletes a user** - their name is
on every document they ever created. Deactivating the last active admin is
refused.

### 6.17 Setup - admin only

| Group | Endpoints |
|---|---|
| Categories | `GET/POST /setup/categories`, `PATCH /setup/categories/:id` |
| Items | `GET/POST /setup/items`, `PATCH /setup/items/:id` |
| Packs | `POST /setup/items/:id/packs`, `PATCH /setup/packs/:id` |
| Suppliers | `GET/POST /setup/suppliers`, `PATCH /setup/suppliers/:id` |
| Prices | `GET/POST /setup/suppliers/:id/prices` |
| Section kinds | `GET /setup/section-kinds` |
| Branches | `GET/POST /setup/branches`, `PATCH /setup/branches/:id` |
| Sections | `POST /setup/sections`, `PATCH /setup/sections/:id` |

`GET /setup/section-kinds` returns the fixed list of six. **There is no
endpoint that creates a new kind.** A section of an unknown kind is a room no
role can reach - created successfully, visible to nobody. Adding a sixth is a
code change in `SECTION_KINDS`, which both the permission checks and the setup
form read.

Nothing in setup deletes. Everything deactivates.

## 7. Rate limiting

Applied globally, and more tightly on `/auth/login`. Exceeding it returns 429.

## 8. Logging and redaction

Structured JSON logs. **`req.headers.authorization` and `req.body.pin` are
redacted.** A PIN in a log file is a PIN in a backup, forever.

## 9. Notes for anyone integrating

| # | |
|---|---|
| 1 | This is the same API the web application uses. There is no private back door |
| 2 | Authenticate as a named service user, so integration actions carry a name like everyone else's |
| 3 | Send an `Idempotency-Key` on every document POST. Retries are your problem otherwise |
| 4 | Never attempt to write the ledger directly. The database will refuse, and it should |
| 5 | Read-only reporting is better served by a read-only database role against `current_stock_valued` |
| 6 | Treat a 409 as information, not an error to retry. It means the thing already happened |
