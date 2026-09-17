-- Everything the owner needs to set the system up themselves, and a purchase
-- order that survives contact with a delivery lorry.
--
-- Two problems this fixes.
--
-- First: after db/reset.sql there are no locations, sections, items, suppliers
-- or cleaning tasks at all -- every one of them is seeded, and nothing in the
-- app can create one. Handing the system over meant handing over psql with it.
-- The tables were fine; what they lacked was the ability to retire a row.
-- Master data is never deleted here (the ledger references it forever), so
-- every table an admin can edit needs an is_active to switch off instead.
--
-- Second: a purchase order recorded a wish and nothing else. It had no
-- supplier, no pack, and no idea whether the goods ever turned up. You ordered
-- ten sacks, six arrived, and the purchase order sat at "ordered" looking
-- identical to one that was fully delivered.

begin;

-- ---------------------------------------------------------------------------
-- 1. Retiring master data
--
-- is_active, not delete. A pack that has appeared on one GRN is part of the
-- ledger's history whether or not the supplier still sells that size.
-- ---------------------------------------------------------------------------

alter table item_categories add column is_active boolean not null default true;
alter table item_packs      add column is_active boolean not null default true;
alter table sections        add column is_active boolean not null default true;

-- ---------------------------------------------------------------------------
-- 2. Section kind
--
-- Role permissions have always keyed off sections.code, which forced the code
-- to be one of five hard-coded values and made `unique (location_id, code)`
-- mean "one kitchen per branch". A second kitchen -- a pastry room, a prep
-- room -- could not be created without a role losing sight of it.
--
-- `kind` carries the permission meaning; `code` goes back to being a short
-- label. A branch can now hold KITCHEN and PASTRY, both of kind KITCHEN, both
-- visible to the kitchen logins.
--
-- Deliberately no check constraint: the list of kinds lives in one constant in
-- the API (plugins/auth.ts, SECTION_KINDS) so that adding a sixth kind later
-- is one edit that both the permission checks and the setup form read. A check
-- constraint here would make it two, and the second one a migration.
-- ---------------------------------------------------------------------------

alter table sections add column kind text;
update sections set kind = code;
alter table sections alter column kind set not null;

create index on sections (location_id, kind);

-- ---------------------------------------------------------------------------
-- 3. Purchase orders that can actually be received
--
-- Ordering happens in packs -- "5 x 50 kg sack" is what you say to a supplier
-- and what comes back on the invoice -- so a line carries the pack it was
-- ordered in and converts to stock units exactly once, the same rule the GRN
-- has always followed. Both columns are nullable because purchase orders
-- raised before this migration have neither, and rewriting their history to
-- invent a pack would be a lie. The API requires them on everything new.
-- ---------------------------------------------------------------------------

alter table purchase_orders
    add column supplier_id int references suppliers(id),
    -- Set when the last outstanding line is received, or when management
    -- closes the order short. Distinct from decided_at, which records the
    -- decision to buy, not the arrival of the goods.
    add column closed_at timestamptz;

alter table purchase_order_lines
    add column item_pack_id int references item_packs(id),
    add column qty_packs numeric(14,3),
    -- Accumulates across deliveries. A part-delivered order stays open on the
    -- balance rather than quietly disappearing from the follow-up list.
    add column qty_received_base numeric(14,3) not null default 0;

comment on column purchase_order_lines.est_price is
    'Estimated price for ONE pack, matching grn_lines.pack_price. Null if unknown.';

create index on purchase_orders (supplier_id);
create index on purchase_order_lines (item_pack_id);

-- The receipt side of the link. A GRN entered against an order tells the order
-- what arrived; a GRN with no po_id is an ordinary walk-in delivery.
alter table grn add column po_id bigint references purchase_orders(id);
create index on grn (po_id);

-- ---------------------------------------------------------------------------
-- 4. Opening stock
--
-- Step 7 of the go-live runbook -- "opening count in every section" -- had no
-- document behind it. doc_type 'opening' existed and nothing ever wrote one,
-- so the only way to get real stock into a fresh system was to type it in as a
-- GRN from a supplier who never delivered it.
--
-- It is its own document because it is its own event: an opening balance is
-- what was already on the shelf on day one, and a count is a discrepancy found
-- later. A report that cannot tell them apart reads day one as a variance.
-- ---------------------------------------------------------------------------

create table opening_stock (
    id            bigserial primary key,
    location_id   int not null references locations(id),
    section_id    int not null references sections(id),
    business_date date not null,
    entered_by    int not null references users(id),
    entered_at    timestamptz not null default now(),
    note          text,
    is_demo       boolean not null default false
);

create table opening_stock_lines (
    id            bigserial primary key,
    opening_id    bigint not null references opening_stock(id) on delete cascade,
    item_id       int not null references items(id),
    qty_base      numeric(14,3) not null,
    -- What the stock on the shelf is worth. There is no invoice for it, so
    -- somebody has to say -- and it becomes the starting weighted average.
    unit_cost     numeric(14,4) not null,
    is_demo       boolean not null default false
);

create index on opening_stock (location_id, section_id);
create index on opening_stock_lines (opening_id);
create index on opening_stock_lines (item_id);

commit;
