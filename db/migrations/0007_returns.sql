-- Returns: out of a section, into quarantine, back to the vendor.
--
-- The gap this fills: a delivery arrives, the store releases it to the kitchen,
-- the kitchen opens it and the goods are wrong. Until now the only instruments
-- were wastage -- which says the food was destroyed and nobody owes anybody
-- anything -- and reversing the GRN, which says the delivery never happened.
-- Neither is true. The goods exist, they are faulty, and the supplier owes
-- either money or a replacement.
--
-- ---------------------------------------------------------------------------
-- Two documents, because two different things happen
-- ---------------------------------------------------------------------------
--
--   section_returns    the kitchen hands stock back to the store
--   supplier_returns   the store hands stock back to the vendor
--
-- They are separate documents because they answer to different people. The
-- first is an internal movement and follows the wastage rule -- the stock has
-- physically moved, so the ledger says so immediately and a manager approves
-- afterwards. The second spends money, so management approves it *before* the
-- goods leave the building, the same way they approve a purchase.
--
-- ---------------------------------------------------------------------------
-- Quarantine is a section, not a flag
-- ---------------------------------------------------------------------------
--
-- Returned goods land in a section of kind QUARANTINE rather than back on the
-- main store's shelf. Two reasons, and the second is the one that matters.
--
-- A flag on a quantity would be the first stored piece of stock state in this
-- system, and the whole design rests on stock being derived from movements
-- rather than stored anywhere.
--
-- And faulty goods sitting in the main store's balance are faulty goods the
-- kitchen can ask for again tomorrow. The store shows more than it can really
-- give, and the first person to find out is the chef who was promised it.
-- A section nobody may request from cannot do that.
--
-- The kind itself is declared in api/src/plugins/auth.ts SECTION_KINDS, which
-- is the single list the permission checks and the setup form both read. There
-- is deliberately no check constraint here -- see 0005 for why.
--
-- No quarantine section is created here. A migration runs before any location
-- exists on a fresh database, so an insert would silently do nothing on the
-- one path that matters most. The seed creates them, the setup screen creates
-- them, and the return service refuses with an instruction if a branch has
-- none.
--
-- ---------------------------------------------------------------------------
-- The ledger already knew about this
-- ---------------------------------------------------------------------------
--
-- `return` has been a member of doc_type since 0001_init and has never been
-- written. It is the document type both of these post under.
--
-- Cost: a return is not a receipt, so it leaves at the weighted average like
-- any other outgoing movement. The money the supplier owes is a different
-- number -- the price actually paid on the GRN line -- and it lives on
-- supplier_return_lines, not in the ledger. They can legitimately differ, and
-- pretending otherwise would revalue the stock that stayed on the shelf.

begin;

-- ---------------------------------------------------------------------------
-- 1. Section return -- the kitchen hands it back
-- ---------------------------------------------------------------------------

create table section_returns (
    id             bigserial primary key,
    location_id    int not null references locations(id),
    -- Where it came back from, and the quarantine section it landed in.
    from_section_id int not null references sections(id),
    to_section_id   int not null references sections(id),
    item_id        int not null references items(id),
    qty_base       numeric(14,3) not null check (qty_base > 0),
    -- Why. A return with no reason is indistinguishable from a stock count
    -- somebody did badly, and the supplier conversation needs it.
    reason_code    text not null references reason_codes(code),
    note           text,
    photo_url      text,
    -- The issue it came out of, when the kitchen can say. Optional: stock that
    -- has been on the shelf a fortnight cannot always be traced to one release.
    issue_id       bigint references issues(id),
    returned_by    int not null references users(id),
    returned_at    timestamptz not null default now(),
    -- Approval follows the movement, as with wastage.
    approved_by    int references users(id),
    approved_at    timestamptz,
    is_demo        boolean not null default false
);

create index on section_returns (location_id, returned_at);
create index on section_returns (item_id);
create index on section_returns (approved_by) where approved_by is null;

-- ---------------------------------------------------------------------------
-- 2. Supplier return -- the store hands it back to the vendor
-- ---------------------------------------------------------------------------
--
-- raised    the storekeeper has written it up
-- approved  management has agreed to send it
-- rejected  management has not
-- sent      it has physically left. THIS is when the ledger is written
-- settled   the supplier has done whatever they were going to do
--
-- The ledger writes at `sent` and nowhere else. Raising a return is paperwork;
-- the stock is still in quarantine and still ours. Settling it is a
-- conversation about money that happens weeks later, long after the goods went.

create type supplier_return_status as enum
    ('raised', 'approved', 'rejected', 'sent', 'settled');

-- What the supplier actually did about it. Null until settled.
create type supplier_return_outcome as enum
    ('credit', 'replacement', 'written_off');

create table supplier_returns (
    id             bigserial primary key,
    location_id    int not null references locations(id),
    supplier_id    int not null references suppliers(id),
    -- The delivery it came in on. Every line must belong to this GRN, which is
    -- what lets the credit be priced from what was actually paid.
    grn_id         bigint not null references grn(id),
    status         supplier_return_status not null default 'raised',
    reason_code    text not null references reason_codes(code),
    note           text,

    raised_by      int not null references users(id),
    raised_at      timestamptz not null default now(),

    decided_by     int references users(id),
    decided_at     timestamptz,
    decision_note  text,

    sent_by        int references users(id),
    sent_at        timestamptz,

    -- Settlement. `outcome` says what the supplier did; the rest is the
    -- evidence for it.
    outcome        supplier_return_outcome,
    credit_note_no text,
    credit_value   numeric(14,2),
    settled_by     int references users(id),
    settled_at     timestamptz,
    settle_note    text,

    is_demo        boolean not null default false
);

create table supplier_return_lines (
    id             bigserial primary key,
    return_id      bigint not null references supplier_returns(id) on delete cascade,
    -- The GRN line being returned against. This is the whole point of tying a
    -- return to a delivery: it carries the pack, the conversion and the price.
    grn_line_id    bigint not null references grn_lines(id),
    item_id        int not null references items(id),
    -- Entered in packs, like the delivery was. Converted once, on entry.
    qty_packs      numeric(14,3) not null check (qty_packs > 0),
    qty_base       numeric(14,3) not null check (qty_base > 0),
    -- The price on the original GRN line, copied at raise. Copied rather than
    -- joined because a supplier price list changes and the credit owed does
    -- not: it is what was paid on that invoice, on that day.
    pack_price     numeric(14,2) not null,
    line_credit    numeric(14,2) not null,
    -- The internal return this line came from, when it came from one. A vendor
    -- return can also be raised for goods the store itself rejected at the
    -- door, which never went to a section at all.
    section_return_id bigint references section_returns(id),
    is_demo        boolean not null default false
);

create index on supplier_returns (location_id, status);
create index on supplier_returns (supplier_id);
create index on supplier_returns (grn_id);
create index on supplier_return_lines (return_id);
create index on supplier_return_lines (grn_line_id);

-- ---------------------------------------------------------------------------
-- 3. Reason codes for returns
-- ---------------------------------------------------------------------------
--
-- Deliberately not reusing the wastage codes. `RETURN` already exists there and
-- means "a customer sent their plate back", which is the opposite direction and
-- a different conversation. These belong to doc type `return`.

insert into reason_codes (code, doc, label) values
    ('RET_DAMAGED',  'return', 'Damaged in transit'),
    ('RET_QUALITY',  'return', 'Below the quality agreed'),
    ('RET_EXPIRED',  'return', 'Expired or too close to expiry'),
    ('RET_WRONG',    'return', 'Wrong item or wrong pack'),
    ('RET_EXCESS',   'return', 'Over-delivered, not ordered')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Usage variance has to net returns off
-- ---------------------------------------------------------------------------
--
-- The view measured a section's actual intake as everything issued into it.
-- With returns that is wrong in the direction that matters most: a kitchen that
-- was sent 40 kg of fish and sent 12 kg straight back would read as having
-- consumed all 40. Theoretical usage from the recipes stays where it was, so
-- the variance report -- the one that catches chicken being over-issued --
-- would flag the kitchen for stock it never had.
--
-- A section return posts a negative row in the section it came out of, so
-- summing issue-in together with return-out gives intake net of what went back.
--
-- Quarantine is excluded outright. Both legs of a return touch it, and it is
-- not a room anybody cooks in: leaving it in produced variance rows for a
-- section with no recipes and no production, which is noise in a report whose
-- whole value is being short.

create or replace view usage_variance as
with theoretical as (
  select pl.location_id, pl.business_date, pl.section_id, rl.item_id,
         sum(rl.qty_base * pl.qty_made / nullif(pr.yield_qty, 0)) as theoretical_qty
  from production_log pl
  join products pr     on pr.id = pl.product_id
  join recipe_lines rl on rl.product_id = pl.product_id
  group by pl.location_id, pl.business_date, pl.section_id, rl.item_id
),
actual as (
  select l.location_id, l.business_date, l.section_id, l.item_id,
         sum(l.qty_base) as issued_qty
  from stock_ledger l
  join sections s on s.id = l.section_id
  where s.kind <> 'QUARANTINE'
    and (   (l.doc = 'issue'  and l.qty_base > 0)
         or (l.doc = 'return' and l.qty_base < 0))
  group by l.location_id, l.business_date, l.section_id, l.item_id
)
select
  coalesce(t.location_id,   a.location_id)   as location_id,
  coalesce(t.business_date, a.business_date) as business_date,
  coalesce(t.section_id,    a.section_id)    as section_id,
  coalesce(t.item_id,       a.item_id)       as item_id,
  coalesce(t.theoretical_qty, 0)             as theoretical_qty,
  coalesce(a.issued_qty, 0)                  as actual_qty,
  coalesce(a.issued_qty, 0) - coalesce(t.theoretical_qty, 0) as variance_qty,
  case
    when coalesce(t.theoretical_qty, 0) = 0 then null
    else round(
      100.0 * (coalesce(a.issued_qty, 0) - t.theoretical_qty) / t.theoretical_qty, 2)
  end as variance_pct
from theoretical t
full outer join actual a
  on  a.location_id   = t.location_id
  and a.business_date = t.business_date
  and a.section_id    = t.section_id
  and a.item_id       = t.item_id;

commit;
