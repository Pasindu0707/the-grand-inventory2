# UAT Sign-off Certificate

**Project:** The Grand - inventory management system
**Client:** [FILL: client legal entity name], trading as The Grand Gastrobar, Negombo
**Supplier:** TriniphiX (Pvt) Ltd
**Under:** SOW TPX-SOW-[FILL] · MSA TPX-MSA-[FILL]

| | |
|---|---|
| Certificate number | TPX-UAT-[FILL] |
| UAT started | [FILL] |
| UAT completed | [FILL] |
| Version tested | [FILL] |
| Environment | [FILL: demonstration URL] |

---

## 1. What this certificate means

Signing this confirms that the Client's own staff have tested the system doing
their own jobs, and that it does what the signed SRS says it does.

It **triggers milestone payment P4** under the Payment Schedule.

It does **not** mean the system is perfect, and it does not close the remaining
minor defects listed in §5 - those are fixed during the 90-day warranty period.

## 2. Who tested

| Role | Name | Scripts run | Hours | Signature |
|---|---|---|---|---|
| Storekeeper | | | | |
| Kitchen | | | | |
| Cleaning | | | | |
| Management | | | | |
| Admin | | | | |

**Each person signed for the scripts they ran themselves**, in the room where
they will actually do that job.

## 3. Scripts executed

| Section | Scripts | Passed | Failed | Not run |
|---|---|---|---|---|
| A - Signing in | 6 | | | |
| B - Receiving a delivery | 8 | | | |
| C - Market purchase | *withdrawn (CR-001)* | - | - | - |
| D - Requests and issues | 9 | | | |
| E - Purchases | 8 | | | |
| F - Wastage | 5 | | | |
| G - Counting | 8 | | | |
| H - Cleaning | *withdrawn (CR-001)* | - | - | - |
| I - Opening stock | 3 | | | |
| J - The two that matter | 2 | | | |
| K - Reports | 13 | | | |
| L - Logins and setup | 16 | | | |
| M - Non-functional | 7 | | | |
| **Total** | **94** | | | |

Any script not run must be listed here with a reason:

```
[FILL, or "none"]
```

## 4. The critical confirmations

Each of these is initialled by the named person. They are the checks the
system's credibility rests on.

| # | Confirmation | Script | Confirmed by | Initials |
|---|---|---|---|---|
| C1 | **The expected quantity is never shown while counting** | U-62 | Storekeeper | |
| C2 | **Wastage cannot be saved without a reason** | U-51 | Kitchen | |
| C3 | **A price rise warns and still records** | U-12 | Storekeeper | |
| C4 | **Releasing outside the issue window warns and still records** | U-34 | Storekeeper | |
| C5 | **Stock never goes negative** | U-32 | Storekeeper | |
| C6 | **Nobody can release their own request** | U-36 | Storekeeper | |
| C7 | **Nobody can verify their own count** | U-64 | Management | |
| C8 | **A count cannot be closed twice** | U-65 | Storekeeper | |
| C9 | **A document cannot be reversed twice** | U-16 | Management | |
| C10 | **The last admin cannot be switched off** | U-105 | Admin | |
| C11 | **The five planted faults were each found by their own report** | U-120 to U-124 | Management | |
| C12 | **Documented lettuce spoilage appears in Wastage and does NOT appear in Shrinkage** | U-90 | Management | |
| C13 | **The database refused an UPDATE, a DELETE and a TRUNCATE on the ledger** | U-91 | Management + TriniphiX | |
| C14 | **A backup was restored successfully in our presence** | U-144 | Management | |

### C14 and C15 in the Client's own words

Please write, in your own words, what you saw:

**C14 -**
```
[FILL]
```

**C15 -**
```
[FILL]
```

> These two are asked for in longhand deliberately. C14 is the acceptance
> gate - a report that accuses people of theft over honest waste is the failure
> that gets systems abandoned. C15 is the property that makes every number in
> the system worth reading. Both are worth being certain you saw.

## 5. Defects

### 5.1 Closed during UAT

| # | Summary | Severity | Fixed in | Retested by |
|---|---|---|---|---|
| | | | | |

### 5.2 Remaining open - accepted

Acceptance is not withheld for S3 and S4 defects. They are fixed during the
warranty period.

| # | Summary | Severity | Agreed fix by |
|---|---|---|---|
| | | S3 / S4 | |

### 5.3 Confirmation

**There are no open Severity 1 or Severity 2 defects.**

☐ Confirmed by the Client
☐ Confirmed by TriniphiX

If any S1 or S2 defect is open, **this certificate must not be signed.**

## 6. Raised during UAT, classified as change requests

Recorded so nobody has to reconstruct the conversation later.

| # | Raised by | What was asked for | CR number | Decision |
|---|---|---|---|---|
| | | | | |

## 7. Values the Client set during UAT

| Setting | Value the Client chose |
|---|---|
| Shrinkage floor - money | LKR [FILL] |
| Shrinkage floor - proportion | [FILL] % |
| Price movement threshold | [FILL] % |
| Issue windows | [FILL] |

☐ These have been applied to the system and re-verified.

## 8. Known limitations acknowledged

The Client confirms they understood these before signing. Each is in the signed
SRS.

| # | Limitation | SRS ref | Ack |
|---|---|---|---|
| 1 | **Online-only.** A dropped connection during a count loses that count | CON-02 | ☐ |
| 2 | **No transfers screen** in Phase 1 - the API works and is tested | FR-TRF-04 | ☐ |
| 3 | **No CSV import.** Every item is typed in once | FR-DAT-04 | ☐ |
| 4 | **Read access is not restricted by role.** Quantities are visible to any signed-in user; money and reports are not | FR-ROL-11 | ☐ |
| 5 | **No approval limits.** Management approves every purchase, of any value | OOS-12 | ☐ |
| 6 | **Every purchase goes through a supplier who invoices.** There is no cash-buy document | OOS-13, CR-001 | ☐ |
| 7 | Changing someone's role is done by a command, not a screen | FR-ADM-08 | ☐ |
| 8 | Recipes and production are Phase 2 | OOS-10 | ☐ |
| 9 | English only | OOS-09 | ☐ |
| 10 | Runs in a browser tab; not installable as an app | CON-03 | ☐ |

## 9. Declaration

The Client confirms that:

1. Its own staff, in their own roles, have executed the UAT scripts recorded in
   §3.
2. The results are as recorded, including the failures.
3. There are no open Severity 1 or Severity 2 defects.
4. The remaining defects in §5.2 are accepted for correction during the warranty
   period.
5. The limitations in §8 were understood before signing.
6. **User Acceptance Testing is complete and passed.**

TriniphiX confirms that:

1. All 64 automated tests and all 12 database integrity checks pass on the
   version tested.
2. Every defect raised has been assessed and recorded.
3. Every defect fixed has a regression test.

---

## Signed

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
| Name | Pasindu Fernando |
| Title | Chief Executive Officer |
| Signature | |
| Date | |

---

**Next:** this certificate triggers invoice **P4 (20%)** and opens the go-live
sequence. Final acceptance is recorded separately on the
[Delivery & Acceptance Certificate](../06-deployment/delivery-acceptance-certificate.md).
