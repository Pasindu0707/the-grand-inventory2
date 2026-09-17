# Software Requirements Specification

**The Grand - inventory management system**

| | |
|---|---|
| Document | SRS |
| Version | 1.9 |
| Date | [FILL] |
| Prepared by | TriniphiX (Pvt) Ltd |
| Client | [FILL: client legal entity name], trading as The Grand Gastrobar, Negombo |
| Status | **For sign-off** |
| Governs | SOW TPX-SOW-[FILL] under MSA TPX-MSA-[FILL] |
| Amended by | **CR-001** - withdraws the cleaning checklist and the cash market purchase. See [the change request](../02-contract/change-requests/CR-001-withdraw-cleaning-checklist-and-market-purchase.md) |
| | **CR-002** - cleaning may count its own store and log wastage in it. See [the change request](../02-contract/change-requests/CR-002-cleaning-may-count-and-log-wastage.md) |
| | **CR-003** - returns: a section hands stock back, the store hands it to the vendor. See [the change request](../02-contract/change-requests/CR-003-returns-to-store-and-supplier.md) |
| | **CR-003a** - a section return is measured against the release that delivered the stock, and is raised from Requests. Recorded in CR-003 Part D |
| | **CR-004** - one kitchen: the Bar and Bakery section kinds are retired. See [the change request](../02-contract/change-requests/CR-004-one-kitchen-no-bar-or-bakery-sections.md) |
| | **CR-005** - management approves; the store handles stock. See [the change request](../02-contract/change-requests/CR-005-management-approves-the-store-handles-stock.md) |
| | **CR-006** - one decision about bad stock: back to the supplier, or in the bin. See [the change request](../02-contract/change-requests/CR-006-one-decision-about-bad-stock.md) |

> **This is the document the project is measured against.** Once signed, it is
> the definition of "done". A behaviour described here and not delivered is a
> Defect, fixed free. A behaviour not described here is a Change Request, with
> its own cost and time. Read it properly before signing - that is time much
> better spent than the same hours spent arguing in week seven.

---

## Table of contents

1. [Introduction](#1-introduction)
2. [Overall description](#2-overall-description)
3. [Design principles](#3-design-principles-the-rules-everything-else-follows)
4. [Roles and permissions](#4-roles-and-permissions)
5. [Functional requirements](#5-functional-requirements)
6. [Reports](#6-reports)
7. [Non-functional requirements](#7-non-functional-requirements)
8. [Data requirements](#8-data-requirements)
9. [Constraints and assumptions](#9-constraints-and-assumptions)
10. [Out of scope](#10-out-of-scope)
11. [Acceptance criteria](#11-acceptance-criteria)
12. [Glossary](#12-glossary)
13. [Sign-off](#13-sign-off)

---

## 1. Introduction

### 1.1 Purpose

This document specifies the requirements for an inventory management system for
The Grand Gastrobar, Negombo. It is written for two audiences at once: the
Client's decision-maker, who must be able to read it and recognise their own
business; and TriniphiX's engineers, who must be able to build from it without
guessing.

Where those two purposes conflict, plain English wins and the technical detail
moves to the design documents.

### 1.2 Scope

The system covers the receipt, movement, consumption, loss and counting of
stock across the five rooms of a single restaurant site, together with the
purchasing that feeds it and the reports that make sense of it.

It does **not** cover sales, because there is no point-of-sale system, and does
not cover accounting.

### 1.3 The problem, in one sentence

The business cannot reliably answer two questions - **what is in the store, and
who took it** - and every other requirement in this document exists to serve
one of those two.

### 1.4 Definitions

See the [Glossary](#12-glossary). Two terms are worth stating up front because
they are used throughout:

- **Stock unit** - the smallest unit an item is measured in: grams,
  millilitres, or each. Everything is stored in stock units.
- **Pack** - how an item arrives: a 50 kg sack, a case of twelve, a 20 litre
  can. Users always enter packs; the system converts.

### 1.5 References

| Document | Relevance |
|---|---|
| Discovery / As-Is Process Report v1.0 | Findings F1-F10, which this document answers |
| SOW TPX-SOW-[FILL] | Scope boundary and milestones |
| UI / Screen Specification v1.0 | Screen-level detail, signed alongside this |
| Change Request Procedure | How this document is amended |

### 1.6 How requirements are numbered

`FR-<module>-<nn>` for functional, `NFR-<category>-<nn>` for non-functional.
Numbers are stable: a requirement that is removed leaves its number retired
rather than reused, so a reference in a test or a defect log never becomes
ambiguous.

Each requirement is marked:

| Mark | Meaning |
|---|---|
| **M** | Mandatory - must be delivered for acceptance |
| **S** | Should - delivered unless it forces a trade-off, in which case it is discussed |
| **P2** | Phase 2 - specified here for context, not in Phase 1 scope |

---

## 2. Overall description

### 2.1 Product perspective

A web application used in a browser on phones and tablets, backed by an HTTP
API and a PostgreSQL database, deployed on a single cloud server. It is a
standalone system. It does not integrate with any other software.

```
   Phone / tablet / laptop          Cloud VPS
  ┌─────────────────────┐      ┌──────────────────────────┐
  │  Web application    │─────▶│  Reverse proxy (HTTPS)   │
  │  (browser)          │      │            │              │
  └─────────────────────┘      │            ▼              │
                               │      API service          │
                               │            │              │
                               │            ▼              │
                               │      PostgreSQL           │
                               │   ┌──────────────────┐    │
                               │   │  stock_ledger    │    │
                               │   │  append-only     │    │
                               │   └──────────────────┘    │
                               └───────────┬──────────────┘
                                           ▼
                                  Nightly backup to
                                   object storage
```

### 2.2 Product functions

| # | Function |
|---|---|
| 1 | Receive goods from a supplier, against an invoice and optionally a purchase order |
| 2 | Let a room ask the store for stock, and let the store release it |
| 3 | Record wastage with a reason |
| 3a | Return unfit stock to the store, and on to the supplier who delivered it |
| 4 | Move stock between rooms and between sites |
| 5 | Count stock blind, and show the variance afterwards |
| 6 | Raise and approve purchase orders |
| 7 | Report on usage, loss, prices, waste and stock-outs |
| 8 | Manage logins, items, suppliers and rooms |

### 2.3 Users

| Class | Number | Device | Technical skill | Frequency |
|---|---|---|---|---|
| Storekeeper | 1-3 | Phone at the delivery door, tablet in the store | Low | All day |
| Kitchen (chefs, bakers, bar) | 5-10 | Shared tablet | Low | Several times a day |
| Cleaning | 2-4 | Shared tablet | Low-none | Once or twice a day |
| Management / owner | 2-3 | Tablet, laptop | Moderate | Daily to weekly |
| Admin | 1 | Laptop | Moderate | Rarely |

**This table drives the interface design.** Most users have low technical
skill, are holding a device in a wet or busy room, and are being interrupted.
That is why authentication is a four-digit PIN on a tile grid rather than an
email and a password, why the counting screen shows one item at a time with
large targets, and why almost nothing in the system blocks.

### 2.4 Operating environment

| | |
|---|---|
| Client | Modern browser - Chrome, Safari, Edge - on Android, iOS, Windows |
| Network | Premises Wi-Fi and mobile data. **Online-only** |
| Server | Linux VPS, [FILL: region] |
| Database | PostgreSQL 16 |
| Language | English |
| Currency | Sri Lankan Rupees (LKR) |
| Time zone | Asia/Colombo (UTC+5:30) |

---

## 3. Design principles - the rules everything else follows

These are not implementation notes. They are requirements, and they are the
part of this document most worth arguing about *now*, because each one is
cheap to agree today and expensive to reverse later.

### P1 - The ledger is append-only, and the database enforces it

Every movement of stock is one row in a ledger. No row is ever updated or
deleted, by any route, by anyone, including TriniphiX. A correction is a new
row marked as a reversal, pointing at the row it undoes. The original stays
exactly where it was.

This is enforced by database triggers, not by application code. Application
rules can be bypassed by a script, a console, or the next developer in a hurry.

**Why it matters:** the moment stock history can be quietly edited, every
report becomes an opinion. This one property is what makes the numbers worth
reading.

### P2 - Stock is derived, never stored

There is no "quantity on hand" column anywhere in the database. On-hand is
calculated by summing the ledger for that item in that room, every time anyone
looks.

**Why it matters:** a cached quantity is a number that eventually disagrees
with the movements behind it, and nobody can tell you when it started lying.

### P3 - The document is the interface; the ledger is a consequence

Users create documents - a delivery, an issue, a wastage note, a count. The
ledger rows are written by the system as a consequence. No screen and no API
endpoint writes the ledger directly.

### P4 - The store is just another room

The main store is not a special case. It is a section like the kitchen or the
bar. Every movement is therefore a room-to-room transfer, and there is no
special-casing anywhere in the system.

### P5 - Everything in the small unit; packs convert once

Stock is held in grams, millilitres or each. Users enter **packs** - "2 × 20 L
can" - because that is what arrives on the lorry and what the invoice says. The
conversion happens once, at entry, on the server.

**If a user is ever asked to type a number in grams, the design has gone
wrong.**

### P6 - Warn, do not block

Issues outside the agreed window, price rises, cash discrepancies: all of these
warn and record. None of them refuse.

**Why it matters:** an issue that happened at 14:00 happened at 14:00. Refusing
to record it does not undo it - it just makes the stock figure wrong as well as
the process. A system that blocks the storekeeper at 6am is a system that gets
worked around by week three, and then the stock figure is worthless.

Three things do block, and only three. Each is listed at FR-WST-02, FR-MKT-02
and FR-CNT-08, and each has a reason given there.

### P7 - Physical reality first, approval second

Wastage and transfers write the ledger at the moment the stock physically
moves, not when a manager approves. The food is already in the bin. Withholding
the record until someone is free means the stock figure is knowingly wrong for
as long as they are busy.

### P8 - Counts are blind, and expected is frozen at open

The expected quantity is **never** shown while counting. It is captured when
the count is opened and does not change afterwards.

**Why it matters:** show a tired storekeeper that the system expects 4,500 and
they will type 4,500 - which confirms a theft rather than finding it. And if
expected were re-read at close, a movement posted while someone walked the
shelves would silently absorb the gap.

### P9 - Spoilage and shrinkage are different conversations

Declared waste has a name and a reason on it: that is a kitchen and ordering
problem. Unexplained loss is a different discussion entirely. They are separate
reports, and documented waste is excluded from the loss report **by
construction**, not by a filter someone might change.

### P10 - Reports need a materiality floor, in money *and* proportion

Counting is never exact. A loss report with no floor will tell you about 44
cents of lettuce. A money floor alone lets ordinary counting noise on expensive
spirits bury the real losses, because noise is proportional to what is on the
shelf and theft is not.

Both floors are therefore required. Their values are set by the Client in
§6.2.

### P11 - Faults surface when they are discovered, not when they happen

Two bottles of gin leave on a Tuesday, but nothing reveals it until the next
bar count. A supplier raises a price on the 5th, but you find out at the next
delivery. A report that insists on flagging faults on the day they occur would
miss both.

### P12 - Separation of duties

A second check is only worth something if it is a second person. Nobody may
release their own request, confirm a delivery they released, or verify their
own count - regardless of role or seniority.

---

## 4. Roles and permissions

### 4.1 The five roles

| Role | Who this is | What they see |
|---|---|---|
| **Admin** | Whoever hands out logins | One screen: Logins. Cannot touch stock at all |
| **Management** | Owner, manager | Everything, including all reports. They decide - approvals, purchases, credit notes - and do not handle stock *(CR-005)* |
| **Storekeeper** | Holds the store | Requests to release, stock everywhere, deliveries, raising purchases and supplier returns |
| **Kitchen** | Chefs, bakers, bar hands - one production room *(CR-004)* | Ask for stock, see what they hold, confirm arrivals |
| **Cleaning** | Cleaning staff | The same, for cleaning supplies, plus wastage and counts in their own store |

**FR-ROL-01 (M)** A branch may have any number of logins per role.

**FR-ROL-02 (M)** A login is assigned to one branch, or to all branches
(management and admin only).

### 4.2 Permission matrix

This is the definitive statement of who may do what. It is enforced by the
server. The menu hides what a role cannot use, but that is presentation.

*Amended by CR-002:* cleaning gains **Log wastage** and **Stock count** for its
own section, matching kitchen. The original exclusion was never justified here
or anywhere else, and it left the one person standing at the cleaning shelf
unable to count it or to declare what they had broken.

*Amended by CR-006:* the separate approval of a section's hand-back is
withdrawn - it approved a movement that had already happened. In its place
management answers one question per quarantined line, **back to the supplier or
into the bin**, which is the only approval in the return chain.

*Amended by CR-005:* management loses **Release stock**, **Return stock to the
store**, **Raise a supplier return** and **Mark a supplier return gone**. The
rule the matrix now states is *management decides, the store handles stock, and
neither does both* - no action and its own approval share a column. Management
keeps every approval and every report.

| Action | Admin | Management | Storekeeper | Kitchen | Cleaning |
|---|:--:|:--:|:--:|:--:|:--:|
| Ask for stock | | ● | ● | ● | ● |
| **Release stock** | | | ● | | |
| Confirm it arrived | | ● | ● | ● | ● |
| Raise a purchase request | | ● | ● | | |
| **Approve a purchase** | | ● | | | |
| Receive a delivery (GRN) | | ● | ● | | |
| Log wastage | | ● | ● | ● | ● |
| Return stock to the store | | | ● | ● | ● |
| Ask what to do with quarantined stock | | | ● | | |
| **Decide it: supplier, or bin - line by line** | | ● | | | |
| Mark a supplier return gone | | | ● | | |
| Bin what was decided into the bin | | | ● | | |
| **Record the credit note** | | ● | | | |
| **Approve wastage** | | ● | | | |
| Transfer stock | | ● | ● | | |
| Stock count | | ● | ● | ● | ● |
| **Verify a count** | | ● | | | |
| Enter opening stock | | ● | ● | | |
| **Reverse a document** | | ● | | | |
| **See the reports** | | ● | | | |
| **Create and remove logins** | ● | | | | |
| **Set up items, suppliers and branches** | ● | | | | |

### 4.3 The three deliberate gaps

**FR-ROL-03 (M)** **Admin cannot touch stock.** Someone has to be able to hand
out logins without that also granting them the run of the inventory.

**FR-ROL-04 (M)** **The storekeeper cannot approve purchases.** They handle
stock, not money. The storekeeper asks for the money; management spends it.

**FR-ROL-05 (M)** **The kitchen cannot raise a purchase.** They cannot see the
store's shelf, so asking them to decide something needs buying invites an order
for a sack of flour that is already in the store. The Purchases screen is not
on their menu at all - it would be a list they could read and do nothing with.
What they asked for, and what came of it, is on their Requests screen.

### 4.4 Separation of duties

**FR-ROL-06 (M)** A user may not release a request they raised.
**FR-ROL-07 (M)** A user may not confirm receipt of an issue they released.
**FR-ROL-08 (M)** A user may not verify a stock count they performed.
**FR-ROL-09** *Withdrawn by CR-001* - there are no cleaning tasks to verify.
**FR-ROL-10 (M)** The last active admin cannot be deactivated. Otherwise nobody
can ever create a login again, and the failure is silent until someone needs
one.

### 4.5 A limitation the Client must accept explicitly

**FR-ROL-11 (M)** **Read access is not restricted by role.** Any signed-in user
can, by calling the API directly, see stock levels for their branch. The menu
hides screens a role has no use for, but that is presentation, not security.

This is a deliberate trade for a system used on a shared store-room tablet.
Tightening it is a change to the route guards and is a Change Request.
**Cost prices and reports are restricted** - the exposure is quantities, not
money.

---

## 5. Functional requirements

### 5.1 Authentication and session

**FR-AUTH-01 (M)** A user signs in by selecting their branch, tapping their own
name from a grid of tiles, and entering a 4-digit PIN on an on-screen keypad.
Nobody types an email address on a wet tablet in a store room.

**FR-AUTH-02 (M)** PINs are 4 to 6 digits and are stored only as a bcrypt hash
with a per-user random salt. A PIN is never stored, logged or transmittable in
plain text and cannot be recovered - only replaced.

**FR-AUTH-03 (M)** Five consecutive failed attempts lock the account for
**15 minutes**. An admin can clear a lockout without changing the PIN.

**FR-AUTH-04 (M)** A successful sign-in issues a session token and a refresh
token. The session survives a page refresh: refreshing on any screen returns
the user to that screen, signed in.

**FR-AUTH-05 (M)** Every request carries the active branch. The server
validates that the user is assigned to that branch and rejects the request
otherwise. A user cannot reach another branch's data by changing a value in the
browser.

**FR-AUTH-06 (M)** Only active users appear on the sign-in screen.

**FR-AUTH-07 (S)** Sessions expire after [FILL: 12 hours] of inactivity.

### 5.2 Goods receipt - GRN

**FR-GRN-01 (M)** The storekeeper or management records a delivery against a
supplier, with an optional invoice number, invoice date and photograph.

**FR-GRN-02 (M)** A delivery has one or more lines. Each line names an item
pack, a **quantity in packs**, and the **price for one pack**.

**FR-GRN-03 (M)** Quantities are entered in packs only. The system converts to
stock units server-side and shows the converted figure beneath the line,
**read-only**. The user never types grams.

**FR-GRN-04 (M)** Fractional packs are accepted. Half a sack does get
delivered.

**FR-GRN-05 (M)** Where the pack price differs from the last price paid for
that pack by more than **[FILL: 10]%**, the system displays a warning showing
the previous price, the new price and the percentage change, **and records the
delivery anyway**. It must not block: the lorry has already gone.

**FR-GRN-06 (M)** Receiving a delivery increases stock in the **store** section
of the branch, and records the price actually paid on each ledger row.

**FR-GRN-07 (M)** Receiving updates the item's weighted-average cost:

```
new average = (qty on hand × old average + qty received × receipt cost)
              ÷ (qty on hand + qty received)
```

Issues, wastage and count adjustments *read* this average; they never change
it.

**FR-GRN-08 (M)** A delivery may be recorded against an open purchase order.
Where it is, the ordered quantities are reduced by what was received. A short
delivery leaves the order open for the balance.

**FR-GRN-09 (M)** Submitting the same delivery twice - a double tap, a retried
request on a poor connection - creates **one** delivery. This is enforced by an
idempotency key generated by the client and checked by the server.

**FR-GRN-10 (M)** A delivery can be listed and viewed afterwards, with its
lines, its total, who received it and when.

**FR-GRN-11 (M)** A delivery can be reversed by management, which writes
mirrored reversal rows. It cannot be edited or deleted.

**FR-GRN-12 (S)** An optional expiry date can be recorded per line.

### 5.3 Cash market purchase - **withdrawn**

> **Withdrawn by CR-001.** The requirement ID is retained so that the
> traceability matrix and the UAT scripts still resolve; nothing implements it.

Every purchase goes through a supplier who invoices (§5.2). **FR-MKT-01** to
**FR-MKT-06** are withdrawn in full: there is no cash-purchase document, no
cash-discrepancy flag, and no second route by which stock enters the ledger.

### 5.4 Requests and issues

The everyday flow:

```
Kitchen or Cleaning        Management OR Storekeeper       Back to the asker
────────────────────       ─────────────────────────       ─────────────────
1. Ask for stock      →    2. Approve and release     →    3. "It came"
   (say when needed)          (stock moves here)              (confirm arrival)
```

**FR-REQ-01 (M)** Any signed-in user may raise a request for stock for a
section they belong to, naming one or more items and a quantity for each, and
optionally when it is needed.

**FR-REQ-02 (M)** A request has a status: **requested → released → received**,
or **cancelled**.

**FR-REQ-03 (M)** Before releasing, the releaser sees, for each line, what the
store actually holds.

**FR-REQ-04 (M)** Releasing moves stock out of the store section and into the
requesting section, in the same transaction, by the same amount. Both halves
are recorded with the releaser's name.

**FR-REQ-05 (M)** Where the store holds less than was asked for, the system
**issues what exists** and records the shortfall. **Stock never goes negative.**

**FR-REQ-06 (M)** Where there is a shortfall, the releaser is offered a
purchase order for the short items, pre-filled, immediately.

**FR-REQ-07 (M)** Releasing outside the configured issue windows
([FILL: 06:00, 11:00, 17:00]) **warns and records**. It does not block.

**FR-REQ-08 (M)** The requester confirms the stock arrived. Until then the
request shows as awaiting confirmation.

**FR-REQ-09 (M)** A user cannot release their own request (FR-ROL-06) and
cannot confirm an issue they released (FR-ROL-07).

**FR-REQ-10 (M)** A request that has not been released can be cancelled. One
that has been released cannot - the stock has already moved. Correcting it is a
reversal.

**FR-REQ-11 (M)** Each role sees its own requests; the storekeeper and
management see all requests for their branch.

### 5.5 Wastage

**FR-WST-01 (M)** A user in a section, or management, records wastage of one or
more items with quantities.

**FR-WST-02 (M)** **A reason code is mandatory. Save is disabled without one.**
This blocks, and the reason is that the reason *is* the point - wastage with no
reason is indistinguishable from loss and teaches nobody anything.

**FR-WST-03 (M)** Reason codes come from a list agreed with the Client, in the
Client's own words. Initial list: [FILL: e.g. Spoiled / expired, Over-production,
Preparation waste, Breakage, Customer return, Quality rejected].

**FR-WST-04 (M)** Wastage reduces stock in the section that recorded it, at the
current weighted-average cost, **at the moment it is recorded** - not when it is
approved. The food is already in the bin (P7).

**FR-WST-05 (M)** Management approves wastage after the fact. Approval is a
review, not a gate.

**FR-WST-06 (S)** An optional photograph can be attached.

**FR-WST-07 (M)** Wastage appears in the wastage report and **must never appear
in the shrinkage report** (P9).

### 5.6 Transfers

**FR-TRF-01 (M)** The storekeeper or management moves stock from one section to
another, or between branches.

**FR-TRF-02 (M)** The receiving section confirms receipt.

**FR-TRF-03 (M)** Stock leaves the sending section at the moment the transfer
is created (P7).

**FR-TRF-04 (M)** **Phase 1 delivers the transfer API and its tests. There is
no transfer screen in Phase 1.** A screen is a Change Request or a Phase 2
item. This is stated plainly because it is the one place where the API is ahead
of the interface.

### 5.7 Stock counts

**FR-CNT-01 (M)** Two kinds of count: a **daily count** of items marked
critical, and a **full count** of a whole section, run weekly or monthly.

**FR-CNT-02 (M)** Opening a count captures the expected quantity for every item
in it, from the ledger, and **freezes it**. It is not re-read afterwards.

**FR-CNT-03 (M)** **The expected quantity is never displayed while counting**
(P8).

**FR-CNT-04 (M)** The counting screen shows **one item at a time**, with large
touch targets, and moves to the next on entry.

**FR-CNT-05 (M)** Closing the count computes, per line, the variance between
counted and expected, in quantity and in money at the current average cost, and
displays it only then.

**FR-CNT-06 (M)** Closing writes an adjustment to the ledger so that on-hand
equals what was counted.

**FR-CNT-07 (M)** A count must be verified by **a different person** who is
management (FR-ROL-08).

**FR-CNT-08 (M)** **A count cannot be closed twice.** This blocks, because the
second close would write a second set of adjustments against a stale expected
figure and corrupt the stock position.

**FR-CNT-09 (M)** A partial count is permitted: a section may be counted for a
subset of its items.

**FR-CNT-10 (M)** Counts can be listed, and a closed count viewed with its
variances.

### 5.8 Cleaning checklist - **withdrawn**

> **Withdrawn by CR-001.** The requirement ID is retained so that the
> traceability matrix and the UAT scripts still resolve; nothing implements it.

**FR-CLN-01** to **FR-CLN-05** are withdrawn in full. There are no cleaning
areas, tasks or daily log.

**The cleaning role is not withdrawn.** Cleaning staff sign in, ask the store
for supplies and confirm they arrived, and hold stock in a section of kind
Cleaning store, exactly as §4 describes. What is gone is the checklist, not the
people.

### 5.9 Returns

Added by **CR-003**. Two documents, because two different things happen and
they answer to different people.

#### Handing stock back to the store

**FR-RET-01 (M)** A section returns stock **against the release that delivered
it**, from the Requests screen. The request names the section, so what can be
handed back is what was actually given to that room - not everything the room
happens to hold, and not everything the item master contains.

**FR-RET-01a (M)** The quantity is capped at the lesser of: what was released
on that request, less anything already returned against it; and what the
section still holds. The refusal message carries all three figures.

**FR-RET-01b (M)** An item that was not on the request cannot be returned
against it, even when the section holds some of it from another release.

**FR-RET-01c (M)** A request that has not been released has nothing to return.

**FR-RET-01d (M)** The **store** is the exception: its stock arrives on a
delivery rather than a release, so there is no request to measure against. The
store returns from its own screen, and that path is constrained downstream
instead - a supplier return must name a GRN line and the goods must physically
be in quarantine (FR-RET-09, FR-RET-10).

**FR-RET-01g (M)** A return **closes after a window** - seven days from the
release. The measure is whether anybody can still say the stock on the shelf is
what came in on that release: for fresh fish that is hours, for a sack of flour
it might be weeks, and the system cannot tell which. After the window the
honest instruments are wastage or a stock count, and the refusal says so.

> The check before this was "does the section hold any of this item", which a
> five-week-old request passes trivially. The bar holds wine, so a request from
> August offered to return wine that arrived in September. A balance is not
> evidence that these are the goods that came in on that release.

**FR-RET-01h (M)** Handing stock back **acknowledges receipt**. You cannot send
back what never came, so a return against a release that has not been confirmed
confirms it, signed by whoever did the returning. A request whose contents have
gone back does not sit in anybody's queue asking them to confirm the arrival of
goods already on their way to the supplier.

**FR-RET-01i (M)** A request with nothing left to return **is not outstanding
work**. It leaves the "needs me" queue, offers no confirmation and no Return,
and reads as closed.

**FR-RET-01e (M)** The request row **says what went back**. A request records
what was released and does not shrink when stock is returned, so the row carries
the returned quantity separately. Without it the screen is identical before and
after a return, and the person who made one concludes it did nothing.

**FR-RET-01f (M)** The Return action is **withdrawn** once nothing on that
request could still go back - fully returned, or the section no longer holds
what it was given. Offering it would open a panel with every line capped at
zero.

**FR-RET-02 (M)** The return moves stock **immediately**, out of the section
and into the branch's quarantine section, in one document. The stock has
physically moved; approval follows it, as with wastage (P4).

**FR-RET-03 (M)** The destination is resolved by the server. A section login
never names it, and never sees quarantine in a picker.

**FR-RET-04 (M)** A section cannot return more than it holds. Stock never goes
negative, here as anywhere. This is the transactional backstop beneath
FR-RET-01a, so two people cannot return the same crate at once.

**FR-RET-05 (M)** Management approves a return after the fact, and may not
approve one they made themselves (P12).

**FR-RET-06 (M)** A branch with no quarantine section refuses the return with
an instruction naming the screen that fixes it.

#### Sending it back to the supplier

**FR-RET-07 (M)** The storekeeper or management raises a supplier return
against **one delivery**, with one or more lines, each pointing at a line of
that delivery and entered **in packs**.

**FR-RET-08 (M)** The credit is priced from the **pack price on that delivery**,
copied at the time it is raised. A later change to the supplier's price list
does not alter what is owed for goods already invoiced.

**FR-RET-09 (M)** A line cannot exceed what the delivery brought, less anything
already returned against it. Rejected returns do not count against the balance.

**FR-RET-10 (M)** A line cannot exceed what **quarantine actually holds**. Goods
must be in quarantine before they can go back to a supplier.

**FR-RET-11 (M)** Management, and only management, approves or rejects a
supplier return. A rejection requires a reason. This is the same rule as a
purchase order: it is the action that spends money.

**FR-RET-12 (M)** Stock leaves quarantine when the return is marked **sent**,
and at no other point. A return that is raised or approved has moved nothing.

**FR-RET-13 (M)** Sending a return that management has not approved is refused.

**FR-RET-14 (M)** A sent return is settled with one of three outcomes: a
**credit note**, a **replacement**, or **written off** with nothing recovered.

**FR-RET-15 (M)** A credit requires its note number and the amount the supplier
actually allowed, which may be less than was asked for. A replacement and a
write-off require neither.

**FR-RET-16 (M)** A return cannot be settled before it has been sent.

#### Seeing it from the store

**FR-RET-18 (M)** The store has a **Returns** screen showing what is in
quarantine right now - item, quantity and value - and what came back off the
floor, with the reason and who returned it.

**FR-RET-19 (M)** That screen states the next step in words and links to it:
raise a supplier return, management approves, mark it gone, record the credit.
A chain that moves stock correctly and then says nothing about what to do with
it leaves the goods in the right place and nobody aware of them.

**FR-RET-20 (M)** The home screen carries a **Returns** tile for management and
the storekeeper, counting what has come back and is not yet on a supplier
return.

**FR-RET-21 (M)** The supplier return form **arrives filled in**. Everything in
quarantine is worked out into proposed returns - the delivery, the reason, the
pack quantities and the credit - so the storekeeper reads a form rather than
rebuilding one. Pressing "send it back to the supplier" on the Returns screen
carries the delivery with it.

**FR-RET-22 (M)** The proposed delivery is a **best guess and stays editable**.
Nothing in the ledger ties a crate in quarantine to the invoice it arrived on:
goods come in on a delivery, go out to a section, and come back, and the chain
is by item and quantity rather than by identity. The guess is the most recent
delivery of that item with packs still returnable, and the screen says so.

**FR-RET-23 (M)** A proposed quantity is **rounded down**, never up, so it is
always submittable. 2,148 g of a 1 kg pack is 2.148 packs; proposing 2.15 would
be two grams more than exists and would be refused, handing the storekeeper an
error on a form they did not fill in.

#### What the ledger records

**FR-RET-17 (M)** Both documents post under the `return` document type. A return
is not a receipt, so it is valued at the running weighted average - the cost of
what left. The money owed by the supplier is recorded on the return document,
not in the ledger, and the two may legitimately differ.

### 5.10 Purchase orders

**FR-PO-01 (M)** The storekeeper or management raises a purchase order naming a
supplier and one or more item packs with quantities **in packs**.

**FR-PO-02 (M)** The system suggests a purchase order from items at or below
their reorder point, pre-filled with a suggested quantity.

**FR-PO-03 (M)** A purchase order can be raised directly from the shortfall on
a request (FR-REQ-06).

**FR-PO-04 (M)** **Only management may approve or reject a purchase order**
(FR-ROL-04). Every purchase goes to management, whatever its value.

**FR-PO-05 (M)** A rejected order records the reason.

**FR-PO-06 (M)** An approved order is closed by a GRN against it. A short
delivery leaves it open for the balance.

**FR-PO-07 (M)** An order can be closed manually by management with a reason -
for an order that will never be filled.

**FR-PO-08 (M)** Open purchase orders are visible as a report.

**FR-PO-09 (M)** Kitchen and cleaning roles cannot see the Purchases screen at
all (FR-ROL-05).

### 5.11 Opening stock

**FR-OPN-01 (M)** At cutover, the storekeeper or management enters the opening
balance for a section: for each item, the quantity on the shelf and what it is
worth.

**FR-OPN-02 (M)** A section can be opened **once**, and only while it has never
held stock. After that the instrument is a stock count, because after day one a
difference is a discrepancy rather than a starting point.

**FR-OPN-03 (M)** Opening stock writes to the ledger like any other document,
and is visible in history.

### 5.12 Stock enquiry

**FR-STK-01 (M)** A user can see current stock for their branch: item, section,
quantity in stock units, and value at current average cost.

**FR-STK-02 (M)** Stock is filterable by section and by category, and
searchable by item name or code.

**FR-STK-03 (M)** Kitchen and cleaning users see their own sections; the
storekeeper and management see all sections in the branch.

**FR-STK-04 (M)** Items at or below their reorder point are visibly flagged.

**FR-STK-05 (M)** Stock quantities are calculated from the ledger on every read
(P2).

### 5.13 Documents and reversals

**FR-DOC-01 (M)** Every document type can be listed and viewed with its lines,
its total, who created it, and when.

**FR-DOC-02 (M)** **Management can reverse any document.** A reversal writes
mirrored ledger rows marked as reversals and pointing at the originals.

**FR-DOC-03 (M)** **A document cannot be reversed twice.**

**FR-DOC-04 (M)** No document and no ledger row can be edited or deleted, by
any route.

**FR-DOC-05 (M)** Every document write is recorded in an audit log with the
actor, the timestamp and the document reference.

### 5.14 Administration - logins

**FR-ADM-01 (M)** The admin creates a login with four things: the person's
name, their role, their branch (or all branches), and a 4-digit PIN.

**FR-ADM-02 (M)** The system can suggest a PIN.

**FR-ADM-03 (M)** **The PIN is displayed once, large, in plain text, at the
moment of creation, and never again.** This is deliberate: hiding it produces a
sticky note stuck to the tablet.

**FR-ADM-04 (M)** A new login appears on the sign-in screen immediately, with
no restart.

**FR-ADM-05 (M)** The admin can issue a new PIN, unlock a locked account,
deactivate a user and reactivate them.

**FR-ADM-06 (M)** **Nobody is ever deleted, only deactivated.** Their name is
on every document they ever created and the ledger does not forget. Deleting a
user would orphan the history.

**FR-ADM-07 (M)** The last active admin cannot be deactivated (FR-ROL-10).

**FR-ADM-08 (S)** Changing a person's role is available from a command-line
script in Phase 1. A screen for it is a Change Request.

### 5.15 Setup

All setup is the **admin's**, and nobody else's - including management. The
person who hands out logins is also the person who defines what the system
contains, and neither of those is the person who receives stock against it.

**FR-SET-01 (M)** Create and edit branches. A new branch arrives with its main
store already created.

**FR-SET-02 (M)** Create and edit sections within a branch. Each section has a
**kind**: Main store, Kitchen, Bakery, Bar, Cleaning store, or Quarantine.

**FR-SET-03 (M)** **The kind decides who can work there.** A branch may have
two kitchens - a pastry room is of kind Kitchen with a name of its own, and
both are visible to kitchen logins.

**FR-SET-04 (M)** **A new *kind* cannot be invented through the interface.** A
section of an unknown kind is a room no role can reach: created successfully,
visible to nobody. Adding a sixth kind is deliberately a code change in one
place. This is a constraint, not a limitation to be fixed.

**FR-SET-05 (M)** Create and edit item categories, each with a storage type:
dry, chiller, freezer, bar, chemical, packaging, gas.

**FR-SET-06 (M)** Create and edit items: code, name, category, **stock unit**,
par level, reorder point, shelf life, and whether the item is **critical**
(counted daily).

**FR-SET-07 (M)** Create and edit **packs** for an item. An item may have
several - sugar arrives in 1 kg packs *and* 50 kg sacks. Each pack records how
many stock units it contains. One pack may be marked the default for purchase.

**FR-SET-08 (M)** Create and edit suppliers. *Amended by CR-001:* the
cash-market flag is withdrawn along with the market purchase.

**FR-SET-09 (M)** Record agreed prices per supplier and pack, with an effective
date. These are what the first delivery is measured against; without them the
first surprise price looks exactly like the normal price.

**FR-SET-10** *Withdrawn by CR-001* - there are no cleaning areas or tasks.

**FR-SET-11 (M)** Nothing in setup is deleted; items, suppliers and sections
are deactivated.

**FR-SET-12 (S)** Issue windows are configured in the database in Phase 1. A
screen for them is a Change Request.

### 5.16 Home screen

**FR-HOM-01 (M)** On signing in, each user lands on a screen showing what
matters to their role - for the storekeeper, items below reorder point,
requests waiting to be released, and open counts; for management, the same plus
purchase orders awaiting approval and total stock value.

### 5.17 Phase 2 - recipes and production

Specified here for context. **Not in Phase 1 scope.**

**FR-PRD-01 (P2)** Define products with a recipe: which items, and how much of
each, to produce one unit.
**FR-PRD-02 (P2)** Each section declares its daily output - "42 chocolate
cakes, 180 fish buns".
**FR-PRD-03 (P2)** The system explodes declared output through the recipes to
derive theoretical ingredient usage.
**FR-PRD-04 (P2)** Theoretical usage is compared against what was actually
issued, per item, over a date range.

> **Why this is Phase 2, and its honest limit.** With no POS, declared
> production is the only available driver of theoretical consumption. It works
> well for bakery and prepped items, which is most of the volume. It works
> poorly for à la carte - a chef will not log every plate - so those items stay
> on issue-versus-count control. Bar is the strongest case, because spirits are
> countable by bottle and millilitre.

---

## 6. Reports

All reports are **management only**. All take a date range and are scoped to
the user's branch.

### 6.1 The five core reports

**FR-RPT-01 (M) - Usage variance.** Theoretical consumption against what was
actually issued, per item, over a range. Shows quantity variance, value
variance and percentage. Ordered by significance.

> Must list two or three items, not forty. A report that flags most of the
> store is noise.

**FR-RPT-02 (M) - Shrinkage.** Count gaps with no wastage document behind them:
stock that has gone with no explanation. Shows item, section, date, quantity
and value.

Subject to **both** materiality floors (P10), and **excludes documented
wastage by construction** (P9).

**FR-RPT-03 (M) - Supplier price movement.** Where a pack price has moved by
more than a threshold between one purchase and the next. Shows supplier, item,
pack, old price, new price, percentage and the date it was discovered.

**FR-RPT-04 (M) - Wastage by reason.** Wastage grouped by reason code, with
quantity and value, drillable to item and to the individual document.

**FR-RPT-05 (M) - Stock-outs and below-reorder.** Items that reached zero, with
the date, and items currently at or below their reorder point.

### 6.2 Materiality floors - the Client sets these

**FR-RPT-06 (M)** The shrinkage report reports a discrepancy only where it is
material in **both** money and proportion.

| Floor | Default | Client's value |
|---|---|---|
| Minimum value | LKR 100 | **[FILL]** |
| Minimum proportion of expected | 2% | **[FILL]** |

> These defaults are informed guesses and they belong on the Phase 0 list to
> confirm. Both were reached by watching what happened without them: with no
> floor the report listed Rs 0.44 of lettuce; with a money floor alone,
> ordinary counting noise on expensive gin produced fifteen false alarms that
> buried two real bottles.

**FR-RPT-07 (M)** The price movement threshold is configurable, defaulting to
**[FILL: 10]%**.

### 6.3 Operational reports

Delivered alongside the five, and less contentious.

| ID | Report | Shows |
|---|---|---|
| **FR-RPT-08 (M)** | Open purchase orders | What has been ordered and not yet received, with age |
| **FR-RPT-09 (M)** | Service level | How much of what was requested was actually released |
| **FR-RPT-10 (M)** | Supplier performance | Delivery completeness and price behaviour by supplier |
| **FR-RPT-11 (M)** | Stock valuation | Value on hand by section and category, at average cost |
| **FR-RPT-12 (M)** | Dead stock | Items with no movement in a period |
| **FR-RPT-13 (M)** | Consumption | What each section consumed over a range |
| **FR-RPT-14 (M)** | Count accuracy | How often counts match, by counter and by section |

### 6.4 A property of every report

**FR-RPT-15 (M)** Reports never invent, cache or store a figure. Every number
is computed from the ledger at the moment it is asked for.

---

## 7. Non-functional requirements

### 7.1 Integrity - the ones that matter most

**NFR-INT-01 (M)** A `stock_ledger` row cannot be updated or deleted by any
route, including `TRUNCATE`, including by a database superuser using SQL
directly. Enforced by database triggers.

**NFR-INT-02 (M)** Corrections are reversals: a new row marked as such,
pointing at the row it undoes.

**NFR-INT-03 (M)** No stock quantity is stored. All quantities are derived.

**NFR-INT-04 (M)** All ledger rows for one document are written in a single
transaction. A partially written document is impossible.

**NFR-INT-05 (M)** No API endpoint writes the ledger directly. One service
function per document type. This is enforced by an automated lint rule that
fails the build, not by a convention.

**NFR-INT-06 (M)** Stock can never go negative.

**NFR-INT-07 (M)** Every document POST is idempotent on a client-supplied key.
A retried request creates one document.

**NFR-INT-08 (M)** All money is stored to two decimal places, all quantities to
three. No floating point is used for money.

### 7.2 Performance

**NFR-PRF-01 (M)** Stock enquiry for a branch returns within **2 seconds** at
50,000 ledger rows.
**NFR-PRF-02 (M)** Any report over a 90-day range returns within **5 seconds**
at 50,000 ledger rows.
**NFR-PRF-03 (M)** Saving a document returns within **2 seconds** on premises
Wi-Fi.
**NFR-PRF-04 (M)** The application loads on a mid-range Android phone within
**5 seconds** on first visit.

### 7.3 Availability

**NFR-AVL-01 (S)** Target availability **99%** during the Client's operating
hours, measured monthly. Full terms in the SLA.
**NFR-AVL-02 (M)** Planned maintenance is notified at least 48 hours in advance
and performed outside operating hours.
**NFR-AVL-03 (M)** Uptime and error alerting to a nominated mobile number.

### 7.4 Security

**NFR-SEC-01 (M)** All traffic over HTTPS.
**NFR-SEC-02 (M)** PINs stored only as bcrypt hashes with per-user random salt.
**NFR-SEC-03 (M)** PINs and authorisation headers are redacted from all logs. A
PIN in a log file is a PIN in a backup, forever.
**NFR-SEC-04 (M)** Authorisation is enforced by the server on every request.
**NFR-SEC-05 (M)** Branch membership is validated on every request against the
session token, never against a value supplied by the client.
**NFR-SEC-06 (M)** Rate limiting on authentication and on write endpoints.
**NFR-SEC-07 (M)** Uploaded files are size-limited and type-checked.
**NFR-SEC-08 (M)** Server access by SSH key only; password authentication
disabled.
**NFR-SEC-09 (M)** Input validated against a schema at the API boundary.

### 7.5 Backup and recovery

**NFR-BAK-01 (M)** Nightly automated database backup to object storage.
**NFR-BAK-02 (M)** 30-day retention.
**NFR-BAK-03 (M)** **A restore is performed successfully in the Client's
presence before go-live, and evidenced.** An untested backup is a belief, not a
backup.
**NFR-BAK-04 (M)** Recovery Point Objective: **24 hours**. Recovery Time
Objective: **4 hours**.
**NFR-BAK-05 (M)** Backup failure raises an alert.

> **NFR-BAK-03 is a condition of go-live and is not negotiable.** No real
> delivery is entered into a system whose restore has never been performed.

### 7.6 Usability

**NFR-USE-01 (M)** Usable one-handed on a phone at the delivery door.
**NFR-USE-02 (M)** Touch targets no smaller than 44 × 44 pixels.
**NFR-USE-03 (M)** No screen requires typing where a choice will do.
**NFR-USE-04 (M)** Errors are in plain English and say what to do next.
**NFR-USE-05 (M)** A refresh returns the user to the screen they were on.
**NFR-USE-06 (M)** Destructive or irreversible actions are confirmed.
**NFR-USE-07 (M)** English interface. Sinhala labels are a Change Request.

### 7.7 Maintainability

**NFR-MNT-01 (M)** TypeScript end to end, compiled with strict type checking.
**NFR-MNT-02 (M)** Automated tests run against a real PostgreSQL database, not
mocks - because the behaviours worth testing here *are* database behaviours.
**NFR-MNT-03 (M)** Database changes are numbered, forward-only migration files.
**NFR-MNT-04 (M)** The API contract generates the web application's types, so
drift between them cannot happen without a build failing.

### 7.8 Auditability

**NFR-AUD-01 (M)** Every stock movement carries the identity of the person who
caused it.
**NFR-AUD-02 (M)** Every document carries who created it and when.
**NFR-AUD-03 (M)** Every approval and verification carries who did it and when.
**NFR-AUD-04 (M)** Audit records are retained permanently and cannot be
deleted.

---

## 8. Data requirements

### 8.1 Volumes at go-live

| Entity | Expected | Design capacity |
|---|---|---|
| Branches | 1 | 5+ |
| Sections per branch | 5 | Unlimited |
| Users | [FILL: 15] | 100+ |
| Items | [FILL: 100-150] | 5,000 |
| Packs per item | 1-3 | Unlimited |
| Suppliers | [FILL: 20-30] | Unlimited |
| Ledger rows per year | ~65,000 | Millions |

### 8.2 Retention

| Data | Retained |
|---|---|
| Ledger rows | **Permanently. Cannot be deleted** |
| Documents | Permanently |
| Audit log | Permanently |
| Users | Permanently; deactivated, never deleted |
| Uploaded photographs | [FILL] |
| Backups | 30 days rolling |

### 8.3 Cutover data

**FR-DAT-01 (M)** Items, packs, suppliers, prices, branches, sections and users
are entered through the setup screens at cutover.

**FR-DAT-02 (M)** Opening balances are entered per section by physically
counting the shelf.

**FR-DAT-03 (M)** **No historical transactions are migrated.** The system
starts from the opening count. Attempting to import a history that was never
reliable would import its unreliability.

**FR-DAT-04 (M)** **There is no CSV import in Phase 1.** Every item is typed in
once. For [FILL: 150] items this is a long day, and it is a day, not a
developer. A CSV import is a Change Request.

### 8.4 Demo and real data

**FR-DAT-05 (M)** Every table carries a flag distinguishing demonstration rows
from real ones. Demo and real data share every table, every query and every
screen, so the Client is never testing against a structure that will not ship.

**FR-DAT-06 (M)** Cutover deletes every demonstration row. After the first real
delivery, the ledger is immutable for real.

---

## 9. Constraints and assumptions

### 9.1 Constraints

| # | Constraint | Consequence |
|---|---|---|
| CON-01 | **No POS, and none planned** | Theoretical consumption cannot come from sales. Control is issue-versus-count, and later declared production |
| CON-02 | **Online-only** | A dropped connection during a count loses that count |
| CON-03 | Runs in a browser tab; not installable as an app | |
| CON-04 | English only | |
| CON-05 | Shared devices in wet, busy rooms | PIN on tiles; large targets; minimal typing |
| CON-06 | À la carte cooking is not repeatable | Recipe control works for bakery and prep, not every plate |
| CON-07 | Single branch in Phase 1 | Schema and setup support more; none has been run at one |
| CON-08 | Section kinds are fixed at five | Adding a sixth is a code change (FR-SET-04) |

### 9.2 Assumptions

| # | Assumption |
|---|---|
| ASM-01 | The premises has working internet in the store, kitchen and bar |
| ASM-02 | The Client provides devices |
| ASM-03 | Every user gets their own login. The audit trail depends entirely on this |
| ASM-04 | Phase 0 will confirm every item, unit and pack conversion by physically walking the store |
| ASM-05 | The Client can supply agreed supplier prices at cutover |
| ASM-06 | Staff will be released for UAT and training |
| ASM-07 | Up to [FILL: 25] users and [FILL: 150] items |

### 9.3 The dependency that carries the most risk

**ASM-04.** If a pack conversion is wrong - a sack recorded as 50 kg when it is
25 - every figure the system produces about that item is wrong, silently,
forever, and nobody finds out for months. No amount of software recovers from
it. This is why Phase 0 is two weeks and why TriniphiX will not compress it.

---

## 10. Out of scope

Stated so that neither party is in any doubt.

| # | Not included | Why |
|---|---|---|
| OOS-01 | POS integration | No POS exists |
| OOS-02 | Accounting integration | Not requested |
| OOS-03 | Real-time depletion per plate | Requires per-plate logging no kitchen sustains |
| OOS-04 | Barcode scanning | Loose produce has no barcode |
| OOS-05 | Supplier portals | |
| OOS-06 | Demand forecasting | |
| OOS-07 | Offline working | Client elected online-only |
| OOS-08 | Native mobile app | |
| OOS-09 | Sinhala or Tamil interface | |
| OOS-10 | Recipes, products, production log | Phase 2 |
| OOS-11 | CSV import of the item master | |
| OOS-12 | Approval thresholds by value | Management approves every purchase |
| OOS-13 | Any purchase outside a supplier invoice - cash buys at the market or the pola | Withdrawn by CR-001. A purchase order is closed by a GRN |
| OOS-14 | A transfers screen | API and tests only in Phase 1 (FR-TRF-04) |
| OOS-15 | A screen for changing a user's role | Script only in Phase 1 |
| OOS-16 | A screen for issue windows | Database only in Phase 1 |
| OOS-17 | Multi-branch rollout | |
| OOS-18 | Devices, tablets, network equipment | Client provides |

OOS-03 to OOS-06 are each requested on projects like this, and each of them,
taken on too early, is what stops the system being adopted at all.

---

## 11. Acceptance criteria

### 11.1 The functional gate

Every requirement marked **M** is delivered and demonstrable.

### 11.2 The integrity gate

Demonstrated live, in front of the Client. Each of these must **fail**:

| # | Attempt | Must |
|---|---|---|
| 1 | Edit a ledger row directly in the database | Be rejected |
| 2 | Delete a ledger row directly in the database | Be rejected |
| 3 | `TRUNCATE` the ledger | Be rejected |
| 4 | Reverse the same document twice | Be rejected |
| 5 | Cancel a request that has already moved stock | Be rejected |
| 6 | Close the same count twice | Be rejected |
| 7 | Verify a count you performed | Be rejected |
| 8 | Sign in as kitchen and open Reports | Be refused |
| 9 | Change the branch identifier to a branch you are not assigned to | Be rejected |

### 11.3 The reports gate - the planted faults

The system is delivered loaded with sixty days of generated data containing
five deliberate faults. Each report must find its own fault.

| Fault | Where it hides | Report that must catch it | Correct answer |
|---|---|---|---|
| **A** Chicken breast over-issued from day 20 | Individual issues look normal | Usage variance | **+18.6%**, ~LKR 192,000 |
| **B** Two gin bottles vanish, days 28 and 44 | No document at all | Shrinkage | **Exactly two rows**, −750 ml and ~LKR 5,216 each, both in the bar |
| **C** Sunflower oil +32% at the supplier on day 35 | Buried in a routine delivery | Price movement | 45,880 → 60,561.60 |
| **D** Lettuce spoilage spike, days 38-44 | Genuine waste, correctly logged | Wastage by reason | Listed under *Spoiled / expired* |
| **E** Prawns hit zero on day 41 | Store empties mid-service | Stock-outs | Balance 0 on that date |

### 11.4 The acceptance gate - a report that must stay silent

**Fault D must appear in the wastage report and must NOT appear in the
shrinkage report.**

This is the single most important acceptance criterion in this document, and it
is the one nobody usually writes. Honest, documented spoilage showing up in an
unexplained-loss report is the failure mode that gets a system abandoned: an
owner accused of theft over a crate of lettuce stops opening reports by week
three.

It has already caught a real defect during development. Without a materiality
floor, the shrinkage report was listing 44 cents of lettuce; and a money floor
alone still let fifteen days of ordinary counting noise on expensive gin bury
the two real bottles.

### 11.5 The non-functional gate

| # | Criterion |
|---|---|
| 1 | Deployed with HTTPS and an automatically renewing certificate |
| 2 | Nightly backup running and verified |
| 3 | **A restore performed successfully in the Client's presence** |
| 4 | Alerting configured to a nominated number |
| 5 | Performance targets in §7.2 met |
| 6 | Full automated test suite passing |

### 11.6 The handover gate

| # | Criterion |
|---|---|
| 1 | User Manual delivered, by role |
| 2 | Administrator Manual delivered |
| 3 | Training delivered and the attendance sheet signed |
| 4 | Handover Note signed - credentials, server details, repository access |
| 5 | Source code delivered per the Software Licence Agreement |

### 11.7 Defects

Acceptance is not withheld for Severity 3 or 4 defects. Severity 1 and 2
defects must be closed. Severities are defined in SOW §8.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Branch** | A physical site. Also called a location or outlet |
| **Section** | A room where stock sits. The main store is a section like any other |
| **Section kind** | One of: Main store, Kitchen, Bakery, Bar, Cleaning store, Quarantine. Decides who can work there |
| **Stock unit** | The smallest unit an item is measured in: grams, millilitres, or each |
| **Pack** | How an item arrives: a sack, a case, a can. Converts to stock units |
| **Ledger** | The append-only record of every stock movement |
| **Document** | A delivery, issue, wastage note, transfer, count, return or opening balance |
| **Quarantine** | The section returned goods wait in. Nothing is ever issued out of it |
| **Section return** | A room handing stock back to the store because it is not fit to use |
| **Supplier return** | Goods going back to the vendor who delivered them, against that delivery |
| **Reversal** | A new ledger row that undoes an earlier one. The only kind of correction there is |
| **GRN** | Goods Received Note - a delivery from a supplier |
| **Issue** | Stock released from the store to a section |
| **Request** | A section asking the store for stock |
| **Shortfall** | The part of a request the store could not cover |
| **Wastage** | Stock discarded, with a reason |
| **Shrinkage** | Stock gone with no document to explain it |
| **Blind count** | A count where the expected quantity is not shown |
| **Variance** | The difference between counted and expected, in quantity and money |
| **Critical item** | An item counted daily because it is valuable or walks easily |
| **Par level** | The quantity a section aims to hold |
| **Reorder point** | The level at which buying more is triggered |
| **Weighted-average cost** | The running average of what has been paid, used to value stock leaving |
| **Materiality floor** | The threshold below which a discrepancy is not reported. Money *and* proportion |
| **Business day** | The operating day, which may not start at midnight |
| **Idempotency key** | A value that ensures a retried save creates one document |
| **Issue window** | An agreed time for releasing stock. Warned, never enforced |

---

## 13. Sign-off

By signing below, the Client confirms that this document accurately describes
the system to be delivered, and agrees that:

1. Every requirement marked **M** is what will be built.
2. Anything not in this document is a Change Request, with its own cost and
   time impact, under the Change Request Procedure.
3. A delivered behaviour that contradicts this document is a Defect, fixed free.
4. The design principles in §3 are understood and agreed, including the
   deliberate trade-offs in P6 (warn, do not block) and FR-ROL-11 (read access
   is not restricted by role).
5. The values the Client must supply - the materiality floors in §6.2, the
   price threshold in FR-RPT-07, the wastage reasons in FR-WST-03, the issue
   windows in FR-REQ-07 - have been provided or are scheduled in Phase 0.

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

---

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | [FILL] | TriniphiX | First draft for review |
| 1.0 | [FILL] | TriniphiX | Issued for sign-off |
