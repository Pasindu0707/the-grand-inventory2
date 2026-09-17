# Test Plan

**Project:** The Grand - inventory management system
**Version:** 1.0 · [FILL: date]
**Status:** Internal

---

## 1. Approach

Test data with no faults in it teaches you nothing.

The core of this test strategy is that the system is loaded with **sixty days of
generated data containing five deliberate faults**, and each fault maps to one
report. If a report cannot find its own fault, the report is wrong. Each fault
is an assertion in an automated suite, so a report that stops finding its fault
fails the build.

One of those five asserts that a report **stays silent**. That one is the
acceptance gate, and it is explained in §5.

## 2. What is tested where

| Level | What | Tool | Run by |
|---|---|---|---|
| Type checking | Contracts between layers | `tsc --strict` | CI, every push |
| Lint | **Including the rule that no controller writes the ledger** | ESLint | CI, every push |
| Database integrity | Immutability, cutover, re-seed | `npm run db:verify` - 12 checks | CI and before go-live |
| Integration | Every document type, every guard, every report | Vitest against a real PostgreSQL - 64 tests | CI, every push |
| Acceptance | The five planted faults | `anomalies.test.ts` | CI, and demonstrated to the Client |
| Manual | Screens, wording, device behaviour | UAT scripts | Client staff |
| Performance | Response times under volume | Manual, against seeded data | TriniphiX |
| Security | Guards, scoping, immutability | Covered by integration tests + manual probes | TriniphiX |

### 2.1 Why there are no unit tests with mocks

The behaviours worth testing in this system are database behaviours: an
append-only trigger, a weighted-average recalculation inside a transaction, an
idempotency race, a unique constraint that stops the same count being closed
twice.

A mocked database would prove that our code calls a fake correctly. It would
prove nothing about whether the ledger can be edited - which is the property the
entire product rests on.

So the tests run against a real PostgreSQL. They are slower. They are worth it.

## 3. Environments

| Environment | Purpose | Data |
|---|---|---|
| Local | Development | Generated seed, 60 days, five faults |
| CI | Every push | Fresh database per run |
| Demonstration | Client demos and UAT | Generated seed, five faults |
| Production | Live | **Real data only. Reset before go-live** |

**Live personal data is never copied into any other environment.** Every table
carries `is_demo`; demo and real data share every code path, so nothing is ever
tested against a structure that will not ship.

## 4. The five planted faults

Sixty days of generated data, deterministic - the same PRNG seed every run, so
screenshots and assertions stay stable.

| # | Fault | Where it hides | Report that must catch it | Correct answer |
|---|---|---|---|---|
| **A** | Chicken breast over-issued from day 20 | Individual issues look normal | Usage variance | **+18.6%**, ~LKR 192,000, and only 2 rows in the whole report |
| **B** | Two gin bottles vanish, days 28 and 44 | **No document at all** | Shrinkage | **Exactly two rows**, −750 ml, ~LKR 5,216 each, both in the bar |
| **C** | Sunflower oil +32% at the supplier on day 35 | Buried in a routine delivery | Price movement | 45,880 → 60,561.60 on 2026-07-30 |
| **D** | Lettuce spoilage spike, days 38-44 | Genuine waste, correctly logged | Wastage by reason | Under *Spoiled / expired*, with a visible spike |
| **E** | Prawns hit zero on day 41 | Store empties mid-service | Stock-outs | Balance 0 on 2026-07-21 |

### 4.1 Two of them surface late, on purpose

**B** happens on days 28 and 44 but nothing reveals it until the next Sunday bar
count. **C** happens on day 35 but is discovered at the next delivery, on day
50.

A report that insists on flagging faults on the day they occur would miss both,
so there are explicit tests asserting the *detection* date rather than the
*occurrence* date:

- *is detected at the delivery, not on the day the supplier changed the price*

## 5. The acceptance gate - a report that must stay silent

**Fault D must appear in the wastage report and must NOT appear in the shrinkage
report.**

The test asserting this is the most important in the suite:

```
it('does NOT appear in the shrinkage report')
it('keeps documented waste out of the unexplained set generally')
```

Honest, documented spoilage appearing in an unexplained-loss report is the
failure mode that gets a system abandoned. An owner accused of theft over a
crate of lettuce stops opening reports by week three - and that is the failure
nobody writes a test for.

**It has already earned its place.** Without a materiality floor the shrinkage
report was listing Rs 0.44 losses of one gram of lettuce. And a flat money floor
alone still let fifteen days of ordinary counting noise on expensive gin bury
the two real bottles. Shrinkage now needs to be material in **both** money and
proportion, because noise is proportional to what is on the shelf and theft is
not.

## 6. The reports must not cry wolf

Four further assertions exist purely to stop the reports becoming noise:

| Test | Guards against |
|---|---|
| *usage variance stays a short list, not every item in the store* | A report that flags forty items is a report nobody opens |
| *price movement only reports genuine moves* | Rounding and one-off promotions read as price rises |
| *shrinkage reports losses, never found stock* | A count that finds extra is not a theft |
| *ignores counting noise below the materiality floor* | The lettuce problem |

## 7. What the integration suite covers

64 tests across twelve files.

| File | Covers |
|---|---|
| `anomalies.test.ts` | The five faults and the four cry-wolf assertions. **The acceptance suite** |
| `auth.test.ts` | Bootstrap without exposing hashes, PIN login, lockout, branch scoping, refresh-token misuse |
| `ledger.test.ts` | **UPDATE, DELETE and TRUNCATE all refused.** Reversals mirror and do not repeat. Business date honours `day_start`. Schema drift |
| `grn.test.ts` | Pack conversion, weighted average, price warning without blocking, idempotency replay and clash, role guard, stock derivation |
| `documents.test.ts` | Wastage and reason codes, transfers, counts (freeze, adjust, partial, double-close, self-verify), reversals, section boundaries |
| `uploads.test.ts` | The upload endpoint refuses an unauthenticated caller |
| `returns.test.ts` | Both legs at once on a section return; stock moves on send and not before; priced from the delivery; capped by the delivery and by quarantine; netted off consumption; kept out of shrinkage |
| `requests.test.ts` | The full request lifecycle, shortfalls, self-release |
| `purchasing.test.ts` | Raising, deciding, short delivery, wrong supplier, close-short, two pack sizes, suggestions |
| `reports-ops.test.ts` | The seven operational reports |
| `setup.test.ts` | Setup CRUD, opening stock once, admin restrictions, last-admin protection |
| `empty-body.test.ts` | Bodyless commands accepted; malformed JSON still rejected |
| `helpers.ts` | Shared fixtures |

## 8. Database integrity checks

```bash
npm run db:verify   # 12 checks
```

Proves the whole cycle in one command: schema → seed → immutability probes →
cutover → re-seed, twice in a row, with `select count(*) from stock_ledger`
returning **0** after reset.

**If `reset.sql` ever stops emptying the ledger, this catches it.** That matters
because the original schema had a rule that silently discarded deletes - cutover
would have appeared to succeed while leaving 10,800 demonstration rows in the
live ledger.

## 9. What must be impossible

Tested, and demonstrated to the Client at acceptance. **If any of these
succeeds, something is badly wrong.**

| # | Attempt | Enforced by |
|---|---|---|
| 1 | Editing a ledger row, by any route | Database |
| 2 | Deleting a ledger row | Database |
| 3 | `TRUNCATE` on the ledger | Database |
| 4 | Reversing the same document twice | API |
| 5 | Cancelling an issue that already moved stock | API |
| 6 | Closing the same count twice | API |
| 7 | Verifying your own count | API |
| 8 | A kitchen login opening Reports | API |
| 9 | Changing `x-location-id` to a branch you are not assigned to | API |
| 10 | Opening a section's opening stock twice | API |
| 12 | Deactivating the last admin | API |

## 10. Performance testing

| # | Scenario | Target | Method |
|---|---|---|---|
| P1 | Stock enquiry, whole branch | < 2 s | Against 50,000 seeded rows |
| P2 | Any report, 90-day range | < 5 s | Against 50,000 seeded rows |
| P3 | Save a delivery | < 2 s | On premises Wi-Fi |
| P4 | First load on a mid-range Android | < 5 s | Real device |

Run before go-live and recorded in the UAT evidence.

## 11. Manual testing

Everything a person has to see. Full scripts in the
[UAT Plan](uat-plan-and-scripts.md).

The manual-only items, and why each cannot be automated:

| What | Why it is manual |
|---|---|
| **The expected quantity is never shown while counting** | It is an absence on a screen. Automatable only as a negative API assertion, which does not prove the screen |
| **The PIN is shown once and never again** | Human observation |
| Photograph capture on a real phone | Device behaviour |
| Wording, empty states, disabled-control explanations | Judgement |
| One-handed use at a delivery door | Physical |
| Session survives a refresh | Browser behaviour |
| Backup restore | See the DR plan §7 |

## 12. Entry and exit criteria

**Entry to UAT**

| # | |
|---|---|
| 1 | All 64 automated tests pass |
| 2 | `npm run db:verify` passes all 12 checks |
| 3 | Typecheck and lint pass |
| 4 | Demonstration environment deployed and seeded |
| 5 | UAT scripts handed over |
| 6 | Client staff booked |

**Exit from UAT**

| # | |
|---|---|
| 1 | Every UAT script executed and signed |
| 2 | All Severity 1 and 2 defects closed |
| 3 | Severity 3 and 4 defects logged and scheduled |
| 4 | The five faults found by their reports, witnessed by management |
| 5 | **Fault D confirmed absent from the shrinkage report** |
| 6 | The "must be impossible" list demonstrated |
| 7 | UAT Sign-off Certificate signed |

## 13. Defect severity

| Severity | Definition | Blocks acceptance |
|---|---|---|
| **S1 Critical** | Data loss, corruption, unusable system, or a wrong stock figure | **Yes** |
| **S2 Major** | A required function does not work; no reasonable workaround | **Yes** |
| **S3 Minor** | Works but incorrectly or awkwardly; workaround exists | No - fixed in warranty |
| **S4 Cosmetic** | Appearance, wording, alignment | No |

**Any defect that produces a wrong stock figure is S1**, however small it looks.
A stock system that is quietly wrong is worse than one that is visibly broken.

## 14. Risks to testing

| # | Risk | Mitigation |
|---|---|---|
| 1 | Client staff unavailable for UAT | Booked in the SOW; escalated in the weekly status report |
| 2 | UAT run only by management, not by the storekeeper and kitchen | Scripts are assigned by role and signed by role. **The storekeeper's scripts must be run by the storekeeper** |
| 3 | Testing on desks rather than in the rooms | Scripts specify where: the delivery door, the store, the bar |
| 4 | Real data entered before cutover | Freeze demo use; reset; verify the ledger is empty |
| 5 | Reports judged on the demo data and then trusted blindly on real data | The demo faults show *what the reports can find*. Explain that real data will look different |
