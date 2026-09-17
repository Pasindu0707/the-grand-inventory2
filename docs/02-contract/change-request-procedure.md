# Change Request Procedure

**Annexure C to Master Services Agreement TPX-MSA-[FILL]**
**Version:** 1.0 · [FILL: date]

---

## 1. Why this exists

A signed Statement of Work and a signed SRS define what is being built and what
it costs. Everything after that is a change, and a change that is not written
down is the mechanism by which a five-week project becomes a five-month one.

This procedure is not bureaucracy for its own sake. It protects both parties:

- **The Client** gets to know the cost and the delay of each change *before*
  committing, rather than discovering at the end that the price has moved.
- **TriniphiX** gets paid for work it does, and is not held to a delivery date
  that assumed a smaller system.

## 2. What is a change

A change is anything that alters the scope, the Deliverables, the timeline or
the price agreed in the SOW and the signed SRS.

### Is a change

- A new function not in the signed SRS
- A change to how a function in the SRS behaves
- A new report, or a new column on an existing one
- A new field on a screen or in the data model
- A new role, or a change to what a role can do
- Support for another branch, device type or language
- A change to a business rule - approval thresholds, materiality floors, issue
  windows, count frequency - where the SRS states a specific rule
- Integration with any other system
- Data migration beyond what the Data Migration Plan describes
- Bringing forward a Phase 2 item into Phase 1

### Is not a change

- A **Defect** - the delivered system does not do what the signed SRS says it
  does. Fixed free, under warranty or during UAT.
- **Configuration** the Client can perform through its own setup screens -
  adding items, suppliers, sections, users, or changing par levels and reorder
  points.
- Correcting a typo, wording, or label in the interface, where the change is
  trivial and the meaning is unchanged.
- Clarifying an ambiguity in the SRS where both parties agree what was
  intended.

### The grey area, and how it is settled

Sometimes the Client believes something is a Defect and TriniphiX believes it
is a change. The test is simple and it is applied to the document, not to
memory: **open the signed SRS and read the requirement.**

- If the system does not do what the requirement says → **Defect**, fixed free.
- If the requirement is silent, or says something else → **Change Request**.
- If the requirement is genuinely ambiguous → the parties agree an
  interpretation, and TriniphiX absorbs the cost where the ambiguity is in
  wording TriniphiX drafted.

That last rule matters. TriniphiX writes the SRS, so TriniphiX carries the risk
of having written it unclearly. This keeps the incentive on writing it well.

## 3. The procedure

```
1. Raise        Either party completes Part A of the Change Request Form
                    ↓
2. Acknowledge  TriniphiX acknowledges within 2 Business Days
                    ↓
3. Assess       TriniphiX completes Part B: effort, cost, timeline impact,
                risks, and what else it touches - within 5 Business Days
                    ↓
4. Decide       Client accepts, rejects or defers - within 5 Business Days
                    ↓
5. Sign         Both parties sign Part C. Only now does it become scope
                    ↓
6. Schedule     Added to the plan; the SOW and SRS are updated
```

### 3.1 Raise

Either party may raise a change. Complete **Part A** of the Change Request Form
and send it to the other party's nominated contact. Describe the business
problem, not the solution - "the storekeeper cannot tell which supplier is
consistently late" is more useful than "add a column to the supplier table",
because it leaves room for a cheaper answer.

### 3.2 Acknowledge

TriniphiX acknowledges receipt within **2 Business Days**, assigns a CR number,
and enters it on the Change Request Log.

### 3.3 Assess

TriniphiX completes **Part B** within **5 Business Days**, setting out:

- Effort in person-days, by role
- Cost, calculated as a fixed price where the change can be scoped, otherwise
  at the day rates in the Payment Schedule
- Impact on the timeline, including any knock-on effect on later milestones
- What else in the system is affected - screens, reports, data model, tests
- Risks introduced
- Whether it can be done within the current milestone or must follow it
- Options, where a cheaper partial answer exists

**Assessment is free** for the first [FILL: five] Change Requests. Beyond that,
or where assessment requires more than half a day, TriniphiX may charge for the
assessment itself, and will say so before starting.

### 3.4 Decide

The Client's nominated decision-maker accepts, rejects or defers within
**5 Business Days**. A deferred CR stays on the log and can be revived without
being re-assessed, provided the system has not materially changed since.

### 3.5 Sign

Both parties sign **Part C**. A change becomes part of the scope **only** when
Part C is signed by both. Until then it does not exist, whatever has been said
in a meeting or written in an email.

### 3.6 Schedule and update

TriniphiX schedules the work, updates the affected sections of the SRS, and
issues a revised version. The revised SRS section is the requirement for
acceptance and testing purposes.

## 4. Urgent changes

Where a change is genuinely urgent and the full procedure would cause real
harm, the Client's decision-maker may authorise TriniphiX to begin work by
email, stating explicitly that clause 4 of this procedure is being invoked and
that the Client accepts the cost estimate given verbally.

The full Change Request Form must be completed and signed within **5 Business
Days**. If it is not, TriniphiX may suspend the work and invoice for what has
been done.

Use this sparingly. It exists for a real emergency, not as a way around
paperwork.

## 5. Effect on price and timeline

5.1 An approved change alters the SOW price by the amount stated in Part B.

5.2 An approved change alters the affected milestone dates and every subsequent
date by the impact stated in Part B. Later milestones do not absorb the change
silently.

5.3 Changes are invoiced [FILL: with the next milestone / on completion of the
change], unless Part C states otherwise.

5.4 A change of more than [FILL: 15]% of the original contract value, or the
cumulative effect of changes exceeding that, entitles either party to require
a re-baselining of the whole plan before proceeding.

## 6. Rejected changes

A rejected CR is recorded on the log with the reason. This matters: six months
later, "why doesn't it do X?" is answered by pointing at CR-014 and the date it
was declined, rather than by two people remembering a conversation
differently.

## 7. Change Request Log

TriniphiX maintains the log and circulates it with the weekly status report.

| CR # | Title | Raised by | Raised | Status | Cost (LKR) | Days | Decided |
|---|---|---|---|---|---|---|---|
| CR-001 | | | | | | | |
| CR-002 | | | | | | | |

**Status values:** Raised · Assessing · Awaiting decision · Approved ·
Rejected · Deferred · Complete

## 8. During warranty and under the AMC

8.1 During the Warranty Period, Defects are fixed free. Changes follow this
procedure and are charged.

8.2 Under the Annual Maintenance Contract, the AMC's own included-hours
provisions apply first; work beyond them follows this procedure.

## 9. Nominated contacts

| Party | Name | Role | Email |
|---|---|---|---|
| Client | [FILL] | Decision-maker | [FILL] |
| TriniphiX | [FILL] | Delivery lead | [FILL] |

Either party may change its nominated contact on written notice.

---

## Signed

**For and on behalf of TriniphiX (Pvt) Ltd**

| | |
|---|---|
| Signature | |
| Name | Pasindu Fernando |
| Date | |

**For and on behalf of [FILL: client legal entity name]**

| | |
|---|---|
| Signature | |
| Name | |
| Title | |
| Date | |
