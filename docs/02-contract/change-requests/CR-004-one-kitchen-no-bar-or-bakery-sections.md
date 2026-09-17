# Change Request Form

**Project:** The Grand - inventory management system
**Under:** MSA TPX-MSA-[FILL] · SOW TPX-SOW-[FILL] · Change Request Procedure (Annexure C)

| | |
|---|---|
| **CR number** | CR-004 |
| **Title** | One kitchen: retire the Bar and Bakery section kinds |
| **Raised by** | [FILL: name], The Grand Gastrobar |
| **Date raised** | [FILL] |
| **Priority** | ☐ Urgent ☒ High ☐ Medium ☐ Low |
| **Status** | ☐ Raised ☐ Assessing ☐ Awaiting decision ☒ Approved ☐ Rejected ☐ Deferred ☐ Complete |

---

## Part A - The request

### A1. What is the business problem?

The system offers four kinds of production room - Kitchen, Bakery, Bar and the
cleaning store - and the Gastrobar is run with one kitchen. The same people work
the pastry bench and the drinks shelf on the same shift.

Three rooms that behave identically cost the business three things:

- **A decision nobody can answer.** A cook logging wastage is asked which room
  they are in, when the answer depends on what they happened to be doing ten
  minutes ago.
- **Stock split across rooms that do not exist.** Flour issued to "Bakery" and
  flour issued to "Kitchen" are two balances of one sack, and the person
  counting the shelf finds one.
- **Counts that miss things.** A weekly count of the bar covers spirits; nobody
  counts "the bakery" because there is no bakery to walk into.

### A2. Who has this problem, and how often?

Every kitchen login, on every document. There are three kitchen logins at the
Gastrobar and one physical kitchen.

### A3. What happens today, and what does it cost?

Stock is spread over three section balances that correspond to one room, so no
single screen answers "what is in the kitchen". Variance work has to be done
three times and added up by hand.

### A4. What would good look like?

One kind of production room - **Kitchen**. A branch that genuinely works a
separate shelf makes a *second section of kind Kitchen* and names it Pastry: the
kind decides who may stand there, the name tells them which door. Nothing is
lost except the false choice.

### A5. Is there a deadline, and what drives it?

Before go-live and before training, and before any real stock is counted into a
section that is about to be retired.

### A6. What happens if this is not done?

The kitchen's stock stays split three ways at cutover, and the split is then
permanent - moving stock between sections after go-live is a transfer document,
not an edit.

---

## Part B - Assessment

| | |
|---|---|
| Assessed by | [FILL] |
| Date assessed | [FILL] |

### B1. Classification

☒ **Change** - the signed SRS names four section kinds. Chargeable.
☐ **Defect**
☐ **Configuration**
☐ **Clarification**

The system implemented the signed SRS correctly. This narrows it.

**Reference in the signed SRS:** §3.2 locations and sections; §4.2 permission
matrix (Kitchen column).

### B3. Proposed solution

```
Remove BAKERY and BAR from SECTION_KINDS in api/src/plugins/auth.ts. That
constant is the only list of section kinds in the system: the permission checks
read it and so does the setup form, so one edit removes the kinds from both the
rules and the form that offers them.

There is deliberately no matching check constraint in the database, so no
migration is required, and existing rows of the retired kinds keep their history.

The demo generator merges the two rooms into KITCHEN. Section ids 3 and 4 are
left unused rather than renumbered: the gap costs nothing and renumbering would
rewrite every document that names CLEAN or QUARANTINE.
```

### B4. Options considered

| Option | Description | Effort (days) | Cost (LKR) | Recommendation |
|---|---|---|---|---|
| 1 | Remove both kinds; a second kitchen covers a real pastry room | [FILL] | [FILL] | **Recommended** |
| 2 | Remove Bakery, keep Bar | [FILL] | [FILL] | No - the drinks shelf is a shelf in the kitchen, staffed by the kitchen, and keeping it is the same problem with one room fewer |
| 3 | Do nothing | 0 | 0 | No - see A6 |

### B6. What this touches

| Area | Affected? | Notes |
|---|---|---|
| Database schema / migration | ☐ | None. `sections.kind` is text and the permitted values live in one TypeScript constant, by design |
| Stock ledger or its rules | ☐ | Same documents, same writer |
| API endpoints | ☒ | None added or removed; two entries gone from `SECTION_KINDS` |
| Screens | ☒ | Branches and sections no longer offers the two kinds; the stock-by-section grouping drops them |
| Reports | ☒ | Figures move because the demo data moves - see below. Report logic is unchanged |
| Roles and permissions | ☐ | The Kitchen role already owned all three kinds |
| Existing data | ☒ | **Demo data only.** No real data exists yet; a branch already holding stock in a retired section would need a transfer first |
| Automated tests | ☒ | Anomaly B now asserts `KITCHEN`; two count tests and one transfer test renamed onto surviving sections. **137 tests pass** |
| Demo/seed data | ☒ | **See below** |
| User Manual | ☒ | |
| Administrator Manual | ☒ | |
| Training | ☒ | One production room to explain instead of three |
| UAT scripts | ☒ | Section names in the kitchen scripts |

**Seed data and the planted faults.** The generator now gives the Gastrobar
Store, Kitchen, Cleaning and Quarantine. Everything the bakery and the bar held
is the kitchen's, including the drinks shelf and its Sunday count. Production
volumes stayed with the *product* rather than the room - cakes and buns still
come off in tens - so the dataset keeps its shape.

Merging the issue groups changes the PRNG draw sequence, so every figure moved
slightly. All five planted faults survive and were re-measured against the data
the generator now produces:

| Fault | Before | Now |
|---|---|---|
| A - chicken over-issued | +18%, 2 rows | **+18%, LKR 199,084**, the only row in the report |
| B - two gin bottles gone | 2 × −750 ml in **BAR** | 2 × −750 ml, LKR 5,216.25 each, in **KITCHEN** |
| C - sunflower oil +32% | 45,880 → 60,561.60 | **unchanged** |
| D - lettuce spoilage | 3,347 g, zero shrinkage rows | **3,923 g**, still **zero** shrinkage rows |
| E - prawns hit zero | 2026-07-21 | **unchanged** |

Ledger rows fall from 11,490 to **10,417**, because the bakery's and the
kitchen's daily issues are now one document instead of two.

### B9. Does this weaken a core design property?

| Property | Weakened? | If yes, explain |
|---|---|---|
| The ledger is append-only and enforced by the database | ☐ | |
| Stock is derived from the ledger, never stored | ☐ | |
| Controllers never write the ledger directly | ☐ | |
| Counts are blind, and expected is frozen at open | ☐ | |
| Documented waste is excluded from the loss report | ☐ | Re-verified: fault D still produces zero shrinkage rows |
| The system warns rather than blocks | ☐ | |
| Separation of duties - no self-approval | ☐ | |
| Everything is stored in the small unit; packs convert once | ☐ | |
| The store is just another section | ☐ | **Strengthened** - there are now fewer special rooms, not more |

> No box ticked. Spirits are still countable by bottle, which is the only
> property fault B ever depended on - it was never the room they stood in.

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
| Tests added | None added; four updated onto surviving sections. Suite at **137 passing** |
| Manuals updated | ☒ User ☒ Administrator ☐ Not required |
| UAT scripts updated | ☒ Yes ☐ Not required |
| Accepted by | [FILL] on [FILL] |
