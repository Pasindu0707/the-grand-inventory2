# The Grand - inventory system handbook

Everything you need to check the system, understand why it works the way it
does, know who can do what, and add people.

Companion documents: [README.md](README.md) for the data pack,
[PLAN.md](PLAN.md) for the build plan and remaining work.

---

## 1. What this is, in one paragraph

An inventory system for The Grand Gastrobar, Negombo. It answers one question
well: **what is in the store, and who took it.** Every movement of stock is a
row in an append-only ledger that can never be edited or deleted; corrections
are reversals that sit beside the original. Stock levels are not stored
anywhere - they are recalculated from the ledger every time you look, so there
is no cached number that can drift away from the movements that produced it.
There is no POS; consumption is driven by what each section declares it made.

---

## 2. Starting it up

Three things run. All three must be up.

```bash
docker compose up -d          # Postgres on 5433
npm run db:reset-all          # schema + 60 days of demo data
```

```bash
cd api && npm run dev         # API on 3000
```

```bash
cd grand-inventory-web && npm start       # the console on 4300
```

Open **http://localhost:4300**. Every demo user's PIN is **1234**.

**Is it alive?**

| Check | Command | Expected |
|---|---|---|
| Database | `docker compose ps` | `grand_db` healthy |
| API | `curl localhost:3000/api/v1/health` | `{"status":"ok","db":"up","ledgerRows":…}` - 10,417 on a fresh seed, and it only ever grows |
| Web | open `localhost:4300` | login screen with eight faces |
| Web → API | login as anyone | you land on Today with a stock value |

---

## 3. What to check

Work down this list. It is ordered so that a failure early explains failures
later.

### 3.1 The automated suites

These are the fastest way to know the system is sound. Run them first.

```bash
cd api && npm test
```

**Expect 135 passing tests.** They run against a real Postgres, not a mock,
because the things worth testing here - append-only triggers, weighted-average
cost, idempotency races - *are* database behaviour.

```bash
npm run db:verify
```

**Expect 12 passing checks.** This one proves the database itself cannot be
tampered with, and that the cutover script works. If `reset.sql` ever stops
emptying the ledger, this catches it.

### 3.2 The five planted faults

The demo data has five deliberate faults. Each one maps to a report. Sign in as
**Nuwan Perera (manager)** and open **Reports**, with the range covering
2026-06-10 to 2026-08-08.

| Tab | Look for | Correct answer |
|---|---|---|
| Usage variance | Chicken breast | **+18%**, ~LKR 199,000 over-issued - the only row |
| Shrinkage | Gin - imported | **exactly two rows**, −750 ml each, ~LKR 5,216 each, both KITCHEN |
| Price movement | Sunflower oil | **45,880 → 60,561.60 (+32%)** on 2026-07-30 |
| Wastage | Lettuce | listed under **Spoiled / expired** |
| Stock-outs | Prawns - medium | ran out on **2026-07-21** |

**The most important check on this page is a negative one.** Lettuce must appear
under Wastage and must **not** appear under Shrinkage. If honest, documented
spoilage ever shows up in the unexplained-loss report, the report is wrong - and
an owner who gets accused of theft over a crate of lettuce stops opening reports
by week three.

Equally: **Usage variance should list one or two items, not forty.** A report
that flags most of the store is noise.

### 3.3 The daily flows, by hand

Sign in as **Sunil Fernando (storekeeper)** unless stated.

| # | Do this | It is right when |
|---|---|---|
| 1 | **Receive delivery** → supplier, item, pack, quantity in *packs* | The line shows the stock-unit conversion beneath it, read-only. You never type grams. |
| 2 | Enter a price 40% above the last one, save | It **warns** and still records. It must not block - the lorry has already gone. |
| 3 | Press Save twice quickly | **One** delivery, not two. |
| 4 | **Issues** → new request for the Kitchen, then Fulfil | Store goes down, Kitchen goes up, by the same amount. |
| 5 | Request more than the store holds | It issues what exists and tells you the shortfall. Stock never goes negative. |
| 6 | Fulfil outside 06:00 / 11:00 / 17:00 | It **warns** and records anyway. |
| 7 | **Wastage** → log something without a reason | Save stays disabled. The reason is the point. |
| 7a | **Requests** → on a released row, press **Return** | The drawer lists that request's lines and says *at most N can go back*. Kitchen goes down, Quarantine goes up, immediately. |
| 7a2 | Try to return more than that request released | Refused, with all three figures in the message: released, already back, and what you hold. |
| 7a3 | Look for a separate return screen as the kitchen | There is none. Returning happens on the request that delivered the stock. |
| 7a4 | Look at the row you just returned from | It still shows what was **released** - a request is history - with an amber line beneath saying what went back. |
| 7a5 | Return the whole of a line, then look again | The Return button is gone and replaced by a **Returned** tag. |
| 7a6 | As **Sunil (storekeeper)**, open the Overview | A **Returns** tile with a count. Open it: what is in quarantine, what it is worth, and the next step spelled out. |
| 7a7 | Return the whole of a release | The row reads **Done · Returned**, offers no *It came*, and leaves the Needs-me queue. Returning it *is* confirming it arrived. |
| 7a8 | Look at a request from last month | **Too old to return.** Returns close after seven days, because after that nobody can say the shelf holds what came in on that release. |
| 7b | **Returns** → press *Ask management what to do* | Supplier returns opens **already filled in**: the delivery, the reason, the packs and the credit. Nothing to type. |
| 7b0 | As **Nuwan (manager)**, open **Returns** | No *Something on our own shelf is bad*, no *Send it back*. Approvals and the quarantine figure, nothing else. Management decides; the store handles stock. |
| 7b2 | Press *Raise the return* without changing anything | Accepted. A suggestion that cannot be submitted as offered would be worse than none. |
| 7b3 | **Supplier returns** → pick a different delivery by hand | Allowed. The suggested delivery is a guess, because the ledger does not tie a crate to an invoice, and the panel says so. |
| 7b4 | **Supplier returns** → pick the delivery it came in on by hand | Only lines quarantine actually holds can be typed into. The credit prices itself off the invoice. |
| 7c | Try to send it or bin it before management has answered | Refused both ways. It is money whichever way it goes, so it waits for a decision. |
| 8 | **Stock count** → start a daily count | **The expected quantity is never shown.** One item per screen. |
| 9 | Enter one item short, finish | Variance appears *after* closing, with a value. |
| 10 | As **Nuwan (manager)**, verify that count | Allowed. As Sunil, verifying your own count is refused. |
| 11 | Refresh the page on any screen | You stay on that screen. |

### 3.4 The return chain, end to end

Bad stock leaves the building in **two documents**, and the thing worth checking
is which steps move stock. Two of them do; five do not.

```bash
node scripts/check-returns.mjs
```

**Expect every line to be a tick.** It signs in as all three roles, drives the
whole chain, and reads the quarantine balance before and after every single step
-- so it catches both halves of the design at once: that stock moves exactly
twice, and that each step refuses the wrong person.

It works on a freshly seeded database: every demo release is dated inside the
sixty demo days and so is long past the seven-day return window, so if it finds
nothing to hand back it asks for stock and releases it first, through the same
two endpoints the screens use.

**To walk it by hand from an empty shelf**, clear the returns first:

```bash
npm run db:clear-returns               # says what it would remove
node scripts/clear-returns.mjs --confirm
```

It empties section returns, supplier returns, anything binned, and the ledger
rows those produced, then recomputes the affected balances. **It can only ever
remove demo rows** -- the delete runs under the same GUC `reset.sql` uses, and
`ledger_guard()` lets that through for `is_demo` rows only. Returns you created
by hand while testing are real rows and stay; the script says so. The only way
to clear those is `npm run db:reset-all`, which drops the schema and rebuilds
it.

It writes real documents. Run it against demo or trial data, never a live
ledger.

The same walk by hand, which is the only way to tell whether the *screens*
explain the rules:

| # | Do this | It is right when |
|---|---|---|
| R1 | As **Chaminda (kitchen)**, Requests → **Return** on a released row | Kitchen goes down, quarantine goes up, immediately. It is not waiting for anybody. |
| R2 | As **Sunil (storekeeper)**, open **Returns** | It is in *Waiting to go back*, with a value. **There is nothing to approve** - the hand-back needs no stamp. |
| R3 | Press *Ask management what to do* | Supplier returns opens filled in: delivery, reason, packs, credit. |
| R4 | Press *Raise the return* unchanged | Accepted. **Quarantine does not change** - the crate is in the building. |
| R5 | Press *It has gone* or *Bin them* before the answer | Refused both ways, and says why. |
| R6 | As **Nuwan (manager)**, open **Supplier returns** | *Waiting for your decision*, with every line and what each is worth. |
| R7 | Answer only some of the lines | **Save is disabled.** Every line has to go somewhere. |
| R8 | Mark one line *Send it back* and another *Bin it*, save | Accepted. Quarantine *still* unchanged - answering is paperwork. |
| R9 | As Nuwan, look for *It has gone* or *Bin them* | Neither is offered. It says "Waiting for the store to send it / bin it". |
| R10 | As Sunil, press *Bin them* | **Now** the binned line leaves quarantine - as **wastage**, reason *Bad goods, not taken back*. The claimed line is untouched. |
| R11 | Press *Bin them* again | "Already binned." Nothing moves twice. |
| R12 | Press *It has gone* | The claimed line leaves quarantine too. |
| R13 | As Nuwan, *Credit note received* with no note number | Refused. A credit you cannot find on the statement is a note in a diary. |
| R14 | Enter the number and the amount | Settled. If the supplier allowed less than was asked, the shortfall is shown beside it. |
| R15 | Check **Reports → Wastage by reason** | The binned line is there under *Bad goods, not taken back*. It is **not** in Shrinkage - it has a document and a name on it. |

Why it works this way, and what the two documents are for, is
[docs/04-technical/returns-lifecycle.md](docs/04-technical/returns-lifecycle.md).

### 3.5 Who can do what, checked rather than assumed

Sign in as each role and confirm the rail matches
[section 5](#5-who-can-do-what). The quick version - the four that were
deliberately taken away from management, because they are the ones that would
otherwise let one person do both halves of a check:

| As **Nuwan (management)** | Expected |
|---|---|
| Requests → a waiting row | **No Release button.** Releasing is the storekeeper's, and the list is a record for management, not a queue. There is no "Needs me" tab at all. |
| Returns | **No shelf drawer, no *Ask management*, and nothing to approve.** The quarantine figure and the record. |
| Supplier returns | **No raise form, no *It has gone*, no *Bin them*.** A *Waiting for your decision* panel, answered line by line. |
| Purchases | Approve and reject, as before. Management is the only role that can. |

And the same from the other side, as **Sunil (storekeeper)**: Release yes,
raise a supplier return yes, mark it gone yes -- **approve anything, no**.

If a button that should be gone is still there, the server will still refuse
it; that is a screen defect, not a hole. If an action that should be refused
*succeeds*, stop and report it.

### 3.6 The things that must be impossible

If any of these succeed, something is badly wrong.

- Editing or deleting a ledger row, by any route, including `TRUNCATE`.
- Reversing the same document twice.
- Cancelling an issue that already moved stock.
- Closing the same count twice.
- Verifying your own count.
- A chef opening Reports.
- Changing `x-location-id` to another outlet you are not assigned to.

The database enforces the first one; the API enforces the rest.

---

## 4. The ideas

These are the decisions the whole system rests on. If someone proposes a change
that breaks one of them, it is worth a conversation before saying yes.

### The ledger is append-only, and the database enforces it

Not the application. Postgres triggers reject any `UPDATE` or `DELETE` on
`stock_ledger`, and a `TRUNCATE` guard closes the obvious back door. A
correction is a new row with `is_reversal = true` pointing at the row it undoes.
The original stays exactly where it was.

This is the property that makes the numbers worth trusting. The moment stock
history can be quietly edited, every report becomes an opinion.

### Stock is derived, never stored

There is no `stock_qty` column anywhere. On-hand is `sum(qty_base)` over the
ledger for that item and section, computed on read. A cached quantity is a
number that eventually disagrees with the movements behind it, and nobody can
tell you when it started lying.

### The document is the API; the ledger is a consequence

Controllers never write the ledger. One service function per document type
calls a single private writer. This is enforced by an ESLint rule that fails the
build, not by a comment - a convention lasts until the first person in a hurry.

### The store is just another section

Not a special case. That makes every movement a section-to-section transfer and
removes special-casing from the ledger entirely.

### Everything in the small unit; packs convert once

Grams, millilitres, each. Users enter **packs** - "2 × 20 L can" - because that
is what arrives on the lorry and what the invoice says. The conversion happens
once, on entry, server-side. If grams reach a field a human types into,
something has gone wrong.

### Warn, do not block

Issue windows, price jumps, cash discrepancies: all warn, none block. An issue
that happened at 14:00 happened at 14:00. Refusing to record it does not undo
it - it just makes the stock figure wrong as well as the process.

### Physical reality first, approval second

Wastage and transfers write the ledger the moment stock moves, not when a
manager approves. The food is already in the bin. Withholding the row until
someone is free means the stock figure is knowingly wrong for as long as they
are busy.

### Counts are blind, and frozen at open

The expected quantity is **never shown while counting**. Show a tired
storekeeper that the system expects 4,500 and they will type 4,500 - which
confirms a theft rather than finding it. And expected is frozen when the count
opens: if it were re-read at close, a movement posted while someone walked the
shelves would silently absorb the gap.

### A return is measured against the release that delivered it

A section holds stock because an issue put it there. So the question "may this
go back" is answered by that issue: what was released, less what has gone back
already, and never more than is still on the shelf.

The first build got this wrong in a way worth remembering. It offered every item
the section handles and checked only the current balance - so a chef could hand
back four kilos of beef nobody had ever given them, as long as four kilos
happened to be in the room. That is not a return, it is a way of moving stock
sideways with a reason code on it, and it would have shown up in the returns
report as a supplier's fault.

The store is the one exception, because nothing issues stock *to* the store. Its
returns are constrained at the other end instead: a supplier return has to name
a delivery line and the goods have to be in quarantine.

### A return is neither waste nor a delivery that never happened

The kitchen opens a box and the fish is off. Wastage says it was destroyed and
nobody owes anything. Reversing the delivery says it never arrived. Both are
untrue, and before returns existed the honest answer was to record nothing -
which meant the loss surfaced weeks later as **shrinkage**, the report that
means somebody took it.

So a return is its own document, and there are two of them because two
different things happen. The section hands stock back and the ledger moves at
once, because the crate is already moving. The store hands it to the vendor and
the ledger moves only when it is **sent**, because until then the goods are
still in the building and still ours.

### The system knows which delivery it came in on, roughly

Press *send it back to the supplier* and the form arrives filled: the delivery,
the reason the chef gave, the pack quantities worked out from what is in
quarantine, and the credit priced off that invoice. The storekeeper reads it and
presses one button.

The delivery is the one honest guess in the chain. Nothing in the ledger ties a
crate in quarantine to the invoice it arrived on: goods come in on a delivery,
go out to a section, and come back, and the link is by item and quantity rather
than by identity. So the system proposes the most recent delivery of that item
that still has packs left to return, says on screen that is what it has done,
and lets you change it. Right nearly always; wrong when the same item came
twice in a week.

One detail worth knowing because it caused a bug: a proposed quantity is always
rounded **down**. 2,148 g of a 1 kg pack is 2.148 packs, and proposing 2.15
would be two grams more than exists, refused by the service, and an error on a
form nobody had filled in.

### A return has to be timely, or it is guesswork

Returns close seven days after the release. The rule is not about paperwork
tidiness - it is about whether anybody can still say the stock being handed back
is the stock that came in on that release.

The first version checked only whether the section held any of the item, which a
five-week-old request passes without trying: the kitchen holds wine, so a request
from August offered to return wine that arrived in September. That is not a
return, it is choosing a document at random to hang a loss on, and the supplier
would rightly refuse it.

After the window the honest instruments are wastage - we spoiled it - or a stock
count, which is the system saying it cannot account for the difference. Seven
days is a guess and belongs on the Phase 0 list to confirm with the owner,
alongside the shrinkage floors.

### Returning something is how you confirm it arrived

You cannot send back what never came. So a return against a release nobody has
confirmed confirms it, signed by the person doing the returning.

Without that rule a request whose entire contents had gone back still sat in the
chef's "Needs me" queue with an *It came* button on it, asking them to confirm
the arrival of goods that were already in quarantine waiting for the supplier's
lorry. The stock figures were right and the screen was nagging about work that
was finished.

### Stock that moves correctly and says nothing has still failed

Two things went wrong the first time returns were built, and both were about
telling somebody rather than recording something.

A chef returned 200 g, the request row still read *Wheat flour 200 g*, and they
reasonably concluded it had not worked. The row was correct - a request records
what was released and does not shrink - but correct is not the same as
believable, so the row now carries what went back as well.

And the goods landed in quarantine with nothing anywhere to say so. No list, no
count, no next step: the storekeeper would have found them at the next count, or
not at all. There is now a tile on the Overview and a screen that says what is
waiting, what it is worth, and what to do about it.

### Quarantine is a section, not a flag

Returned goods do not go back on the store's shelf. They go to a section of
kind Quarantine, and nothing is ever issued out of it.

Two reasons. A flag on a quantity would be the first stored piece of stock
state in a system whose whole design is that stock is derived from movements.
And more plainly: faulty goods sitting in the store's balance are goods the
kitchen can ask for again tomorrow, and the first person to find out is the
chef who was promised them.

### Spoilage and shrinkage are different conversations

Declared waste has a name and a reason on it - a kitchen and ordering problem.
Unexplained loss is a different discussion entirely. They are separate reports
on separate screens, and documented waste is excluded from the loss report by
construction.

### Reports need a materiality floor, in money *and* proportion

Counting is never exact. Without a floor the loss report listed Rs 0.44 of
lettuce. With only a money floor, ordinary counting noise on expensive gin
produced fifteen false alarms that buried the two real bottles. Noise is
proportional to what is on the shelf; theft is not. Both floors are guesses
(Rs 100 and 2%) and belong on the Phase 0 list to confirm with the owner.

### Faults surface when they are discovered, not when they happen

The gin leaves on days 28 and 44 but nothing reveals it until the next Sunday
count of the drinks shelf. The supplier raises the oil price on day 35 but you
find out at the
next delivery. A report that insists on same-day detection misses both.

### Demo and real data share every code path

Every table has `is_demo`. Same tables, same queries, same screens. You are
never testing against a structure you will not ship.

---

## 5. Who can do what

**Five roles.** The API is the real gate - the menu hides what a role cannot
use, but the server is what enforces it. This table comes from the route
definitions, not from memory.

### The roles

| Role | Who this is | What they see |
|---|---|---|
| **Admin** | Whoever hands out logins | One screen: Logins. Cannot touch stock at all. |
| **Management** | Owner, manager | Everything, including the five reports. They **decide**: approvals, purchases, credit notes. They do not hand stock over. |
| **Storekeeper** | Holds the store | Requests to release, stock everywhere, deliveries, raising purchases and supplier returns |
| **Kitchen** | Cooks, bakers, bar hands - one room, one role | Ask for stock, what we have, confirm arrivals |
| **Cleaning** | Cleaning staff | The same, for cleaning supplies, plus wastage, counts and returns in their own store |

A branch can have **as many logins per role as it needs** - two kitchen logins,
three, whatever matches how the shifts work.

### The everyday flow

```
Kitchen or Cleaning          Storekeeper                      Back to the asker
─────────────────────        ─────────────────────────        ─────────────────
1. Ask for stock       →     2. Release it                →    3. "It came"
   (say when you need it)       (stock moves here)               (confirm arrival)
```

**Releasing is the storekeeper's, and nobody else's.** Management used to be
able to release as a stand-in, which meant the people who approve the spending
could also hand the goods out - the one separation the rest of this system is
built to keep. A storekeeper who is away is covered by a second storekeeper
login, not by a manager reaching past them. Management still sees every request
and what became of it; the screen is a record for them rather than a queue, and
has no *Needs me* tab at all.

If the store cannot cover it, the storekeeper is offered a **purchase order**
for the shortfall right there, with the short items already on it. **Kitchen and
cleaning cannot raise a purchase**, and do not need to: they ask for stock, and
the store buys what it could not give them. Only the storekeeper can see whether
the shelf is really empty, so only the storekeeper decides that something has to
be bought.

Every purchase order then goes to **Management**, who are the only people who
can approve it. The storekeeper asks for the money; management spends it.

### Who can do what

| Action | Admin | Management | Storekeeper | Kitchen | Cleaning |
|---|:--:|:--:|:--:|:--:|:--:|
| Ask for stock | | ● | ● | ● | ● |
| **Release stock** | | | ● | | |
| Confirm it arrived | | ● | ● | ● | ● |
| Raise a purchase request | | ● | ● | | |
| **Approve a purchase** | | ● | | | |
| Receive a delivery (GRN) | | ● | ● | | |
| Log wastage | | ● | ● | ● | ● |
| Return stock, against the release | | | ● | ● | ● |
| Hold the store's own stock for return | | | ● | | |
| **Decide: back to the supplier, or the bin** | | ● | | | |
| Ask management what to do with it | | | ● | | |
| Mark a supplier return gone | | | ● | | |
| Bin what management said to bin | | | ● | | |
| **Record the credit note** | | ● | | | |
| **Approve wastage** | | ● | | | |
| Stock count | | ● | ● | ● | ● |
| **Verify a count** | | ● | | | |
| **Reverse a document** | | ● | | | |
| **See the five reports** | | ● | | | |
| **Create and remove logins** | ● | | | | |

Read the bold rows as one rule: **management decides, the store handles stock,
and neither does both.** Every bold line is an approval, and none of them sits
in the same column as the action it approves.

Four deliberate gaps. **Admin cannot touch stock** - someone has to hand out
logins without that also granting them the run of the inventory. **The
storekeeper cannot approve purchases or returns** - they handle stock, not
money. **Management cannot release stock, put it in quarantine, or mark it gone**
- those are acts on a crate, done by the person standing next to it, and an
approval you can grant yourself approves nothing. And **the kitchen cannot raise
a purchase** - they cannot see the store's shelf, so asking them to decide
something needs buying invites an order for a sack of flour that is sitting in
the store already. The Purchases screen is not on their menu at all: it would be
a list they could read and do nothing with. What they asked for, and what came
of it, is on Requests.

### Separation of duties

Enforced regardless of role, because a second check is only worth anything if it
is a second person:

- You cannot **release your own request**.
- You cannot **confirm a delivery you released**.
- You cannot **verify a count you performed**.
- You cannot **switch off the last admin** - otherwise nobody can ever add a
  login again, and the failure is silent until someone needs one.

### One thing to know

**Reads are not restricted by role.** Any signed-in person can call the API
directly and see stock levels. The menu hides screens they have no use for, but
that is presentation, not security. On a shared store-room tablet this is a
reasonable trade; tightening it is a change to the route guards, not the UI.

---

## 6. Adding people

### In the app - the normal way

Sign in as **System Admin** and open **Logins**.

**To add someone**, tap *Add someone* and fill in four things:

1. **Their name** - this is the tile they tap on the sign-in screen
2. **What they do** - pick one of the five roles; each says what it means
3. **Which branch** - or "All branches" for management and admin
4. **A 4-digit PIN** - tap *Suggest one* if you like

The PIN is then shown once, large, in plain text. **Read it to them there and
then** - it is not shown again. That is deliberate: hiding it just produces a
sticky note stuck to the tablet.

They appear on the sign-in screen immediately. No restart, no waiting.

**Other things on that screen:**

| Situation | What to do |
|---|---|
| Someone forgot their PIN | *New PIN* - generates one and shows it once |
| Locked out after 5 wrong tries | *Unlock* - clears it without changing the PIN |
| Someone leaves | *Switch off* - they can no longer sign in |
| They come back | *Turn back on* |
| They change job | Not in the UI yet; use the script below |

Nobody is ever deleted, only switched off. Their name is on every document they
ever created, and the ledger does not forget.

### From the terminal - when the app cannot help

If nobody can sign in as admin, or you need to change someone's role:

```bash
node scripts/add-user.mjs --list
```

```bash
node scripts/add-user.mjs --name "Kamal Perera" --role kitchen --pin 4821
```

They appear on the login screen immediately. No restart.

**Options**

| Flag | Meaning |
|---|---|
| `--name` | Full name, as it should appear on the login tile |
| `--role` | One of: `admin management storekeeper kitchen cleaning` |
| `--pin` | 4-6 digits |
| `--outlet` | Branch code, default `GB`. Options: `GB ESP TCL KAT BANQ` |
| `--group` | All branches instead of one. Use for management and admin. |
| `--phone` | Optional |
| `--deactivate` | Removes them from the login screen |
| `--list` | Show everyone |

**Reset a forgotten PIN** - same command, existing name. This also clears any
lockout from failed attempts:

```bash
node scripts/add-user.mjs --name "Sunil Fernando" --pin 5566
```

**Someone leaves:**

```bash
node scripts/add-user.mjs --name "Sunil Fernando" --deactivate
```

Deactivate, never delete. Their name is on every document they ever created and
the ledger does not forget. A deleted user would orphan sixty days of history.

### Choosing a PIN

Four digits on a shared tablet, so treat it as identification rather than a
secret. Five wrong attempts locks the account for fifteen minutes. Avoid `1234`,
birth years, and the last four of a phone number. Everyone gets their own - the
entire audit trail depends on the name against a document being the person who
did it.

### When someone changes job

Give them the new role with the same command; it updates in place.

```bash
node scripts/add-user.mjs --name "Ruwan Dias" --role storekeeper --pin 7788
```

Their history stays attached to them. Documents they created as a baker still
say baker's work - the ledger records what happened, not what is true today.

---

## 7. Adding other master data

**This is currently the weakest part of the system and the main thing standing
between you and go-live.** There is no screen for any of it.

| Thing | How, today |
|---|---|
| People | **In the app** - Admin → Logins ✅ |
| Items, packs, par levels | **In the app** - Setup → Products ✅ |
| Categories | **In the app** - Setup → Products → Categories ✅ |
| Suppliers and agreed prices | **In the app** - Setup → Suppliers ✅ |
| Outlets and sections | **In the app** - Setup → Branches and sections ✅ |
| Opening balances | **In the app** - Advanced → Opening stock ✅ |
| Quarantine section | **In the app** - Setup → Branches and sections. **Every branch needs one before anything can be returned** |
| Issue windows | `settings` table, SQL only |
| Kinds of section | One constant, `api/src/plugins/auth.ts` → `SECTION_KINDS` |

All of it is the **admin's**, and nobody else's - including management. The
person who hands out logins is also the person who defines what the system
contains, and neither of those is the person who receives stock against it.

The trade to know about: a delivery from a supplier nobody has entered yet
needs the admin before it can be booked in. If that turns out to bite at 6am on
a loading bay, widening it to management is one line in
`ROUTE_PERMISSIONS` (web) and one in the `adminOnly` guard (api).

**Sections have a *kind*, and the kind is what decides who can work there.** A
branch can have two kitchens - a pastry room is of kind Kitchen with a name of
its own, and both are visible to the kitchen logins. What the setup form will
not let you do is invent a *new* kind, because a section of some unknown kind
is a room no role can reach: created successfully, visible to nobody. Adding a
seventh kind is deliberately a code change in one place, `SECTION_KINDS`, which
both the permission checks and the setup form read.

---

## 8. Known gaps

Honest list of what is not built.

| Gap | Impact |
|---|---|
| **Fourteen documents in the pack are not written yet** | All of `docs/07-post-golive/` and `docs/08-running/`, plus the acceptance certificate, handover note, training pack and migration completion report in `06-deployment/`. `docs/README.md` lists them; the files do not exist. The User Manual and Administrator Manual are now written; the Acceptance Certificate is still on that document's own "cannot be skipped" list |
| **No CSV import for cutover** | Every item is typed in one at a time. A hundred items is a long day, but it is a day, not a developer. |
| **No transfers screen** | API works and is tested; no UI. |
| **Not deployed** | No VPS, no HTTPS, no CI, **no backups, no tested restore**. |
| **No offline support** | Deliberate - you chose online-only. A dropped connection during a count loses it. |
| **Not installable as an app** | Runs in a browser tab. |
| **Recipes and products** | Setup covers the item master, not Phase 2's recipes. `usage_variance` still runs on seeded recipes. |
| **No approval limits** | Management approves every purchase, of any size. There is no "under Rs 5,000 needs nobody". |
| Phase 4 | Other outlets. The schema supports them and Setup can now create them; nothing has been run at one. |

**The one that should worry you most is backups.** There is currently no backup
of anything. Before a single real GRN is entered, there must be a nightly dump
*and* a restore that has actually been performed once. An untested backup is a
belief, not a backup.

---

## 9. Go-live runbook

Do not start this until Phase 0 is finished - every item, unit and pack
conversion confirmed by walking the store with the storekeeper. No amount of
software recovers from a wrong pack conversion.

1. Deploy and confirm backups **and a successful restore**.
2. Freeze demo use. Tell everyone to stop.
3. `psql "$DB" -f db/reset.sql`
4. **Verify**: `select count(*) from stock_ledger;` → must be **0**.
5. Create the first admin with `scripts/add-user.mjs`. This is the only step
   that still needs a terminal, because the reset takes every login with it -
   including the one that would have created the next one.
6. Sign in as that admin and build the system, in this order, because each step
   needs the one before it:
   1. **Setup → Branches and sections.** The branch arrives with its main
      store; add the kitchen and cleaning sections it really has,
      **and a Quarantine section** - without one nothing can be returned, and
      the return screen will say so at the worst possible moment.
   2. **Setup → Products.** Categories first, then every item with its packs.
      This is the long one, and it is Phase 0's spreadsheet being typed in.
   3. **Setup → Suppliers**, with the prices you have already agreed. Those
      prices are what the first delivery is measured against; without them the
      first surprise price looks exactly like the normal price.
   4. **Logins** for the real people. Delete nothing - the demo accounts went
      with the reset.
7. **Advanced → Opening stock**, per section, as the storekeeper or a manager.
   Count the shelf, enter what is on it and what it is worth. A section can be
   opened once and only while it has never held anything; after that the
   instrument is a stock count, because after day one a difference is a
   discrepancy rather than a starting point.
8. First real delivery.

### Or: empty it but keep the branches

Between "finished trialling" and "ready for the runbook above" there is a third
thing you often want -- an empty system that still has its branches and
sections, so you are not re-typing five outlets to test one flow.

```bash
node scripts/wipe-and-admins.mjs             # says what it would delete, stops
node scripts/wipe-and-admins.mjs --confirm   # does it
```

It empties everything `db/reset.sql` does and then some -- it ignores
`is_demo`, so trial data entered by hand goes too -- but keeps `locations`,
`sections`, the item categories and the wastage reason codes. Then it creates
one admin login per branch, because the wipe takes every user with it including
the one who would have created the next one. The PINs are printed once, at the
end. Add `--random` for random PINs, or `--pin 4821` to set them all the same.

The branches come out of it with `is_demo` cleared, which also puts them beyond
the reach of `db/reset.sql` later -- a cutover run must not take the branches
with it.

After that first real GRN the ledger is immutable for real. That is the point.

---

## 10. Where things live

```
db/migrations/     schema and its changes
db/reset.sql       the cutover wipe -- demo rows only, branches included
db/wipe-keep-branches.sql
                   the harder wipe -- everything except the branches
scripts/clear-returns.mjs
                   empties the returns so the flow can be walked from zero
                   (demo rows only -- the ledger refuses the rest)
seed/items.csv     the 100-item master, and the Phase 0 template
seed/generate.ts   demo data generator, including the five planted faults
scripts/           migrate, seed, verify, add-user
api/src/services/  the business rules - ledger.ts is the important one
api/src/routes/    HTTP surface and role guards
api/test/          135 tests; anomalies.test.ts is the acceptance suite
grand-inventory-web/src/app/pages/        the screens
```

If you read one file, read `api/src/services/ledger.ts`. Everything else is
arrangement around what that module guarantees.
