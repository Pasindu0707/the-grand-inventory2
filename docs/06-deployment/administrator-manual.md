# The Grand — administrator manual

**Everything the admin sets up, in the order it has to be done.**

| | |
|---|---|
| System | The Grand — inventory management |
| For | Whoever holds the admin login at The Grand Gastrobar |
| Companion | [User Manual](user-manual.md) — the day-to-day flows for everyone else |
| Version | 1.0 · [FILL: date] |

---

## 1. What an admin is, and is not

The admin **defines what the system contains**: branches, sections, products,
packs, suppliers, prices and logins.

The admin **touches no stock at all**. You cannot receive a delivery, release
stock, count a shelf or read the reports. That is on purpose: the person who
hands out logins should not also have the run of the inventory.

Your menu is one group — **Administration** — with five screens:

| Screen | What it is for |
|---|---|
| **Admin overview** | Is this branch ready to go live, and what is wrong |
| **Logins** | Who can sign in, and as what |
| **Products** | Items, their units, their pack sizes, categories |
| **Suppliers** | Who you buy from, and the prices agreed |
| **Branches** | Outlets, and the sections inside them |

---

## 2. Setting up from nothing

The order matters — each step needs the one before it.

### Step 1 — Branches and sections

**Branches** → the branch arrives with its **main store**. Add the rooms it
really has.

| Kind | Use it for | Who can work there |
|---|---|---|
| **Main store** | Where deliveries land. One per branch | Storekeeper and management |
| **Kitchen** | Any production room | The kitchen logins |
| **Cleaning store** | Cleaning supplies | The cleaning logins |
| **Quarantine** | Where returned goods wait for the supplier | The storekeeper only |

**Every branch needs a Quarantine section.** Without one, nothing can ever be
returned, and the person who finds out is a chef holding a crate of bad fish at
the worst possible moment.

**A branch can have two kitchens.** A pastry bench or a drinks shelf that is
genuinely counted separately is a *second section of kind Kitchen* with its own
name — call it "Pastry" or "Bar". The **kind** decides who may stand there; the
**name** tells them which door. You cannot invent a new kind: a section of an
unknown kind is a room no role can reach, created successfully and visible to
nobody.

Set the **business day start**. Most branches are 06:00. A 24-hour site runs
04:00–04:00, so "today" there is not "today" anywhere else — the Coffee Lounge
is the example.

### Step 2 — Products

**Products** → **Categories** first, then every item.

For each product:

| Field | What it means | Get this right |
|---|---|---|
| **Code** | e.g. `MEA-001` | Unique. People search by it |
| **Name** | Chicken breast | |
| **Category** | Meat | Decides how it is stored and grouped |
| **Stock unit** | g, ml, ea | **The small unit.** Everything is counted in it |
| **Packs** | "1 kg pack" = 1000 g | **At least one, or it can never be bought or received** |
| **Reorder point** | When to buy more | Without it, it never reaches a suggested order |
| **Par level** | The level to top back up to | |
| **Critical?** | Counted daily rather than weekly | |

**The stock unit and the pack conversion are the two things no amount of
software recovers from.** "1 kg pack = 1000 g" is right; "1 kg pack = 1 g" makes
every figure that touches that product wrong forever. Walk the store with the
storekeeper and confirm each one before you type it — that is what Phase 0 is
for.

Once a product has moved, **its stock unit cannot be changed** — changing it
would reinterpret every past figure. Retire it and create a new one instead.
Same for resizing a pack that has already been bought.

### Step 3 — Suppliers and their prices

**Suppliers** → name, phone, payment terms, and **the prices you have already
agreed**.

Those prices matter more than they look. They are what the first delivery is
measured against. Without them, the first surprise price looks exactly like the
normal price, and the price-movement report only wakes up on the *second*
delivery.

### Step 4 — Logins

**Logins** → **Add someone**. Four things:

1. **Their name** — this is the tile they tap on the sign-in screen
2. **What they do** — one of the five roles; each says what it means
3. **Which branch** — or "All branches" for management and admin
4. **A 4-digit PIN** — tap *Suggest one* if you like

The PIN is then shown **once**, large, in plain text. **Read it to them there
and then.** It is not shown again. That is deliberate — hiding it just produces
a sticky note stuck to the tablet.

They appear on the sign-in screen immediately.

| Situation | What to do |
|---|---|
| Forgot their PIN | **New PIN** — generates one and shows it once |
| Locked out after 5 wrong tries | **Unlock** — clears it without changing the PIN |
| Someone leaves | **Switch off** — they can no longer sign in |
| They come back | **Turn back on** |
| They change job | Not in the screen yet — use the script in [HANDBOOK §6](../../HANDBOOK.md) |

**Nobody is ever deleted, only switched off.** Their name is on every document
they ever created, and the record does not forget.

**Create more than one storekeeper.** Releasing stock is the storekeeper's alone
— management deliberately cannot do it — so a branch with one storekeeper login
has a branch that stops when that person is off. A second login costs nothing
and takes a minute.

**You cannot switch off the last admin.** Otherwise nobody could ever create a
login again, and the failure would be silent until someone needed one.

### Step 5 — Opening stock

**This one is not yours.** The storekeeper or a manager counts each shelf and
enters what is on it, under **Opening stock**.

A section can be opened **once**, and only while it has never held anything.
After that the instrument is a stock count, because after day one a difference
is a discrepancy rather than a starting point.

---

## 3. The Admin overview

`/admin` answers the question you actually have: **is this ready?**

**Before go-live** — outlets and sections, categories, the product master, a
purchase pack on every product, suppliers, a login per person, and the opening
balance per section. Each line says what breaks if it is skipped.

**Needs attention** — things already set up but wrong:

| It says | It means |
|---|---|
| Products with no pack | They cannot be ordered or received at all |
| Locked-out logins | Somebody cannot work |
| Logins with no outlet | They cannot see anything |
| Sections still on zero | No opening balance entered |
| Products with no reorder point | They never reach a suggested order |
| Empty categories | Probably a typo |

Opening balances are the storekeeper's and management's at the API, so that one
line shows as somebody else's job and is left out of your tally rather than
failing the page.

---

## 4. Changing things after go-live

| You want to | Can you? |
|---|---|
| Add a product, supplier, pack, section, branch | **Yes**, any time |
| Rename a product or a section | **Yes** — the name is a label |
| Change a product's stock unit after it has moved | **No.** Retire it, create a new one |
| Resize a pack that has been bought | **No.** Add a new pack, retire the old one |
| Retire a section | Only if it holds no stock. Transfer it out first |
| Delete anything | **No.** Things are switched off, never deleted |

Retired sections still appear on old documents — switching one off stops new
work being filed against it, it does not erase last month.

---

## 5. Things only you can fix

| Symptom | Cause | Fix |
|---|---|---|
| *"This branch has no quarantine section"* on a return | The branch was set up without one | Branches → add a Quarantine section |
| A product "cannot be received" | It has no pack | Products → add a pack |
| A delivery cannot name its supplier | Supplier not entered | Suppliers → add them |
| Somebody cannot sign in | Locked out, or switched off | Logins → Unlock, or Turn back on |
| The price warning never fires for a supplier | No agreed prices were entered | Suppliers → add their prices |
| A product never appears on a suggested order | No reorder point | Products → set one |

---

## 6. Before the real data goes in

Read the **go-live runbook** in [HANDBOOK §9](../../HANDBOOK.md) and do not
start until:

1. Deployment is done and **a backup has been taken and restored once**. An
   untested backup is a belief, not a backup.
2. Phase 0 is finished — every item, unit and pack conversion confirmed by
   walking the store.

Then: freeze the demo, wipe it, verify the stock record is empty, create the
first admin from the terminal (the wipe takes every login with it, including the
one that would have created the next one), and build the system in the order in
[section 2](#2-setting-up-from-nothing).

**After the first real delivery the record is permanent.** That is the point.
