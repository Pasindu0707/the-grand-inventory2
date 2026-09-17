# What actually happens to stock the kitchen sends back

**One crate, followed from the request to the very end.**

This is the question people ask and the manual answers in pieces: *the kitchen
asked for something, it arrived, they sent it back because it was bad — so where
is it now, and what happens to it?*

Companion: [User Manual §8](user-manual.md#8-returns-explained-properly) ·
[Returns lifecycle](../04-technical/returns-lifecycle.md)

---

## 1. The short answer

It goes to a **third shelf** — not back into the store, and not into the bin.

```
   ┌───────────┐        ┌───────────┐        ┌────────────┐
   │   STORE   │───────►│  KITCHEN  │───────►│ QUARANTINE │
   └───────────┘ release└───────────┘ return └────────────┘
                                                    │
                        it can only leave here ──────┤
                        in one of two ways           │
                                                     ▼
                           supplier takes it  ·  or we bin it
```

**Quarantine is a real shelf in the building**, with a real balance, sitting on
the stock record like any other section. Stock there is still ours and still
counts as ours until it physically leaves.

**Nothing is ever issued out of quarantine.** That is the whole reason it
exists. If bad fish went back into the main store's balance, the kitchen could
ask for it again tomorrow and the store would hand it over in good faith.

---

## 2. The same crate, hour by hour

Say the kitchen asked for 5 kg of cuttlefish. It came in on delivery **no. 295**
at **LKR 4,167 a kilo**, and it is off.

| When | What happens | Where the crate is | What the stock record says | Who did it |
|---|---|---|---|---|
| Mon 09:00 | Delivery arrives, booked in | Store | Store **+8 kg** | Storekeeper |
| Tue 06:30 | Kitchen asks for 5 kg | Store | no change — a request is only a question | Kitchen |
| Tue 06:45 | Storekeeper releases it | Kitchen | Store **−5 kg**, Kitchen **+5 kg** | Storekeeper |
| Tue 06:50 | Kitchen taps *It came* | Kitchen | no change — this only confirms it arrived | Kitchen |
| Tue 07:10 | Box opened. It smells wrong. Kitchen taps **Return**, picks *Below the quality agreed*, writes "off smell on opening" | **Quarantine** | Kitchen **−5 kg**, Quarantine **+5 kg** | Kitchen |
| Tue 09:30 | Storekeeper asks management: delivery 295, 5 kg, worth LKR 20,835 — claim it or bin it? | Quarantine | **no change** | Storekeeper |
| Tue 11:00 | Manager answers: **send it back** | Quarantine | **no change** | Management |
| Fri 08:00 | Supplier's van collects it. Storekeeper taps *It has gone* | **Gone** | Quarantine **−5 kg** | Storekeeper |
| +3 weeks | Credit note CN-4412 for LKR 20,835 arrives. Manager records it | — | no change — this is money, not stock | Management |

**Read the fourth column.** Between Tuesday 07:10 and Friday 08:00 — nearly four
days — **the stock figure does not move once**. The crate is in the building the
whole time, and the system says so.

That is the single most misunderstood thing about this process. People assume
"I sent it back" means it is gone. It is not gone until somebody physically
hands it to a driver and says so.

---

## 3. The four ways it can end

Only one of these is the common one. All four are normal.

### Ending 1 — The supplier gives a credit *(most common)*

The van takes it, and weeks later a credit note arrives.

Management opens the return and taps **Credit note received**, entering the note
number and the amount. That number is what you check against the supplier's
statement at the end of the month.

**If they allow less than was asked** — say LKR 16,000 against LKR 20,835 — the
screen shows the shortfall of LKR 4,835 beside it. That gap is the number worth
arguing about, and it is the only reason to record the two separately.

### Ending 2 — The supplier replaces it

Fresh cuttlefish turns up on the next van.

Management taps **Replaced**. The replacement is **not** part of the return — it
arrives as an ordinary delivery, booked in through Receive delivery like
anything else, because that is exactly what it is: goods arriving at the door.

### Ending 3 — Nothing comes back

They refuse, or the claim is dropped, or it is not worth the argument.

Management taps **Nothing back**. The return is closed and the money is gone.
The stock already left the building when it was marked gone, so the books are
already right; this only records that no credit is coming.

### Ending 4 — Management says bin it

The commonest ending of all, and the one that used to have no proper route
through the system.

When the store asks, management can answer **Bin it** on any line — perhaps the
claim is too weak, the goods are not worth the argument, or the relationship
matters more than LKR 20,000. The store then presses **Bin them**, one button,
and the goods leave quarantine as an ordinary wastage document under the reason
*"Bad goods, not taken back"*.

That puts it in **Wastage by reason**, where anybody asking "what did we throw
away" will find it, and keeps it out of the unexplained-loss report, where it
would read as theft. It is deliberately **not** filed as spoilage: we did not
spoil it, it arrived bad, and putting somebody else's fault into our spoilage
figures is exactly the quiet mislabelling that report exists to avoid.

An ask binned in full closes itself — there is no credit to chase, so it does
not sit on anybody's list.

**One ask can end both ways.** Management answers line by line: claim the fish,
bin the lettuce. The store then presses both buttons, and each line leaves
quarantine by its own route.

> **Every line has to end somewhere.** Management cannot save a half-answered
> ask, which is deliberate: a line nobody answered is stock sitting in
> quarantine with nobody claiming it and nobody refusing it. Stock in quarantine
> is money already paid for that is doing nothing, and the Returns screen shows
> that total for exactly that reason.

---

## 4. What it does to the money

Two different numbers, both correct, and they are allowed to differ.

| Number | What it is | Where it lives |
|---|---|---|
| **What it cost us** | The running average cost of that product — the same figure any issue or wastage is valued at | The stock record |
| **What they owe us** | The pack price **on the original invoice**, from the delivery it came in on | The supplier return |

The crate might have cost us LKR 4,100/kg on average — mixed from several
deliveries — while that particular invoice charged LKR 4,167/kg. The claim uses
the invoice; the stock record uses the average.

Forcing the stock record to the invoice price would quietly revalue the stock
still sitting on the shelf, which would make every rupee figure in every report
slightly wrong. So they stay separate.

---

## 5. What it does to the reports

This is the part that protects people.

| Report | What it does with a return |
|---|---|
| **Usage variance** | **Nets it off.** The kitchen is not treated as having used something it sent straight back — otherwise a chef gets asked why they got through 5 kg of cuttlefish they never cooked |
| **Wastage by reason** | A return that goes **back to the supplier** does not appear here — it was not our waste, it arrived bad. A line management said to **bin** does appear, under *"Bad goods, not taken back"*, because we did throw it away |
| **Shrinkage** *(unexplained loss)* | Neither ending appears here. Both have a document, a reason and a name against them. Only stock that goes missing with **no** document reaches this report |
| **Price movement** | Untouched. The return does not change what the delivery was priced at |

If a return ever shows up as shrinkage, that is a bug — tell us. Honest,
documented returns being reported as unexplained loss is how a report gets
abandoned.

---

## 6. Things that are deliberately not possible

| You might expect | What actually happens | Why |
|---|---|---|
| Returned stock goes back to the store's shelf | It goes to **quarantine** | Otherwise the kitchen is handed the same bad fish again tomorrow |
| The kitchen can send back more than arrived | Refused, with all three figures: released, already returned, what you hold | A return is measured against the release that delivered it |
| Last month's release can be returned | Refused after **seven days** | Nobody can honestly say the crate on your shelf is the one that came in on that release. After a week it is Wastage |
| Management sends it back or bins it themselves | No such button | They answer; the store handles the goods. An approval you can grant yourself approves nothing |
| The storekeeper answers their own ask | Refused | Same reason, the other way round |
| Answering only some of the lines | Refused | Every line has to end somewhere |
| Sending or binning before the answer | Refused, and says so | It is money, both ways |
| Editing a return once it is recorded | Not possible anywhere | Nothing on the stock record is edited. A correction is a **reversal** — a second entry that cancels the first and stays beside it |

---

## 7. Questions people actually ask

**"I returned it — why does stock still show we have it?"**
Because you do. It is on the quarantine shelf. It leaves the building when the
storekeeper marks it gone or bins it, and not before.

**"The kitchen returned it. Do I have to approve that before they can carry on?"**
No — there is nothing to approve. The stock moved the moment they handed it
back, and nothing is blocked while it sits in quarantine. The one thing you
decide is what becomes of it, and the store asks you that directly.

**"What if I want to claim for some of it and bin the rest?"**
That is exactly what the line-by-line answer is for. Mark each line the way you
want it, and save once.

**"Can I return part of a delivery and keep the rest?"**
Yes. Returns are per line and per quantity. The rest of the delivery is
untouched.

**"Two deliveries of the same thing came in this week. Which one does the
return get claimed against?"**
The system suggests the most recent delivery of that product that still has
packs left to return — and **says it is a guess**. Nothing in the record ties a
physical crate to an invoice. If you know it came in on the other one, change it
on the form.

**"What if it was our fault — we left it out overnight?"**
That is **Wastage**, not a return. The test is simple: *did it arrive bad, or
did we ruin it?* Claiming a credit for something we spoiled is the fastest way
to lose a supplier.

**"Where can I see what happened to it afterwards?"**

| To see | Go to |
|---|---|
| What came back off the floor | **Returns** |
| What is in quarantine right now, and what it is worth | **Returns**, top panel |
| Where a supplier return has got to | **Supplier returns** |
| Whether a credit ever arrived | **Supplier returns**, the settled row |
| Which delivery it was claimed against, and how much of it went back | **Deliveries** → open that delivery |
