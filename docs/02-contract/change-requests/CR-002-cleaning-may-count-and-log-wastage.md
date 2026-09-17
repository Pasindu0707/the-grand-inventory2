# Change Request Form

**Project:** The Grand - inventory management system
**Under:** MSA TPX-MSA-[FILL] · SOW TPX-SOW-[FILL] · Change Request Procedure (Annexure C)

| | |
|---|---|
| **CR number** | CR-002 |
| **Title** | Cleaning may count its own store and log wastage in it |
| **Raised by** | [FILL: name], The Grand Gastrobar |
| **Date raised** | [FILL] |
| **Priority** | ☐ Urgent ☒ High ☐ Medium ☐ Low |
| **Status** | ☐ Raised ☐ Assessing ☐ Awaiting decision ☒ Approved ☐ Rejected ☐ Deferred ☐ Complete |

---

## Part A - The request

### A1. What is the business problem?

Kitchen can count its own section and log wastage in it. Cleaning can do
neither, and nothing in the SRS ever said why.

The effect is that the one person who stands at the cleaning shelf can neither
count what is on it nor declare what they have broken. A split drum of
degreaser leaves the ledger believing it is still there. It stays believed
until somebody else counts the cleaning store - and then the loss surfaces in
the **shrinkage** report, which is the report that means somebody took it.

That is precisely the failure the design principles warn about: honest,
documented waste being reported as unexplained loss. It was avoided carefully
for the kitchen and left in place for cleaning.

### A2. Who has this problem, and how often?

The cleaning login, at every branch. Daily for wastage, weekly for a count.

### A3. What happens today, and what does it cost?

Nothing is recorded. Cleaning stock drifts until the storekeeper or a manager
counts that section, which is not on anybody's routine because the section
never appeared to hold anything (see B6, seed data).

### A4. What would good look like?

Cleaning is treated exactly as kitchen is: wastage and stock counts **in its own
section only**, with verification and approval still reserved to management.

### A5. Is there a deadline, and what drives it?

Before go-live and before training, so the cleaning staff learn one set of rules
rather than two.

### A6. What happens if this is not done?

Cleaning-store losses keep arriving as unexplained loss. The first time that
gets raised with a cleaner as a theft question, the report stops being trusted.

---

## Part B - Assessment

| | |
|---|---|
| Assessed by | [FILL] |
| Date assessed | [FILL] |

### B1. Classification

☒ **Change** - not in the signed SRS. Chargeable.
☐ **Defect** - the system does not do what the signed SRS says. **Fixed free.**
☐ **Configuration** - the Client can do this themselves. See B2.
☐ **Clarification** - the SRS is ambiguous; interpretation agreed, no charge.

Classified honestly as a **Change**: the signed SRS §4.2 permission matrix
leaves the Cleaning column blank for both rows, and the system implemented that
correctly. What the SRS never did was *justify* it - §4.3 records three
deliberate role gaps and this is not among them, which is why it reads as an
oversight carried into signature rather than a decision.

A separate genuine **Defect** was found in the same code and is logged as
**D-001**; it is fixed free.

**Reference in the signed SRS:** §4.2 permission matrix; FR-CNT-01, FR-WST-01.

### B3. Proposed solution

```
Add 'cleaning' to the role guards on POST /wastage, POST /counts/open and
POST /counts/:id/close, and to the wastage and counts entries in both front
ends' route permission tables.

Nothing else changes. Section scoping is untouched: assertSectionAllowed judges
on sectionsForUser, which gives a cleaning login the CLEAN sections and nothing
else, so cleaning gains its own store and reaches no further. Verification of a
count stays management-only, as does approval of wastage, and the
no-self-verification rule is unaffected.
```

### B4. Options considered

| Option | Description | Effort (days) | Cost (LKR) | Recommendation |
|---|---|---|---|---|
| 1 | Add cleaning to both guards, scoped to its own section | [FILL] | [FILL] | **Recommended** |
| 2 | Wastage only; leave counting to the storekeeper | [FILL] | [FILL] | No - then the cleaning store is only ever counted by someone who does not work at it |
| 3 | Do nothing | 0 | 0 | No - see A6 |

### B6. What this touches

| Area | Affected? | Notes |
|---|---|---|
| Database schema / migration | ☐ | None |
| Stock ledger or its rules | ☐ | Same documents, same writer |
| API endpoints | ☒ | Three role guards widened in `routes/documents.ts` |
| Screens | ☒ | Wastage and Stock count appear on the cleaning menu in both front ends |
| Reports | ☐ | Cleaning-store waste now reaches Wastage-by-reason instead of Shrinkage - which is the point, and is the existing behaviour of both reports, not a change to either |
| Roles and permissions | ☒ | Two rows of the matrix |
| Existing data | ☐ | None |
| Automated tests | ☒ | Three added to `documents.test.ts`: cleaning may waste and count its own store; may not reach the kitchen; may not verify its own count. 104 tests pass |
| Demo/seed data | ☒ | **See below** |
| User Manual | ☒ | |
| Administrator Manual | ☒ | |
| Training | ☒ | Cleaning session gains wastage and counting |
| UAT scripts | ☒ | Cleaning role allocation widened |

**Seed data.** The cleaning store held **exactly zero of every item on all sixty
demo days**: the generator issued a weekly top-up into it and consumed the whole
amount on the same day. A section that always reads empty cannot be counted, and
a count that finds nothing proves nothing - which is a large part of why this
gap survived review. The generator now draws the top-up down through the week
and leaves a working balance. Ledger rows rise from 10,995 to **11,490**.

### B9. Does this weaken a core design property?

| Property | Weakened? | If yes, explain |
|---|---|---|
| The ledger is append-only and enforced by the database | ☐ | |
| Stock is derived from the ledger, never stored | ☐ | |
| Controllers never write the ledger directly | ☐ | Same services |
| Counts are blind, and expected is frozen at open | ☐ | Unchanged - a cleaning count is blind like any other |
| Documented waste is excluded from the loss report | ☐ | **Strengthened.** Cleaning-store waste can now be documented, so it stops arriving as unexplained loss |
| The system warns rather than blocks | ☐ | |
| Separation of duties - no self-approval | ☐ | Verification stays management-only and still refuses your own work. Asserted by a new test |
| Everything is stored in the small unit; packs convert once | ☐ | |

> No box ticked. This closes a hole in "documented waste is not theft" rather
> than opening one.

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
| SRS updated to version | 1.2 |
| Tests added | Three, in `documents.test.ts`. Suite at 104 passing |
| Manuals updated | ☒ User ☒ Administrator ☐ Not required |
| UAT scripts updated | ☒ Yes ☐ Not required |
| Accepted by | [FILL] on [FILL] |
