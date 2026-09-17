# UI / Screen Specification

**Project:** The Grand - inventory management system
**Version:** 1.0 · [FILL: date]
**Signed alongside:** SRS v1.0
**Status:** For sign-off

---

## 1. Who is holding the device

Every decision in this document comes from this table. It is worth reading
before the screens.

| Role | Where they are | What they are holding | State of mind |
|---|---|---|---|
| Storekeeper | Delivery door, 6am. Store room, all day | Phone, one hand, other hand on a sack | Interrupted, in a hurry, lorry waiting |
| Kitchen | Kitchen pass during prep | Shared tablet on a wall mount | Wet hands, mid-task |
| Cleaning | Store cupboard, end of shift | Shared tablet | Wants to leave |
| Management | Office or at home | Tablet or laptop | Reading, thinking, unhurried |
| Admin | Office, rarely | Laptop | Careful, doing setup |

**The consequence:** four of the five are in a hurry, on a shared device, in a
wet room. Only management is sitting down. So:

- Sign-in is a tile and four digits, never an email and a password.
- Almost nothing blocks (SRS P6).
- Typing is avoided wherever a choice will do.
- The count screen shows one item at a time.
- Reports get to be dense, because only management reads them.

## 2. Rules that apply to every screen

| # | Rule |
|---|---|
| G1 | Touch targets at least 44 × 44 px |
| G2 | Body text at least 16 px; never smaller than 14 px |
| G3 | A refresh returns the user to the screen they were on (FR-AUTH-04) |
| G4 | Every list has a defined empty state that says what to do, not "no data" |
| G5 | Every list has a loading state and an error state with a retry |
| G6 | Errors are one plain sentence saying what to do next |
| G7 | Warnings are amber and dismissible; they never prevent saving (SRS P6) |
| G8 | Save buttons disable while saving. A double tap creates one document (FR-GRN-09) |
| G9 | Quantities always display with their unit; money always with `LKR` |
| G10 | **No screen ever asks a user to type a quantity in stock units** (SRS P5) |
| G11 | The menu shows only what the role can use; the server enforces it regardless |
| G12 | Irreversible actions confirm - reversal, deactivation, closing a count |
| G13 | Destructive language is avoided. "Switch off", not "delete" - nothing is deleted |
| G14 | **A product is always chosen by typing, never by scrolling.** One control, used everywhere an item is named: it searches name, code and category, floats the items that room actually uses to the top, and hides nothing. A hundred products is too many to scroll on a tablet and exactly right to type into |
| G15 | **A screen that asks more than about six things asks them in steps**, one question at a time, with a header showing where you are. Going back is always available; going forward states what is missing rather than greying a button in silence |

## 3. Navigation

```
Sign in
  │
  ├── Today                    all roles - the landing screen
  ├── Ask for stock            kitchen, cleaning, storekeeper, management
  ├── Requests                 all roles (scoped)
  ├── What we have             all roles (scoped)
  ├── Receive delivery         storekeeper, management
  ├── Wastage                  kitchen, storekeeper, management
  ├── Hold for return          storekeeper, management
  ├── Supplier returns         storekeeper, management
  ├── Stock count              kitchen, storekeeper, management
  ├── Purchases                storekeeper, management        ← not on kitchen's menu at all
  ├── Reports                  management only
  ├── Setup ▸                  admin only
  │     ├── Branches and sections
  │     ├── Products
  │     └── Suppliers
  ├── Advanced ▸
  │     └── Opening stock      storekeeper, management
  └── Logins                   admin only
```

**Admin sees one screen: Logins, plus Setup.** Admin cannot reach any stock
screen at all (FR-ROL-03).

---

## 4. Screens

### 4.1 Sign in

**Route:** `/login` · **Roles:** everyone · **Implements:** FR-AUTH-01 to 06

**Three steps, one at a time.**

```
┌──────────────────────────────┐   ┌──────────────────────────────┐   ┌──────────────────┐
│  Where are you?              │   │  Who are you?                │   │   Sunil Fernando │
│                              │   │                              │   │                  │
│  ┌────────────────────────┐  │   │  ┌──────┐ ┌──────┐ ┌──────┐  │   │   ● ● ○ ○        │
│  │ The Grand Gastrobar    │  │ → │  │Sunil │ │Nuwan │ │Kamal │  │ → │                  │
│  └────────────────────────┘  │   │  │store │ │mgmt  │ │kitch │  │   │  1   2   3       │
│  ┌────────────────────────┐  │   │  └──────┘ └──────┘ └──────┘  │   │  4   5   6       │
│  │ Espresso Bar           │  │   │  ┌──────┐ ┌──────┐           │   │  7   8   9       │
│  └────────────────────────┘  │   │  │Ruwan │ │Admin │           │   │      0   ⌫       │
└──────────────────────────────┘   └──────────────────────────────┘   └──────────────────┘
```

| Element | Behaviour |
|---|---|
| Branch list | Skipped if there is only one branch |
| Name tiles | Active users only. Name and role beneath. Large - this is a wet-hands target |
| Keypad | Digits appear as dots. No "show PIN" |
| Wrong PIN | "That PIN is not right. [N] tries left." Returns to the keypad |
| Locked | "This login is locked for 15 minutes. Ask your admin to unlock it." |

**Never on this screen:** an email field, a password field, a "remember me", a
"forgot password" link. There is nothing to remember and nothing to email.

### 4.2 Today

**Route:** `/` · **Roles:** all · **Implements:** FR-HOM-01

A row of cards, each a tap into the screen behind it. What appears depends on
the role.

| Card | Storekeeper | Kitchen | Cleaning | Management |
|---|:--:|:--:|:--:|:--:|
| Requests waiting to be released | ● | | | ● |
| My requests awaiting confirmation | | ● | ● | |
| Items below reorder point | ● | | | ● |
| Open stock counts | ● | ● | | ● |
| Purchases awaiting approval | | | | ● |
| Total stock value | | | | ● |

Each card shows a number and a one-line label. Zero states say something useful
- "Nothing waiting" - not "0".

### 4.3 Ask for stock

**Route:** `/ask` · **Roles:** kitchen, cleaning, storekeeper, management ·
**Implements:** FR-REQ-01

| Element | Behaviour |
|---|---|
| Section | Pre-selected if the user belongs to one. A chooser if several |
| Item search | The standard product picker (G14): type-ahead on name, code or category, with *"what you usually take"* - the items this section has drawn before - sorted first |
| Quantity | In the item's own everyday terms. Numeric keypad |
| When needed | Optional: Now / Next window / Tomorrow |
| Add line | The list stays visible; lines can be removed |
| Send | Disabled until at least one line |

After sending: "Sent. The store will release it." with a link to the request.

**What this screen never shows:** what the store holds. The kitchen asking for
what the store has is a different question from the kitchen asking for what it
needs, and mixing them turns a request into a negotiation at the fridge door.

### 4.4 Requests

**Route:** `/requests` · **Roles:** all, scoped · **Implements:** FR-REQ-02 to 11

Two tabs: **To release** (storekeeper and management) and **Mine** (everyone).

**To release - the list**

| Column | Note |
|---|---|
| Section | |
| Who asked | |
| When | Relative - "20 minutes ago" |
| Lines | Count |
| Status | requested / released / received |

**To release - one request**

Per line: what was asked for, and **what the store actually holds**, side by
side. The releaser types what they are giving.

| Situation | Behaviour |
|---|---|
| Store has enough | Pre-filled with what was asked |
| Store has less | Pre-filled with what exists. A note: "Store has 3 kg. Short by 2 kg." |
| Any shortfall | On release: "Order the shortfall?" with a pre-filled purchase order (FR-REQ-06) |
| Outside the issue window | Amber: "It's 14:20. Issue windows are 06:00, 11:00 and 17:00." **Save still works** (FR-REQ-07) |
| Own request | The Release button is absent and the reason is shown: "You raised this. Someone else must release it." |

**Mine - the requester's view.** Status, and a **It came** button when released
(FR-REQ-08). Cancel only while still `requested` (FR-REQ-10).

### 4.5 Receive delivery (GRN)

**Route:** `/grn` · **Roles:** storekeeper, management ·
**Implements:** FR-GRN-01 to 12

This screen is used one-handed, at a door, with a lorry waiting. It is the
screen most worth getting right.

**Four questions, one at a time** (G15), because that is what a delivery is:

| Step | Question | Contents |
|---|---|---|
| 1 | **Which order?** | The open orders, most recognisable first. Orders management has not approved are listed but greyed and inert - the server refuses a delivery against them, and a storekeeper's real question is "where is my order", not "why is this list short". *Nothing was ordered* goes straight to step 2 |
| 2 | **Who delivered it?** | Supplier, invoice number, invoice date. The supplier is locked when the delivery is against an order - a delivery from anybody else is its own delivery |
| 3 | **What came?** | The lines, below |
| 4 | **Check and save** | The whole delivery read back, with the total and any price changes, then Save |

Arriving from Purchases with `?po=` skips step 1: that question is answered.
Going back to step 1 discards the order - half of one order and half of another
is the one delivery this form must never be able to produce.

**Lines**

```
┌────────────────────────────────────────────────────────┐
│  Sugar - white                                    [×]  │
│  Pack:  [ 50 kg sack            ▾ ]                    │
│  Packs: [ 2         ]   Price/pack: [ 24,500  ]        │
│  ────────────────────────────────────────────────────  │
│  = 100,000 g  ·  LKR 49,000                            │
│                                                        │
│  ⚠ Last paid LKR 18,500. That is 32% more.             │
└────────────────────────────────────────────────────────┘
```

| Element | Behaviour |
|---|---|
| Item | The standard product picker (G14) |
| Pack | Defaults to the item's default purchase pack. Says so plainly when a product has no pack, because then it cannot be received at all |
| Packs | Numeric. Fractions allowed (FR-GRN-04) |
| Price per pack | Numeric, LKR |
| Converted figure | **Read-only, beneath the line**, as a sentence: *"That is 40 L onto the shelf"*. The user never types this (G10) |
| Price warning | Amber, inline, **while the price is typed** - shows the last price, the new one and the percentage. **Does not block** (FR-GRN-05) |
| Against a purchase order | Lines pre-fill with what is still **outstanding** on the order, never the full original quantity |

**The price warning is the reason step 3 exists separately.** It used to arrive
with the save response - which is after the delivery is recorded and, in
practice, after the driver has gone. The last price this supplier charged is
read when the supplier is chosen at step 2, so the question gets asked while the
lorry is still in the yard. The save response remains the authority and is shown
at step 4.

**Footer:** the blocking reason, if any, then Save. Save disables while saving; a
double tap creates one delivery (FR-GRN-09).

### 4.5a Deliveries

**Route:** `/deliveries` · **Roles:** storekeeper, management ·
**Implements:** FR-GRN-11 (the record)

The record of what has arrived, newest first, searchable by supplier name or
invoice number. Opening a row shows the delivery read back: every line, the
packs, the pack price, what it put on the shelf, the total, and **how much of
each line has since gone back to the supplier**.

**Read-only, and that is the design.** A delivery on the ledger is corrected by
a reversal, never an edit; an edit button on an immutable document is a promise
the screen cannot keep. The panel says so rather than leaving people hunting for
one.

**Why it exists.** A delivery could be entered and then never seen again — the
only route back to last Tuesday's invoice was the delivery picker inside the
supplier-return form, which is a strange place to keep a record and is closed to
anyone who cannot raise a return. *"What did we pay for that last time"* is a
question the price-movement report raises by design, and the answer had nowhere
to live.

### 4.6 Market purchase - **withdrawn**

> **Withdrawn by CR-001**, with FR-MKT-01 to 06. Every purchase goes through a
> supplier who invoices, so the screen has no occasion to exist.

### 4.7 Wastage

**Route:** `/wastage` · **Roles:** kitchen, storekeeper, management ·
**Implements:** FR-WST-01 to 07

| Element | Behaviour |
|---|---|
| Section | The user's own, or chosen |
| Item and quantity | Per line |
| **Reason** | **Mandatory.** Buttons, not a dropdown - one tap. Save disabled until chosen (FR-WST-02) |
| Photograph | Optional |

Reason buttons come from the Client's own list (FR-WST-03) and use the Client's
own words.

Management sees an **Approve** action on the list afterwards. It reads as a
review, not a gate - the stock has already moved (SRS P7), and the screen says
so: "Already recorded. Approval is a check, not a hold."

### 4.8 Stock count

**Route:** `/counts` · **Roles:** kitchen, storekeeper, management ·
**Implements:** FR-CNT-01 to 10

**Open a count:** section, and type - daily (critical items) or full.

**Counting - one item per screen**

```
┌──────────────────────────────────┐
│              4 of 12             │
│                                  │
│         Gin - imported           │
│              BAR                 │
│                                  │
│        ┌──────────────┐          │
│        │              │  ml      │
│        └──────────────┘          │
│                                  │
│   1   2   3      [ Skip ]        │
│   4   5   6                      │
│   7   8   9      [ Next → ]      │
│       0   ⌫                      │
└──────────────────────────────────┘
```

| Rule | |
|---|---|
| **The expected quantity is never shown** | FR-CNT-03. This is the most important rule on this screen |
| One item per screen | FR-CNT-04 |
| Progress | "4 of 12" only. No running variance |
| Skip | Allowed. A partial count adjusts only what was counted (FR-CNT-09) |
| Back | Allowed, to correct a mis-tap |

**Closing.** A confirm - "Finish this count? You will not be able to change it."
**Only then** does the variance appear: per item, counted, expected, difference,
value. Ordered by value.

**Verification.** A different person, who is management (FR-CNT-07). The
counter's own screen says: "Waiting for someone else to check this."

### 4.9 What we have

**Route:** `/stock`, `/my-stock` · **Roles:** all, scoped ·
**Implements:** FR-STK-01 to 05

| Element | Behaviour |
|---|---|
| Scope | Kitchen and cleaning see their own sections. Storekeeper and management see all |
| Columns | Item, section, quantity with unit, value at average cost |
| Value column | **Management only** |
| Below reorder | Row flagged; a filter shows only those |
| Search | Name or code |
| Filters | Section, category |

### 4.10 Cleaning - **withdrawn**

> **Withdrawn by CR-001**, with FR-CLN-01 to 05. The cleaning *role* remains and
> uses Ask for stock, Requests and What we have like any other section.

### 4.11 Purchases

**Route:** `/purchases` · **Roles:** storekeeper, management ·
**Implements:** FR-PO-01 to 09

**Not on the kitchen or cleaning menu at all** (FR-PO-09) - it would be a list
they could read and do nothing with.

Tabs: **To approve** (management), **Open**, **All**.

**Raising an order is three questions, one at a time** (G15), because raising
one is three separate jobs and they used to share a single column with the two
that decide the answer - the reason and the date - at the very bottom, reading
as optional extras:

| Step | Question | Contents |
|---|---|---|
| 1 | **What** | *What the shelf says* - everything below its reorder point, addable one at a time or all at once - then anything else through the standard product picker (G14). The order so far is listed underneath |
| 2 | **How much** | Packs and an estimated price per pack, per line, with the stock-unit conversion and the line total shown beside each |
| 3 | **Why** | The reason - **required**, because management decides on that sentence - then when it is needed by, who from if known, and the whole order read back |

| Element | Behaviour |
|---|---|
| Suggest | Pre-fills everything at or below its reorder point, in whole packs (FR-PO-02) |
| From a shortfall | Pre-filled from a request (FR-REQ-06) |
| Approve / Reject | **Management only.** The storekeeper sees the status, not the buttons (FR-PO-04) |
| Reject | Requires a reason (FR-PO-05) |
| Open order | Shows ordered, received and outstanding per line |
| Close short | Management, with a reason (FR-PO-07) |

The storekeeper's view says why the buttons are absent: **"Waiting for
management to approve."** A greyed-out control with no explanation reads as a
bug.

### 4.12 Returning stock - on Requests

**Route:** `/requests` · **Roles:** management, storekeeper, kitchen, cleaning ·
**Implements:** FR-RET-01 to 06

**There is no separate screen for this.** A section returns stock from the
request that delivered it, because that is the same moment and the same object:
the chef is looking at the release that just arrived, and what they want to say
about it is "this was wrong".

A row at **released** or **received** that belongs to this login carries a
**Return** button beside *It came*. It opens a drawer listing that request's
lines.

| Element | Behaviour |
|---|---|
| Each line | released · already back · what you hold · **at most N can go back** |
| The quantity box | Capped at `qtyReturnable`, and disabled at zero |
| Item picker | **There is none.** The lines are the request's lines |
| Reason | Required, from the return list |
| Note | Labelled with who reads it: the storekeeper, before arguing with the supplier |
| On save | One document per line. A partial failure names the lines that did not go |
| After saving | The row keeps its released quantity and gains an amber line: *Vodka - imported 200 ml went back to the store* |
| Once fully returned | The Return button becomes a **Returned** tag, *It came* disappears, and the row leaves the Needs-me queue. The quantity asked for never changes - a request is history |
| Past the window | Reads **Too old to return** rather than silently dropping the button, with the reason and the alternative on hover |

**The cap is the point of the screen.** A bar holding 2.4 L of vodka that was
released 483 ml on this request can hand back 483 ml. The earlier design offered
every item the section handles and checked only the current balance, which made
a return a way of moving stock the section had never been given.

### 4.13 Returns - the store's side

**Route:** `/returns` · **Roles:** management, storekeeper ·
**Implements:** FR-RET-01d, FR-RET-18 to 20

**Route:** `/returns` · **Roles:** management, storekeeper *(CR-005: the two
roles see different screens - see below)*

Three panels, in the order the questions are asked.

| Panel | What it answers |
|---|---|
| **Waiting for you / for management** | Returns nobody has approved yet. First, because it is the only thing on the page with a person held up behind it. Capped at five, with *"and N more, listed below"* - a queue, not a list |
| **Waiting to go back** | What is in quarantine right now, with a total value |
| **What happens next** | Stated in words, with a button to Supplier returns that **names the supplier** and carries the delivery, so the next screen opens filled in |
| **Came back off the floor** | The section returns, with reason, who, and whether each has gone to a supplier yet |
| *Something on our own shelf is bad* | **A drawer, not a panel.** The storekeeper's form for bad stock that never went to a section |

**The shelf form is a drawer because it is the rarest thing done on this screen
and it used to be the largest thing on it** - a four-field form at the bottom of
a page whose actual job is "look at this and decide".

**What management sees instead** *(CR-005)*: no shelf drawer and no *Send it
back* button. Both are refused by the server, so offering them would be a 403 at
the end of a filled-in form. The quarantine panel stays, as information rather
than a to-do — money that has been paid for and cannot be used — and points at
Supplier returns, where their half of the job is.

**The middle panel is the point of the rewrite.** Returns moved stock into
quarantine correctly and then said nothing more: no list, no count, no next
step. The goods were in the right place and invisible, which for a storekeeper
is the same as lost. A **Returns** tile on the home screen carries the count so
nobody has to go looking.

### 4.14 Supplier returns

**Every screen opens with the lifecycle spelled out** - Raised (storekeeper),
Approved (management), Gone (storekeeper, *and this is the step that moves
stock*), Settled (management). The status labels do not carry it on their own:
nothing in "Approved, not yet sent" says that sending is a separate act by a
different person, or that the stock has not moved yet.

**The two roles see different halves** *(CR-005)*. The storekeeper gets the
suggestion panel and the delivery form, and *It has gone*; management gets a
*Waiting for your decision* queue with the credit value on it, Approve/Reject,
and the settle actions - and a plain statement of what their part is. Both see
the same list, because both need to know where a return has got to. On an
approved row, management reads *"Waiting for the store to send it"* rather than
a row that simply stops having buttons.

**The ask is a drawer, not a panel.** It used to sit permanently below the
suggestions, so pressing *Use this* filled in a form somewhere under the fold
and the screen gave no sign anything had happened. A form needed only once you
have decided to raise something has no business being the tallest thing on a
screen you mostly come to read.

**Quantities on it are counted in packs, and the screen says so.** The column is
headed *"Send back — in packs"* and each box shows the stock-unit equivalent
beneath it: `0.4` under a 5 L can reads `= 2 L`. A credit note is written in
packs, so a part pack is ordinary and has to be enterable — but an unlabelled
`0.2` against a litre of bleach reads as a bug, and was reported as one.

**Only the lines quarantine actually holds something of are listed.** The rest
of the invoice is not shown, greyed or otherwise: those rows can never be filled
in, because a claim may only be made against goods physically on the quarantine
shelf. A delivery of six things where one is bad was putting five permanently
dead rows around the one that mattered.

Nothing is lost by it. If more of the same delivery turns out to be bad it has
to be handed back into quarantine first, and at that moment it appears here on
its own. The whole invoice is readable any time under **Deliveries**.

Choosing a delivery with nothing in quarantine gives a plain statement of that,
not an empty table.

**Sending the ask closes the drawer**, clears it, and refreshes both lists: the
ask joins the record below, and the goods leave *Ready to send back* because
they are now spoken for. Leaving the form open over a delivery whose quantities
had just been cleared read as though nothing had happened.

**Route:** `/supplier-returns` · **Roles:** management, storekeeper ·
**Implements:** FR-RET-07 to 17

**It opens filled in.** A **Ready to send back** panel at the top lists what is
in quarantine already worked out into returns - delivery, reason, pack
quantities, credit - and *Use this* loads one into the form below. Arriving from
the Returns screen with a delivery named, or with only one thing in quarantine,
it fills itself without being asked.

The panel says plainly that the delivery is the most recent one with packs left
to return, because nothing in the ledger ties a crate to an invoice. Everything
stays editable: a guess that could not be corrected would be worse than an empty
form.

**Built around the delivery, not the item.** Pick the invoice it arrived on and
the pack, the conversion and the price come with it.

| Element | Behaviour |
|---|---|
| Delivery picker | Supplier, invoice number and date |
| Line table | Delivered · already back · **in quarantine** · send back · credit |
| The quantity box | Capped at the lesser of what is still returnable and what quarantine holds. **Disabled at zero**, which is most lines |
| Credit | Priced from the invoice, live as you type |
| Status | Waiting for a decision · Approved, not yet sent · Sent · Settled · Rejected |
| Buttons | Change with the status, and with the role. Only management sees Approve, Reject and the settlement buttons |

**Marking it gone is the only button that moves stock.** Raising and approving
are paperwork, and the screen does not pretend otherwise.

A credit settled for less than was asked shows the shortfall in amber beside
it. That number is the reason the outcome is recorded at all.

### 4.15 Reports

**Route:** `/reports` · **Roles:** management only · **Implements:** FR-RPT-01 to 15

Tabs, with a shared date range at the top. This is the one screen read sitting
down, so it can be dense.

| Tab | Shows |
|---|---|
| **Usage variance** | Item, theoretical, actual, variance qty, variance value, % |
| **Shrinkage** | Item, section, date, quantity, value. Subject to both floors |
| **Price movement** | Supplier, item, pack, old, new, %, date discovered |
| **Wastage** | Grouped by reason, drillable to item and document |
| **Stock-outs** | Items that hit zero with dates; items below reorder now |
| Operations | Open POs · Service level · Supplier performance · Valuation · Dead stock · Consumption · Count accuracy |

**Empty states are worded carefully.** "No unexplained losses above LKR 100 and
2% in this period" - not "No data". The first tells management the report ran
and found nothing, which is the answer they wanted. The second reads like a
fault.

### 4.16 Logins

**Route:** `/users` · **Roles:** admin only · **Implements:** FR-ADM-01 to 08

**Add someone - four fields.**

1. Their name - this becomes the tile they tap
2. What they do - the five roles, each with a sentence saying what it means
3. Which branch - or "All branches"
4. A 4-digit PIN - with a **Suggest one** button

**Then the PIN is shown once, large, in plain text**, with:

> **Read this to them now. It will not be shown again.**
>
> # 4 8 2 1

This is deliberate (FR-ADM-03). Hiding it produces a sticky note on the tablet,
which is worse.

**The list**

| Situation | Action |
|---|---|
| Forgot their PIN | **New PIN** - generates one and shows it once |
| Locked out | **Unlock** - clears it without changing the PIN |
| Someone leaves | **Switch off** |
| They come back | **Turn back on** |
| Last admin | Switch off is disabled, with the reason shown (FR-ADM-07) |

The word "delete" appears nowhere. Nobody is deleted (FR-ADM-06).

### 4.17 Setup

**Route:** `/setup/*` · **Roles:** admin only · **Implements:** FR-SET-01 to 12

Four screens. Used rarely, by one careful person at a laptop, so they can be
denser and more form-like than anything else in the system.

| Screen | Contents |
|---|---|
| **Branches and sections** | Branch, then its sections. Each section has a **kind** from a fixed list of six, including **Quarantine**, which every branch needs before anything can be returned. A new branch arrives with its main store already created |
| **Products** | Categories, then items. Each item: code, name, category, **stock unit**, par level, reorder point, shelf life, critical flag. Then **packs** - several per item, each with how many stock units it holds |
| **Suppliers** | Supplier and contact. Then agreed prices per pack with an effective date |

**Two things the section form deliberately will not let you do:**

1. **Invent a new kind.** The list of six is fixed. A section of an unknown
   kind is a room no role can reach - created successfully, visible to nobody
   (FR-SET-04). The form explains this rather than just omitting the option.
2. **Delete anything.** Everything deactivates (FR-SET-11).

**The pack form carries a warning**, because this is the field that quietly
ruins a system:

> **How many grams are in one of these?** Check it physically. If this number
> is wrong, every figure about this item will be wrong and nobody will notice
> for months.

### 4.18 Opening stock

**Route:** `/opening` · **Roles:** storekeeper, management ·
**Implements:** FR-OPN-01 to 03

Used once per section, at cutover.

| Element | Behaviour |
|---|---|
| Section | Only sections that have never held stock are offered |
| Lines | Item, quantity on the shelf, and **what it is worth** |
| Already opened | The section is absent from the list, with the reason: "This section has already been opened. Use a stock count instead." |

The screen states its own finality: **"A section can be opened once. After this,
a difference is a discrepancy, not a starting point."**

---

## 5. Wording standards

The words are part of the specification. These are the ones that matter.

| Do not write | Write |
|---|---|
| "No data" | "Nothing waiting" / "No losses above your floors in this period" |
| "Error 500" | "Something went wrong saving that. Try again." |
| "Invalid input" | "Enter a number of packs." |
| "Unauthorized" | "You cannot release your own request. Someone else must." |
| "Delete user" | "Switch off" |
| "Are you sure?" | "Finish this count? You will not be able to change it." |
| "Submit" | "Save delivery" / "Send request" / "Finish count" |
| "Qty" | "Quantity" |

**Every disabled control says why it is disabled.** Every refusal says what to
do instead. A screen that says no without saying why is a screen someone stops
using.

## 6. States every screen must define

| State | Requirement |
|---|---|
| Loading | A skeleton or spinner, never a blank screen |
| Empty | Says what to do next (G4) |
| Error | Plain sentence plus a Retry |
| Offline | "You are offline. This will not save until you reconnect." The system is online-only (SRS CON-02) and must say so rather than appearing to work |
| Saving | Button disabled and labelled "Saving…" |
| Saved | Confirmation naming what was saved |
| Refused | The reason, in plain English |

## 7. Deferred to Phase 1 delivery

Documented so nobody is surprised at UAT.

| # | Not in Phase 1 | Consequence |
|---|---|---|
| UI-D1 | **No transfers screen** (FR-TRF-04) | Transfers are API-only |
| UI-D2 | **No screen for changing a role** (FR-ADM-08) | Command-line script |
| UI-D3 | **No screen for issue windows** (FR-SET-12) | Database only |
| UI-D4 | **No CSV import** (FR-DAT-04) | Items typed one at a time |
| UI-D5 | Not installable as an app | Runs in a browser tab |
| UI-D6 | No offline support (CON-02) | A dropped connection during a count loses that count |

---

## Sign-off

The Client confirms this describes the screens to be delivered, including the
deferrals in §7.

**For [FILL: client legal entity name]**

| | |
|---|---|
| Name | |
| Signature | |
| Date | |

**For TriniphiX (Pvt) Ltd**

| | |
|---|---|
| Name | |
| Signature | |
| Date | |
