# Project document set - The Grand inventory system

Supplier: **TriniphiX (Pvt) Ltd**
Client: **The Grand Gastrobar, Negombo**
Project: Inventory management system, Phase 0-4

---

## How to read this pack

Documents are grouped by the phase that produces them. A document marked
**signed** is not finished until both parties have put a name and a date on the
last page - an unsigned SRS is an opinion, and an unsigned acceptance
certificate is an invoice nobody has agreed to pay.

Anything written as `[FILL: …]` is a value TriniphiX must supply before the
document leaves the office. Grep for it:

```bash
grep -rn "FILL:" docs/
```

**The legal documents in `02-contract/` and `07-post-golive/` are drafts.**
They must be reviewed by a Sri Lankan attorney-at-law before use. They are
written to be a sound starting point, not a substitute for advice.

---

## The set

### 00 - Company

| Document | Signed |
|---|---|
| [Company Profile / Capability Statement](00-company/company-profile.md) | No |

### 01 - Pre-sales

| Document | Signed |
|---|---|
| [Mutual Non-Disclosure Agreement](01-presales/nda-mutual.md) | **Both parties** |
| [Requirement Gathering Questionnaire](01-presales/requirement-questionnaire.md) | No |
| [Discovery / As-Is Process Report](01-presales/discovery-as-is-report.md) | No |
| [Proposal & Quotation](01-presales/proposal-and-quotation.md) | Acknowledged |
| [Demo Feedback Note](01-presales/demo-feedback-note.md) | No |

### 02 - Contracting

| Document | Signed |
|---|---|
| [Master Services Agreement](02-contract/master-services-agreement.md) | **Yes** |
| [Statement of Work](02-contract/statement-of-work.md) | **Yes** |
| [Payment Schedule / Milestone Plan](02-contract/payment-schedule.md) | **Yes** (MSA annexure) |
| [Software Licence Agreement](02-contract/software-licence-agreement.md) | **Yes** |
| [Data Processing Agreement](02-contract/data-processing-agreement.md) | **Yes** |
| [Change Request Procedure](02-contract/change-request-procedure.md) | **Yes** (annexure) |
| [Change Request Form](02-contract/change-request-form.md) | **Yes**, one per change |
| [CR-001 - withdraw the cleaning checklist and the cash market purchase](02-contract/change-requests/CR-001-withdraw-cleaning-checklist-and-market-purchase.md) | **Yes** |
| [CR-002 - cleaning may count its own store and log wastage](02-contract/change-requests/CR-002-cleaning-may-count-and-log-wastage.md) | **Yes** |
| [CR-003 - returns to the store and on to the supplier](02-contract/change-requests/CR-003-returns-to-store-and-supplier.md) | **Yes** |
| [CR-004 - one kitchen: retire the Bar and Bakery section kinds](02-contract/change-requests/CR-004-one-kitchen-no-bar-or-bakery-sections.md) | **Yes** |
| [CR-005 - management approves; the store handles stock](02-contract/change-requests/CR-005-management-approves-the-store-handles-stock.md) | **Yes** |
| [CR-006 - one decision about bad stock: supplier or bin](02-contract/change-requests/CR-006-one-decision-about-bad-stock.md) | **Yes** |

### 03 - Requirements & design

| Document | Signed |
|---|---|
| [Software Requirements Specification](03-requirements/srs.md) | **Yes - the critical one** |
| [Requirements Traceability Matrix](03-requirements/traceability-matrix.md) | No |
| [UI / Screen Specification](03-requirements/ui-screen-specification.md) | **Yes** |
| [Data Migration Plan](03-requirements/data-migration-plan.md) | **Yes** |
| [Integration Specification](03-requirements/integration-specification.md) | No |

### 04 - Technical (internal)

| Document |
|---|
| [System Architecture](04-technical/system-architecture.md) |
| [Database Design & Data Dictionary](04-technical/database-design.md) |
| [API Documentation](04-technical/api-documentation.md) |
| [Returns lifecycle](04-technical/returns-lifecycle.md) |
| [Security & Access Control Design](04-technical/security-and-access-control.md) |
| [Backup & Disaster Recovery Plan](04-technical/backup-and-disaster-recovery.md) |
| [Coding Standards](04-technical/coding-standards.md) |

### 05 - Testing

| Document | Signed |
|---|---|
| [Test Plan](05-testing/test-plan.md) | No |
| [UAT Plan & Test Scripts](05-testing/uat-plan-and-scripts.md) | **Yes**, per script |
| [Defect Log](05-testing/defect-log.md) | No |
| [UAT Sign-off Certificate](05-testing/uat-signoff-certificate.md) | **Yes** |

### 06 - Deployment & handover

| Document | Signed |
|---|---|
| [Deployment / Go-Live Plan](06-deployment/go-live-plan.md) | No |
| [Installation & Configuration Guide](06-deployment/installation-and-configuration-guide.md) | No |
| [Delivery & Acceptance Certificate](06-deployment/delivery-acceptance-certificate.md) | **Yes - triggers payment** |
| [User Manual](06-deployment/user-manual.md) | No |
| [What happens to returned stock](06-deployment/what-happens-to-returned-stock.md) | No |
| [Administrator Manual](06-deployment/administrator-manual.md) | No |
| [Training Plan](06-deployment/training-plan.md) | No |
| [Training Attendance & Completion Sheet](06-deployment/training-attendance-sheet.md) | **Yes**, by attendees |
| [Data Migration Completion Report](06-deployment/data-migration-completion-report.md) | **Yes** |
| [Handover Note](06-deployment/handover-note.md) | **Yes** |

### 07 - Post go-live

| Document | Signed |
|---|---|
| [Warranty Certificate](07-post-golive/warranty-certificate.md) | Issued by TriniphiX |
| [Service Level Agreement](07-post-golive/service-level-agreement.md) | **Yes** |
| [Annual Maintenance Contract](07-post-golive/annual-maintenance-contract.md) | **Yes** |
| [Support Ticket Procedure](07-post-golive/support-ticket-procedure.md) | No |
| [Project Closure Report](07-post-golive/project-closure-report.md) | Acknowledged |

### 08 - Running throughout

| Document |
|---|
| [Project Plan](08-running/project-plan.md) |
| [Meeting Minutes template](08-running/meeting-minutes-template.md) |
| [Status Report template](08-running/status-report-template.md) |
| [Risk & Issue Register](08-running/risk-and-issue-register.md) |

---

## The short list

For a project this size, most of the above is scaled to fit. These eight cannot
be skipped:

**NDA → Proposal → MSA + SOW → SRS (signed) → UAT sign-off → Acceptance
Certificate → User Manual → SLA/AMC**

Keep meeting minutes and signed change requests regardless of how small the job
is. Those two are what stop a five-week project becoming a five-month one.

---

## Source of truth

These documents describe the system as built. Where a document states a
behaviour, that behaviour is in the code and, in most cases, in a test. The
engineering companions are:

- [README.md](../README.md) - the data pack and the five planted faults
- [HANDBOOK.md](../HANDBOOK.md) - how to check the system, and why it works the way it does
- [PLAN.md](../PLAN.md) - the build plan and the remaining work

Where a document has been amended after signature, the amendment is a change
request in `02-contract/change-requests/` and the document says which one. The
presales records in `01-presales/` are deliberately **not** rewritten - they
record what was found and agreed at the time, and carry a pointer instead.
