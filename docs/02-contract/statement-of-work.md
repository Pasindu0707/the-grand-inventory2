# Statement of Work

**Annexure A to Master Services Agreement TPX-MSA-[FILL]**

| | |
|---|---|
| SOW number | TPX-SOW-[FILL: 001] |
| Project | The Grand - inventory management system, Phase 1 |
| Client | [FILL: client legal entity name], trading as The Grand Gastrobar, Negombo |
| Supplier | TriniphiX (Pvt) Ltd |
| Version | 1.1 |
| Date | [FILL] |

> This SOW is governed by the Master Services Agreement. Where they conflict,
> the MSA prevails except on matters this SOW expressly varies.

> **Varied by CR-001**, which withdraws M4 (cash market purchase) and M9
> (cleaning checklist) from scope. See
> [the change request](change-requests/CR-001-withdraw-cleaning-checklist-and-market-purchase.md).
> The cleaning **role** is unaffected and remains in M5 and M14.

---

## 1. Objective

To deliver a working inventory management system for The Grand Gastrobar,
Negombo, that reliably answers two questions: **what is in the store, and who
took it** - and to have it in daily use by the storekeeper, the kitchen, the
cleaning staff and management, with a stock history that cannot be edited after
the fact.

## 2. Scope

### 2.1 Functional scope

Delivered as the signed SRS defines it. The headings below are the scope
boundary; the SRS is the detail.

| # | Module | Included |
|---|---|---|
| M1 | **Authentication and sessions** | PIN login on a tile grid, JWT sessions with refresh, five-attempt lockout for fifteen minutes, branch context |
| M2 | **Stock ledger core** | Append-only ledger enforced by database triggers, reversal-based corrections, weighted-average cost, idempotent document posting |
| M3 | **Goods receipt (GRN)** | Receipt against supplier and optional purchase order, entry in packs, server-side conversion, price-rise warning, invoice reference, optional photo |
| M4 | ~~**Cash market purchase**~~ | **Withdrawn by CR-001.** Every purchase goes through a supplier who invoices (M3) |
| M5 | **Requests and issues** | Section requests stock, storekeeper or management releases, requester confirms arrival, partial fulfilment with shortfall, issue-window warning |
| M6 | **Wastage** | Reason code from the client's own list, optional photo, management approval, ledger written at the moment stock moves |
| M7 | **Transfers** | Section to section and branch to branch, with receipt confirmation. **API and tests only - no screen in Phase 1** |
| M8 | **Stock counts** | Blind daily counts on critical items and full counts, expected quantity frozen at open and never displayed while counting, variance after close, verification by a second person |
| M9 | ~~**Cleaning checklist**~~ | **Withdrawn by CR-001.** The cleaning role, its store and its stock requests are unaffected |
| M10 | **Purchase orders** | Raised from reorder points or from a request shortfall, approved or rejected by management only, closed by a GRN, short deliveries remain open |
| M11 | **Opening stock** | One-time opening balance per section at cutover, blocked once a section has held stock |
| M12 | **Reports** | Usage variance, shrinkage, supplier price movement, wastage by reason, stock-outs and below-reorder. Plus operational views: open purchase orders, service level, supplier performance, valuation, dead stock, consumption, count accuracy |
| M13 | **Administration** | Create and deactivate logins, reset PINs, unlock accounts, last-admin protection |
| M14 | **Setup** | Branches and sections, item categories, items and packs, suppliers and agreed prices |

### 2.2 Non-functional scope

| # | Requirement |
|---|---|
| N1 | Deployment to a cloud VPS with HTTPS and an automatically renewed certificate |
| N2 | Nightly database backup to object storage, 30-day retention |
| N3 | **A restore drill performed in the Client's presence before go-live** |
| N4 | Uptime and error alerting to a nominated mobile number |
| N5 | Automated test suite run on every change |
| N6 | Usable on a phone at the delivery door and a tablet in the store room |

### 2.3 Explicitly out of scope

Neither party should be in any doubt about these.

| # | Out of scope | Why |
|---|---|---|
| X1 | Point-of-sale integration | The Client has no POS |
| X2 | Accounting-software integration | Not requested; would be a Change Request |
| X3 | Real-time depletion per plate | Requires per-plate logging no kitchen sustains |
| X4 | Barcode scanning | Loose produce has no barcode |
| X5 | Supplier portals | - |
| X6 | Demand forecasting | - |
| X7 | Offline working | Client has elected online-only |
| X8 | Native mobile app | Runs in a browser |
| X9 | Sinhala or Tamil interface | English only in Phase 1 |
| X10 | Recipes, products and production log | Phase 2, separately priced |
| X11 | CSV import of the item master | Items are entered through the setup screens |
| X12 | Approval limits by value | Management approves every purchase regardless of value |
| X13 | Any purchase outside a supplier invoice - cash buys at the market or the pola | Withdrawn by CR-001. A PO is closed by a GRN only |
| X14 | Multi-branch rollout | Schema and setup support it; only Negombo is in Phase 1 |
| X15 | Supply of devices, tablets or network equipment | Client provides |

## 3. Deliverables

| # | Deliverable | Format | Milestone |
|---|---|---|---|
| D1 | Software Requirements Specification | Document, signed | M2 |
| D2 | UI / Screen Specification | Document, signed | M2 |
| D3 | Working system - Slices 1 to 5 | Deployed application | M3-M4 |
| D4 | Source code | Git repository, access transferred | M5 |
| D5 | Database schema, migrations and data dictionary | In repository + document | M5 |
| D6 | API documentation | Document | M5 |
| D7 | Automated test suite | In repository | M4 |
| D8 | UAT Plan and Test Scripts | Document | M4 |
| D9 | User Manual, by role | Document | M5 |
| D10 | Administrator Manual | Document | M5 |
| D11 | Deployment and Go-Live Plan | Document | M5 |
| D12 | Backup and Disaster Recovery Plan, with evidence of a successful restore | Document + evidence | M5 |
| D13 | Training delivery and attendance sheet | Sessions + signed sheet | M5 |
| D14 | Handover Note - credentials, server details, repository access | Document, signed | M5 |

## 4. Milestones and timeline

Working days. Day 1 is the first Business Day after this SOW is signed and the
mobilisation invoice is paid.

| # | Milestone | Contents | Working days | Cumulative |
|---|---|---|---|---|
| **M1** | Mobilisation | SOW signed, kick-off, environments up | 2 | 2 |
| **M2** | Requirements signed | SRS and UI specification signed. **Phase 0 store walk runs in parallel and must complete by end of M2** | 8 | 10 |
| **M3** | Core operations demonstrated | Ledger, login, GRN, stock view, requests, issues, wastage, counts | 15 | 25 |
| **M4** | Reports and UAT ready | Purchase orders, the five reports, acceptance suite, UAT scripts handed over | 12 | 37 |
| **M5** | Go-live | Deployment, backups, restore drill, cutover, data entry, training, handover | 8 | 45 |
| - | **UAT window** | Client executes the scripts; defects logged and fixed | 10 | 55 |
| - | **Acceptance** | Delivery & Acceptance Certificate signed | - | ~55 |

**Indicative duration: approximately 11 calendar weeks from signature to
acceptance**, of which the UAT window depends on the Client's availability.

### 4.1 Phase 0 is a condition of M3

Phase 0 - walking the store with the storekeeper and confirming every item, its
stock unit and every pack conversion - is the Client's responsibility with our
support. **M3 will not start until Phase 0 is signed off.** A wrong pack
conversion produces wrong numbers silently and permanently; no engineering
recovers from it.

## 5. Team

| Name | Role | Allocation |
|---|---|---|
| Pasindu Fernando | Project sponsor, architect | [FILL: %] |
| Shenal Tissera | [FILL: delivery lead] | [FILL: %] |
| Rumesh Lakshan | [FILL: engineering lead] | [FILL: %] |
| [FILL] | Engineer | [FILL: %] |
| [FILL] | Engineer / QA | [FILL: %] |

**Client team**

| Name | Role | Commitment |
|---|---|---|
| [FILL] | Decision-maker - approves deliverables and Change Requests | As required |
| [FILL] | Storekeeper - Phase 0, UAT | Half a day per day for 2 weeks, then 2 hours UAT |
| [FILL] | Kitchen representative - UAT | 2 hours |
| [FILL] | Cleaning representative - UAT | 30 min |
| [FILL] | Management / owner - reports UAT, sign-off | 3 hours |

## 6. Client dependencies

Failure to meet these engages clause 4.2 of the MSA (Client delay).

| # | Dependency | Owner | Needed by |
|---|---|---|---|
| CD1 | Named decision-maker appointed | Client | M1 |
| CD2 | Storekeeper released for Phase 0 | Client | M1 |
| CD3 | Verified item master - every item, unit and pack conversion | Client | End of M2 |
| CD4 | Supplier list with agreed prices | Client | End of M2 |
| CD5 | Wastage reason codes, in the Client's own words | Client | M3 |
| CD6 | Materiality floors - rupee value and percentage | Client | M4 |
| CD7 | Issue window times | Client | M3 |
| CD8 | Devices for each role | Client | M5 |
| CD9 | Wi-Fi in store, kitchen and bar | Client | M5 |
| CD10 | Domain name or authority to register one | Client | M5 |
| CD11 | Staff released for UAT and training | Client | UAT window |
| CD12 | Opening stock counted on cutover day | Client | Go-live |

## 7. Acceptance criteria

A milestone is accepted when the criteria below are met. Anything not listed in
the signed SRS is not an acceptance criterion - it is a Change Request.

| Milestone | Accepted when |
|---|---|
| M2 | SRS and UI specification signed by the Client's decision-maker |
| M3 | The flows in §3.3 of the Handbook can be performed end to end on the demonstration environment by TriniphiX in the Client's presence |
| M4 | Each of the five reports detects its planted fault, and the shrinkage report does **not** flag the planted spoilage. The automated suite passes in full |
| M5 | System deployed with HTTPS; a backup restored successfully in the Client's presence; all documentation delivered; training completed and the attendance sheet signed |
| Final | UAT Sign-off Certificate signed, all Severity 1 and 2 defects closed, Delivery & Acceptance Certificate signed |

**Definition of "the acceptance suite passes":** the automated tests run against
a real PostgreSQL database and every assertion passes, including the negative
assertion that documented spoilage does not appear in the unexplained-loss
report.

## 8. Defect severity

Used during UAT and during the warranty period.

| Severity | Definition | Example | Response |
|---|---|---|---|
| **S1 - Critical** | Data loss or corruption, system unusable, or a stock figure that is wrong | Ledger accepts an edit; stock goes negative | Blocks acceptance. Fixed immediately |
| **S2 - Major** | A required function does not work, no reasonable workaround | Cannot release a request | Blocks acceptance |
| **S3 - Minor** | A function works but incorrectly or awkwardly; workaround exists | Report column mislabelled | Does not block acceptance; fixed in warranty |
| **S4 - Cosmetic** | Appearance, wording, alignment | Button misaligned on one screen | Does not block acceptance; fixed if time permits |

Acceptance is not withheld for S3 or S4 defects. They are logged and fixed
during the Warranty Period.

## 9. Assumptions

1. One branch (Negombo) in Phase 1.
2. Up to [FILL: 25] user logins.
3. Up to [FILL: 150] active stock items at go-live.
4. Up to [FILL: 30] suppliers.
5. Online-only operation; the premises has working internet.
6. English interface.
7. Modern browser on Client-supplied devices.
8. UAT completed within 10 Business Days of the scripts being handed over.
9. Client review of any deliverable within 5 Business Days.
10. Hosting is [FILL: TriniphiX-managed and recharged / Client-held with access granted].

## 10. Charges

Set out in Annexure B - Payment Schedule. This SOW is **fixed price** for the
scope defined in the signed SRS.

## 11. Change control

Any change to this SOW follows Annexure C - Change Request Procedure, and takes
effect only on a signed Change Request Form.

---

## Signed

**For and on behalf of TriniphiX (Pvt) Ltd**

| | |
|---|---|
| Signature | |
| Name | Pasindu Fernando |
| Title | Chief Executive Officer |
| Date | |

**For and on behalf of [FILL: client legal entity name]**

| | |
|---|---|
| Signature | |
| Name | |
| Title | |
| Date | |
