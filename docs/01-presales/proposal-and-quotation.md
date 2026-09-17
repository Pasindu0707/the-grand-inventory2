# Proposal & Quotation

**To:** [FILL: client contact name, title], The Grand Gastrobar, Negombo
**From:** Pasindu Fernando, Chief Executive Officer, TriniphiX (Pvt) Ltd
**Date:** [FILL] · **Valid until:** [FILL: date + 30 days]
**Reference:** TPX-[FILL: 2026-001]

> **Superseded in part by CR-001.** The cash market purchase and the cleaning
> checklist were later withdrawn from scope - see
> [the change request](../02-contract/change-requests/CR-001-withdraw-cleaning-checklist-and-market-purchase.md).
> This document is left as written: it records what was found, proposed and
> agreed at the time, and a record edited after the fact is no longer a record.
> The cleaning **role** was never withdrawn.

> **All figures below are marked `[FILL]`. Insert your own numbers before
> issuing.** The structure - what is billed when, and against what - is the
> part worth keeping.

---

## 1. What you asked for

A system that answers two questions reliably: **what is in the store, and who
took it.** Behind that sit the specific problems we recorded during discovery -
stock movements with no name against them, cash market buys with no evidence,
counts that confirm the record instead of checking it, and a stock figure that
lives in a spreadsheet anyone can edit.

Our Discovery Report sets those out as findings F1-F10. This proposal responds
to them.

## 2. What we propose

A web-based inventory system, used on phones and tablets, running on a server
we manage. No point-of-sale integration, because you have no POS and are not
buying one.

The design rests on one idea: **every movement of stock is a row in a ledger
that can never be edited or deleted.** Corrections are reversals that sit
beside the original. Stock levels are not stored anywhere - they are
recalculated from the ledger every time you look. That means there is no cached
number that can quietly drift away from the movements behind it, and no way for
anyone, including us, to change history after the fact.

That single decision is what makes the reports worth reading.

### In scope - Phase 1

| # | Capability | Answers finding |
|---|---|---|
| 1 | **Goods receipt (GRN)** against a supplier and, where there is one, a purchase order. Quantities entered in packs; the system converts. Price rises warned inline. | F2, F4, F7 |
| 2 | **Cash market purchase** with a mandatory photograph - the only evidence that exists for those buys - and cash-given versus lines-total reconciliation. | F3 |
| 3 | **Request and release.** A section asks the store for stock; the storekeeper or management releases it. Both halves are recorded with names. | F1 |
| 4 | **Wastage** with a reason code from your own list, and management approval. | F6 |
| 5 | **Stock transfers** between rooms and, later, between sites. | F1 |
| 6 | **Blind stock counts** - daily on your critical items, full counts weekly or monthly. The expected figure is never shown while counting. Variance appears only after the count closes, and a second person verifies. | F5 |
| 7 | **Cleaning checklist** by area and task, with verification. | - |
| 8 | **Purchase orders** raised from the store's own reorder points, approved by management, and closed by the delivery against them so a short delivery stays open. | F2 |
| 9 | **Opening stock** entry per room, once, at cutover. | - |
| 10 | **Five management reports** - usage variance, shrinkage, supplier price movement, wastage by reason, and stock-outs. | F6, F7, F8 |
| 11 | **Login management** - the admin adds and removes people, resets PINs and unlocks accounts, in the app. | F1 |
| 12 | **Setup screens** - branches, rooms, categories, items and their packs, suppliers and agreed prices, cleaning tasks. You build the system yourself from an empty database. | F4 |
| 13 | **Deployment** on a server, with HTTPS, nightly backups and a restore we perform in front of you. | F9 |
| 14 | **Training and manuals** for each role. | - |

### In scope - Phase 2 (optional, priced separately)

Products, recipes, a daily production log, and theoretical-versus-actual
consumption. This is what turns "the kitchen took 5 kg of chicken" into "the
kitchen should have used 4.2 kg for what it produced". It works well for bakery
and prepped items and poorly for à la carte, and we would rather say that now
than discover it together later.

### Not in scope

Each of these gets requested on projects like this, and each of them, taken on
too early, is what stops the system being adopted:

- Real-time depletion per plate
- Barcode scanning on vegetables
- Supplier portals
- Demand forecasting
- Offline working (you have chosen online-only)
- POS integration
- Accounting-software integration

Any of them can be added later under a Change Request, priced on its own merits.

## 3. How we will run it

| Phase | What happens | Who does the work | Duration |
|---|---|---|---|
| **Phase 0** | Walk the store. Confirm every item, unit and pack conversion. Agree par levels and reorder points. | Your storekeeper, with us | 2 weeks |
| **Requirements** | SRS written and signed | Us, reviewed by you | 1 week |
| **Slice 1** | Ledger core, PIN login, goods receipt, stock view | Us | 1 week |
| **Slice 2** | Requests, issues, wastage, transfers, counts | Us | 1 week |
| **Slice 3** | Cash market purchase, photo upload, cleaning | Us | 3-4 days |
| **Slice 4** | The five reports, tested against planted faults | Us | 1 week |
| **Slice 5** | Roles, deployment, backup and a restore drill | Us | 4-5 days |
| **UAT** | Your staff execute our test scripts; we fix what they find | You, with us | 1 week |
| **Go-live** | Cutover, data entry, training | Both | 2-3 days |
| **Warranty** | Defects fixed free | Us | 90 days |

**Total: approximately [FILL: 8] weeks from signature to go-live**, of which
Phase 0 runs in parallel and is your team's time, not ours.

### Phase 0 is not optional

Two weeks walking the store with the storekeeper, confirming that a sack is
really 50 kg and not 25, is the phase that decides whether anyone trusts this
system. It is also the phase clients most want to shorten. We will not shorten
it. No amount of software recovers from a wrong pack conversion - it produces
wrong numbers silently, forever, and by the time anyone notices, six months of
history is unusable.

## 4. How we will prove it works

We do not ask you to take our word for it.

Before you see the system, we load it with sixty days of realistic data
containing **five deliberate faults**: an item quietly over-issued, two bottles
of gin that vanish with no document, a supplier price rise of 32% buried in a
routine delivery, a genuine spoilage spike, and an item that runs out
mid-service. Each fault maps to one report. If a report cannot find its own
fault, the report is wrong and we fix it before you ever open it.

One of those five is a test that a report must **stay silent**. The lettuce
spoilage is honest, documented waste, and it must appear in the wastage report
and must *never* appear in the unexplained-loss report. That check caught a real
defect during our build: without a materiality floor, the loss report was
listing 44 cents of lettuce, and a money floor alone still let ordinary counting
noise on expensive gin bury the two real bottles.

That failure mode - a report that accuses people of theft over a crate of
lettuce - is the one that gets systems abandoned, and it is the one nobody
writes a test for.

## 5. What we need from you

Delivery depends on these as much as on our work.

| # | We need | From whom | By when |
|---|---|---|---|
| 1 | A single decision-maker who can approve a change and its cost | You | At signature |
| 2 | The storekeeper's time - roughly half a day a day for two weeks | Storekeeper | Phase 0 |
| 3 | Your complete item list, with pack sizes physically verified | Storekeeper | End of Phase 0 |
| 4 | Your supplier list with agreed prices | [FILL] | End of Phase 0 |
| 5 | Your wastage reason list, in your own words | Kitchen | Before Slice 2 |
| 6 | The two materiality floors - rupee and percentage | Owner | Before Slice 4 |
| 7 | Staff availability for UAT - roughly 2 hours each | All roles | UAT week |
| 8 | Working Wi-Fi in the store, kitchen and bar | You | Before go-live |
| 9 | Devices: [FILL: N] tablets / phones | You | Before training |
| 10 | A domain name, or authority to register one | You | Before deployment |

If any of these slip, the timeline slips with them. We will say so in the weekly
status report rather than at the end.

## 6. Quotation

All amounts in Sri Lankan Rupees, exclusive of taxes.

### 6.1 Phase 1 - the system

| # | Item | Amount (LKR) |
|---|---|---|
| 1 | Discovery and requirements (SRS) | [FILL] |
| 2 | Ledger core, authentication, goods receipt, stock view | [FILL] |
| 3 | Requests, issues, wastage, transfers, stock counts | [FILL] |
| 4 | Cash market purchase, photo upload, cleaning module | [FILL] |
| 5 | The five reports and the acceptance test suite | [FILL] |
| 6 | Purchase orders and approvals | [FILL] |
| 7 | Setup and administration screens | [FILL] |
| 8 | Deployment, HTTPS, backups and restore drill | [FILL] |
| 9 | UAT support, training and manuals | [FILL] |
| | **Phase 1 total** | **[FILL]** |

### 6.2 Phase 2 - recipes and production (optional)

| # | Item | Amount (LKR) |
|---|---|---|
| 1 | Products, recipes, production log, theoretical vs actual | [FILL] |
| | **Phase 2 total** | **[FILL]** |

### 6.3 Recurring

| # | Item | Amount (LKR) | Frequency |
|---|---|---|---|
| 1 | Server hosting, backups and monitoring | [FILL] | Monthly |
| 2 | Domain name | [FILL] | Annual |
| 3 | Annual Maintenance Contract - begins when the 90-day warranty ends | [FILL] | Annual |

Hosting is billed at cost plus [FILL: %]. If you would rather hold the hosting
account yourself and give us access, we will do that instead and the line
disappears.

### 6.4 Excluded from all figures

- Devices - tablets, phones, chargers, mounts
- Wi-Fi installation or improvement at the premises
- Taxes, which are added at the prevailing rate
- Data entry of your item master, unless separately quoted below
- Any item listed under "Not in scope"

**Optional: we type in your item master for you** - [FILL] for up to
[FILL: 150] items. There is currently no CSV import, so this is otherwise a
long day of your storekeeper's time.

## 7. Payment schedule

| # | Milestone | Trigger | % | Amount (LKR) |
|---|---|---|---|---|
| 1 | Mobilisation | Signature of MSA and SOW | 30% | [FILL] |
| 2 | SRS sign-off | Client signs the SRS | 15% | [FILL] |
| 3 | Slice 2 demonstrated | Requests, issues, wastage and counts working | 20% | [FILL] |
| 4 | UAT sign-off | UAT Sign-off Certificate signed | 20% | [FILL] |
| 5 | Acceptance | Delivery & Acceptance Certificate signed | 15% | [FILL] |

Invoices are payable within **[FILL: 14] days**. Full detail, including the
consequences of late payment and of client-caused delay, is in the Payment
Schedule annexed to the Master Services Agreement.

## 8. What is fixed and what is not

**Fixed:** the price, for the scope in section 2 as detailed in the signed SRS.

**Not fixed:** anything added after the SRS is signed. Those go through a
Change Request Form, each with its own cost and time impact, each signed before
we start. We do this not to be difficult but because it is the only thing that
reliably stops a five-week project becoming a five-month one - and the cost of
that lands on both of us.

## 9. Assumptions

1. One site (Negombo) in Phase 1. Additional sites are a separate quotation,
   though the system is built to take them.
2. Up to [FILL: 25] user logins.
3. Up to [FILL: 150] stock items at go-live.
4. Online-only. A dropped connection during a count loses that count.
5. English interface. Sinhala labels would be a change request.
6. The client provides devices and premises Wi-Fi.
7. UAT is completed within [FILL: 10] business days of our handing over the test
   scripts.
8. Client feedback on any deliverable arrives within [FILL: 5] business days.

## 10. Why us

We are five people, and the person writing this proposal is the person who will
write your architecture and answer your phone in year two. There is no account
manager between you and the work.

What we are actually good at is the part of this that is not software: deciding
that counts must be blind, that spoilage and theft are different conversations,
that a report needs a floor in both money and proportion, and that a system
which blocks the storekeeper at 6am is a system that gets bypassed. Those
decisions are why this will still be in use in year two.

## 11. Next steps

1. You review this proposal and the Discovery Report and tell us what is wrong.
2. We agree the scope and the price.
3. We sign the Master Services Agreement and the Statement of Work.
4. Phase 0 begins the following Monday.

---

## Acknowledgement

Signing below acknowledges receipt and acceptance of this proposal as the basis
for the Statement of Work. It is not itself a contract for the supply of
services; that is the Master Services Agreement.

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
| Name | Pasindu Fernando |
| Title | Chief Executive Officer |
| Signature | |
| Date | |
