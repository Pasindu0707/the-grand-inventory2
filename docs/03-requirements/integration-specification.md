# Integration Specification

**Project:** The Grand - inventory management system
**Version:** 1.0 · [FILL: date]

---

## 1. Summary

**There are no integrations in Phase 1.** The system is standalone.

This document exists anyway, for three reasons: to record that the decision was
made rather than overlooked; to say what each integration would involve if it
is asked for later; and to record the interfaces that already exist and could
be built against.

## 2. Integrations considered and declined

| # | System | Decision | Reason |
|---|---|---|---|
| I1 | Point of sale | **Not applicable** | The Client has no POS and is not buying one |
| I2 | Accounting software | **Deferred** | Not requested. See §4.1 |
| I3 | Supplier ordering portals | **Declined** | Suppliers here take orders by phone. A portal integration would serve one supplier and be maintained forever |
| I4 | Barcode scanners | **Declined** | Loose produce has no barcode. A scanning workflow that works for a third of the store gets abandoned, and takes the stock figure down with it |
| I5 | Label printers | **Deferred** | Not requested |
| I6 | Payroll / HR | **Declined** | No overlap beyond staff names |
| I7 | Email / SMS notification | **Deferred** | See §4.2 |
| I8 | Accounting e-invoicing | **Not applicable** | [FILL: confirm the Client's obligations, if any] |

## 3. What the system does talk to

Not integrations in the business sense, but external dependencies worth
recording.

| # | Service | Purpose | Direction | Failure behaviour |
|---|---|---|---|---|
| E1 | [FILL: VPS provider] | Hosting | - | System unavailable |
| E2 | [FILL: object storage] | Nightly backups | Outbound, nightly | **Backup fails; an alert is raised.** The system keeps running |
| E3 | Let's Encrypt | TLS certificates | Outbound, automatic | Certificate expiry after 90 days; alerted well before |
| E4 | [FILL: alerting provider] | Uptime and error alerts | Outbound | Alerts stop arriving. Monitored by a heartbeat |

None of these carry business data except E2, which carries all of it, and is
covered by the Data Processing Agreement.

## 4. If an integration is asked for later

Each of these is a Change Request. What follows is enough to estimate one.

### 4.1 Accounting software

**The likely ask:** "push purchases into the accounts so they don't get typed
twice."

**What exists to build on.** Every delivery is already a document with a
supplier, a date, lines, an invoice number and a total - and since CR-001 that
is the only way stock is bought, so there is exactly one shape to export. A
nightly export or a webhook per document is straightforward.

**What makes it harder than it looks:**

- Account codes. The accounting system needs a general-ledger code per item
  category. That mapping does not exist and someone has to own it.
- Reversals. This system corrects by reversal, and most accounting systems
  expect either a credit note or an edit. The mapping must be agreed.
- Tax. Which purchases carry VAT, and at what rate, is currently not recorded
  per line.
- Direction. One-way push is a week's work. Two-way is a different project.

**Recommendation if asked:** a one-way, nightly CSV export of purchases in the
accountant's own import format. It solves 90% of the double-typing for 10% of
the cost of an API integration, and it does not break when the accounting
software updates.

### 4.2 Notifications

**The likely ask:** "tell the manager on WhatsApp when something runs out."

**What exists.** Below-reorder and stock-out data is already computed
(FR-RPT-05). A scheduled job and a message provider is a small piece of work.

**What makes it harder than it looks:** deciding what is worth a message. A
notification that fires forty times a day is muted within a week, and once it
is muted the one that mattered is muted too. This needs the same materiality
thinking the shrinkage report needed (SRS P10), and that conversation is most
of the cost.

### 4.3 Point of sale, if one is ever bought

**What it would change.** Theoretical consumption could come from actual sales
rather than declared production, which is a materially better control for à la
carte items - the weak spot named in SRS FR-PRD-04.

**What it would need:** a product-to-recipe mapping (Phase 2 already models
this), and a sales feed with product, quantity, timestamp and branch.

**Effort:** Phase 2 must exist first. Given Phase 2, a POS feed is roughly
[FILL: 2 weeks] plus whatever the POS vendor's API costs in pain.

## 5. The interfaces that already exist

Anyone building an integration later starts from these.

### 5.1 The HTTP API

Every function in the system is exposed as a documented HTTP API under
`/api/v1`, authenticated with a bearer token, with request and response schemas
validated at the boundary. It is the same API the web application uses - there
is no private back door, so anything the app can do, an integration can do.

See the [API Documentation](../04-technical/api-documentation.md).

### 5.2 Direct database read access

The database can be given a read-only role for reporting tools. Two views are
the obvious entry points:

| View | Contents |
|---|---|
| `current_stock` | Quantity on hand per item and section |
| `current_stock_valued` | The same, valued at current average cost |

**A read-only role is the only safe way to do this.** Write access from outside
the application bypasses the service layer that maintains average cost and the
audit log - the ledger triggers would still refuse an edit, but a badly formed
insert would corrupt the position silently.

### 5.3 Data export

A complete export in PostgreSQL dump format plus CSV extracts is available on
request under the Software Licence Agreement, clause 7.3.

## 6. Constraints on any future integration

Non-negotiable, because each one protects a property the system's credibility
rests on.

| # | Constraint |
|---|---|
| C1 | **No integration may write to the stock ledger directly.** It goes through the documented API, like everything else. The database will refuse it anyway |
| C2 | **No integration may update or delete history.** Corrections are reversals |
| C3 | Every integration authenticates as a named service user, so its actions have a name against them like everyone else's |
| C4 | An integration that fails must fail loudly. Silent partial success in a stock system is worse than an outage |
| C5 | Inbound data is validated at the API boundary on the same terms as a human's input |

---

## Sign-off

**The Client confirms that no integrations are in scope for Phase 1.**

**For [FILL: client legal entity name]**

| | |
|---|---|
| Name | |
| Signature | |
| Date | |
