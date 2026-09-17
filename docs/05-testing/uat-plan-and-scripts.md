# UAT Plan & Test Scripts

**Project:** The Grand - inventory management system
**Client:** The Grand Gastrobar, Negombo
**Version:** 1.0 · [FILL: date]

---

## 1. What this is

User Acceptance Testing is your staff using the system, doing their own jobs,
and saying whether it works. It is not us demonstrating it to you.

These scripts tell each person what to do and what should happen. Where the
result does not match, write it down. That is the whole job.

## 2. Who runs what

**The scripts must be run by the person who will actually do that job.** A
manager running the storekeeper's scripts on a desk proves nothing about a
phone at a delivery door at 6am.

| Role | Scripts | Time | Where |
|---|---|---|---|
| **Storekeeper** | U-01 to U-06, U-10 to U-17, U-31 to U-37, U-40 to U-47, U-60 to U-67, U-80 to U-82, U-154 to U-159 | 2.5 hours | **The store room and the delivery door** |
| **Kitchen** | U-01, U-03, U-05, U-30, U-35, U-38, U-50 to U-54, U-62, U-150 to U-152 | 1.5 hours | **The kitchen pass** |
| **Cleaning** | U-01, U-30, U-35, U-38, U-50 to U-52, U-60 to U-62 | 40 min | **The cleaning store** |
| **Management** | U-16, U-42, U-52, U-64, U-120 to U-132, U-146 | 2 hours | Office |
| **Admin** | U-100 to U-106, U-110 to U-118 | 1 hour | Office |
| **TriniphiX, witnessed by the Client** | U-90, U-91, U-140 to U-144 | 1 hour | Anywhere |

## 3. Before you start

| # | |
|---|---|
| 1 | You are on the demonstration system, not a live one |
| 2 | It holds sixty days of made-up data with five deliberate faults in it |
| 3 | Every demo login's PIN is `1234` |
| 4 | You cannot break anything. Try things |
| 5 | Use your own device - your phone, the kitchen tablet - not ours |

## 4. How to record a result

Every script has a Pass / Fail box.

**Fail** means the result did not match what the script said. Write what
happened instead. Do not fix the wording of the expected result to match what
you saw - that is exactly the information we need.

Anything you dislike but which matches the script is **not** a fail. Write it in
the Comments column. It may be a good idea; it is a Change Request, not a
defect.

Log every fail in the [Defect Log](defect-log.md).

---

# The scripts

## A. Signing in

### U-01 - Sign in
| | |
|---|---|
| Role | All |
| Do | Pick the branch. Tap your own name. Enter your PIN. |
| Expect | You land on Today. Your name is shown. You see only the menu items for your job. |
| Note | There is no email field and no password field anywhere. That is deliberate. |

☐ Pass ☐ Fail - Comments: ______________________

### U-02 - Wrong PIN, five times
| | |
|---|---|
| Role | Storekeeper |
| Do | Enter a wrong PIN five times. |
| Expect | It tells you how many tries are left, then locks the account and says it is locked for 15 minutes. |

☐ Pass ☐ Fail - Comments: ______________________

### U-03 - Refresh the page
| | |
|---|---|
| Role | All |
| Do | Go to any screen. Pull down to refresh, or press F5. |
| Expect | **You stay on that screen, still signed in.** You are not thrown back to the login. |

☐ Pass ☐ Fail - Comments: ______________________

### U-04 - Another branch
| | |
|---|---|
| Role | Storekeeper |
| Do | Try to reach a branch you are not assigned to. |
| Expect | Refused. |

☐ Pass ☐ Fail - Comments: ______________________

### U-05 - What we have
| | |
|---|---|
| Role | All |
| Do | Open "What we have". Search for an item. Filter by section. |
| Expect | Quantities and, if you are management, values. Kitchen sees its own sections only. |

☐ Pass ☐ Fail - Comments: ______________________

### U-06 - Low stock
| | |
|---|---|
| Role | Storekeeper |
| Do | Filter to items below their reorder point. |
| Expect | A short list, clearly flagged. |

☐ Pass ☐ Fail - Comments: ______________________

## B. Receiving a delivery

**Run these at the delivery door, on a phone, one-handed.**

### U-10 - Receive a delivery
| | |
|---|---|
| Role | Storekeeper |
| Do | Receive delivery. Pick a supplier, an item, a pack, a quantity **in packs**, and a price per pack. Save. |
| Expect | The line shows the conversion to grams or millilitres beneath it, **read-only**. You never type grams. Stock in the store goes up. |

☐ Pass ☐ Fail - Comments: ______________________

### U-11 - Half a pack
| | |
|---|---|
| Role | Storekeeper |
| Do | Enter `0.5` packs. |
| Expect | Accepted. Half a sack does get delivered. |

☐ Pass ☐ Fail - Comments: ______________________

### U-12 - A price that jumped
| | |
|---|---|
| Role | Storekeeper |
| Do | Enter a price about 40% above the last one paid. Save. |
| Expect | **It warns you, shows the old and new prices, and saves anyway.** It must not block - the lorry has already gone. |

☐ Pass ☐ Fail - Comments: ______________________

### U-13 - The average cost moves
| | |
|---|---|
| Role | Storekeeper |
| Do | Note an item's value. Receive more of it at a higher price. Look again. |
| Expect | The value per unit moves **towards** the new price, not to it. It is an average. |

☐ Pass ☐ Fail - Comments: ______________________

### U-14 - Press Save twice
| | |
|---|---|
| Role | Storekeeper |
| Do | Fill in a delivery. Tap Save twice, quickly. |
| Expect | **One delivery, not two.** |

☐ Pass ☐ Fail - Comments: ______________________

### U-15 - Find it again
| | |
|---|---|
| Role | Storekeeper |
| Do | Open the list of deliveries. Find the one you just made. |
| Expect | Its lines, total, your name and the time. |

☐ Pass ☐ Fail - Comments: ______________________

### U-16 - Reverse it
| | |
|---|---|
| Role | **Management** |
| Do | Reverse that delivery. Then try to reverse it again. |
| Expect | The first works and stock goes back. **The second is refused.** The original delivery is still in the list - nothing is deleted. |

☐ Pass ☐ Fail - Comments: ______________________

### U-17 - Someone who should not
| | |
|---|---|
| Role | Kitchen |
| Do | Try to reach Receive delivery. |
| Expect | It is not on your menu, and the system refuses if you reach it another way. |

☐ Pass ☐ Fail - Comments: ______________________

## C. Market purchase - withdrawn

> **Withdrawn by CR-001.** The script numbers are retained so that the
> traceability matrix still resolves. Nothing here is run, and nothing here
> counts towards the total below.

**U-20 to U-23** are withdrawn. Every purchase goes through a supplier who
invoices and is tested by section B.

## D. Asking for stock and releasing it

### U-30 - Ask for stock
| | |
|---|---|
| Role | Kitchen |
| Do | Ask for stock. Add two items and quantities. Send. |
| Expect | Confirmation, and it appears on your Requests list as waiting. |

☐ Pass ☐ Fail - Comments: ______________________

### U-31 - Release it
| | |
|---|---|
| Role | Storekeeper |
| Do | Open that request. Note what the store holds for each line. Release it. |
| Expect | The store goes down and the kitchen goes up, **by the same amount**. |

☐ Pass ☐ Fail - Comments: ______________________

### U-32 - Ask for more than exists
| | |
|---|---|
| Role | Kitchen, then storekeeper |
| Do | Ask for more of something than the store holds. Release it. |
| Expect | **It issues what exists and tells you the shortfall. Stock never goes below zero.** |

☐ Pass ☐ Fail - Comments: ______________________

### U-33 - Order the shortfall
| | |
|---|---|
| Role | Storekeeper |
| Do | Immediately after U-32, take the offer to order the shortfall. |
| Expect | A purchase order, pre-filled with the short items. |

☐ Pass ☐ Fail - Comments: ______________________

### U-34 - Outside the issue window
| | |
|---|---|
| Role | Storekeeper |
| Do | Release stock at a time that is not 06:00, 11:00 or 17:00. |
| Expect | **It warns and records anyway.** It does not block. |

☐ Pass ☐ Fail - Comments: ______________________

### U-35 - It came
| | |
|---|---|
| Role | Kitchen |
| Do | On your Requests list, confirm the stock arrived. |
| Expect | The request closes. |

☐ Pass ☐ Fail - Comments: ______________________

### U-36 - Release your own
| | |
|---|---|
| Role | Storekeeper |
| Do | Raise a request yourself, then try to release it. |
| Expect | **Refused, with a reason:** someone else has to release it. |

☐ Pass ☐ Fail - Comments: ______________________

### U-37 - Cancel
| | |
|---|---|
| Role | Kitchen |
| Do | Cancel a request before it is released. Then try to cancel one that has been released. |
| Expect | The first works. **The second is refused** - the stock has already moved. |

☐ Pass ☐ Fail - Comments: ______________________

### U-38 - Other people's rooms
| | |
|---|---|
| Role | Kitchen |
| Do | Try to see or take from the cleaning store. |
| Expect | Not possible. |

☐ Pass ☐ Fail - Comments: ______________________

## E. Purchases

### U-40 - Raise and receive short
| | |
|---|---|
| Role | Storekeeper, then management |
| Do | Raise a purchase order. Have management approve it. Receive **less** than ordered. |
| Expect | The order stays **open on the balance**. Receive the rest; it closes. |

☐ Pass ☐ Fail - Comments: ______________________

### U-41 - What to order
| | |
|---|---|
| Role | Storekeeper |
| Do | Use the suggestion. |
| Expect | Everything at or below its reorder point, in whole packs. |

☐ Pass ☐ Fail - Comments: ______________________

### U-42 - Only management approves
| | |
|---|---|
| Role | Storekeeper, then management |
| Do | As storekeeper, look for an Approve button. Then sign in as management. |
| Expect | **The storekeeper has no Approve button**, and the screen says it is waiting for management. Management can approve or reject. |

☐ Pass ☐ Fail - Comments: ______________________

### U-43 - Reject with a reason
| | |
|---|---|
| Role | Management |
| Do | Reject an order without a reason, then with one. |
| Expect | A reason is required. |

☐ Pass ☐ Fail - Comments: ______________________

### U-44 - Close it short
| | |
|---|---|
| Role | Management |
| Do | Close an order that will never be filled, with a reason. |
| Expect | Closed, reason recorded. |

☐ Pass ☐ Fail - Comments: ______________________

### U-45 - What is outstanding
| | |
|---|---|
| Role | Management |
| Do | Reports → Open purchase orders. |
| Expect | Everything ordered and not yet received, with how long it has been open. |

☐ Pass ☐ Fail - Comments: ______________________

### U-46 - Not on the kitchen's menu
| | |
|---|---|
| Role | Kitchen |
| Do | Look for Purchases. |
| Expect | **Not there at all.** What you asked for, and what came of it, is on Requests. |

☐ Pass ☐ Fail - Comments: ______________________

### U-47 - Wrong supplier
| | |
|---|---|
| Role | Storekeeper |
| Do | Try to receive an order from a different supplier than it was placed with. |
| Expect | Refused. |

☐ Pass ☐ Fail - Comments: ______________________

## F. Wastage

### U-50 - Log wastage
| | |
|---|---|
| Role | Kitchen |
| Do | Log something as wasted, with a reason. |
| Expect | Saved. **Stock in your section goes down immediately** - before anyone approves it. The food is already in the bin. |

☐ Pass ☐ Fail - Comments: ______________________

### U-51 - No reason
| | |
|---|---|
| Role | Kitchen |
| Do | Try to save wastage without picking a reason. |
| Expect | **Save is disabled. The reason is the point.** |

☐ Pass ☐ Fail - Comments: ______________________

### U-52 - Approve it
| | |
|---|---|
| Role | Management |
| Do | Approve that wastage. |
| Expect | Approved. Note that the stock had already moved - approval is a review, not a hold. |

☐ Pass ☐ Fail - Comments: ______________________

### U-53 - With a photo
| | |
|---|---|
| Role | Kitchen |
| Do | Log wastage with a photo. |
| Expect | Saved with the photo, viewable afterwards. |

☐ Pass ☐ Fail - Comments: ______________________

### U-54 - Reverse it
| | |
|---|---|
| Role | Management |
| Do | Reverse a wastage document. |
| Expect | Stock returns. Both the original and the reversal remain visible. |

☐ Pass ☐ Fail - Comments: ______________________

## G. Counting

### U-60 - Start a count
| | |
|---|---|
| Role | Storekeeper |
| Do | Start a daily count for the store. |
| Expect | Your critical items, one per screen. |

☐ Pass ☐ Fail - Comments: ______________________

### U-61 - Movement during a count
| | |
|---|---|
| Role | Storekeeper |
| Do | Open a count. **Before closing it**, have someone release stock of one of those items. Close the count. |
| Expect | The variance is measured against what was expected **when you opened**. The movement does not silently absorb the gap. |

☐ Pass ☐ Fail - Comments: ______________________

### U-62 - The most important one on this page
| | |
|---|---|
| Role | Storekeeper, and separately kitchen |
| Do | Count several items. Look carefully at every screen. |
| Expect | **The system NEVER shows you what it expects.** Not on the item screen, not in a total, not anywhere. |
| Why | If you can see that the system expects 4,500, you will type 4,500 - which confirms a theft rather than finding it. |

☐ Pass ☐ Fail - Comments: ______________________

### U-63 - Enter one short
| | |
|---|---|
| Role | Storekeeper |
| Do | Enter one item deliberately short. Finish the count. |
| Expect | **Only after closing** do you see the variance, with a value against it. |

☐ Pass ☐ Fail - Comments: ______________________

### U-64 - Verify it
| | |
|---|---|
| Role | Management, then the counter |
| Do | As management, verify the count. Then as the person who counted, try to verify your own. |
| Expect | Management can. **The counter cannot verify their own.** |

☐ Pass ☐ Fail - Comments: ______________________

### U-65 - Close it twice
| | |
|---|---|
| Role | Storekeeper |
| Do | Try to close the same count again. |
| Expect | **Refused.** |

☐ Pass ☐ Fail - Comments: ______________________

### U-66 - Skip some
| | |
|---|---|
| Role | Storekeeper |
| Do | Start a count, skip several items, close it. |
| Expect | Only the items you counted are adjusted. The rest are untouched. |

☐ Pass ☐ Fail - Comments: ______________________

### U-67 - Look back
| | |
|---|---|
| Role | Storekeeper |
| Do | Open a closed count. |
| Expect | Counted, expected, difference and value per line. |

☐ Pass ☐ Fail - Comments: ______________________

## H. Cleaning checklist - withdrawn

> **Withdrawn by CR-001.** The script numbers are retained so that the
> traceability matrix still resolves. Nothing here is run, and nothing here
> counts towards the total below.

**U-70 to U-74** are withdrawn. The cleaning **role** is still tested: U-01
signing in, U-30 asking for stock, U-35 confirming it arrived and U-38 the
section boundary all run as a cleaning login.

## N. Returns

### U-150 - Hand stock back, from the request it came on
| | |
|---|---|
| Role | Kitchen |
| Do | Open **Requests**. On a row that says Released or Done, press **Return**. |
| Expect | A panel listing **that request's** lines, each saying what was released and **at most how much can go back**. There is no item picker, and no separate return screen anywhere on your menu. |

☐ Pass ☐ Fail - Comments: ______________________

### U-151 - More than you were given
| | |
|---|---|
| Role | Kitchen |
| Do | On a request that released a small amount of something your section holds plenty of, try to return more than was released. |
| Expect | **The box will not let you type it.** This is the one to take seriously: what can go back is what that release delivered, not what happens to be in the room. |

☐ Pass ☐ Fail - Comments: ______________________

### U-152 - Approving your own
| | |
|---|---|
| Role | Kitchen, then Management |
| Do | Return something, then try to approve it yourself. Then have management approve it. |
| Expect | You cannot. Management can. |

☐ Pass ☐ Fail - Comments: ______________________

### U-153 - A branch with no quarantine
| | |
|---|---|
| Role | Admin, then Kitchen |
| Do | Switch the Quarantine section off, then try to return something. |
| Expect | Refused, **and it names the screen that fixes it.** Switch it back on. |

☐ Pass ☐ Fail - Comments: ______________________

### U-152a - The row says what happened
| | |
|---|---|
| Role | Kitchen |
| Do | Return part of a line, then look at the row you returned from. Then return the rest and look again. |
| Expect | The row keeps the quantity that was **released** - a request is a record and does not shrink - and gains an amber line saying what went back. Once the whole line is back, the Return button becomes a **Returned** tag. |

☐ Pass ☐ Fail - Comments: ______________________

### U-152b - Too old to return
| | |
|---|---|
| Role | Kitchen |
| Do | Find a request from more than a week ago and look at its buttons. |
| Expect | **Too old to return**, not a Return button. Returns close after seven days, because after that nobody can say the stock on your shelf is what came in on that release. Hover it for the reason. |

☐ Pass ☐ Fail - Comments: ______________________

### U-153b - Where the store sees it, and what next
| | |
|---|---|
| Role | Storekeeper |
| Do | Open the Overview. Then open **Returns**. |
| Expect | A **Returns** tile with a count. The screen shows what is in quarantine, what it is worth, what came back off the floor, and - in words - the next step, with a button through to Supplier returns. |

☐ Pass ☐ Fail - Comments: ______________________

### U-153a - The store's own shelf
| | |
|---|---|
| Role | Storekeeper |
| Do | Store → **Hold for return**. Check the Section list. |
| Expect | **Only the main store.** Everything else returns from Requests. |

☐ Pass ☐ Fail - Comments: ______________________

### U-154a - The form fills itself in
| | |
|---|---|
| Role | Storekeeper |
| Do | Returns → press **Send it back to [supplier]**. Then, without changing anything, press **Raise the return**. |
| Expect | Supplier returns opens with the delivery, the reason, the quantity and the credit already in place, and it is accepted exactly as offered. You should not have to type anything. |

☐ Pass ☐ Fail - Comments: ______________________

### U-154b - The delivery is a guess
| | |
|---|---|
| Role | Storekeeper |
| Do | Read the note on the **Ready to send back** panel, then change the delivery by hand. |
| Expect | It says the delivery is the most recent one with packs left to return, and lets you change it. Nothing in the system ties a crate to an invoice, so check it against the paperwork when it matters. |

☐ Pass ☐ Fail - Comments: ______________________

### U-154 - Send it back to the supplier
| | |
|---|---|
| Role | Storekeeper |
| Do | Supplier returns. Pick the delivery it came in on. |
| Expect | The lines of that delivery, with what quarantine holds of each. |

☐ Pass ☐ Fail - Comments: ______________________

### U-155 - The credit prices itself
| | |
|---|---|
| Role | Storekeeper |
| Do | Enter a number of packs on a line. |
| Expect | The credit is worked out from the **price on that invoice**, not today's price. Check it against the paper invoice. |

☐ Pass ☐ Fail - Comments: ______________________

### U-156 - More than arrived
| | |
|---|---|
| Role | Storekeeper |
| Do | Try to return more packs than that delivery brought. |
| Expect | Refused, and it says how many are still returnable. |

☐ Pass ☐ Fail - Comments: ______________________

### U-157 - Goods that are not in quarantine
| | |
|---|---|
| Role | Storekeeper |
| Do | Try to send back a line nobody has returned to the store. |
| Expect | **Not possible.** The box is greyed out. Goods go through the store first. |

☐ Pass ☐ Fail - Comments: ______________________

### U-158 - Who decides
| | |
|---|---|
| Role | Storekeeper, then Management |
| Do | Raise a return. Look for an Approve button. Then sign in as management. |
| Expect | The storekeeper cannot approve their own request to spend. Management can. |

☐ Pass ☐ Fail - Comments: ______________________

### U-159 - When the stock actually moves
| | |
|---|---|
| Role | Storekeeper / Management |
| Do | Check quarantine on Stock on hand. Raise a return - check again. Approve it - check again. Mark it gone - check again. |
| Expect | **Nothing moves until you mark it gone.** Raising and approving are paperwork. |

☐ Pass ☐ Fail - Comments: ______________________

### U-160 - What came of it
| | |
|---|---|
| Role | Management |
| Do | On a sent return, record a credit note for **less** than was asked for. |
| Expect | It takes the note number and the amount, and shows how much short it was. Reports → Returns and credits shows the shortfall as still owed. |

☐ Pass ☐ Fail - Comments: ______________________

## I. Opening stock

### U-80 - Open a section
| | |
|---|---|
| Role | Storekeeper |
| Do | Advanced → Opening stock. Enter quantities and values for a fresh section. |
| Expect | Saved. That section now holds stock. |

☐ Pass ☐ Fail - Comments: ______________________

### U-81 - Open it again
| | |
|---|---|
| Role | Storekeeper |
| Do | Try to open the same section again. |
| Expect | **Refused, with the reason:** use a stock count instead. |

☐ Pass ☐ Fail - Comments: ______________________

### U-82 - Not the admin's job
| | |
|---|---|
| Role | Admin |
| Do | Try to enter opening stock. |
| Expect | Not possible. Setup and stock are different jobs on purpose. |

☐ Pass ☐ Fail - Comments: ______________________

## J. The two that matter most - witnessed

### U-90 - Honest waste is not called theft
| | |
|---|---|
| Role | **Management**, with TriniphiX present |
| Do | Reports, range 2026-06-10 to 2026-08-08. Open **Wastage** and find Lettuce. Then open **Shrinkage** and look for Lettuce. |
| Expect | Lettuce is in Wastage under *Spoiled / expired*. **Lettuce is NOT in Shrinkage - not one row.** |
| Why | This is the acceptance gate. Honest, documented spoilage appearing in a theft report is what gets a system abandoned. If you were ever accused of stealing a crate of lettuce, you would stop opening reports by week three. |

☐ Pass ☐ Fail - Comments: ______________________

**Witnessed by:** Client ____________ TriniphiX ____________

### U-91 - History cannot be edited
| | |
|---|---|
| Role | **TriniphiX, with the Client watching** |
| Do | At a database prompt, attempt in turn: `UPDATE` a ledger row · `DELETE` a ledger row · `TRUNCATE` the ledger. |
| Expect | **All three are refused by the database itself**, with an error saying the ledger is append-only and corrections are reversals. |
| Why | This is the property that makes every number in the system worth reading. Not our code refusing - the database refusing. |

☐ Pass ☐ Fail - Comments: ______________________

**Witnessed by:** Client ____________ TriniphiX ____________

## K. Reports - the five faults

Sign in as management. Set the range **2026-06-10 to 2026-08-08**.

### U-120 - Fault A: over-issuing
| | |
|---|---|
| Do | Usage variance. Find Chicken breast. |
| Expect | About **+18.6%**, roughly **LKR 192,000** over-issued. |

☐ Pass ☐ Fail - Comments: ______________________

### U-121 - Fault B: the missing gin
| | |
|---|---|
| Do | Shrinkage. Find Gin - imported. |
| Expect | **Exactly two rows.** Each −750 ml, about LKR 5,216, both in the bar. |
| Note | They left on days 28 and 44 but only appeared at the next Sunday bar count. That is correct: nothing revealed it until someone counted. |

☐ Pass ☐ Fail - Comments: ______________________

### U-122 - Fault C: the price rise
| | |
|---|---|
| Do | Price movement. Find Sunflower oil. |
| Expect | **45,880 → 60,561.60**, +32%, on 2026-07-30. |
| Note | The supplier raised it on day 35; you found out at the next delivery. A report that insisted on same-day detection would have missed it. |

☐ Pass ☐ Fail - Comments: ______________________

### U-123 - Fault D: the spoilage
| | |
|---|---|
| Do | Wastage. Find Lettuce. |
| Expect | Listed under **Spoiled / expired**, with a visible spike in the last two weeks of the range. |

☐ Pass ☐ Fail - Comments: ______________________

### U-124 - Fault E: running out
| | |
|---|---|
| Do | Stock-outs. Find Prawns - medium. |
| Expect | Reached **zero on 2026-07-21**. |

☐ Pass ☐ Fail - Comments: ______________________

### U-125 - The floors
| | |
|---|---|
| Do | Look at the whole shrinkage report. |
| Expect | A short list of things worth investigating. **No tiny amounts.** No 44-cent lettuce leaves. |
| Question for you | Are LKR 100 and 2% the right floors for your business? Tell us now - they are yours to set. |

☐ Pass ☐ Fail - Answer: floors should be LKR ________ and ________ %

### U-132 - Not crying wolf
| | |
|---|---|
| Do | Look at the whole usage variance report. |
| Expect | **Two or three items, not forty.** A report that flags most of the store is noise, and you will stop opening it. |

☐ Pass ☐ Fail - Comments: ______________________

### U-126 to U-131 - The operational reports
| Script | Report | Expect |
|---|---|---|
| U-126 | Service level | How much of what was asked for was actually given |
| U-127 | Supplier performance | Which suppliers deliver short or dear |
| U-128 | Valuation | What the stock is worth, by room and category |
| U-129 | Dead stock | What has not moved |
| U-130 | Consumption | What each room used |
| U-131 | Count accuracy | Whose counts agree with the system |

☐ Pass ☐ Fail - Comments: ______________________

## L. Logins and setup

### U-100 - Add someone
| | |
|---|---|
| Role | Admin |
| Do | Logins → Add someone. Name, role, branch, PIN (or Suggest one). |
| Expect | Created. |

☐ Pass ☐ Fail - Comments: ______________________

### U-101 - The PIN is shown once
| | |
|---|---|
| Role | Admin |
| Do | Note the PIN shown. Navigate away. Come back and try to see it again. |
| Expect | **Shown once, large, in plain text - and never again.** |
| Why | Deliberate. Hiding it just produces a sticky note stuck to the tablet. Read it to the person there and then. |

☐ Pass ☐ Fail - Comments: ______________________

### U-102 - They can sign in immediately
| | |
|---|---|
| Role | The new person |
| Do | Sign out. Look for the new name on the sign-in screen. |
| Expect | There, straight away. No restart, no waiting. |

☐ Pass ☐ Fail - Comments: ______________________

### U-103 - Forgot it, or locked out
| | |
|---|---|
| Role | Admin |
| Do | Issue a new PIN for someone. Separately, unlock an account locked by wrong attempts. |
| Expect | New PIN shown once. Unlock clears the lockout **without** changing their PIN. |

☐ Pass ☐ Fail - Comments: ______________________

### U-104 - Someone leaves
| | |
|---|---|
| Role | Admin |
| Do | Switch someone off. Check the sign-in screen. Then find a document they created. |
| Expect | Gone from sign-in. **Their name is still on everything they ever did.** Nobody is deleted. |

☐ Pass ☐ Fail - Comments: ______________________

### U-105 - The last admin
| | |
|---|---|
| Role | Admin |
| Do | Try to switch off the only remaining admin. |
| Expect | **Refused, with the reason.** Otherwise nobody could ever create a login again. |

☐ Pass ☐ Fail - Comments: ______________________

### U-106 - Changing someone's job
| | |
|---|---|
| Role | Admin, with TriniphiX |
| Do | Ask TriniphiX to change someone's role. |
| Expect | Done by a command, not a screen, in Phase 1. Their history stays attached to them. |

☐ Pass ☐ Fail - Comments: ______________________

### U-110 to U-118 - Setup
| Script | Do | Expect |
|---|---|---|
| U-110 | Create a branch | Arrives with its main store already created |
| U-111 | Add a section, choosing its kind | The kind decides who can work there. A branch can have two kitchens |
| U-112 | Try to invent a **new kind** of room | **Not possible.** A room of an unknown kind is one no role can reach |
| U-113 | Add a category with a storage type | |
| U-114 | Add an item: code, name, category, **stock unit**, par, reorder, critical | |
| U-115 | Add **two different packs** to one item | Both accepted. Each says how many stock units it holds |
| U-116 | Add a supplier | |
| U-117 | Add agreed prices per pack, with a date | |
| U-118 | Try to delete an item | **Not possible.** Everything switches off instead |

☐ Pass ☐ Fail - Comments: ______________________

> **U-115 is the one to take seriously.** Check the number of grams in a pack
> physically, on the shelf. If it is wrong, every figure about that item will be
> wrong and nobody will notice for months.

## M. Non-functional - witnessed

| Script | Check | Expect |
|---|---|---|
| U-140 | Speed | Stock list under 2 seconds. Any report under 5 seconds. Saving under 2 seconds |
| U-141 | Alerting | TriniphiX stops the service; an alert reaches the nominated phone |
| U-142 | Security | The address is `https://`. The certificate is valid |
| U-143 | Logs | TriniphiX shows you the logs. **No PIN appears anywhere in them** |
| U-144 | **Backup and restore** | **TriniphiX restores last night's backup in front of you and the system comes back with the right data.** Time it |
| U-145 | Usability | Use it one-handed at the delivery door on a real phone |
| U-146 | Audit trail | Pick any stock movement. It has a person's name and a time against it |

☐ Pass ☐ Fail - Comments: ______________________

**U-144 is a condition of go-live.** No real delivery is entered into a system
whose restore has never been performed. An untested backup is a belief, not a
backup.

---

## Summary

| Section | Scripts | Passed | Failed |
|---|---|---|---|
| A - Signing in | 6 | | |
| B - Receiving | 8 | | |
| C - Market | *withdrawn* | - | - |
| D - Requests | 9 | | |
| E - Purchases | 8 | | |
| F - Wastage | 5 | | |
| G - Counting | 8 | | |
| H - Cleaning | *withdrawn* | - | - |
| N - Returns | 17 | | |
| I - Opening stock | 3 | | |
| J - The two that matter | 2 | | |
| K - Reports | 13 | | |
| L - Logins and setup | 16 | | |
| M - Non-functional | 7 | | |
| **Total** | **102** | | |

## Sign-off by role

Each person signs for the scripts they ran themselves.

| Role | Name | Scripts run | Signature | Date |
|---|---|---|---|---|
| Storekeeper | | | | |
| Kitchen | | | | |
| Cleaning | | | | |
| Management | | | | |
| Admin | | | | |

Overall sign-off is on the [UAT Sign-off Certificate](uat-signoff-certificate.md).
