# Software Licence Agreement

> **DRAFT - for review by a Sri Lankan attorney-at-law before use.**
> Clause 3 (the ownership election) is a commercial decision that must be made
> deliberately. Do not issue this document with the election unmade.

**Annexure D to Master Services Agreement TPX-MSA-[FILL]**
**Date:** [FILL]

## Parties

**(1) TriniphiX (Pvt) Ltd** ("**TriniphiX**"); and
**(2) [FILL: client legal entity name]** (the "**Client**").

---

## 1. The Software

1.1 "**the Software**" means the inventory management system delivered under
SOW TPX-SOW-[FILL], comprising:

| Component | Description |
|---|---|
| API service | Node.js / TypeScript service exposing the documented HTTP API |
| Database schema | PostgreSQL schema, migrations, triggers and views |
| Web application | Angular single-page application |
| Scripts and tooling | Migration, seed, verification and administration scripts |
| Documentation | The documents listed in SOW §3 |

1.2 The Software does **not** include:

(a) **Third-Party Components** - open-source and commercial libraries listed in
Schedule 1, each licensed to the Client under its own terms;
(b) **TriniphiX Background IP** - pre-existing frameworks, patterns, tooling
and know-how, licensed under clause 4; and
(c) **Client Data** - all operational data entered into the Software, which is
and remains the Client's property.

## 2. Condition precedent

**No right, title, licence or interest passes to the Client under this
Agreement until all sums due under the relevant SOW have been paid in full.**
Until then, the Client's use is a revocable permission for evaluation and User
Acceptance Testing only.

## 3. Ownership - election

> **Choose exactly one. Delete the other two before issuing.** The three are
> priced differently; if the price in the SOW was quoted on Option A, Option B
> is not available at that price.

### Option A - TriniphiX retains ownership; the Client is licensed *(default)*

3A.1 TriniphiX owns all intellectual property rights in the Software.

3A.2 On full payment, TriniphiX grants the Client a **perpetual, irrevocable,
non-exclusive, non-transferable, royalty-free licence** to use, install and
operate the Software for the Client's own internal business purposes, at the
sites listed in Schedule 2, for an unlimited number of the Client's own users.

3A.3 The licence includes the right to have the Software operated on the
Client's behalf by a third-party hosting provider or IT contractor, provided
that party is bound by equivalent confidentiality and use restrictions.

3A.4 The licence includes the right to receive and retain a copy of the source
code and to have it modified by a third party **if TriniphiX ceases to trade,
enters liquidation, or materially fails to perform under the AMC and does not
remedy that failure within thirty (30) days of written notice**.

3A.5 TriniphiX may reuse its skills, techniques, patterns and general know-how
on other projects. It shall not supply the Software as a whole, or any
Client-specific business rule, item data, supplier data or report definition,
to any third party.

### Option B - Assignment to the Client

3B.1 On full payment, TriniphiX assigns to the Client, absolutely and with full
title guarantee, all intellectual property rights in the bespoke elements of
the Software created specifically for the Client under the SOW.

3B.2 The assignment excludes Third-Party Components and TriniphiX Background
IP, which remain owned by their respective owners and are licensed under
clauses 4 and 5.

3B.3 TriniphiX retains the right to use the general skills, methods, techniques
and know-how developed or applied in creating the Software.

3B.4 TriniphiX shall execute any further document reasonably required to give
effect to this assignment, at the Client's cost.

### Option C - Joint ownership

> Not recommended. Joint ownership requires both parties' consent for almost
> every commercially useful act, and produces a deadlock the first time either
> side wants to do something. Included only for completeness.

3C.1 The parties own the bespoke elements of the Software jointly in equal
shares. Neither may license, assign or commercially exploit them without the
other's prior written consent.

## 4. Licence of TriniphiX Background IP

Where Option B or C is elected, TriniphiX grants the Client a perpetual,
irrevocable, non-exclusive, non-transferable, royalty-free licence to use its
Background IP solely as embedded in the Software and solely for the Client's
internal business purposes.

## 5. Third-Party Components

5.1 The Software incorporates the components listed in Schedule 1. Each is
licensed to the Client under its own licence terms, not under this Agreement.

5.2 TriniphiX warrants that it has used only components whose licences permit
the use contemplated by this Agreement, and that no component imposes an
obligation on the Client to disclose the Software's source code publicly.

5.3 TriniphiX shall maintain the list in Schedule 1 and update it on any
material change.

## 6. Restrictions

The Client shall not:

(a) sell, sub-licence, rent, lease or otherwise make the Software available to
any third party as a service, save as permitted by clause 3A.3;
(b) use the Software to provide services to any business other than those
listed in Schedule 2;
(c) remove or obscure any copyright, trade mark or attribution notice;
(d) reverse engineer, decompile or disassemble any part of the Software except
to the extent permitted by law; or
(e) where Option A is elected, modify the Software or authorise its
modification, except as permitted by clause 3A.4 or with TriniphiX's prior
written consent.

Clause 6(e) does not restrict the Client's configuration of the Software
through its own setup and administration screens, which is normal use.

## 7. Client Data

7.1 All data entered into the Software is and remains the Client's property.

7.2 TriniphiX asserts no right over it and shall not use it for any purpose
other than operating and supporting the Software, save that it may use
aggregated, fully anonymised statistics that cannot identify the Client or any
individual.

7.3 On request at any time, TriniphiX shall provide a complete export of the
Client's data in a documented, non-proprietary format - a PostgreSQL dump plus
CSV extracts of the principal tables - within **ten (10) Business Days**.

7.4 Clause 7.3 survives termination of this Agreement and of the AMC, and is
not conditional on any sum being paid other than sums already due and overdue.

## 8. Source code

8.1 **Where Option A is elected:** TriniphiX shall deposit a current copy of
the source code with the Client at Acceptance, held by the Client under the
terms of clause 3A.4 - that is, the Client holds it but may only modify it in
the circumstances described there. TriniphiX shall provide an updated copy at
each significant release.

8.2 **Where Option B is elected:** TriniphiX shall transfer the complete source
code repository, including its full history, at Acceptance.

8.3 In either case TriniphiX shall provide sufficient documentation for a
competent developer to build, deploy and run the Software - this is delivered
as the Installation & Configuration Guide.

8.4 **Escrow.** If the Client requires a formal escrow arrangement with a third
-party agent, that is available at the Client's cost under a separate escrow
agreement. It is not included in the SOW price.

## 9. Warranties and disclaimer

9.1 TriniphiX warrants that it has the right to grant the rights granted under
this Agreement, and that to the best of its knowledge the Software does not
infringe the intellectual property rights of any third party.

9.2 TriniphiX does not warrant that the Software will be free from all defects
or that it will operate without interruption. The warranty that applies is the
one in MSA clause 8.

9.3 **The Client acknowledges that the Software's outputs depend entirely on
the accuracy of the data entered into it** - in particular the item
definitions, stock units and pack conversions confirmed during Phase 0.
TriniphiX gives no warranty as to the accuracy of any figure derived from
inaccurate data.

## 10. Indemnity

10.1 TriniphiX shall indemnify the Client against any claim that the Software,
as delivered and used in accordance with this Agreement, infringes a third
party's intellectual property rights, provided the Client:

(a) notifies TriniphiX promptly in writing;
(b) gives TriniphiX sole conduct of the defence and settlement; and
(c) provides reasonable assistance at TriniphiX's cost.

10.2 The indemnity does not apply to a claim arising from Client Materials, from
modification of the Software by anyone other than TriniphiX, or from use
contrary to this Agreement.

10.3 If a claim is made or is likely, TriniphiX may at its own cost modify or
replace the affected part of the Software so that it ceases to infringe while
remaining materially equivalent in function, or, if it cannot reasonably do so,
terminate the licence and refund a fair proportion of the fees paid having
regard to the period of use.

10.4 This clause states the Client's sole remedy for infringement, and is
subject to the liability cap in MSA clause 12.3.

## 11. Term and termination

11.1 The licence granted under clause 3A.2 is perpetual and does not terminate
on termination of the MSA or the AMC.

11.2 TriniphiX may terminate the licence only if the Client commits a material
breach of clause 6 and does not remedy it within **thirty (30) days** of
written notice.

11.3 On termination of the licence, the Client shall cease use of the Software
and destroy all copies. TriniphiX shall first provide the data export under
clause 7.3.

## 12. General

12.1 This Agreement is an annexure to and governed by the MSA. Where they
conflict on the subject matter of this Agreement, this Agreement prevails.

12.2 Governed by the laws of Sri Lanka; MSA clauses 15.10 and 15.11 apply.

---

## Schedule 1 - Third-Party Components

To be completed at Acceptance and maintained thereafter.

| Component | Version | Licence | Used for |
|---|---|---|---|
| PostgreSQL | 16 | PostgreSQL Licence | Database |
| Node.js | 20 LTS | MIT | Runtime |
| Fastify | 5.x | MIT | HTTP server |
| Kysely | 0.27.x | MIT | SQL query builder |
| Zod | 3.x | MIT | Validation and schema |
| bcryptjs | 3.x | MIT | PIN hashing |
| Angular | 19.x | MIT | Web application framework |
| PrimeNG | [FILL] | MIT | UI components |
| Vitest | 2.x | MIT | Testing |
| Caddy | 2.x | Apache 2.0 | Reverse proxy, TLS |
| Docker | [FILL] | Apache 2.0 | Containerisation |
| [FILL: complete from package-lock.json at Acceptance] | | | |

> Generate the definitive list at Acceptance:
> ```bash
> npx license-checker --production --summary
> ```

**Note on the web application base.** The Angular application was developed
from a commercially licensed template ([FILL: template name and licence
reference]). TriniphiX confirms the licence permits its use in a
client-commissioned application. Evidence of licence is available on request.

## Schedule 2 - Licensed sites

| # | Site | Address | Licensed from |
|---|---|---|---|
| 1 | The Grand Gastrobar | [FILL], Negombo | Go-live date |
| 2 | [FILL: additional sites, if any] | | |

Additional sites may be added by written agreement. Where the SOW was priced
for one site, additional sites carry the fee stated in the Payment Schedule.

---

## Signed

**For and on behalf of TriniphiX (Pvt) Ltd**

| | |
|---|---|
| Signature | |
| Name | Pasindu Fernando |
| Title | Chief Executive Officer |
| Date | |

**For and on behalf of [FILL: client legal entity name]**

| | |
|---|---|
| Signature | |
| Name | |
| Title | |
| Date | |

**Ownership option elected:** ☐ A  ☐ B  ☐ C
