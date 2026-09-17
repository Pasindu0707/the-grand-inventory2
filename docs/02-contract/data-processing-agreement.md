# Data Processing Agreement

> **DRAFT - for review by a Sri Lankan attorney-at-law before use.**
> Drafted against the Personal Data Protection Act, No. 9 of 2022 (Sri Lanka).
> The Act's provisions have been brought into force in stages; confirm the
> current commencement position and the Data Protection Authority's guidance
> before issuing.

**Annexure E to Master Services Agreement TPX-MSA-[FILL]**
**Date:** [FILL]

## Parties

**(1) [FILL: client legal entity name]** - the "**Controller**"; and
**(2) TriniphiX (Pvt) Ltd** - the "**Processor**".

---

## 1. Does this document apply?

Yes, and it is worth being clear why, because the volume of personal data here
is small and it would be easy to assume it is nil.

The system holds **staff names, roles, phone numbers, branch assignment, and a
complete record of which named individual performed every stock movement**.
That last item is the entire point of the system, and it is personal data
processed for the purpose of accountability. It is also, in practice, evidence
that could be used in a disciplinary or criminal matter.

It holds **no customer data, no payment card data, no financial account data
and no special categories of personal data**.

## 2. Definitions

Terms used have the meanings given in the Personal Data Protection Act, No. 9 of
2022. "**Personal Data**" means personal data processed by the Processor on
behalf of the Controller under the MSA.

## 3. Roles

3.1 The Controller determines the purposes and means of processing. The
Processor processes only on the Controller's documented instructions.

3.2 The MSA, the SOW and this Agreement together constitute the Controller's
documented instructions. Any further instruction must be in writing.

3.3 The Processor shall notify the Controller if, in its opinion, an
instruction infringes applicable data protection law. The Processor may
suspend the affected processing until the instruction is confirmed or amended.

## 4. Details of processing

### 4.1 Subject matter and duration

Provision, hosting, support and maintenance of the inventory management system,
for the duration of the MSA and any Annual Maintenance Contract, plus the
retention period in clause 12.

### 4.2 Nature and purpose

| Purpose | Why |
|---|---|
| User authentication | To identify who is using the system |
| Attribution of stock movements | Accountability - the system's core function |
| Access control | To enforce what each role may do |
| Audit logging | To retain an unalterable record of who did what |
| Support and defect diagnosis | To operate and fix the system |
| Backup and disaster recovery | Continuity |

### 4.3 Categories of data subject

| Category | Approximate number |
|---|---|
| The Controller's employees who use the system | [FILL: up to 25] |
| Supplier contact persons (name, phone) | [FILL: up to 30] |

### 4.4 Categories of Personal Data

| Data | Held in | Notes |
|---|---|---|
| Full name | `users.name` | Displayed on the login screen and on every document |
| Phone number | `users.phone` | Optional |
| Role | `users.role` | |
| Branch assignment | `users.location_id` | |
| PIN | `users.pin_hash` | **Stored only as a bcrypt hash. Never in plain text, never recoverable, redacted from all logs** |
| Failed login attempts and lockout state | `login_attempts` | Security |
| Every stock document created, with timestamp | `stock_ledger.created_by`, document tables | **Permanent and unalterable - see clause 11** |
| Audit log entries | `audit_log` | |
| Supplier contact name and phone | `suppliers` | |
| Photographs taken for deliveries and wastage | Uploaded files | May incidentally show a person |

### 4.5 Special categories

**None.** The Processor shall not knowingly process any special category of
personal data. If the Controller instructs otherwise, this Agreement must be
amended first.

## 5. Processor obligations

The Processor shall:

(a) process Personal Data only on the Controller's documented instructions;
(b) ensure that persons authorised to process Personal Data are bound by
confidentiality;
(c) implement the technical and organisational measures in Schedule 1;
(d) respect the conditions on sub-processors in clause 6;
(e) assist the Controller, so far as reasonably possible, in responding to data
subject requests (clause 7);
(f) assist the Controller with security, breach notification and impact
assessments (clauses 8 and 9);
(g) delete or return Personal Data at the Controller's choice on termination,
subject to clause 11; and
(h) make available the information necessary to demonstrate compliance and
allow audits under clause 10.

## 6. Sub-processors

6.1 The Controller gives general authorisation for the sub-processors listed in
Schedule 2.

6.2 The Processor shall give the Controller **thirty (30) days'** written notice
of any intended addition or replacement. The Controller may object on
reasonable data protection grounds within that period; if it does, the parties
shall discuss in good faith, and if no solution is found the Controller may
terminate the affected service without penalty.

6.3 The Processor shall impose on each sub-processor obligations no less
protective than those in this Agreement, and remains fully liable to the
Controller for its sub-processors' performance.

## 7. Data subject rights

7.1 The Processor shall notify the Controller without undue delay, and in any
event within **three (3) Business Days**, if it receives a request from a data
subject. It shall not respond itself except to acknowledge receipt and direct
the person to the Controller.

7.2 The Processor shall provide reasonable assistance to the Controller in
responding, including extraction, correction and, where lawful, deletion.

7.3 **A limit the Controller must understand.** Ledger and audit records are
append-only by design and cannot be edited or deleted by any route, including
by the Processor. A request for erasure cannot be met in respect of the record
that a named person created a stock document. The Controller must rely on the
lawful grounds for retention in clause 11 when responding to such a request.
The Processor will assist by deactivating the account and removing the phone
number, which are the fields that can be changed.

## 8. Security

8.1 The Processor shall implement and maintain the measures in Schedule 1.

8.2 The Processor shall review those measures at least annually and on any
material change to the system.

## 9. Personal data breach

9.1 The Processor shall notify the Controller **without undue delay and in any
event within twenty-four (24) hours** of becoming aware of a personal data
breach affecting Personal Data.

9.2 The notification shall describe, so far as known: the nature of the breach,
the categories and approximate number of data subjects and records affected,
the likely consequences, and the measures taken or proposed.

9.3 Where full information is not available within 24 hours, the Processor
shall notify what it knows and provide the remainder as it becomes available.

9.4 The Processor shall not notify the Data Protection Authority or any data
subject on the Controller's behalf unless instructed to in writing.

9.5 The Processor shall cooperate fully with the Controller's investigation and
shall preserve evidence.

## 10. Audit

10.1 The Processor shall make available all information reasonably necessary to
demonstrate compliance with this Agreement.

10.2 The Controller may audit the Processor's compliance **once in any twelve
month period**, on thirty days' written notice, during business hours, at the
Controller's cost, and subject to confidentiality. Additional audits may be
carried out following a personal data breach.

## 11. Retention

11.1 The Processor retains Personal Data for as long as necessary to provide
the services.

11.2 **Ledger, document and audit records are retained permanently and cannot
be deleted.** This is a deliberate design property: the integrity of the stock
record depends on it, and the Controller relies on it for accountability and,
potentially, for legal proceedings. The Controller acknowledges this and
confirms it is the intended purpose of the system.

11.3 Backups are retained for **thirty (30) days** and then overwritten. Data
deleted from the live system persists in backups until they roll off.

11.4 Uploaded photographs are retained for [FILL: the same period as the
document they support / N years].

## 12. Deletion or return on termination

12.1 On termination, at the Controller's written choice, the Processor shall
either return all Personal Data in a documented, non-proprietary format, or
delete it.

12.2 The Processor shall in any event provide the complete data export under
clause 7.3 of the Software Licence Agreement before deleting anything.

12.3 The Processor may retain Personal Data to the extent required by law, and
in backups until they roll off under clause 11.3. Retained data remains subject
to this Agreement.

12.4 The Processor shall certify deletion in writing within **thirty (30)
days** of completing it.

## 13. Cross-border transfer

13.1 The system is hosted in **[FILL: Singapore / Mumbai / Sri Lanka]**. If
hosted outside Sri Lanka, this is a cross-border transfer of personal data.

13.2 The Processor shall not transfer Personal Data to any other jurisdiction
without the Controller's prior written consent.

13.3 The Controller confirms it has satisfied itself that the transfer in 13.1
complies with the Personal Data Protection Act, No. 9 of 2022.

> Discuss this before signing. If the Controller wants data held in Sri Lanka,
> say so now - it is a hosting decision, and it is cheap to make at the start
> and expensive to make later.

## 14. Liability

Liability under this Agreement is subject to the limits in MSA clause 12,
except where applicable law does not permit that limitation.

## 15. General

15.1 This Agreement is an annexure to and governed by the MSA.

15.2 Where this Agreement conflicts with the MSA on the subject of personal
data, this Agreement prevails.

15.3 Governed by the laws of Sri Lanka.

---

## Schedule 1 - Technical and organisational measures

| # | Measure | Implementation |
|---|---|---|
| S1 | **Encryption in transit** | HTTPS/TLS on all traffic; certificates renewed automatically |
| S2 | **Credential storage** | PINs stored only as bcrypt hashes with a per-user random salt. Never stored, logged or transmitted in plain text |
| S3 | **Log redaction** | Authorisation headers and PIN fields are redacted from all application logs. A PIN in a log file is a PIN in a backup, forever |
| S4 | **Access control** | Role-based authorisation enforced by the server, not the interface. Five roles with least privilege. Branch membership validated on every request |
| S5 | **Separation of duties** | No user may release their own request, confirm a delivery they released, or verify their own count |
| S6 | **Brute-force protection** | Five failed PIN attempts lock an account for fifteen minutes |
| S7 | **Rate limiting** | Applied at the HTTP layer |
| S8 | **Audit trail** | Every document write recorded in `audit_log` with actor, timestamp and document reference |
| S9 | **Immutable history** | Database triggers reject UPDATE and DELETE on the stock ledger, including via TRUNCATE. Enforced by the database, not the application |
| S10 | **Encryption at rest** | [FILL: provider-level disk encryption - confirm with the hosting provider] |
| S11 | **Backups** | Nightly automated dump to object storage, 30-day retention, transferred over TLS, [FILL: encrypted at rest] |
| S12 | **Restore testing** | A restore is performed and evidenced before go-live, and at least [FILL: annually] thereafter |
| S13 | **Server access** | SSH key authentication only, password authentication disabled. Access limited to named TriniphiX personnel |
| S14 | **Personnel** | All TriniphiX personnel bound by written confidentiality obligations. Access removed within one Business Day of a leaver's last day |
| S15 | **Patching** | Operating system and dependency security updates applied under the AMC |
| S16 | **Environment separation** | Development and demonstration environments hold generated data only, never live personal data |
| S17 | **Monitoring** | Uptime and error alerting to a nominated contact |

**S16 is worth naming explicitly:** development and demonstration use
deterministically generated data with an `is_demo` flag. Live personal data is
never copied into a development environment.

## Schedule 2 - Approved sub-processors

| # | Sub-processor | Service | Location | Data |
|---|---|---|---|---|
| 1 | [FILL: VPS provider] | Server hosting | [FILL] | All system data |
| 2 | [FILL: object storage provider] | Backup storage | [FILL] | Database backups |
| 3 | [FILL: alerting provider, if any] | Uptime and error alerting | [FILL] | Technical metadata only |

---

## Signed

**For and on behalf of [FILL: client legal entity name] (Controller)**

| | |
|---|---|
| Signature | |
| Name | |
| Title | |
| Date | |

**For and on behalf of TriniphiX (Pvt) Ltd (Processor)**

| | |
|---|---|
| Signature | |
| Name | Pasindu Fernando |
| Title | Chief Executive Officer |
| Date | |
