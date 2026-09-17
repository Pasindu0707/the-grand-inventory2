# Defect Log

**Project:** The Grand - inventory management system
**Version:** 1.0 · [FILL: date]
**Maintained by:** TriniphiX · **Circulated:** with the weekly status report

---

## How to raise a defect

Write down four things. If you can only manage one, make it the fourth.

1. **What you did** - the steps, in order
2. **What you expected** - quote the UAT script or the SRS if you can
3. **What happened instead**
4. **Which login you were using, on what device**

A screenshot is worth a paragraph. So is the time it happened.

## Is it a defect?

| It is a **defect** if | It is a **change request** if |
|---|---|
| The system does not do what the signed SRS says | You want it to do something the SRS does not mention |
| A UAT script's expected result did not happen | You would prefer it worked differently |
| Something crashed, or a number is wrong | A screen is not laid out the way you imagined |

Both are worth raising. They are just handled differently: a defect is fixed
free, a change request is quoted. Nothing is lost by raising it as a defect and
being told it is a change - that conversation is the point of this log.

## Severity

Set by TriniphiX, agreed with the Client.

| Severity | Definition | Example | Blocks acceptance |
|---|---|---|---|
| **S1 Critical** | Data loss or corruption, system unusable, or **a stock figure that is wrong** | Stock goes negative; a ledger row can be edited; a report shows the wrong total | **Yes** |
| **S2 Major** | A required function does not work; no reasonable workaround | Cannot release a request; cannot save a delivery | **Yes** |
| **S3 Minor** | Works but incorrectly or awkwardly; a workaround exists | A report column is mislabelled; a filter does not persist | No |
| **S4 Cosmetic** | Appearance, wording, alignment | Button misaligned; a typo | No |

**Any defect that produces a wrong stock figure is S1**, however small it looks.
A stock system that is quietly wrong is worse than one that is visibly broken -
the second gets fixed, the first gets trusted.

## Status

`Open` → `Accepted` → `In progress` → `Fixed` → `Retested` → **`Closed`**

Other outcomes: `Rejected - change request` · `Rejected - works as specified` ·
`Duplicate` · `Cannot reproduce` · `Deferred to warranty`

**Only the person who raised a defect closes it**, after retesting. TriniphiX
moves it to `Fixed`; the Client moves it to `Closed`.

---

## The log

| # | Raised | By | Summary | Where | SRS ref | Sev | Status | Owner | Fixed in | Closed |
|---|---|---|---|---|---|---|---|---|---|---|
| D-001 | [FILL] | TriniphiX (code review) | **Verify count and Approve wastage buttons never appear for management** - the UI tested for roles `owner`/`manager`, which have not existed since migration 0003 collapsed eight roles to five | Stock count, Wastage - both front ends | FR-CNT-09, FR-WST-04 | **S2** | Fixed | TriniphiX | `counts.component.ts`, `wastage.component.ts` - `canVerify`/`canApprove` now test `management` | |
| D-002 | [FILL] | TriniphiX (found while narrowing roles for CR-005) | **The "Needs me" queue promised rows it then greyed out** - the list was filtered on the sections a person can *see* while the flag on each row was built from the sections they *belong to*. The storekeeper, who can see the whole branch, was handed every section's arrivals with every row flagged as not theirs | Requests | FR-REQ-02 | **S3** | Fixed | TriniphiX | `routes/requests.ts` - the filter now reads `owned`, the same set the flag does | |
| D-003 | [FILL] | TriniphiX (found while driving the delivery screen) | **"Last price" was whichever row the database returned first** - `supplier_prices.effective_from` is a date, and two price changes on one day are ordinary. With only the date in the sort, the price a delivery was judged against could differ between two saves of the same delivery | Receive delivery; the price-change warning | FR-GRN-05 | **S2** | Fixed | TriniphiX | `services/grn.ts` and `routes/grn.ts` - both now break the tie on `id desc`, so the screen and the document it produces read the same price | |
| D-004 | [FILL] | TriniphiX (found while driving the Returns screen) | **The quarantine panel read "nothing is waiting to go back" over a quarantine holding 2.6 tonnes** - two unrelated reads were issued as one `Promise.all`, so a rejected page limit on the second took the first down with it | Returns | FR-RET-04 | **S1** | Fixed | TriniphiX | `returns.component.ts` - the panel loads on its own, and the two reads that only improve the drawer fail quietly | |
| D-005 | [FILL] | TriniphiX (found while delivering CR-006) | **Two tests were passing by luck** - the partial-count test counted whichever stock line came back first, which became a zero-quantity line once the kitchen's contents shifted; and the returns suite signed in on every call, silently exceeding the twenty-a-minute login limit and failing as 401s that read as an authentication fault | `documents.test.ts`, `returns.test.ts` | n/a - test defect | **S3** | Fixed | TriniphiX | The count test now picks a line the section actually holds; the returns suite caches one session per role | |
| D-006 | | | | | | | | | | |
| D-007 | | | | | | | | | | |
| D-008 | | | | | | | | | | |
| D-009 | | | | | | | | | | |
| D-010 | | | | | | | | | | |

---

## Detail sheet

One per defect. Copy this block.

### D-[FILL]

| | |
|---|---|
| **Summary** | [FILL: one line, specific. "Releasing a request twice creates two issues" not "requests broken"] |
| Raised by | |
| Date raised | |
| UAT script | [FILL: U-xx, or "found outside a script"] |
| SRS requirement | [FILL: FR-xxx-nn, or "not covered - may be a change request"] |
| Role signed in as | |
| Device and browser | |
| Branch and section | |
| Severity | ☐ S1 ☐ S2 ☐ S3 ☐ S4 |
| Status | |

**Steps to reproduce**

```
1.
2.
3.
```

**Expected**

```
[FILL: quote the UAT script or the SRS]
```

**Actual**

```
[FILL]
```

**Screenshot / evidence**

```
[FILL: attach, or say where it is]
```

**Frequency:** ☐ Every time ☐ Sometimes ☐ Once only

---

**TriniphiX assessment**

| | |
|---|---|
| Assessed by | |
| Date | |
| Classification | ☐ Defect ☐ Change request ☐ Works as specified ☐ Duplicate of D-___ ☐ Cannot reproduce |
| Cause | |
| Fix | |
| **Does this affect existing data?** | ☐ No ☐ Yes - see below |
| Data correction needed | [FILL: **Remember: the ledger cannot be edited. A data correction is a reversal, and it must be recorded as one**] |
| Test added | [FILL: test name - a defect without a regression test comes back] |
| Fixed in version | |
| Date fixed | |

**Client retest**

| | |
|---|---|
| Retested by | |
| Date | |
| Result | ☐ Closed ☐ Still failing - reopened |
| Comments | |

---

## Two rules for this log

**Every defect gets a regression test.** A defect fixed without a test is a
defect that comes back, usually after everyone has forgotten the original
conversation. The test name goes in the assessment block above and, if it
relates to a requirement, in the traceability matrix.

**A defect that corrupted data needs a correction plan, not just a code fix.**
The bug is fixed in an hour; the wrong rows sit in the ledger permanently. They
cannot be edited - that is the design - so the correction is a reversal, and
somebody has to decide what the right figures were. Record that decision here.

## Summary

| Severity | Open | In progress | Fixed | Closed | Rejected |
|---|---|---|---|---|---|
| S1 | | | | | |
| S2 | | | | | |
| S3 | | | | | |
| S4 | | | | | |
| **Total** | | | | | |

**Acceptance requires:** S1 = 0 open, S2 = 0 open.
S3 and S4 may remain open and are fixed during the warranty period.

---

### D-001

| | |
|---|---|
| **Summary** | Management can never see the Verify (count) or Approve (wastage) buttons |
| Raised by | TriniphiX, during the CR-002 review |
| Date raised | [FILL] |
| UAT script | Found outside a script - U-64 and U-52 would both have caught it |
| SRS requirement | FR-CNT-09 (management verifies a count), FR-WST-04 (management approves wastage) |
| Role signed in as | Management |
| Device and browser | Any |
| Branch and section | Any |
| Severity | ☐ S1 ☒ S2 ☐ S3 ☐ S4 |
| Status | Fixed - awaiting retest |

**Steps to reproduce**

```
1. Sign in as Nuwan Perera (management)
2. Open Stock counts and select a closed count
3. Look for the Verify button
4. Repeat on Wastage, looking for Approve
```

**Expected** - both buttons are offered. The SRS gives management, and only
management, both actions.

**What happened** - neither button ever renders, for any role.

**Cause** - both components computed their permission as
`['owner', 'manager'].includes(role)`. Those two role names came from the
eight-role model that migration `0003_simple_roles.sql` replaced with
`admin · management · storekeeper · kitchen · cleaning`. The array can never
match, so the guard was permanently false. Present in **both** front ends.

**Why nothing caught it.** The API guard is correct and separately tested
(`requireRole('management')`), so the server would have accepted the call - the
UI simply never made it. The automated suite exercises the endpoint, not the
button, and U-52 and U-64 had not yet been run against a build.

**Severity.** S2 rather than S1: no stock figure is wrong. But it is the whole
of the second-person check in §P12 - counts could be closed and wastage logged,
and neither could ever be verified or approved by anyone.

**Fix** - `canVerify` and `canApprove` now test `role === 'management'`, the
one role the API accepts.
