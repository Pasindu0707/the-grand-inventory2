# Change Request Form

**Project:** The Grand - inventory management system
**Under:** MSA TPX-MSA-[FILL] · SOW TPX-SOW-[FILL] · Change Request Procedure (Annexure C)

| | |
|---|---|
| **CR number** | CR-006 |
| **Title** | One decision about bad stock: back to the supplier, or in the bin |
| **Raised by** | [FILL: name], The Grand Gastrobar |
| **Date raised** | [FILL] |
| **Priority** | ☐ Urgent ☒ High ☐ Medium ☐ Low |
| **Status** | ☐ Raised ☐ Assessing ☐ Awaiting decision ☒ Approved ☐ Rejected ☐ Deferred ☐ Complete |

---

## Part A - The request

### A1. What is the business problem?

Two problems, and they are the same problem.

**The chain is longer than the conversation.** Bad stock took five steps and
**two** management approvals: the kitchen hands it back, management approves the
hand-back, the storekeeper writes up a supplier return, management approves that
too, the storekeeper sends it. In the store the conversation is one question -
*the fish is off; do we claim it or bin it?* - and the software made it into
two documents and two approvals, one of which decided nothing.

The first approval approved a movement that **had already happened**. The stock
left the kitchen when the chef carried the crate out; approving it afterwards
blocked nothing, changed nothing, and produced a queue of rows whose only
available action was to agree with the past.

**The common ending had no route at all.** Suppliers frequently will not take
goods back. There was no way to say so: the storekeeper logged wastage against
the quarantine section, which worked, was approved by nobody, appeared in no
process document, and was discovered by reading the code.

### A2. Who has this problem, and how often?

Every return, which is every week. Management twice per return, the storekeeper
across two screens, and whoever has to explain the flow to a new starter.

### A3. What happens today, and what does it cost?

A manager's approval that means nothing teaches people that approvals mean
nothing. And bad stock the supplier refuses either sits in quarantine
indefinitely - paid for, unusable, on nobody's list - or is quietly written off
with no decision behind it.

### A4. What would good look like?

The store asks management **one question**, with the delivery, the packs and the
money already worked out:

> 5 kg cuttlefish, delivery 295, worth LKR 20,835 - claim it, or bin it?

Management answers **line by line**. That answer is the only approval in the
chain. The store then carries it out: one button to mark it gone, one button to
bin it.

### A5. Is there a deadline, and what drives it?

Before training. Teaching the five-step version and then replacing it wastes the
session that decides whether people use the system.

### A6. What happens if this is not done?

The write-off route stays undocumented and unapproved, and the hand-back
approval stays as a queue of stamps - which is how a control becomes a habit
people click through.

---

## Part B - Assessment

| | |
|---|---|
| Assessed by | [FILL] |
| Date assessed | [FILL] |

### B1. Classification

☒ **Change** - the signed SRS describes both approvals. Chargeable.
☐ **Defect**
☐ **Configuration**
☐ **Clarification**

Part of it is arguably a **gap** rather than a change: the SRS never says what
happens when a supplier refuses, and the system's answer was an undocumented
side door. That half is delivered free; the restructuring of the approvals is
the chargeable part.

**Reference in the signed SRS:** §4.2 permission matrix (Approve a return);
FR-RET-02 (hand-back approval), FR-RET-05 (supplier return decision).

### B3. Proposed solution

```
A supplier return becomes an ASK, and each of its lines carries a DECISION.

  supplier_return_lines.decision text check (decision in ('vendor','waste'))
  supplier_return_lines.wastage_id bigint references wastage(id)

POST /supplier-returns/:id/decide  (management)
    takes one answer per line; a partial answer is refused with 400.
    Answering also accepts the hand-back - the separate approval is withdrawn.

POST /supplier-returns/:id/bin     (storekeeper)
    posts an ordinary wastage document per 'waste' line, out of quarantine,
    under a new reason code BADGOODS - "Bad goods, not taken back".
    Idempotent per line. An ask binned in full settles itself as written_off.

POST /supplier-returns/:id/send    (storekeeper)
    unchanged, except that it now posts only the 'vendor' lines.

POST /returns/:id/approve          WITHDRAWN.

section_returns.approved_by is kept and stays readable - it is history.
```

### B4. Options considered

| Option | Description | Effort (days) | Cost (LKR) | Recommendation |
|---|---|---|---|---|
| 1 | One ask, answered line by line, two endings | [FILL] | [FILL] | **Recommended** |
| 2 | One ask, one answer for the whole ask | [FILL] | [FILL] | No - a mixed pallet is ordinary, and forcing two asks for one delivery puts the paperwork back |
| 3 | Keep both approvals, add a "write off" button | [FILL] | [FILL] | No - fixes the missing ending and leaves the meaningless approval in place |
| 4 | Do nothing | 0 | 0 | No - see A6 |

### B6. What this touches

| Area | Affected? | Notes |
|---|---|---|
| Database schema / migration | ☒ | `0008_one_decision_disposals.sql`: two columns, one check constraint, one index, one reason code. No table renamed, nothing dropped |
| Stock ledger or its rules | ☐ | Same writer, same documents. Binning posts `wastage`, which already existed |
| API endpoints | ☒ | One withdrawn (`/returns/:id/approve`), one added (`/supplier-returns/:id/bin`), one reshaped (`/decide`) |
| Screens | ☒ | Returns loses its approval panel; Supplier returns gains the line-by-line answer and the *Bin them* button |
| Reports | ☒ | Binned stock now reaches **Wastage by reason** under its own code. Shrinkage is untouched - both endings carry a document |
| Roles and permissions | ☒ | Management loses the hand-back approval, gains the disposal decision. The store gains *Bin them* |
| Existing data | ☒ | Lines on decided returns are backfilled as `vendor`, which is what they were. Undecided ones stay undecided - they are waiting for the new question |
| Automated tests | ☒ | **Five added**, two rewritten. 144 pass. See below |
| Demo/seed data | ☐ | None |
| User Manual | ☒ | §7.3 and §8 rewritten |
| Administrator Manual | ☐ | |
| Training | ☒ | Shorter: one decision instead of two |
| UAT scripts | ☒ | The return scripts follow the new chain |

**Tests.** The new ones cover what did not exist: a half-answered ask is refused
and leaves nothing decided; the person who raised an ask cannot answer it; one
ask split between the supplier and the bin moves each line out of quarantine by
its own route, and only once; pressing *Bin them* twice bins the crate once; an
ask binned in full settles itself and then refuses to be sent. `check-returns.mjs`
drives the whole chain end to end and asserts the same.

**A defect found alongside.** Two tests were passing by luck - one counted
whichever stock line came back first, which became a zero-quantity line when the
kitchen's contents shifted, and the returns file signed in on every call, which
silently exceeded the twenty-a-minute login limit and failed as 401s that looked
like an authentication fault. Both fixed; logged as **D-005**.

### B9. Does this weaken a core design property?

| Property | Weakened? | If yes, explain |
|---|---|---|
| The ledger is append-only and enforced by the database | ☐ | |
| Stock is derived from the ledger, never stored | ☐ | |
| Controllers never write the ledger directly | ☐ | Binning goes through the same service path as any wastage |
| Counts are blind, and expected is frozen at open | ☐ | |
| Documented waste is excluded from the loss report | ☐ | **Strengthened.** A write-off that used to be an undocumented wastage entry is now a decision with a reason, an approver and its own code |
| The system warns rather than blocks | ☐ | The refusals here are refusals of authority and of incompleteness, which the system has always blocked |
| Separation of duties - no self-approval | ☐ | **Strengthened.** One meaningful approval replaces one stamp plus one decision, and the person who raises an ask cannot answer it |
| Everything is stored in the small unit; packs convert once | ☐ | |

> No box ticked. **One fewer approval, and it is the real one.**

---

## Part C - Decision and authorisation

| | |
|---|---|
| Decision | ☒ **Approved** ☐ **Rejected** ☐ **Deferred to** [FILL] |
| Option selected (from B4) | Option 1 |
| Agreed cost | **LKR [FILL]** (exclusive of tax) |
| Agreed timeline impact | **0 Business Days** |
| Revised acceptance date | Unchanged |

### Authorisation

By signing, both parties agree that this change is added to the scope of SOW
TPX-SOW-[FILL]. This form takes precedence over the SOW and the SRS to the
extent of the change.

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
| SRS updated to version | 1.4 |
| Migration | `db/migrations/0008_one_decision_disposals.sql` |
| Tests added | Five added, two rewritten. Suite at **144 passing**, plus `npm run check:returns` |
| Manuals updated | ☒ User ☐ Administrator ☐ Not required |
| UAT scripts updated | ☒ Yes ☐ Not required |
| Accepted by | [FILL] on [FILL] |
