# Change Request Form

**Project:** The Grand - inventory management system
**Under:** MSA TPX-MSA-[FILL] · SOW TPX-SOW-[FILL] · Change Request Procedure (Annexure C)

| | |
|---|---|
| **CR number** | CR-003 |
| **Title** | Returns: a section hands stock back, the store hands it to the vendor |
| **Raised by** | [FILL: name], The Grand Gastrobar |
| **Date raised** | [FILL] |
| **Priority** | ☐ Urgent ☒ High ☐ Medium ☐ Low |
| **Status** | ☐ Raised ☐ Assessing ☐ Awaiting decision ☒ Approved ☐ Rejected ☐ Deferred ☐ Complete |

---

## Part A - The request

### A1. What is the business problem?

A delivery arrives, the store releases it to the kitchen, and the kitchen opens
it to find the goods are not fit to use. There is nowhere for them to go.

The system offered two instruments and both said something untrue:

- **Wastage** says the food was destroyed and nobody owes anybody anything. The
  crate is standing on the bench and the supplier owes for it.
- **Reversing the GRN** says the delivery never happened. It did happen; it was
  simply wrong.

So in practice nothing was recorded. The stock stayed on the books until the
next count found a gap, and that gap arrived in the **shrinkage** report - the
one that means somebody took it.

### A2. Who has this problem, and how often?

The kitchen and the storekeeper. Not daily, but the money is not small: a
rejected box of fish is several thousand rupees, and a supplier who is never
charged for one has no reason to improve.

### A3. What happens today, and what does it cost?

Nothing is recorded. Nobody knows what is owed by whom, and there is no list
anyone can chase.

### A4. What would good look like?

The kitchen hands it back to the store, the store hands it to the supplier, and
at the end of the month somebody can answer: what went back, why, to whom, and
did the money ever come.

### A5. Is there a deadline, and what drives it?

Before go-live, so it is trained once.

### A6. What happens if this is not done?

Faulty deliveries continue to be absorbed as unexplained loss, and the
shrinkage report keeps accusing staff of a supplier's mistake.

---

## Part B - Assessment

| | |
|---|---|
| Assessed by | [FILL] |
| Date assessed | [FILL] |

### B1. Classification

☒ **Change** - not in the signed SRS. Chargeable.

Wholly new scope. `return` has been a member of the `doc_type` enum since
`0001_init` and has never been written; it is the document type both new
documents post under.

**Reference in the signed SRS:** not covered.

### B3. Proposed solution

```
Two documents, because two different things happen and they answer to
different people.

  section_returns    a section hands stock back into quarantine
  supplier_returns   the store hands it to the vendor, with lines

WHEN THE LEDGER MOVES, and why it differs:

  A section return moves stock IMMEDIATELY, both legs -- out of the kitchen and
  into quarantine. The crate is already on its way to the store; holding the
  row back until a manager is free would leave the section figure knowingly
  wrong for as long as that took. Management approves afterwards. This is the
  wastage rule, unchanged.

  A supplier return moves stock ON SEND and at no other point. Raising it is
  paperwork and the crate is still ours; approval is management agreeing to
  spend; sending is the moment the goods leave the building. Settlement happens
  weeks later and moves nothing.

QUARANTINE IS A SECTION, NOT A FLAG.

  Returned goods land in a section of kind QUARANTINE rather than back on the
  main store's shelf. A flag on a quantity would be the first stored piece of
  stock state in this system, and the design rests on stock being derived from
  movements. More practically: faulty goods sitting in the store's balance are
  goods the kitchen can ask for again tomorrow.

  Nothing is ever issued out of quarantine -- requests are filled from the
  section marked is_store, and this is not it. A section login never names it:
  it returns FROM its own shelf and the server resolves the destination.

TIED TO A DELIVERY.

  Every supplier-return line points at a GRN line, which carries the pack, the
  conversion and the price actually paid. The credit is worked out from what
  was invoiced rather than from today's price list.

COST.

  A return is not a receipt, so the ledger values it at the running weighted
  average like any other outgoing movement -- the cost of what left. The money
  the supplier owes is a different number and lives on supplier_return_lines.
  They can legitimately differ, and forcing the ledger to the invoice price
  would revalue the stock that stayed on the shelf.
```

### B4. Options considered

| Option | Description | Effort (days) | Cost (LKR) | Recommendation |
|---|---|---|---|---|
| 1 | Two documents, quarantine section, tied to a GRN line, full settlement lifecycle | [FILL] | [FILL] | **Recommended** |
| 2 | One "return" document straight from the section to the supplier | [FILL] | [FILL] | No - the goods physically sit somewhere between the two, and a system that says otherwise cannot answer "what is waiting to go back" |
| 3 | Return to normal store stock, no quarantine | [FILL] | [FILL] | No - the kitchen can then be issued the same faulty goods tomorrow |
| 4 | Record the paperwork, do not move stock | [FILL] | [FILL] | No - the stock figure stays wrong, which is the problem being solved |
| 5 | Do nothing | 0 | 0 | No - see A6 |

### B6. What this touches

| Area | Affected? | Notes |
|---|---|---|
| Database schema / migration | ☒ | `0007_returns.sql`: `section_returns`, `supplier_returns`, `supplier_return_lines`, two status enums, five return reason codes |
| Stock ledger or its rules | ☒ | Writes under the existing `return` doc type. No new rule, no new writer - `postDocument` unchanged |
| API endpoints | ☒ | `POST/GET /returns`, `POST /returns/:id/approve`, `GET /grn/:id/returnable`, `POST/GET /supplier-returns`, `/decide`, `/send`, `/settle` |
| Screens | ☒ | Return to store (all stock-holding roles); Supplier returns (management, storekeeper). Both front ends |
| Reports | ☒ | **See below - three existing reports would have been wrong** |
| Roles and permissions | ☒ | New `QUARANTINE` section kind, owned by the storekeeper. The five roles are unchanged |
| Existing data | ☒ | Seed gains a quarantine section per branch and three worked returns |
| Automated tests | ☒ | `returns.test.ts`, 18 tests. Suite at 122 |
| User Manual | ☒ | |
| Administrator Manual | ☒ | Quarantine section at go-live |
| Training | ☒ | Two new screens |
| UAT scripts | ☒ | New section N |

**The report work is the part that would have been missed.** Three existing
reports read `doc = 'issue'` and would have counted returned stock as consumed:

| Report | What was wrong | Fix |
|---|---|---|
| Usage variance | A kitchen sent 40 kg of fish that returned 12 kg read as having used all 40, against unchanged recipe theory. The report that catches over-issuing would have flagged the kitchen for food it never had | The view nets return-out off issue-in, and excludes quarantine |
| Consumption by section | Overstated every room's usage by whatever it sent back | Same netting, plus a `having` so a fully returned line disappears rather than showing zero |
| Supplier performance | Returned goods still counted as delivered and paid for | New columns: returned value, credited, net spend, return rate |

Plus a new **Returns and credits** report: why stock is coming back, grouped by
reason, and what is still owed.

### B9. Does this weaken a core design property?

| Property | Weakened? | If yes, explain |
|---|---|---|
| The ledger is append-only and enforced by the database | ☐ | Two more document types writing through the same single writer |
| Stock is derived from the ledger, never stored | ☐ | **Deliberately protected.** Quarantine is a section precisely so that "these goods are not usable" is a location rather than a stored flag |
| Controllers never write the ledger directly | ☐ | `services/returns.ts` calls `postDocument`; the ESLint rule holds |
| Counts are blind, and expected is frozen at open | ☐ | |
| Documented waste is excluded from the loss report | ☐ | **Extended.** A documented return is now excluded from shrinkage for the same reason, and asserted by a test |
| The system warns rather than blocks | ☐ | Three refusals, all about physical impossibility rather than process: cannot return more than the section holds, cannot send more than quarantine holds, cannot return more than the delivery brought |
| Separation of duties - no self-approval | ☐ | **Extended.** You cannot approve a return you made; management alone decides a supplier return |
| Everything is stored in the small unit; packs convert once | ☐ | Supplier returns are entered in packs and converted once, on entry, from the original GRN line |

> No box ticked. The one judgement worth recording is the third refusal: goods
> must be in quarantine before they can go to a supplier. It blocks rather than
> warns because the alternative is a credit note for stock that is still on a
> shelf.

---

## Part C - Decision and authorisation

| | |
|---|---|
| Decision | ☒ **Approved** ☐ **Rejected** ☐ **Deferred to** [FILL] |
| Option selected (from B4) | Option 1 |
| Agreed cost | **LKR [FILL]** (exclusive of tax) |
| Agreed timeline impact | **[FILL] Business Days** |

### Authorisation

By signing, both parties agree that this change is added to the scope of SOW
TPX-SOW-[FILL], that the contract price is varied by the amount above, and that
the dates in the milestone plan move as stated.

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

---

## Part D - Completion

| | |
|---|---|
| Delivered on | [FILL] |
| SRS updated to version | 1.3 |
| Tests added | 18, in `returns.test.ts`. Suite at 122 passing |
| Manuals updated | ☒ User ☒ Administrator ☐ Not required |
| UAT scripts updated | ☒ Yes - new section N, U-150 to U-160 |
| Accepted by | [FILL] on [FILL] |

---

## Part E - Amendment CR-003a, after first use

Raised by the Client on first look at the built screens.

**What was wrong.** A section return was free-form: its own screen, an item
picker offering everything the section handles, and the only check was the
section's current balance. A chef could hand back stock nobody had ever released
to them. The Client's words: *they can make any item return no matter it came or
not.*

**What changed.**

| | |
|---|---|
| Where it happens | Sections return from **Requests**, against the release that delivered the goods. The separate screen is gone from their menu |
| The cap | Released on that request, less already returned, and never more than the section holds. All three figures appear in the refusal |
| The item | Comes from the request's lines. There is no item picker |
| The store | Keeps a screen of its own (**Hold for return**), because its stock arrives on a delivery and has no release to measure against. Constrained downstream by the GRN-line and quarantine rules |
| New endpoint | `GET /requests/:id/returnable` |
| Requirements | FR-RET-01 rewritten; FR-RET-01a to 01d added |
| Tests | Five added, 23 in `returns.test.ts`. Suite at 127 |

**Two follow-on defects, raised on the next look at the screens:**

3. **A return left no trace on the request it came from.** The Client returned
   200 g and reported *it still shows in kitchen*. The stock had moved
   correctly; the row had not changed, because a request records what was
   released and does not shrink. Correct, and not believable. The row now
   carries the returned quantity as well, and the Return action is withdrawn
   once nothing on that request could still go back.

4. **Nothing said where the goods had gone or what to do next.** The Client's
   question: *where it displays in the main store, what happens next.* The
   answer was "on the Supplier returns screen, if you already know to look
   there", which is not an answer. The store's screen is now a **Returns**
   screen that leads with what is in quarantine and its value, states the next
   step in words with a link to it, and lists what came back off the floor. A
   **Returns** tile on the Overview carries the count so nobody has to go
   looking.

**One more, on the next pass:**

8. **"Send it back to the supplier" landed on an empty form.** The Client's
   words: *do not allow user to fill, keep the details filled, so nothing need
   to add those again by user.* The button moved the storekeeper to a screen
   that asked them to reconstruct from memory what was already in the database:
   which delivery, which reason, how many packs. The form now arrives filled in
   from what is in quarantine, and the button names the supplier it is sending
   to. Two things worth recording:

   - The **delivery is a guess** and stays editable. Nothing in the ledger ties
     a crate in quarantine to the invoice it arrived on, so the system proposes
     the most recent delivery of that item with packs still returnable, and says
     on screen that is what it has done.
   - Proposed quantities are **rounded down**. Found the hard way: 2,148 g of a
     1 kg pack rounded to 2.15 packs, two grams more than existed, and the
     service refused it - an error on a form nobody had filled in. A suggestion
     that cannot be submitted as offered is worse than no suggestion.

**Three more on the following look, all in the same area:**

5. **A fully returned request still asked to be confirmed.** It sat in the
   chef's *Needs me* queue with an *It came* button, asking them to confirm the
   arrival of goods already in quarantine. Fixed at the root: **a return
   acknowledges receipt**, because you cannot send back what never came. The
   request is marked received by whoever returned it, and drops out of the
   queue.

6. **A five-week-old release was still returnable.** The only test was whether
   the section held any of the item, which any old request passes: the bar holds
   wine, so a request from 8 August offered to return wine that arrived in
   September. **Returns now close seven days after the release**, because after
   that nobody can say the shelf holds what came in on it. The refusal names the
   alternative - wastage, or let the count find it. Seven days is a guess and
   goes on the Phase 0 list with the shrinkage floors.

7. **A request with nothing left to return still read as outstanding work.**
   Now it leaves the queue, offers no confirmation and no Return, and the row
   reads *Done · Returned*.

**Two defects found alongside it, both pre-existing:**

1. **Every filter row in the console rendered as unstyled running text** -
   `.app-filters` and `.app-filter` were defined in the first build's stylesheet
   and never carried into the console's. Six screens looked broken in the same
   way: *AllKitchenBakery and pastryBar*. The console now has its own, in its
   own idiom - a row of tabs on a rule with the open one underlined in brass.

2. **Seeded requests showed the status word "issued"** - a value that predates
   `0003_simple_roles.sql`, which replaced it with `released` → `received`.
   Neither front end's label map had an entry for it, so the chip rendered the
   raw word. The seed now writes `received` with a confirmation, which is what
   sixty-day-old requests actually are.

---

**Note for whoever runs the cutover.** Every branch needs a **Quarantine**
section before anybody can return anything. New branches do not get one
automatically; it is added under Setup → Branches and sections, and the return
screen refuses with that instruction if it is missing.
