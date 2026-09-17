# Change Request Form

**Project:** The Grand - inventory management system
**Under:** MSA TPX-MSA-[FILL] · SOW TPX-SOW-[FILL] · Change Request Procedure (Annexure C)

| | |
|---|---|
| **CR number** | CR-001 |
| **Title** | Withdraw the cleaning checklist and the cash market purchase |
| **Raised by** | [FILL: name], The Grand Gastrobar |
| **Date raised** | [FILL] |
| **Priority** | ☐ Urgent ☐ High ☒ Medium ☐ Low |
| **Status** | ☐ Raised ☐ Assessing ☐ Awaiting decision ☒ Approved ☐ Rejected ☐ Deferred ☐ Complete |

---

## Part A - The request

*Completed by whoever is raising the change.*

### A1. What is the business problem?

Two features in the signed scope do not match how the restaurant works.

**The cleaning checklist.** Cleaning is not run off a system here. The tasks,
the areas and the daily tick-list were built and are not being filled in. A
checklist nobody completes is worse than no checklist: the Today screen shows a
panel that is permanently incomplete, and people learn to read past it - which
costs them the panels that do mean something.

**The cash market purchase.** Every purchase at The Grand goes through a
supplier who invoices. There is no buying at the fish market or the pola for
cash, so the document has no occasion to exist. Keeping it means a second,
looser way of putting stock into the ledger, a second place a price can come
from, and a second thing to reconcile at month end.

### A2. Who has this problem, and how often?

The cleaning checklist: the cleaning login, daily, and the manager who is meant
to verify it. Neither uses it.

The market purchase: the storekeeper, whenever a delivery arrives. Two ways to
book in the same goods is a decision they should not have to make.

### A3. What happens today, and what does it cost?

The checklist sits unticked. The market screen is not used, but it is on the
menu, and the fish and vegetable suppliers were set up as "cash market" so they
cannot be received against an invoice in the ordinary way.

### A4. What would good look like?

Both screens gone. One way for stock to arrive - a delivery against a supplier
invoice, optionally closing a purchase order.

The **cleaning role stays**, and so does the cleaning store. Cleaning staff
still sign in, still ask the store for detergent, and still hold it in a section
of their own. That was never the checklist; it is ordinary stock movement that
happens to be soap.

### A5. Is there a deadline, and what drives it?

Before go-live. Every screen removed now is a screen not taught in training and
not written into the manual.

### A6. What happens if this is not done?

Staff are trained on two screens they will not use, and the store room tablet
offers a way of receiving goods that bypasses the invoice.

---

## Part B - Assessment

*Completed by TriniphiX. Target: 5 Business Days from acknowledgement.*

| | |
|---|---|
| Assessed by | [FILL] |
| Date assessed | [FILL] |

### B1. Classification

☒ **Change** - not in the signed SRS. Chargeable.
☐ **Defect** - the system does not do what the signed SRS says. **Fixed free.**
☐ **Configuration** - the Client can do this themselves. See B2.
☐ **Clarification** - the SRS is ambiguous; interpretation agreed, no charge.

A **descope**: both features are in the signed SRS and are being withdrawn from
it. Classified as a Change because it varies signed scope, not because it adds
work.

**Reference in the signed SRS:** the cleaning module and the market purchase
requirements. See the traceability matrix for the affected requirement IDs.

### B2. If configuration, how

```
Not configuration. The screens, the API endpoints and the tables all exist and
have to be removed deliberately.
```

### B3. Proposed solution

```
Remove the cleaning checklist (areas, tasks, daily log) and the cash market
purchase from the database, the API and both web front ends.

Keep: the cleaning role, the CLEAN section kind, and the cleaning store's stock.
Keep: photo upload, which wastage and short deliveries still use.

The two suppliers set up as cash-market - the fish market and the vegetable
pola - become ordinary suppliers who deliver against an invoice. The
`is_cash_market` flag on the supplier record goes with the feature: with the
market screen gone, nothing reads it, and a tick box that changes nothing is a
question every new administrator asks exactly once.
```

### B4. Options considered

| Option | Description | Effort (days) | Cost (LKR) | Recommendation |
|---|---|---|---|---|
| 1 | Hide both from the menu, leave the code and tables in place | 0.5 | [FILL] | No - the endpoints stay reachable and the next person has to work out whether they are live |
| 2 | Remove from the front ends and the API, leave the tables | 1 | [FILL] | No - leaves empty tables that read as a feature somebody forgot to finish |
| 3 | Remove from front end, API and database | [FILL] | [FILL] | **Recommended** |
| 4 | Do nothing | 0 | 0 | No - see A6 |

### B5. Effort

| Role | Days | Rate (LKR/day) | Amount (LKR) |
|---|---|---|---|
| Architect / technical lead | [FILL] | [FILL] | |
| Senior engineer | [FILL] | [FILL] | |
| Engineer | [FILL] | [FILL] | |
| QA / test | [FILL] | [FILL] | |
| Documentation / training | [FILL] | [FILL] | |
| **Total** | | | **[FILL]** |

### B6. What this touches

| Area | Affected? | Notes |
|---|---|---|
| Database schema / migration | ☒ | `0006_drop_cleaning_tasks_and_market.sql` drops `cleaning_areas`, `cleaning_tasks`, `cleaning_log`, `market_purchase`, `market_purchase_lines`, the `cleaning_frequency` type and `suppliers.is_cash_market` |
| Stock ledger or its rules | ☒ | `'market'` **stays** a member of the `doc_type` enum. Removing an enum value means rewriting `stock_ledger.doc`, and ledger rows cannot be deleted. Nothing can write a new one - the service is gone |
| API endpoints | ☒ | `POST/GET /market`, all `/cleaning/*`, `/setup/cleaning*` removed. `POST /uploads` retained |
| Screens | ☒ | Market purchase, Cleaning, Setup → Cleaning tasks removed from both front ends; Today's checklist tile and the cash-market tick on Setup → Suppliers with them |
| Reports | ☐ | No report read either feature |
| Roles and permissions | ☒ | Route permission tables lose three keys. **The five roles are unchanged** - `cleaning` remains |
| Existing data - does it need migrating? | ☒ | Demo data regenerated. On a system that has recorded real cash purchases, the ledger rows survive by design and stay readable; the source documents do not |
| Automated tests | ☒ | `market-cleaning.test.ts` retired, its uploads block kept as `uploads.test.ts`; schema and setup tests updated. 101 tests pass |
| User Manual | ☒ | |
| Administrator Manual | ☒ | |
| Training | ☒ | Two fewer screens to teach |
| UAT scripts | ☒ | The scripts covering both features are withdrawn |

### B7. Timeline impact

| | |
|---|---|
| Can it be done within the current milestone? | ☒ Yes ☐ No |
| Delay to the current milestone | 0 Business Days |
| Delay to final acceptance | 0 Business Days |
| Revised acceptance date | Unchanged |

### B8. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | The client later wants cash buys back after all | Low | Medium | The migration and this CR record exactly what was removed; the ledger keeps any history |
| 2 | Someone reads the withdrawal of the cleaning checklist as the withdrawal of the cleaning **role** | Medium | High | Stated in A4, B3 and B6; the role, the section kind and the supply requests are explicitly retained and still tested |
| 3 | The fish and vegetable suppliers have no agreed prices, having previously been cash | Medium | Medium | Enter their prices under Setup → Suppliers before the first delivery, or the first surprise price looks like the normal price |

### B9. Does this weaken a core design property?

| Property | Weakened? | If yes, explain |
|---|---|---|
| The ledger is append-only and enforced by the database | ☐ | Untouched. Verified by `npm run db:verify` after the change |
| Stock is derived from the ledger, never stored | ☐ | |
| Controllers never write the ledger directly | ☐ | One fewer document service; the ESLint rule still holds |
| Counts are blind, and expected is frozen at open | ☐ | |
| Documented waste is excluded from the loss report | ☐ | |
| The system warns rather than blocks | ☐ | |
| Separation of duties - no self-approval | ☐ | The self-verification rule for cleaning goes with the checklist; counts, releases and confirmations are unchanged |
| Everything is stored in the small unit; packs convert once | ☐ | **Strengthened.** The market purchase was the one document entered in stock units rather than packs |

> No box ticked. This change removes a second way into the ledger rather than
> opening one.

### B10. Assessment charge

☒ No charge - within the free assessment allowance
☐ Charged: [FILL] LKR - notified to the Client on [FILL: date] before assessment began

---

## Part C - Decision and authorisation

*Completed by the Client's nominated decision-maker.*

| | |
|---|---|
| Decision | ☒ **Approved** ☐ **Rejected** ☐ **Deferred to** [FILL] |
| Option selected (from B4) | Option 3 - remove from front end, API and database |
| Agreed cost | **LKR [FILL]** (exclusive of tax) |
| Agreed timeline impact | **0 Business Days** |
| Revised acceptance date | Unchanged |
| Invoicing | ☐ With next milestone ☐ On completion ☒ [FILL] |

**If rejected or deferred, the reason:**

```
Not applicable - approved.
```

### Authorisation

By signing, both parties agree that this change is added to the scope of SOW
TPX-SOW-[FILL], that the contract price is varied by the amount above, and that
the dates in the milestone plan move as stated. This form takes precedence over
the SOW and the SRS to the extent of the change.

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
| Title | |
| Signature | |
| Date | |

---

## Part D - Completion

*Completed by TriniphiX when the change is delivered.*

| | |
|---|---|
| Delivered on | [FILL] |
| Actual effort | [FILL] days against [FILL] estimated |
| SRS updated to version | [FILL] |
| Tests added | None added; `market-cleaning.test.ts` retired and its uploads coverage kept as `uploads.test.ts`. 101 tests pass |
| Manuals updated | ☒ User ☒ Administrator ☐ Not required |
| UAT scripts updated | ☒ Yes ☐ Not required |
| Accepted by | [FILL] on [FILL] |

**Variance note:**

```
[FILL]
```
