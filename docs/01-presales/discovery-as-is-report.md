# Discovery / As-Is Process Report

**Project:** Inventory management system
**Client:** The Grand Gastrobar, Negombo
**Prepared by:** TriniphiX (Pvt) Ltd
**Version:** 1.0 · [FILL: date]
**Status:** For client review - please correct anything we have got wrong

> **Superseded in part by CR-001.** The cash market purchase and the cleaning
> checklist were later withdrawn from scope - see
> [the change request](../02-contract/change-requests/CR-001-withdraw-cleaning-checklist-and-market-purchase.md).
> This document is left as written: it records what was found, proposed and
> agreed at the time, and a record edited after the fact is no longer a record.
> The cleaning **role** was never withdrawn.

---

## 1. What we did

| Activity | Date | Who we spoke to |
|---|---|---|
| Site walk - store room, kitchen, bakery, bar, cleaning store | [FILL] | [FILL: storekeeper] |
| Observed a delivery being received | [FILL] | [FILL] |
| Observed a morning issue to the kitchen | [FILL] | [FILL] |
| Reviewed existing records (spreadsheets, delivery notes, order book) | [FILL] | [FILL] |
| Owner / management interview | [FILL] | [FILL] |
| Questionnaire returned and reviewed | [FILL] | [FILL] |

## 2. The business in one paragraph

The Grand Gastrobar is a restaurant and bar in Negombo, serving roughly
[FILL: N] covers a day. It holds stock in five physical places: a main store
room, a kitchen, a bakery, a bar, and a cleaning store. Goods arrive from
[FILL: N] regular suppliers on invoice, plus cash purchases at the fish market
and the pola for which no paperwork exists at all. The store issues to the
kitchen, bakery and bar throughout the day. There is **no point-of-sale
system**, which removes the usual way of working out what should have been
consumed.

## 3. How things work today

### 3.1 Buying

Someone notices a shelf is low - usually the storekeeper, sometimes a chef -
and tells [FILL: whom]. A call is made to the supplier. There is no written
purchase order. Nothing records that an order was placed, so nothing records
that a delivery was short.

**Consequences observed:**

- A short delivery is either noticed at the door and remembered, or not noticed
  at all. There is no open balance anywhere saying "we are still owed 20 kg".
- Nobody can answer "what have we ordered that has not arrived".
- Price is agreed verbally and, in practice, checked only when it looks wrong.

### 3.2 Receiving

Goods arrive at [FILL: location], typically [FILL: time]. [FILL: who] checks
the delivery against the supplier's invoice. The invoice is [FILL: filed where].
The stock spreadsheet is updated [FILL: when - same day, end of week, from
memory].

**Consequences observed:**

- Quantities are recorded in whatever unit is on the invoice - sacks, cases,
  kilos - and converted mentally, if at all. Conversion errors are invisible.
- A price increase from a supplier reaches the business as a larger monthly
  bill, weeks after the delivery it came in on.
- There is no record of *who* received a delivery.

### 3.3 Cash market purchases

[FILL: who] goes to the fish market and the pola [FILL: how often] with
[FILL: roughly how much] in cash. There is **no invoice and no receipt**.

**Consequences observed:**

- The only record is what the buyer says they bought and what they say it cost.
- Nothing reconciles cash taken against goods brought back.
- This is, by some distance, the least controlled part of the operation, and
  the one where a control has the highest value.

### 3.4 Issuing to the kitchen, bakery and bar

The kitchen takes what it needs from the store. In practice [FILL: describe:
the store is open all day / there is a morning issue / the chef has a key].
Nothing is written down at the point of taking.

**Consequences observed:**

- Nobody can say who took what. Stock reduces without a name against it.
- The store cannot tell the difference between "the kitchen used it" and "it
  left the building".
- Requests, shortfalls and substitutions are all verbal, so a shortfall never
  becomes a purchase.

### 3.5 Wastage

[FILL: describe - recorded in a book / not recorded / recorded sometimes].

**Consequences observed:**

- Honest, ordinary spoilage is indistinguishable from loss.
- No reason is captured, so nothing can be improved. "We waste a lot of
  lettuce" is not actionable; "we waste lettuce because we over-order on
  Mondays" is.

### 3.6 Counting

A count is performed [FILL: frequency] by [FILL: who], using [FILL: method].
The counter [FILL: does / does not] see the expected figure while counting.

**Consequences observed:**

- Where the expected figure is visible, the count confirms the system rather
  than checking it. This is the single most common way a stock count becomes
  worthless.
- Variances, where found, are [FILL: investigated / absorbed / adjusted
  silently].
- No record survives of what the variance was, so a repeat pattern on one item
  is never noticed.

### 3.7 Cleaning

[FILL: describe current cleaning schedule and record-keeping.]

### 3.8 Reporting

Management currently sees [FILL: what, how often, in what form]. Stock value is
[FILL: calculated how / not calculated].

## 4. Records that exist today

| Record | Form | Kept by | Kept how long | Reliable? |
|---|---|---|---|---|
| Supplier invoices | Paper | [FILL] | [FILL] | [FILL] |
| Stock spreadsheet | Excel | [FILL] | [FILL] | [FILL] |
| Order book | [FILL] | [FILL] | [FILL] | [FILL] |
| Wastage record | [FILL] | [FILL] | [FILL] | [FILL] |
| Cleaning checklist | [FILL] | [FILL] | [FILL] | [FILL] |
| Item list | [FILL] | [FILL] | - | [FILL] |

## 5. Findings

Numbered so they can be referred to in the proposal and the SRS.

| # | Finding | Impact | Severity |
|---|---|---|---|
| F1 | Stock movements are not recorded against a person | Loss cannot be attributed, so it cannot be stopped | **High** |
| F2 | No written purchase order | Short deliveries are invisible; nothing tracks what is owed | **High** |
| F3 | Cash market buys have no evidence at all | The least controlled spend in the business | **High** |
| F4 | Pack-to-unit conversions live in people's heads | Every figure derived from stock is potentially wrong, undetectably | **High** |
| F5 | Counts are not blind | The count confirms the record instead of checking it | **High** |
| F6 | Wastage and unexplained loss are not distinguished | Neither conversation can be had properly | Medium |
| F7 | Supplier price changes are noticed at the bank, not at the door | Overpayment continues for weeks | Medium |
| F8 | No stock valuation | Stock on hand is an unknown asset | Medium |
| F9 | Stock figures live in an editable spreadsheet | Any figure can be changed after the fact with no trace | **High** |
| F10 | No POS | Theoretical consumption cannot be derived from sales | Constraint, not a fault |
| F11 | [FILL] | [FILL] | [FILL] |

## 6. Constraints we must design around

| # | Constraint | What it means for the design |
|---|---|---|
| C1 | **No POS, and none planned** | Consumption cannot be derived from sales. Control has to come from issue-versus-count, and later from declared production. |
| C2 | Delivery door has [FILL: good / poor / no] Wi-Fi | Decides whether the system can be online-only |
| C3 | Staff literacy and comfort with devices varies | Big touch targets, few fields, no free typing where a choice will do |
| C4 | Shared devices in wet, busy rooms | PIN on a tile grid, not an email and password |
| C5 | À-la-carte cooking is not repeatable | Recipe-based control works for bakery and prep, not for every plate |
| C6 | Deliveries arrive during service | Anything that blocks the person receiving will be worked around |
| C7 | [FILL] | [FILL] |

## 7. What the client says success looks like

In their words:

> [FILL: quote the owner. This is the sentence the whole project is measured
> against, and it is worth writing down exactly as it was said.]

Restated as something testable:

1. At any moment, management can see what is in each room and what it is worth.
2. Every movement of stock has a person's name on it.
3. Unexplained loss is separated from documented waste, and both are visible.
4. A supplier price rise is visible on the day the delivery arrives.
5. Nobody can quietly change history.

## 8. Where the risk sits

**The pack conversions.** Confirming every item, its unit and its pack sizes by
physically walking the store is not software work and cannot be rushed. If it
is wrong, no amount of engineering recovers. We have scoped two weeks for it
and it is the phase we will push back hardest on if it is compressed.

**Adoption.** A system that is inconvenient at the delivery door at 6am is a
system that gets bypassed by week three. This is why we will propose that the
software *warns* rather than *blocks* in almost every case.

**Previous attempts.** [FILL: if a previous system was tried, what happened and
why. If none, say so.]

## 9. Recommended scope

Based on the above, we recommend the first release covers: goods receipt
against a purchase order, cash market purchase with mandatory photo evidence,
request-and-release of stock to sections, wastage with reasons, blind stock
counts with verification, a cleaning checklist, and five management reports.

*(Two of those - the cash market purchase and the cleaning checklist - were
built and then withdrawn under CR-001. Finding F3, that cash buys have no
evidence at all, was answered instead by moving every purchase onto a supplier
invoice.)*
Recipes and production-based consumption follow in a second phase, once the
first is trusted.

The detail and the price are in the Proposal.

## 10. Open questions

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | The two materiality floors - rupee value and percentage - below which a discrepancy is not worth reporting | Client | Before reports are built |
| Q2 | Issue window times, if any | Client | Before issue screen is built |
| Q3 | Whether management may create suppliers and items, or admin only | Client | Before go-live |
| Q4 | Approval threshold for purchases, if any | Client | Phase 3 |
| Q5 | [FILL] | | |

---

## Confirmation

This report records what we observed and what we were told. If anything here is
wrong, it will be wrong in the system too.

**Reviewed and confirmed as an accurate description of current practice:**

| | |
|---|---|
| Name | [FILL] |
| Title | [FILL] |
| Signature | |
| Date | |
