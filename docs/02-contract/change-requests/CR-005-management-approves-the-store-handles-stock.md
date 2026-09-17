# Change Request Form

**Project:** The Grand - inventory management system
**Under:** MSA TPX-MSA-[FILL] · SOW TPX-SOW-[FILL] · Change Request Procedure (Annexure C)

| | |
|---|---|
| **CR number** | CR-005 |
| **Title** | Management approves; the store handles stock |
| **Raised by** | [FILL: name], The Grand Gastrobar |
| **Date raised** | [FILL] |
| **Priority** | ☐ Urgent ☒ High ☐ Medium ☐ Low |
| **Status** | ☐ Raised ☐ Assessing ☐ Awaiting decision ☒ Approved ☐ Rejected ☐ Deferred ☐ Complete |

---

## Part A - The request

### A1. What is the business problem?

Management can do the storekeeper's job as well as their own. Today a manager
can release stock against a request, move stock into quarantine, raise a
supplier return and mark it gone — and then approve all of it themselves.

That is the one thing the rest of the system is built to prevent. The signed SRS
records three separation-of-duties rules, each of them the same idea: a check is
only a check if it is a second person. Giving the approver the ability to
perform the act as well makes the approval a formality by the person who already
did the thing.

It also produces a screen that misleads. A manager opening **Requests** sees a
*Needs me* queue full of other people's arrivals, and a **Release** button
against requests they have no business filling; the store's shelf is not theirs
to hand out of, and only the storekeeper can see what is really on it.

### A2. Who has this problem, and how often?

Every management login, on every request, return and supplier return. Two
management logins exist at the Gastrobar.

### A3. What happens today, and what does it cost?

Nothing is being abused — the practice today is that Sunil releases and Nuwan
approves. The cost is that the system does not require it, so the audit trail
records a control that is not actually enforced, and the first time somebody
covers a shift the habit quietly breaks.

### A4. What would good look like?

One rule, readable off the permission matrix in a sentence: **management
decides, the store handles stock, and neither does both.**

Management keeps every approval — releases are not theirs, but returns,
purchases, wastage, counts and credit notes all still come to them — and keeps
read access to everything, including the five reports.

### A5. Is there a deadline, and what drives it?

Before go-live and before training, so the rule is learned once.

### A6. What happens if this is not done?

The separation is a convention rather than a control, and an auditor reading the
permission matrix is told something the system does not enforce.

---

## Part B - Assessment

| | |
|---|---|
| Assessed by | [FILL] |
| Date assessed | [FILL] |

### B1. Classification

☒ **Change** - the signed SRS grants management these rights explicitly. Chargeable.
☐ **Defect**
☐ **Configuration**
☐ **Clarification**

The signed SRS §4.2 shows Management with a dot in every row the storekeeper
has. The system implemented that faithfully. This narrows it.

**Reference in the signed SRS:** §4.2 permission matrix; §4.3 separation of
duties; FR-ISS-03 (release), FR-RET-01/04 (returns).

### B3. Proposed solution

```
Four role guards narrowed from ('management','storekeeper') to ('storekeeper'):

  POST /requests/:id/release        release stock against a request
  POST /returns                     put stock into quarantine
  POST /supplier-returns            raise a return to a supplier
  POST /supplier-returns/:id/send   mark it gone

...plus the two reads that exist only to fill in that form
(GET /grn/:id/returnable and GET /supplier-returns/suggested), so management is
not offered inputs to a document they cannot submit.

me/context.canRelease becomes storekeeper-only, which is what the screens read.

Management keeps: approve a section return, decide a supplier return, settle it,
approve wastage, verify a count, approve a purchase, reverse a document, and
every report.
```

### B4. Options considered

| Option | Description | Effort (days) | Cost (LKR) | Recommendation |
|---|---|---|---|---|
| 1 | Narrow all four, at the API and in the screens | [FILL] | [FILL] | **Recommended** |
| 2 | Hide the buttons, leave the API open | [FILL] | [FILL] | No - that is presentation, not a control, and the SRS would still overstate what is enforced |
| 3 | Narrow release only | [FILL] | [FILL] | No - the supplier-return path is where actual money moves |
| 4 | Do nothing | 0 | 0 | No - see A6 |

### B6. What this touches

| Area | Affected? | Notes |
|---|---|---|
| Database schema / migration | ☐ | None |
| Stock ledger or its rules | ☐ | Same documents, same writer |
| API endpoints | ☒ | Six role guards narrowed. No endpoint added or removed |
| Screens | ☒ | Requests loses the Release button and the *Needs me* tab for management; Returns loses the shelf drawer and *Send it back*; Supplier returns loses the raise form and *It has gone*, and gains a *Waiting for your decision* panel |
| Reports | ☐ | Unchanged. Management still sees all five |
| Roles and permissions | ☒ | Six rows of the matrix |
| Existing data | ☐ | None |
| Automated tests | ☒ | **Three added, two inverted.** See below. 137 tests pass |
| Demo/seed data | ☐ | None |
| User Manual | ☒ | |
| Administrator Manual | ☒ | |
| Training | ☒ | Management session: approvals, not handling |
| UAT scripts | ☒ | The management scripts that released stock now assert refusal |

**Tests.** `requests.test.ts` had a test named *"lets management release too,
not only the storekeeper"*; it is now *"will not let management release,
however senior they are"*, and additionally asserts the request is left
untouched — a refusal must not half-release. `returns.test.ts` gains two:
management cannot raise a supplier return or mark it gone (and the same test
walks the correct path to prove the chain still completes), and management
cannot hand stock back on a section's behalf.

**A defect found alongside.** The `needsMe` filter on the request list was built
from the sections a person can *see*, while the flag on each row was built from
the sections they *belong to*. The storekeeper, who can see the whole branch,
was handed a queue of other people's arrivals with every row flagged as not
theirs. Both now read the same set. Logged as **D-002**, fixed free.

### B9. Does this weaken a core design property?

| Property | Weakened? | If yes, explain |
|---|---|---|
| The ledger is append-only and enforced by the database | ☐ | |
| Stock is derived from the ledger, never stored | ☐ | |
| Controllers never write the ledger directly | ☐ | |
| Counts are blind, and expected is frozen at open | ☐ | |
| Documented waste is excluded from the loss report | ☐ | |
| The system warns rather than blocks | ☐ | These are refusals, not warnings - but they are refusals of *authority*, which is the one thing the system has always blocked outright |
| Separation of duties - no self-approval | ☐ | **This is the point.** Three rules become nine, and all of them are now enforced rather than assumed |
| Everything is stored in the small unit; packs convert once | ☐ | |

> No box ticked.

**The operational risk, stated plainly.** If the storekeeper is absent, nobody
releases stock. That is a real cost and it is accepted deliberately: the answer
is a second storekeeper login, which costs nothing and takes a minute
(Administration → Logins), not a manager reaching past the control. The
Administrator Manual says so at the point where it matters.

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
| SRS updated to version | 1.3 |
| Tests added | Three added, two inverted. Suite at **137 passing**, plus `scripts/check-returns.mjs` which asserts the role split end to end |
| Manuals updated | ☒ User ☒ Administrator ☐ Not required |
| UAT scripts updated | ☒ Yes ☐ Not required |
| Accepted by | [FILL] on [FILL] |
