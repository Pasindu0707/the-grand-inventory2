# Security & Access Control Design

**Project:** The Grand - inventory management system
**Version:** 1.0 · [FILL: date]
**Status:** Internal

---

## 1. What we are actually protecting

Being honest about the threat model produces better decisions than reaching for
a checklist.

**This system holds:** staff names and phone numbers, stock quantities, cost
prices, supplier prices, and a permanent record of which named person moved
which stock.

**It does not hold:** customer data, payment card data, bank details, or any
special category of personal data.

**The realistic threats, in order:**

| # | Threat | Likelihood | Why |
|---|---|---|---|
| T1 | **An insider covering a loss** | High | The system exists because stock is going missing. Whoever is taking it now has a reason to alter records |
| T2 | **Credential sharing** | High | Shared tablets, four-digit PINs, a busy kitchen |
| T3 | **A user reaching data outside their room or branch** | Medium | Curiosity, or worse |
| T4 | Accidental destruction | Medium | A wrong script, a wrong click |
| T5 | Server compromise | Low | Small target, but a real one |
| T6 | Data loss | Medium | Until backups exist and a restore has been performed, this is the largest risk in the project |
| T7 | External attacker after the data | Low | There is little here worth stealing |

**T1 is the one the architecture is built around.** Almost every design decision
in this system - the append-only ledger, blind counts, separation of duties, the
name on every row - is a control against someone inside the business altering
the record. Conventional application security addresses T5 and T7, which are the
*least* likely threats here.

## 2. The controls, mapped to the threats

| Control | T1 | T2 | T3 | T4 | T5 | T6 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Append-only ledger, enforced by the database | ●● | | | ●● | ● | |
| Corrections are reversals, never edits | ●● | | | ● | | |
| Every row carries who created it | ●● | ● | | | | |
| Separation of duties - no self-approval | ●● | | | | | |
| Blind counts, expected frozen at open | ●● | | | | | |
| One login per person | ● | ●● | | | | |
| PIN lockout after five failures | | ●● | | | ● | |
| Server-side role enforcement | | | ●● | | ● | |
| Branch scoping from the token | | | ●● | | | |
| Section-kind scoping | | | ●● | | | |
| Audit log | ●● | ● | ● | ● | ● | |
| Backups with a tested restore | | | | ●● | ● | ●● |
| HTTPS everywhere | | | | | ●● | |
| bcrypt PIN hashes, log redaction | | ● | | | ●● | |
| Rate limiting | | ● | | | ● | |
| SSH keys only | | | | | ●● | |

## 3. The primary control: history cannot be edited

Three database triggers reject `UPDATE`, `DELETE` and `TRUNCATE` on
`stock_ledger`. Not application code - the database. Application rules can be
bypassed by a script, a psql prompt, or the next developer in a hurry.

```sql
raise exception 'stock_ledger is append-only; correct it with a reversal row (id=%)', old.id
```

One narrow escape exists: demo rows, only when `grand.allow_demo_reset` is set,
and only `db/reset.sql` sets it, inside its own transaction. Real rows are
immutable under every code path.

`TRUNCATE` gets a separate statement-level trigger because truncation bypasses
row-level delete triggers entirely.

**Why this is the primary control.** Everything else in this document protects
access. This protects the record itself. If someone does get into the database,
they still cannot change what happened - they can only add rows, which are
timestamped, attributed, and visible.

**Verified by:** `ledger.test.ts` - *refuses an UPDATE even through the query
builder* · *refuses a DELETE* · *refuses a TRUNCATE*.

## 4. Authentication

### 4.1 Why a PIN

An email and a password is the wrong credential for this environment. Nobody
types an email address one-handed on a wet tablet in a store room at 6am. They
would write it on the wall, or the shift would share one login, and the audit
trail - the entire point of the system - would be worthless.

A four-digit PIN on a tile grid is **identification, not a secret**. It is a
deliberate trade, and these are the compensating controls:

| Weakness | Compensating control |
|---|---|
| Only 10,000 combinations | Lockout after five failures for 15 minutes |
| Shoulder-surfing is easy | Everything is attributed and reviewable; separation of duties means one stolen PIN cannot approve its own work |
| People pick 1234 | The system suggests a PIN; guidance is in the Administrator Manual |
| Shared devices | One login per person is a contractual assumption (SRS ASM-03) |

### 4.2 Storage

bcrypt with a per-user random salt. Never plain text, never reversible, never
logged.

**Demo data uses a fixed salt** so that `seed.sql` stays byte-identical between
runs, which is what makes the test suite deterministic. Real PINs are set
through the API with a random salt. These two paths are separate and the demo
path does not exist in production data after cutover.

### 4.3 Display

A newly created or reset PIN is shown **once**, large, in plain text, then never
again.

This looks wrong and is right. The alternative - mailing it, or hiding it -
produces a PIN written on a sticky note on the tablet, which is strictly worse
than an admin reading four digits aloud to the person standing in front of them.

### 4.4 Sessions

JWT access token plus a refresh token. The refresh interceptor single-flights
concurrent 401s: ten parallel requests produce one refresh, not ten.

A refresh token presented as an access token is rejected, with a test asserting
it.

## 5. Authorisation

### 5.1 The server is the gate

The menu hides what a role cannot use. **That is presentation, not security.**
Every route carries `app.requireRole(...)` as a `preHandler`, and the server
refuses regardless of what the client sent.

### 5.2 Branch scoping

The JWT carries the branches a user may reach. The client sends
`x-location-id`. **The server validates membership on every request.** Every
list is scoped from the token, never from a query parameter.

Changing the header to another branch produces a 403, with a test asserting it.

### 5.3 Section-kind scoping

Sections have a *kind* - `STORE`, `KITCHEN`, `CLEAN`, `QUARANTINE` - and the
kind decides which role can reach the room. This is what stops the kitchen and
the cleaning store reaching into each other.

`BAKERY` and `BAR` were retired by **CR-004**. A branch that works a separate
pastry bench or drinks shelf makes a second section *of kind `KITCHEN`* and
names it accordingly: the kind decides who may stand there, the name tells them
which door.

Management, the storekeeper and the admin run the branch and see all of it.
Everyone else sees the kinds they own.

**A new kind cannot be created through the interface.** A section of an unknown
kind is a room no role can reach: created successfully, visible to nobody.
Adding a fifth kind is a code change in one constant, `SECTION_KINDS`, which
both the permission checks and the setup form read.

### 5.4 Separation of duties

Enforced regardless of role or seniority, because a second check is only worth
something if it is a second person.

| Cannot | Why |
|---|---|
| Release your own request | The releaser is the check on the asker |
| Confirm a delivery you released | The confirmer is the check on the releaser |
| Verify a count you performed | Otherwise the count checks nothing |
| Approve a return you made | Same reason, for the same kind of judgement |
| Switch off the last admin | Otherwise nobody can ever create a login again, and the failure is silent until someone needs one |

### 5.5 Management decides; the store handles stock

**CR-005.** The rule in one sentence: *management decides, the store handles
stock, and neither does both.* It is the generalisation of 5.4 from individual
documents to whole roles — a check performed by the same role that approves it
is a formality.

| Act on a crate | Who | Approval of it | Who |
|---|---|---|---|
| Release stock against a request | Storekeeper | *(the request is the ask)* | — |
| Put stock into quarantine | Storekeeper, kitchen, cleaning | *(no separate stamp - CR-006)* | — |
| Ask what to do with quarantined stock | Storekeeper | Decide it, line by line: supplier or bin | **Management** |
| Mark a supplier return gone | Storekeeper | Record the credit note | **Management** |
| Bin what was decided into the bin | Storekeeper | *(the decision was the approval)* | — |
| Raise a purchase | Storekeeper | Approve the purchase | **Management** |
| Log wastage | Whoever holds the stock | Approve the wastage | **Management** |
| Perform a count | Whoever holds the stock | Verify the count | **Management** |

No row has the same role in both columns. Enforced at the route guards, not in
the menu; `scripts/check-returns.mjs` drives the return chain end to end and
asserts each refusal.

**CR-006 removed an approval rather than adding one.** Approving a section's
hand-back stamped a movement that had already happened and blocked nothing. It
is replaced by the disposal decision - *back to the supplier, or into the bin* -
which is a real choice about real money, answered line by line, and refused to
the person who raised it.

### 5.6 The four deliberate role gaps

| Gap | Reason |
|---|---|
| **Admin cannot touch stock** | Someone has to hand out logins without that also granting them the run of the inventory |
| **Storekeeper cannot approve purchases or returns** | They handle stock, not money. The storekeeper asks; management spends |
| **Management cannot release, quarantine or send stock** | Those are acts on a crate, done by the person standing next to it. See 5.5 |
| **Kitchen cannot raise a purchase** | They cannot see the store's shelf. Asking them to decide something needs buying invites an order for a sack of flour already in the store |

### 5.7 The accepted limit

**Read access is not restricted by role.** Any signed-in user can call the API
directly and see stock quantities for their branch. Money and reports *are*
restricted.

This is a documented decision (SRS FR-ROL-11), signed by the Client, not an
oversight. On a shared store-room tablet it is a reasonable trade. Tightening it
is a change to the route guards, not the UI.

## 6. Application security

| # | Control | Implementation |
|---|---|---|
| A1 | Input validation | Zod schema on every route, request and response |
| A2 | SQL injection | Kysely parameterises everything. No string-concatenated SQL |
| A3 | Rate limiting | `@fastify/rate-limit`, tighter on login |
| A4 | Upload limits | `@fastify/multipart`, one file, size-capped, type-checked |
| A5 | CORS | Explicit allow-list, not `*` |
| A6 | Log redaction | `authorization` header and `body.pin` redacted |
| A7 | Error messages | Plain English, no stack traces, no internal identifiers |
| A8 | Dependencies | Lock file committed; security updates applied under the AMC |
| A9 | Secrets | Environment variables, never committed. `.env` is gitignored |

### 6.1 Uploads deserve a note

Photographs are user-supplied files served back to browsers. Controls:

- Size limit and a single file per request
- Content-type checked
- Stored outside the application directory, served as static content by Caddy
- **Never executed, never interpreted**

## 7. Infrastructure

| # | Control |
|---|---|
| I1 | HTTPS only. Certificates issued and renewed automatically |
| I2 | SSH key authentication only; password authentication disabled |
| I3 | SSH access limited to named TriniphiX personnel |
| I4 | Firewall: 80, 443 and SSH only |
| I5 | **PostgreSQL not exposed to the internet.** Container network only |
| I6 | Database credentials in environment variables |
| I7 | OS and dependency security updates under the AMC |
| I8 | Uptime and error alerting to a nominated number |

## 8. Personnel

| # | Control |
|---|---|
| P1 | All TriniphiX personnel bound by written confidentiality obligations |
| P2 | Server access limited to those who need it |
| P3 | Access removed within one Business Day of a leaver's last day |
| P4 | **Live personal data is never copied into a development environment.** Development and demonstration use deterministically generated data flagged `is_demo` |

P4 is worth stating plainly. It is the control most often broken on small
projects, usually with the words "just to reproduce the bug".

## 9. Audit

| What | Where |
|---|---|
| Every stock movement, with who caused it | `stock_ledger.created_by` |
| Every document, with creator and time | Document tables |
| Every approval and verification | `approved_by`, `verified_by`, `decided_by` |
| Every document write | `audit_log` with actor, action, entity, before/after |
| Failed sign-in attempts | `login_attempts` |

**Retained permanently and cannot be deleted.** This is a deliberate property,
recorded in the Data Processing Agreement §11.2, and the Client has confirmed it
is the intended purpose.

## 10. What is not done, and should be known

Honesty here is more useful than a clean-looking list.

| # | Gap | Risk | Recommendation |
|---|---|---|---|
| G1 | **No backups exist until deployment** | **Catastrophic** | Blocking for go-live. NFR-BAK-03 |
| G2 | No two-factor authentication | Low | A four-digit PIN with 2FA on a shared kitchen tablet would not be used |
| G3 | No IP allow-listing | Low | Staff use mobile data |
| G4 | No intrusion detection | Low | Disproportionate at this size |
| G5 | No penetration test | Medium | Worth commissioning before a multi-branch rollout |
| G6 | Read access not role-restricted | Accepted | SRS FR-ROL-11, signed |
| G7 | PIN entropy is low | Accepted | See §4.1 |
| G8 | No session revocation list | Low | A deactivated user's token remains valid until it expires. Mitigate with a short access-token lifetime |
| G9 | Uploads on local disk | Medium at scale | Object storage at Phase 4 |
| G10 | No formal secret rotation schedule | Low | Add to the AMC |

**G1 is the one that should worry everyone.** Until there is a nightly backup
*and* a restore that has actually been performed once, everything else in this
document is protecting data that can vanish. An untested backup is a belief, not
a backup.

**G8 is worth a line in the runbook:** when someone leaves, deactivate them and
have them signed out. The token expiry window is the exposure.

## 11. Incident response

| Step | Action | Who |
|---|---|---|
| 1 | Contain - revoke access, isolate if needed | TriniphiX |
| 2 | Assess - what was reached, what was changed | TriniphiX |
| 3 | **Notify the Client within 24 hours** if personal data is involved (DPA §9.1) | TriniphiX |
| 4 | Preserve evidence - the ledger and audit log cannot be altered, which helps here | TriniphiX |
| 5 | Remediate | TriniphiX |
| 6 | Written report within 5 Business Days | TriniphiX |

A useful property of this design: after an incident, the ledger is trustworthy
evidence. Nobody - attacker or insider - could have edited it, so "what actually
happened to the stock" is answerable even when "who got in" is not yet.

## 12. Verification

| Control | Test |
|---|---|
| Ledger immutability | `ledger.test.ts` - *refuses an UPDATE / DELETE / TRUNCATE* |
| PIN hashes never exposed | `auth.test.ts` - *lists locations and users without exposing PIN hashes* |
| Lockout | `auth.test.ts` - *locks the account after repeated wrong PINs* |
| Branch scoping | `auth.test.ts` - *rejects an `x-location-id` outside the token's allowed set* |
| Section scoping | `documents.test.ts` - *refuses a kitchen login every door into the cleaning store* |
| Role guards | `grn.test.ts` - *refuses a role that has no business receiving deliveries* |
| Self-verification refused | `documents.test.ts` - *refuses to let the counter verify their own count* |
| Last admin protection | `setup.test.ts` |
| Refresh token misuse | `auth.test.ts` - *rejects a refresh token used as an access token* |
