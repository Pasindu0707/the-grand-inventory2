# TriniphiX (Pvt) Ltd

**Company profile and capability statement**

| | |
|---|---|
| Registered name | TriniphiX (Pvt) Ltd |
| Company registration no. | [FILL: PV xxxxxxx] |
| Registered address | [FILL: street, city, Sri Lanka] |
| Founded | 2022 |
| Team | 5 |
| Email | [FILL: hello@triniphix.lk] |
| Phone | [FILL] |
| Web | [FILL: triniphix.lk] |
| Document version | 1.0 · [FILL: date] |

---

## Who we are

TriniphiX was founded in 2022 by three friends who had spent long enough inside
other people's software to know which parts of it break. We build custom
business systems - the kind a company runs on daily, where a wrong number is a
real loss rather than a cosmetic bug.

We are five people. That is on purpose, and it is worth saying honestly rather
than dressing up. It means we do not take work we cannot finish, we do not hand
a project to a junior team after the sale, and the person who writes your
requirements is the person who writes your code and the person who picks up the
phone when something goes wrong in year two.

## Leadership

| Name | Role | Responsibility on a project |
|---|---|---|
| **Pasindu Fernando** | Chief Executive Officer | Commercial owner, technical architecture, final sign-off on delivery |
| **Shenal Tissera** | Co-founder | [FILL: e.g. delivery and client engagement - requirements, UAT, training] |
| **Rumesh Lakshan** | Co-founder | [FILL: e.g. engineering - backend, database, deployment] |
| [FILL: name] | [FILL: e.g. Software Engineer] | Implementation, testing |
| [FILL: name] | [FILL: e.g. Software Engineer / QA] | Implementation, test scripts, documentation |

## What we do

**Custom business systems.** Inventory, stock control, operational workflow,
internal reporting. Systems where the value is in getting the rules right, not
in the number of screens.

**Web applications, end to end.** Database design, API, front end, deployment,
backups, handover. One team, one contract, one number to call.

**Systems that have to be trusted.** Where money or stock is involved, the
question is not whether the software runs - it is whether anyone believes the
figure on the screen. That is a design problem, and it is the one we are best
at.

## How we build

Four things we do on every project, because each of them is the difference
between a system that survives its first year and one that quietly stops being
used.

**We write the rules down before we write the code.** A signed Software
Requirements Specification, agreed line by line. Every later argument about
scope is settled by reading it rather than by remembering a meeting.

**We test against faults we planted ourselves.** Test data with no problems in
it proves nothing. We seed a system with deliberate, realistic faults - an
over-issue, a theft, a supplier price rise - and every report has to find its
own fault or the report is wrong. Those become the acceptance suite.

**We make the audit trail impossible to edit.** In systems that record
movements of stock or money, we enforce append-only history in the database
itself, not in the application. Corrections are reversals that sit beside the
original. The moment history can be quietly edited, every report becomes an
opinion.

**We hand over properly.** Manuals written for the person doing the job, not
for a developer. Training with an attendance sheet. Credentials, server details
and repository access in one document. A tested restore, not a backup script
nobody has ever run.

## What we do not do

Said plainly, because a supplier who claims everything is a supplier who has
not thought about it.

- We are not a body shop. We do not supply developers by the hour to sit in
  someone else's team.
- We do not resell or implement large third-party ERP platforms.
- We do not take on projects that need a team of twenty. If your project needs
  that, we will say so at the proposal stage rather than at month four.
- We do not build mobile-first consumer apps or marketing sites.

## Case study - The Grand Gastrobar, Negombo

**Problem.** A restaurant and bar with a store room, a kitchen, a bakery, a bar
and a cleaning store, and no reliable answer to two questions: what is in the
store, and who took it. Stock figures were a spreadsheet updated from memory.
Losses were noticed at the point where a supplier could not be paid.

**Constraint.** No point-of-sale system to drive consumption figures, so the
usual "sales tell you what you should have used" approach was unavailable.

**What we built.** A web-based inventory system covering goods receipt,
internal issue and requests, wastage, stock transfers, blind stock counts,
purchase orders and five management reports. Built on an append-only stock
ledger that the database itself refuses to update or delete.

**Design decisions that mattered:**

- **Stock is derived, never stored.** There is no quantity column anywhere.
  On-hand is recomputed from the ledger on every read, so there is no cached
  number that can drift away from the movements behind it.
- **Counts are blind.** The expected quantity is never shown while counting.
  Show a tired storekeeper that the system expects 4,500 and they will type
  4,500 - which confirms a theft rather than finding it.
- **Warn, do not block.** An issue that happened at 14:00 happened at 14:00.
  Refusing to record it does not undo it; it just makes the stock figure wrong
  as well as the process.
- **Spoilage and shrinkage are different conversations.** Documented waste is
  excluded from the unexplained-loss report by construction. An owner accused
  of theft over a crate of lettuce stops opening reports by week three.

**How it was proved.** Five faults were planted in sixty days of generated
data - an over-issue, two vanished gin bottles, a 32% supplier price rise, a
spoilage spike and a stock-out. Each maps to one report, and each is an
assertion in an automated test suite. One of those assertions checks that a
report *does not* fire: honest, documented spoilage must never appear in the
theft report. That test caught a real defect before the client ever saw it.

**Result.** 64 automated tests against a real database, 12 database-integrity
checks, and a documented cutover runbook. Reference available on request.

## Engagement model

| Stage | What happens | Typical duration |
|---|---|---|
| Discovery | We walk your operation and write down how it works today | 3-5 days |
| Proposal | Fixed scope, fixed price, fixed milestones | 1 week |
| Requirements | SRS written and signed before any code | 1-2 weeks |
| Build | Delivered in slices you can see and use | Project-dependent |
| UAT | Your staff execute scripts we write; defects logged and fixed | 1-2 weeks |
| Go-live | Cutover runbook, data migration, training | 2-3 days |
| Warranty | Defects fixed free of charge | 90 days |
| Support | SLA and annual maintenance contract | Ongoing |

## Commercial terms, in outline

- Fixed price against a signed Statement of Work. Milestone billing, not time
  and materials.
- Changes go through a signed Change Request Form with their own cost and time
  impact. No verbal scope.
- Source code ownership and licensing are set out in the Software Licence
  Agreement. We are content to assign, escrow or licence - it is a commercial
  decision, and we will tell you what each one costs.
- 90-day warranty from acceptance, then an annual maintenance contract.

## Technology

| Layer | What we use |
|---|---|
| Database | PostgreSQL |
| Backend | TypeScript, Node.js, Fastify |
| Frontend | Angular, TypeScript |
| Testing | Vitest against a real database, not mocks |
| Deployment | Docker, Caddy, a single VPS per site |
| Backups | Nightly dumps to object storage, with a restore drill that is actually run |

We pick boring, well-understood tools and spend the effort on the rules of your
business instead. That is the part nobody else can write for you.

---

**References and a demonstration environment are available on request.**

TriniphiX (Pvt) Ltd · [FILL: address] · [FILL: email] · [FILL: phone]
