# Change Request Form

**Project:** The Grand - inventory management system
**Under:** MSA TPX-MSA-[FILL] · SOW TPX-SOW-[FILL] · Change Request Procedure (Annexure C)

| | |
|---|---|
| **CR number** | CR-[FILL: 001] |
| **Title** | [FILL: short, specific] |
| **Raised by** | [FILL: name, organisation] |
| **Date raised** | [FILL] |
| **Priority** | ☐ Urgent ☐ High ☐ Medium ☐ Low |
| **Status** | ☐ Raised ☐ Assessing ☐ Awaiting decision ☐ Approved ☐ Rejected ☐ Deferred ☐ Complete |

---

## Part A - The request

*Completed by whoever is raising the change.*

### A1. What is the business problem?

Describe the problem, not the solution. There is often a cheaper answer than
the one you had in mind, and this is where it gets found.

```
[FILL]
```

### A2. Who has this problem, and how often?

```
[FILL: which role, in which room, how many times a day or week]
```

### A3. What happens today, and what does it cost?

```
[FILL: the current workaround and its consequence - time, money, or risk]
```

### A4. What would good look like?

```
[FILL]
```

### A5. Is there a deadline, and what drives it?

```
[FILL]
```

### A6. What happens if this is not done?

```
[FILL: be honest. "Nothing much, it is just annoying" is a legitimate answer
and it helps prioritise correctly.]
```

---

## Part B - Assessment

*Completed by TriniphiX. Target: 5 Business Days from acknowledgement.*

| | |
|---|---|
| Assessed by | [FILL] |
| Date assessed | [FILL] |

### B1. Classification

☐ **Change** - not in the signed SRS. Chargeable.
☐ **Defect** - the system does not do what the signed SRS says. **Fixed free.**
☐ **Configuration** - the Client can do this themselves. See B2.
☐ **Clarification** - the SRS is ambiguous; interpretation agreed, no charge.

**Reference in the signed SRS:** [FILL: requirement ID, or "not covered"]

### B2. If configuration, how

```
[FILL: which screen, which role, and a reference to the manual page]
```

### B3. Proposed solution

```
[FILL]
```

### B4. Options considered

| Option | Description | Effort (days) | Cost (LKR) | Recommendation |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | Do nothing | 0 | 0 | |

### B5. Effort

| Role | Days | Rate (LKR/day) | Amount (LKR) |
|---|---|---|---|
| Architect / technical lead | | | |
| Senior engineer | | | |
| Engineer | | | |
| QA / test | | | |
| Documentation / training | | | |
| **Total** | | | **[FILL]** |

### B6. What this touches

Everything affected. An unlisted side effect becomes a defect argument later.

| Area | Affected? | Notes |
|---|---|---|
| Database schema / migration | ☐ | |
| Stock ledger or its rules | ☐ | |
| API endpoints | ☐ | |
| Screens | ☐ | |
| Reports | ☐ | |
| Roles and permissions | ☐ | |
| Existing data - does it need migrating? | ☐ | |
| Automated tests | ☐ | |
| User Manual | ☐ | |
| Administrator Manual | ☐ | |
| Training | ☐ | |
| UAT scripts | ☐ | |

### B7. Timeline impact

| | |
|---|---|
| Can it be done within the current milestone? | ☐ Yes ☐ No |
| Delay to the current milestone | [FILL] Business Days |
| Delay to final acceptance | [FILL] Business Days |
| Revised acceptance date | [FILL] |

### B8. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |

### B9. Does this weaken a core design property?

Answer honestly. Some changes are cheap to build and expensive to live with.

| Property | Weakened? | If yes, explain |
|---|---|---|
| The ledger is append-only and enforced by the database | ☐ | |
| Stock is derived from the ledger, never stored | ☐ | |
| Controllers never write the ledger directly | ☐ | |
| Counts are blind, and expected is frozen at open | ☐ | |
| Documented waste is excluded from the loss report | ☐ | |
| The system warns rather than blocks | ☐ | |
| Separation of duties - no self-approval | ☐ | |
| Everything is stored in the small unit; packs convert once | ☐ | |

> If any box is ticked, this needs a conversation before it needs a signature.
> These are the properties the system's credibility rests on, and they are much
> easier to give away than to get back.

### B10. Assessment charge

☐ No charge - within the free assessment allowance
☐ Charged: [FILL] LKR - notified to the Client on [FILL: date] before assessment began

---

## Part C - Decision and authorisation

*Completed by the Client's nominated decision-maker.*

| | |
|---|---|
| Decision | ☐ **Approved** ☐ **Rejected** ☐ **Deferred to** [FILL] |
| Option selected (from B4) | [FILL] |
| Agreed cost | **LKR [FILL]** (exclusive of tax) |
| Agreed timeline impact | **[FILL] Business Days** |
| Revised acceptance date | [FILL] |
| Invoicing | ☐ With next milestone ☐ On completion ☐ [FILL] |

**If rejected or deferred, the reason** - recorded so that neither party has to
reconstruct it from memory in six months:

```
[FILL]
```

### Authorisation

By signing, both parties agree that this change is added to the scope of SOW
TPX-SOW-[FILL], that the contract price is varied by the amount above, and that
the dates in the milestone plan move as stated. This form takes precedence over
the SOW and the SRS to the extent of the change.

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
| Name | |
| Title | |
| Signature | |
| Date | |

---

## Part D - Completion

*Completed by TriniphiX when the change is delivered.*

| | |
|---|---|
| Delivered on | [FILL] |
| Actual effort | [FILL] days against [FILL] estimated |
| SRS updated to version | [FILL] |
| Tests added | [FILL] |
| Manuals updated | ☐ User ☐ Administrator ☐ Not required |
| UAT scripts updated | ☐ Yes ☐ Not required |
| Accepted by | [FILL] on [FILL] |

**Variance note** - if actual effort differed materially from the estimate, say
why. This is how the next estimate gets better.

```
[FILL]
```
