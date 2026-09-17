# Requirements Traceability Matrix

**Project:** The Grand - inventory management system
**Traces:** SRS v1.0 → implementation → automated test → UAT script
**Version:** 1.0 · [FILL: date]

---

## Why this document exists

Two reasons, and the second is the one that pays for it.

**Coverage.** Every mandatory requirement in the SRS has somewhere to point at
in the code and a test that proves it. A requirement with no test is a
requirement nobody has checked.

**Disputes.** When someone says "this doesn't work", this table converts that
into a specific requirement, a specific line of code and a specific test.
Either the test passes and the disagreement is about the requirement - which
makes it a Change Request - or the test fails, and it is a Defect. That
distinction is worth money to both sides, and this is the document that settles
it in ten minutes rather than in a meeting.

## How to read it

| Column | Meaning |
|---|---|
| **Req** | SRS requirement ID |
| **Requirement** | Short form. The SRS is authoritative |
| **Implementation** | Where the behaviour lives |
| **Automated test** | Test file and the name of the assertion |
| **UAT** | Script number in the UAT Plan |
| **Status** | ✅ Covered · ⚠ Partial · ○ Manual only · P2 Phase 2 · ⊘ Withdrawn |

**○ Manual only** is not a failure. Some things - a PIN shown once and never
again, a photograph genuinely being taken at the delivery door - are verified by
a person doing it, and the UAT script is the evidence.

**⊘ Withdrawn** rows are kept rather than deleted. A requirement ID that simply
disappears is indistinguishable from one somebody forgot to trace.

Run the automated suite:

```bash
cd api && npm test
```

---

## 1. Authentication and session

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-AUTH-01 | PIN sign-in via branch → name tile → keypad | `api/src/routes/auth.ts`, `web/pages/login.component.ts` | `auth.test.ts` - *signs in with the right PIN and returns the active location and its sections* | U-01 | ✅ |
| FR-AUTH-02 | PIN stored as bcrypt hash only | `api/src/routes/auth.ts`, `admin.ts` | `auth.test.ts` - *lists locations and users without exposing PIN hashes* | U-01 | ✅ |
| FR-AUTH-03 | Five failures lock for 15 minutes | `api/src/routes/auth.ts`, `login_attempts` | `auth.test.ts` - *locks the account after repeated wrong PINs* | U-02 | ✅ |
| FR-AUTH-04 | Session survives a page refresh | `web/core/auth.store.ts`, auth interceptor | - | U-03 | ○ |
| FR-AUTH-05 | Branch validated server-side on every request | `api/src/plugins/auth.ts` | `auth.test.ts` - *rejects an `x-location-id` outside the token's allowed set*; *refuses a location the user is not assigned to* | U-04 | ✅ |
| FR-AUTH-06 | Only active users on the sign-in screen | `api/src/routes/auth.ts` `/bootstrap` | `auth.test.ts` - *bootstrap* | U-01 | ✅ |
| FR-AUTH-07 | Session inactivity expiry | `api/src/plugins/auth.ts` | - | U-03 | ⚠ |
| - | Refresh token cannot be used as an access token | `api/src/plugins/auth.ts` | `auth.test.ts` - *rejects a refresh token used as an access token* | - | ✅ |

## 2. Goods receipt

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-GRN-01 | Record a delivery against a supplier | `api/src/routes/grn.ts`, `services/grn.ts` | `grn.test.ts` - *POST /grn* | U-10 | ✅ |
| FR-GRN-02 | Lines in packs with a pack price | `services/grn.ts` | `grn.test.ts` - *converts packs to stock units exactly once* | U-10 | ✅ |
| FR-GRN-03 | Conversion server-side, shown read-only | `services/grn.ts`, `web/pages/grn.component.ts` | `grn.test.ts` - *converts packs to stock units exactly once and lands them in the store* | U-10 | ✅ |
| FR-GRN-04 | Fractional packs accepted | `routes/grn.ts` schema | `grn.test.ts` | U-11 | ✅ |
| FR-GRN-05 | Price jump warns, does not block | `services/grn.ts` | `grn.test.ts` - *warns when a pack price jumps, without blocking the delivery* | U-12 | ✅ |
| FR-GRN-06 | Increases store stock at price paid | `services/ledger.ts` | `grn.test.ts`, `ledger.test.ts` | U-10 | ✅ |
| FR-GRN-07 | Weighted-average cost recomputed | `services/ledger.ts`, `item_cost_state` | `grn.test.ts` - *moves the weighted average toward the new price, not to it* | U-13 | ✅ |
| FR-GRN-08 | Closes a purchase order; short delivery stays open | `services/purchasing.ts` | `purchasing.test.ts` - *keeps the order open on the balance, then closes it when the rest arrives* | U-40 | ✅ |
| FR-GRN-09 | Idempotent save | `services/idempotency.ts` | `grn.test.ts` - *replaying an Idempotency-Key creates exactly one GRN*; *rejects the same key with a different body rather than guessing* | U-14 | ✅ |
| FR-GRN-10 | Deliveries listed and viewable | `routes/grn.ts` | `grn.test.ts` | U-15 | ✅ |
| FR-GRN-11 | Reversible by management only | `routes/documents.ts` | `ledger.test.ts` - *mirrors every row of a document and leaves the originals alone* | U-16 | ✅ |
| FR-GRN-12 | Optional expiry date per line | `routes/grn.ts` | - | U-11 | ⚠ |
| - | Role guard on receiving | `routes/grn.ts` | `grn.test.ts` - *refuses a role that has no business receiving deliveries* | U-17 | ✅ |

## 3. Cash market purchase - withdrawn (CR-001)

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-MKT-01-06 | The whole cash-purchase document | Removed - `db/migrations/0006` | - | - | ⊘ |
| - | Upload requires a session | `routes/uploads.ts` | `uploads.test.ts` - *requires a session* | - | ✅ |

## 4. Requests and issues

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-REQ-01 | Raise a request for a section | `routes/requests.ts`, `services/requests.ts` | `requests.test.ts` | U-30 | ✅ |
| FR-REQ-02 | Status requested → released → received / cancelled | `services/requests.ts` | `requests.test.ts` | U-30 | ✅ |
| FR-REQ-03 | Releaser sees what the store holds | `routes/requests.ts` `/requests/:id` | `requests.test.ts` | U-31 | ✅ |
| FR-REQ-04 | Release moves stock, both legs, one transaction | `services/ledger.ts` | `requests.test.ts`, `ledger.test.ts` | U-31 | ✅ |
| FR-REQ-05 | Partial fulfilment; stock never negative | `services/requests.ts` | `requests.test.ts` | U-32 | ✅ |
| FR-REQ-06 | Shortfall offers a pre-filled purchase order | `services/purchasing.ts` | `purchasing.test.ts` | U-33 | ✅ |
| FR-REQ-07 | Outside issue window warns, records | `services/settings.ts`, `routes/requests.ts` `/issue-windows` | `requests.test.ts` | U-34 | ✅ |
| FR-REQ-08 | Requester confirms arrival | `services/requests.ts` | `requests.test.ts` | U-35 | ✅ |
| FR-REQ-09 | Cannot release own request; cannot confirm own release | `services/requests.ts` | `requests.test.ts` | U-36 | ✅ |
| FR-REQ-10 | Cancel only before release | `services/requests.ts` | `requests.test.ts` | U-37 | ✅ |
| FR-REQ-11 | Scoped visibility by role | `plugins/auth.ts` | `documents.test.ts` - *refuses a kitchen login every door into the cleaning store* | U-38 | ✅ |

## 5. Wastage

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-WST-01 | Record wastage with quantities | `routes/documents.ts`, `services/wastage.ts` | `documents.test.ts` - *wastage* | U-50 | ✅ |
| FR-WST-02 | **Reason mandatory** | `services/wastage.ts` | `documents.test.ts` - *rejects an unknown reason code*; *rejects a reason code belonging to another document type* | U-51 | ✅ |
| FR-WST-03 | Reason codes from the Client's list | `reason_codes` table | `documents.test.ts` | U-51 | ✅ |
| FR-WST-04 | Reduces stock at once, before approval | `services/wastage.ts` | `documents.test.ts` - *reduces the section it was wasted from* | U-50 | ✅ |
| FR-WST-05 | Management approves after the fact | `routes/documents.ts` `/wastage/:id/approve` | `documents.test.ts` | U-52 | ✅ |
| FR-WST-06 | Optional photograph | `routes/uploads.ts` | - | U-53 | ⚠ |
| FR-WST-07 | Never appears in shrinkage | `services/reports.ts` | `anomalies.test.ts` - ***does NOT appear in the shrinkage report***; *keeps documented waste out of the unexplained set generally* | **U-90** | ✅ |
| - | Reversal nets to zero | `services/ledger.ts` | `documents.test.ts` - *undoes a wastage document and nets its effect to zero* | U-54 | ✅ |

## 6. Transfers

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-TRF-01 | Section to section, branch to branch | `routes/documents.ts` `/transfers` | `documents.test.ts` - *posts both legs at once within one outlet* | - | ✅ API |
| FR-TRF-02 | Receiving section confirms | `routes/documents.ts` `/transfers/:id/receive` | `documents.test.ts` | - | ✅ API |
| FR-TRF-03 | Stock leaves on creation | `services/ledger.ts` | `documents.test.ts` | - | ✅ |
| FR-TRF-04 | **No screen in Phase 1** | - | - | - | By design |
| - | Refuses a transfer to the same section | `routes/documents.ts` | `documents.test.ts` - *refuses a transfer to the same section* | - | ✅ |

## 7. Stock counts

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-CNT-01 | Daily and full counts | `routes/documents.ts`, `services/counts.ts` | `documents.test.ts` - *scopes the daily count to what the section actually holds* | U-60 | ✅ |
| FR-CNT-02 | Expected frozen at open | `services/counts.ts` | `documents.test.ts` - ***freezes expected at open, and a later movement does not absorb the variance*** | U-61 | ✅ |
| FR-CNT-03 | **Expected never shown while counting** | `web/pages/counts.component.ts` | - | **U-62** | ○ |
| FR-CNT-04 | One item per screen, large targets | `web/pages/counts.component.ts` | - | U-62 | ○ |
| FR-CNT-05 | Variance computed at close | `services/counts.ts` | `documents.test.ts` | U-63 | ✅ |
| FR-CNT-06 | Adjustment written to the ledger | `services/counts.ts` | `documents.test.ts` - *writes a COUNTADJ adjustment that makes the ledger agree with the shelf* | U-63 | ✅ |
| FR-CNT-07 | Verified by a different person, management | `services/counts.ts` | `documents.test.ts` - *refuses to let the counter verify their own count* | U-64 | ✅ |
| FR-CNT-08 | **Cannot close twice** | `services/counts.ts` | `documents.test.ts` - *will not close the same count twice* | U-65 | ✅ |
| FR-CNT-09 | Partial counts | `services/counts.ts` | `documents.test.ts` - *leaves untouched lines alone - a partial count adjusts only what was counted* | U-66 | ✅ |
| FR-CNT-10 | Counts listed and viewable | `routes/documents.ts` | `documents.test.ts` | U-67 | ✅ |

## 8. Cleaning checklist - withdrawn (CR-001)

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-CLN-01-05 | Areas, tasks, the daily log and its verification | Removed - `db/migrations/0006` | - | - | ⊘ |

The cleaning **role** is not withdrawn and is traced under §4 (requests) and
§10 (stock visibility) like any other section.

## 8a. Returns (CR-003)

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-RET-01 | Returned against the release that delivered it | `services/returns.ts` `issueReturnableLines`, `routes/returns.ts` `GET /requests/:id/returnable` | `returns.test.ts` - *refuses a return with no request behind it* | U-150 | ✅ |
| FR-RET-01a | Capped by released, less returned, and by what is held | `services/returns.ts` | `returns.test.ts` - *refuses more than the request released, with the arithmetic in the message*; *counts what has already gone back against the same request* | U-151 | ✅ |
| FR-RET-01b | An item not on the request cannot go back against it | `services/returns.ts` | `returns.test.ts` - *refuses an item that was not on the request* | U-151 | ✅ |
| FR-RET-01c | A request with nothing released has nothing to return | `services/returns.ts` | `returns.test.ts` | U-150 | ✅ |
| FR-RET-01d | The store returns with no request | `services/returns.ts` | `returns.test.ts` - *lets the store hand back its own shelf with no request* | U-154 | ✅ |
| FR-RET-01e | The row says what went back | `routes/requests.ts` `qtyReturned`, `qtyReturnedTotal` | `returns.test.ts` - *tells the request list what went back, and when to stop offering Return* | U-150 | ✅ |
| FR-RET-01f | Return withdrawn once nothing can go | `routes/requests.ts` `canReturn` | `returns.test.ts` - same, plus *does not offer Return on a request that has not been released* | U-152a | ✅ |
| FR-RET-01g | Returns close after a window | `services/returns.ts` `RETURN_WINDOW_DAYS` | `returns.test.ts` - *closes the window, so an old release is not returnable*; *still allows a return inside the window, after the goods were confirmed* | U-152b | ✅ |
| FR-RET-01h | A return acknowledges receipt | `services/returns.ts` | `returns.test.ts` - *acknowledges receipt - you cannot send back what never came* | U-152a | ✅ |
| FR-RET-01i | A finished request leaves the queue | `routes/requests.ts` `needsMe` | `returns.test.ts` - same | U-152a | ✅ |
| FR-RET-18 | The store sees what is in quarantine | `pages/returns.component.ts`, `GET /stock?sectionId` | - | U-153b | ○ |
| FR-RET-19 | The next step is stated and linked | `pages/returns.component.ts` | - | U-153b | ○ |
| FR-RET-20 | Home tile with the count | `pages/home.component.ts`, `GET /returns?awaitingSupplier` | - | U-153b | ○ |
| FR-RET-21 | The form arrives filled in | `services/returns.ts` `suggestedSupplierReturns`, `GET /supplier-returns/suggested` | `returns.test.ts` - *suggests a return from what is in quarantine, priced off the delivery* | U-154a | ✅ |
| FR-RET-22 | The delivery is a guess, and editable | `services/returns.ts` | `returns.test.ts` - same | U-154b | ✅ |
| FR-RET-23 | Rounded down, always submittable | `services/returns.ts` | `returns.test.ts` - *never suggests more than is in quarantine* | U-154a | ✅ |
| - | Reason must belong to the return document | `services/returns.ts` `assertReturnReason` | `returns.test.ts` - *refuses a wastage reason on a return* | U-150 | ✅ |
| FR-RET-02 | Both legs move immediately | `services/returns.ts` `returnToStore` | `returns.test.ts` - *moves it out of the kitchen and into quarantine at once* | U-150 | ✅ |
| FR-RET-03 | Destination resolved server-side | `plugins/auth.ts` `quarantineSectionFor` | `returns.test.ts` - asserts `toSectionId` | U-150 | ✅ |
| FR-RET-04 | Cannot return more than the section holds | `services/returns.ts` | `returns.test.ts` - *refuses to return more than the section holds* | U-151 | ✅ |
| FR-RET-05 | Management approves, never your own | `services/returns.ts` `approveSectionReturn` | `returns.test.ts` - *will not let the person who returned it approve it* | U-152 | ✅ |
| FR-RET-06 | No quarantine section ⇒ an instruction | `plugins/auth.ts` | - | U-153 | ○ |
| FR-RET-07 | Raised against one delivery, in packs | `routes/returns.ts` `POST /supplier-returns` | `returns.test.ts` | U-154 | ✅ |
| FR-RET-08 | Priced from the delivery | `services/returns.ts` `raiseSupplierReturn` | `returns.test.ts` - *prices the credit from the delivery, not from today* | U-155 | ✅ |
| FR-RET-09 | Cannot exceed what the delivery brought | `services/returns.ts` `returnableLines` | `returns.test.ts` - *refuses to return more than the delivery brought*; *counts what has already gone back* | U-156 | ✅ |
| FR-RET-10 | Cannot exceed what quarantine holds | `services/returns.ts` | `returns.test.ts` | U-157 | ✅ |
| FR-RET-11 | Management alone decides | `routes/returns.ts` `/decide` | `returns.test.ts` - *storekeeper writes it up and management decides it* | U-158 | ✅ |
| FR-RET-12 | Stock moves on send, and only then | `services/returns.ts` `sendSupplierReturn` | `returns.test.ts` - *does not move stock until the goods are sent* | U-159 | ✅ |
| FR-RET-13 | Send before approval refused | `services/returns.ts` | `returns.test.ts` | U-159 | ✅ |
| FR-RET-14-15 | Settlement with three outcomes; a credit needs its note | `services/returns.ts` `settleSupplierReturn` | `returns.test.ts` - *wants the credit note number before it will record a credit* | U-160 | ✅ |
| FR-RET-16 | Cannot settle before sending | `services/returns.ts` | `returns.test.ts` - *will not settle a return that has not gone anywhere* | U-160 | ✅ |
| FR-RET-17 | Valued at weighted average, credit recorded separately | `services/ledger.ts`, `supplier_return_lines` | `returns.test.ts` - *reports what the supplier allowed, not what was asked for* | - | ✅ |
| - | A return is not shrinkage | Reports read documents | `returns.test.ts` - *keeps a documented return out of the shrinkage report* | U-90 | ✅ |
| - | Returns net off consumption | `reports-ops.ts`, `usage_variance` view | `returns.test.ts` - *nets a return off what the section is shown to have consumed*; *never shows quarantine as a room that consumed anything* | U-131 | ✅ |

## 9. Purchase orders

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-PO-01 | Raise an order in packs | `routes/purchasing.ts` | `purchasing.test.ts` - *lets the storekeeper order before anyone has gone short* | U-40 | ✅ |
| FR-PO-02 | Suggested from reorder points | `routes/purchasing.ts` `/suggested` | `purchasing.test.ts` - *suggests whole packs for everything at or below its reorder point* | U-41 | ✅ |
| FR-PO-03 | Raised from a request shortfall | `services/purchasing.ts` | `purchasing.test.ts` | U-33 | ✅ |
| FR-PO-04 | **Management approves; storekeeper cannot** | `routes/purchasing.ts` `/decide` | `purchasing.test.ts` - *can be closed short, with a reason, by management only* | U-42 | ✅ |
| FR-PO-05 | Rejection records a reason | `services/purchasing.ts` | `purchasing.test.ts` - *refuses to mark an order "ordered" without saying who it went to* | U-43 | ✅ |
| FR-PO-06 | Closed by GRN; short stays open | `services/purchasing.ts` | `purchasing.test.ts` - *keeps the order open on the balance* | U-40 | ✅ |
| FR-PO-07 | Closed manually with a reason | `routes/purchasing.ts` `/close` | `purchasing.test.ts` | U-44 | ✅ |
| FR-PO-08 | Open orders as a report | `routes/reports.ts` `/open-purchase-orders` | `reports-ops.test.ts` | U-45 | ✅ |
| FR-PO-09 | Kitchen and cleaning cannot see Purchases | `web/app.routes.ts`, `routes/purchasing.ts` | `purchasing.test.ts` | U-46 | ✅ |
| - | Delivery from the wrong supplier refused | `services/purchasing.ts` | `purchasing.test.ts` - *refuses a delivery from a supplier the order was not placed with* | U-47 | ✅ |
| - | Same item ordered in two pack sizes | `services/purchasing.ts` | `purchasing.test.ts` - *fills both lines when the same item is ordered in two pack sizes* | - | ✅ |

## 10. Opening stock

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-OPN-01 | Opening balance per section | `routes/opening.ts`, `services/opening.ts` | `setup.test.ts` - *opening stock* | U-80 | ✅ |
| FR-OPN-02 | **Once per section, only while empty** | `services/opening.ts` | `setup.test.ts` - *opens a fresh section once, and refuses the second time* | U-81 | ✅ |
| FR-OPN-03 | Written to the ledger | `services/ledger.ts` | `setup.test.ts` | U-80 | ✅ |
| - | Not something the admin can do | `routes/opening.ts` | `setup.test.ts` - *is not something the admin can do* | U-82 | ✅ |

## 11. Stock enquiry

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-STK-01 | Quantity and value by item and section | `routes/stock.ts` | `grn.test.ts` - *derives quantities from the ledger and values them* | U-05 | ✅ |
| FR-STK-02 | Filter and search | `routes/stock.ts` | `grn.test.ts` | U-05 | ✅ |
| FR-STK-03 | Scoped by role | `plugins/auth.ts` | `documents.test.ts` - *section boundaries* | U-38 | ✅ |
| FR-STK-04 | Below-reorder flagged | `routes/stock.ts` | `grn.test.ts` - *filters to items below their reorder point* | U-06 | ✅ |
| FR-STK-05 | Derived on read | `db/migrations` views | `ledger.test.ts` | U-05 | ✅ |

## 12. Documents and reversals

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-DOC-01 | List and view any document | `routes/documents.ts` | `documents.test.ts` | U-15 | ✅ |
| FR-DOC-02 | Management can reverse | `routes/documents.ts` `/documents/:doc/:id/reverse` | `ledger.test.ts` - *mirrors every row of a document and leaves the originals alone* | U-16 | ✅ |
| FR-DOC-03 | **Cannot reverse twice** | `services/ledger.ts` | `ledger.test.ts` - *will not reverse the same document twice* | U-16 | ✅ |
| FR-DOC-04 | Nothing editable or deletable | DB triggers | `ledger.test.ts` - *refuses an UPDATE even through the query builder*; *refuses a DELETE*; *refuses a TRUNCATE* | **U-91** | ✅ |
| FR-DOC-05 | Audit log written | `services/ledger.ts`, `audit_log` | `ledger.test.ts` | - | ✅ |
| - | Reversal refused for a role that cannot approve | `routes/documents.ts` | `documents.test.ts` - *refuses a reversal from a role that cannot approve* | U-17 | ✅ |

## 13. Administration

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-ADM-01 | Create a login | `routes/admin.ts` | `setup.test.ts` | U-100 | ✅ |
| FR-ADM-02 | Suggest a PIN | `web/pages/users.component.ts` | - | U-100 | ○ |
| FR-ADM-03 | **PIN shown once, then never** | `routes/admin.ts`, `users.component.ts` | - | **U-101** | ○ |
| FR-ADM-04 | Appears on sign-in immediately | `routes/auth.ts` `/bootstrap` | `auth.test.ts` | U-102 | ✅ |
| FR-ADM-05 | New PIN, unlock, deactivate, reactivate | `routes/admin.ts` | `setup.test.ts` | U-103 | ✅ |
| FR-ADM-06 | Never deleted, only deactivated | `routes/admin.ts` | `setup.test.ts` | U-104 | ✅ |
| FR-ADM-07 | **Last admin cannot be switched off** | `routes/admin.ts` | `setup.test.ts` | U-105 | ✅ |
| FR-ADM-08 | Role change by script only | `scripts/add-user.mjs` | - | U-106 | ○ |

## 14. Setup

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-SET-01 | Branches | `routes/setup.ts` `/setup/branches` | `setup.test.ts` | U-110 | ✅ |
| FR-SET-02 | Sections with a kind | `routes/setup.ts` `/setup/sections` | `setup.test.ts` | U-111 | ✅ |
| FR-SET-03 | Kind decides who works there | `plugins/auth.ts` `SECTION_KINDS` | `documents.test.ts` - *section boundaries* | U-111 | ✅ |
| FR-SET-04 | **A new kind cannot be invented in the UI** | `routes/setup.ts` `/setup/section-kinds` | `setup.test.ts` | U-112 | ✅ |
| FR-SET-05 | Categories with a storage type | `routes/setup.ts` `/setup/categories` | `setup.test.ts` | U-113 | ✅ |
| FR-SET-06 | Items | `routes/setup.ts` `/setup/items` | `setup.test.ts` | U-114 | ✅ |
| FR-SET-07 | Packs, several per item | `routes/setup.ts` `/setup/items/:id/packs` | `setup.test.ts` | U-115 | ✅ |
| FR-SET-08 | Suppliers (cash-market flag withdrawn) | `routes/setup.ts` `/setup/suppliers` | `setup.test.ts` | U-116 | ✅ |
| FR-SET-09 | Agreed prices with an effective date | `routes/setup.ts` `/setup/suppliers/:id/prices` | `setup.test.ts` | U-117 | ✅ |
| FR-SET-10 | Cleaning areas and tasks | Removed - `db/migrations/0006` | - | - | ⊘ |
| FR-SET-11 | Deactivate, never delete | `routes/setup.ts` | `setup.test.ts` | U-118 | ✅ |
| FR-SET-12 | Issue windows in the database only | `settings` table | - | - | By design |

## 15. Reports

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| FR-RPT-01 | Usage variance | `services/reports.ts` | `anomalies.test.ts` - *A - is flagged by theoretical vs actual usage*; *shows the step change around day 20* | U-120 | ✅ |
| FR-RPT-02 | Shrinkage | `services/reports.ts` | `anomalies.test.ts` - *B - is flagged by the shrinkage report*; *has no wastage document behind it* | U-121 | ✅ |
| FR-RPT-03 | Supplier price movement | `services/reports.ts` | `anomalies.test.ts` - *C - is flagged by supplier price movement*; *is detected at the delivery, not on the day the supplier changed the price* | U-122 | ✅ |
| FR-RPT-04 | Wastage by reason | `services/reports.ts` | `anomalies.test.ts` - *D - reads as spoilage in the wastage report*; *shows a visible spike in days 38-44* | U-123 | ✅ |
| FR-RPT-05 | Stock-outs and below reorder | `services/reports.ts` | `anomalies.test.ts` - *E - is flagged by the stock-out report* | U-124 | ✅ |
| FR-RPT-06 | **Both materiality floors** | `services/reports.ts` `DEFAULT_SHRINKAGE_FLOOR_LKR`, `_PCT` | `anomalies.test.ts` - *ignores counting noise below the materiality floor*; *shrinkage reports losses, never found stock* | U-125 | ✅ |
| FR-RPT-07 | Price threshold configurable | `services/reports.ts` | `anomalies.test.ts` - *price movement only reports genuine moves* | U-122 | ✅ |
| FR-RPT-08 | Open purchase orders | `routes/reports.ts` | `reports-ops.test.ts` | U-45 | ✅ |
| FR-RPT-09 | Service level | `services/reports-ops.ts` | `reports-ops.test.ts` | U-126 | ✅ |
| FR-RPT-10 | Supplier performance | `services/reports-ops.ts` | `reports-ops.test.ts` | U-127 | ✅ |
| FR-RPT-11 | Valuation | `services/reports-ops.ts` | `reports-ops.test.ts` | U-128 | ✅ |
| FR-RPT-12 | Dead stock | `services/reports-ops.ts` | `reports-ops.test.ts` | U-129 | ✅ |
| FR-RPT-13 | Consumption | `services/reports-ops.ts` | `reports-ops.test.ts` | U-130 | ✅ |
| FR-RPT-14 | Count accuracy | `services/reports-ops.ts` | `reports-ops.test.ts` | U-131 | ✅ |
| FR-RPT-15 | Nothing cached | All report services | `anomalies.test.ts` | - | ✅ |
| - | **Reports do not cry wolf** | `services/reports.ts` | `anomalies.test.ts` - *usage variance stays a short list, not every item in the store* | U-132 | ✅ |

## 16. Non-functional

| Req | Requirement | Implementation | Automated test | UAT | Status |
|---|---|---|---|---|---|
| NFR-INT-01 | **Ledger cannot be updated, deleted or truncated** | `db/migrations/0001_init.sql` `ledger_guard()` | `ledger.test.ts` - *refuses an UPDATE even through the query builder*; *refuses a DELETE*; *refuses a TRUNCATE* | **U-91** | ✅ |
| NFR-INT-02 | Corrections are reversals | `services/ledger.ts` | `ledger.test.ts` | U-16 | ✅ |
| NFR-INT-03 | No stored quantity | Schema - no `stock_qty` column | `ledger.test.ts` - *schema drift* | - | ✅ |
| NFR-INT-04 | One transaction per document | `services/ledger.ts` | `documents.test.ts` - *posts both legs at once* | - | ✅ |
| NFR-INT-05 | No controller writes the ledger | ESLint `no-restricted-imports` | `npm run lint` fails the build | - | ✅ |
| NFR-INT-06 | Stock never negative | `services/requests.ts` | `requests.test.ts` | U-32 | ✅ |
| NFR-INT-07 | Idempotent writes | `services/idempotency.ts` | `grn.test.ts`, `purchasing.test.ts` | U-14 | ✅ |
| NFR-INT-08 | Numeric money and quantities | Schema `numeric(14,2)` / `(14,3)` | `ledger.test.ts` - *schema drift* | - | ✅ |
| - | Business day honours `day_start` | `services/ledger.ts` | `ledger.test.ts` - *uses the location day_start, so a 24-hour site rolls over at 04:00* | - | ✅ |
| NFR-PRF-01-04 | Performance targets | - | - | U-140 | ○ |
| NFR-AVL-01-03 | Availability and alerting | Deployment | - | U-141 | ○ |
| NFR-SEC-01 | HTTPS | Caddy | - | U-142 | ○ |
| NFR-SEC-02 | bcrypt PIN hashes | `routes/admin.ts` | `auth.test.ts` | U-01 | ✅ |
| NFR-SEC-03 | PIN and auth header redaction | `api/src/app.ts` logger `redact` | - | U-143 | ○ |
| NFR-SEC-04-05 | Server-side authorisation and branch scoping | `plugins/auth.ts` | `auth.test.ts`, `documents.test.ts` | U-04 | ✅ |
| NFR-SEC-06 | Rate limiting | `@fastify/rate-limit` | `auth.test.ts` | U-02 | ✅ |
| NFR-SEC-07 | Upload limits | `@fastify/multipart` | `uploads.test.ts` | U-21 | ✅ |
| NFR-SEC-08 | SSH key only | Deployment | - | U-142 | ○ |
| NFR-SEC-09 | Schema validation at the boundary | Zod on every route | `documents.test.ts` - *still rejects genuinely malformed JSON* | - | ✅ |
| NFR-BAK-01-05 | Backup and **a tested restore** | Deployment scripts | - | **U-144** | ○ |
| NFR-USE-01-07 | Usability | Web application | - | U-145 | ○ |
| NFR-MNT-01-04 | Maintainability | `tsconfig`, migrations, codegen | `npm run typecheck`, `ledger.test.ts` - *schema drift* | - | ✅ |
| NFR-AUD-01-04 | Auditability | `audit_log`, `created_by` | `ledger.test.ts` | U-146 | ✅ |

## 17. Phase 2

| Req | Requirement | Status |
|---|---|---|
| FR-PRD-01 to FR-PRD-04 | Products, recipes, production log, theoretical vs actual | P2 - schema exists, not in Phase 1 scope |

---

## Coverage summary

| Category | Requirements | Automated | Manual (UAT) | Not yet |
|---|---|---|---|---|
| Functional (Phase 1) | [FILL: count] | [FILL] | [FILL] | [FILL] |
| Non-functional | [FILL] | [FILL] | [FILL] | [FILL] |
| **Total** | **[FILL]** | **[FILL]** | **[FILL]** | **[FILL]** |

> Complete this table at UAT handover, from the real suite. Do not estimate it.
> A coverage figure that was guessed is worse than no coverage figure.

## The four that matter most

If everything else in this matrix were lost, these four rows are the ones to
keep. Each protects a property the system's credibility depends on.

| Req | What it protects | Test |
|---|---|---|
| **NFR-INT-01** | History cannot be edited | *refuses an UPDATE / DELETE / TRUNCATE* |
| **FR-CNT-02** | A count checks the record rather than confirming it | *freezes expected at open, and a later movement does not absorb the variance* |
| **FR-WST-07** | Honest waste is never called theft | ***does NOT appear in the shrinkage report*** |
| **FR-RPT-06** | The loss report is worth opening | *ignores counting noise below the materiality floor* |
