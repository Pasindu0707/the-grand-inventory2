-- The Grand - inventory schema (Postgres 16)
--
-- Design rule: stock_ledger is append-only. Nothing is ever UPDATEd or DELETEd.
-- Corrections are new rows with is_reversal = true pointing at the original.
--
-- This is the corrected baseline. Differences from the original schema.sql
-- (see git history, commit 7483edf) are marked [A1]..[A9] and explained in
-- PLAN.md §3. Nothing has been deployed, so the fixes are folded into the
-- first migration rather than shipped as a broken rule plus a patch.

begin;

-- ---------------------------------------------------------------------------
-- 1. Master data
-- ---------------------------------------------------------------------------

create table locations (
  id            serial primary key,
  code          text not null unique,          -- GB, ESP, TCL, KAT, BANQ
  name          text not null,
  day_start     time not null default '06:00', -- business-day cut-off
  is_active     boolean not null default true,
  is_demo       boolean not null default false
);

-- A section is anywhere stock can sit. The main store is a section too:
-- that keeps every movement a section-to-section transfer and removes all
-- special-casing from the ledger.
create table sections (
  id            serial primary key,
  location_id   int not null references locations(id),
  code          text not null,                 -- STORE, KITCHEN, BAR, BAKERY, CLEAN
  name          text not null,
  is_store      boolean not null default false,
  is_demo       boolean not null default false,
  unique (location_id, code)
);

create type user_role as enum
  ('owner','manager','storekeeper','chef','bar','baker','cleaning','purchasing');

create table users (
  id            serial primary key,
  location_id   int references locations(id),  -- null = group-wide (owner)
  name          text not null,
  phone         text,
  role          user_role not null,
  pin_hash      text not null,                 -- 4-6 digit PIN, bcrypt  [A6]
  is_active     boolean not null default true,
  is_demo       boolean not null default false
);

create table suppliers (
  id            serial primary key,
  name          text not null,
  phone         text,
  is_cash_market boolean not null default false, -- fish market, pola: no invoice
  vat_no        text,
  payment_terms text,
  is_active     boolean not null default true,
  is_demo       boolean not null default false
);

create type storage_type as enum
  ('dry','chiller','freezer','bar','chemical','packaging','gas');

create table item_categories (
  id            serial primary key,
  name          text not null unique,
  storage       storage_type not null
);

create table items (
  id             serial primary key,
  code           text not null unique,          -- DRY-0007
  name           text not null,
  name_si        text,                          -- reserved; UI is English for now
  category_id    int not null references item_categories(id),
  stock_unit     text not null,                 -- g, ml, ea  -- ALWAYS the small unit
  par_level      numeric(14,3) not null default 0,   -- in stock_unit
  reorder_point  numeric(14,3) not null default 0,
  shelf_life_days int,
  is_critical    boolean not null default false, -- true => counted daily
  is_active      boolean not null default true,
  is_demo        boolean not null default false
);

-- One item can be bought in several pack sizes. Never store a conversion
-- factor on the item itself: sugar arrives in 1 kg packs AND 50 kg sacks.
create table item_packs (
  id            serial primary key,
  item_id       int not null references items(id),
  pack_name     text not null,                 -- "50 kg sack"
  qty_in_stock_unit numeric(14,3) not null,    -- 50000
  is_default_purchase boolean not null default false,
  is_demo       boolean not null default false
);

create table supplier_prices (
  id            serial primary key,
  supplier_id   int not null references suppliers(id),
  item_pack_id  int not null references item_packs(id),
  price         numeric(14,2) not null,
  effective_from date not null,
  is_demo       boolean not null default false
);

-- ---------------------------------------------------------------------------
-- 2. The ledger
-- ---------------------------------------------------------------------------

create type doc_type as enum
  ('grn','market','issue','return','wastage','transfer','count','production','opening');

create table reason_codes (
  code          text primary key,
  doc           doc_type not null,
  label         text not null
);

create table stock_ledger (
  id            bigserial primary key,
  occurred_at   timestamptz not null default now(),
  business_date date not null,                 -- derived from location.day_start
  location_id   int not null references locations(id),
  section_id    int not null references sections(id),
  item_id       int not null references items(id),
  qty_base      numeric(14,3) not null,        -- SIGNED, in item.stock_unit
  -- Receipts (grn/market/opening) record the price actually paid: it appears
  -- nowhere else and it is what the price-movement report reads. Every other
  -- movement records the weighted average at the time it happened, i.e. the
  -- cost of what left. The running average itself lives in item_cost_state.
  unit_cost     numeric(14,4) not null,
  doc           doc_type not null,
  doc_id        bigint not null,
  doc_line      int,
  reason_code   text references reason_codes(code),
  created_by    int not null references users(id),
  is_reversal   boolean not null default false,
  reverses_id   bigint references stock_ledger(id),
  note          text,
  is_demo       boolean not null default false
);

create index on stock_ledger (item_id, section_id, business_date);
create index on stock_ledger (business_date, location_id);
create index on stock_ledger (doc, doc_id);
-- [A9] reports run almost exclusively over real data after cutover
create index stock_ledger_real_dates on stock_ledger (business_date) where not is_demo;
create index on stock_ledger (reverses_id) where reverses_id is not null;
create index on stock_ledger (created_by);

-- [A1] Immutability enforced at the database, not in application code.
--
-- The original used `create rule ... do instead nothing`, which silently
-- discards the statement. That blocked reset.sql too, so cutover would have
-- left every demo row in the live ledger while appearing to succeed. Triggers
-- raise instead of failing silently, and carry one narrow, explicit escape for
-- the demo wipe.
create function ledger_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'stock_ledger is append-only; correct it with a reversal row (id=%)', old.id
      using errcode = 'restrict_violation';
  end if;

  -- Only db/reset.sql sets this, and only inside its own transaction.
  if old.is_demo and coalesce(current_setting('grand.allow_demo_reset', true), '') = 'on' then
    return old;
  end if;

  raise exception 'stock_ledger rows cannot be deleted (id=%, is_demo=%)', old.id, old.is_demo
    using errcode = 'restrict_violation';
end $$;

create trigger ledger_no_update before update on stock_ledger
  for each row execute function ledger_guard();

create trigger ledger_no_delete before delete on stock_ledger
  for each row execute function ledger_guard();

-- TRUNCATE bypasses row-level DELETE triggers entirely. Without this, one
-- `truncate stock_ledger` would defeat every guarantee above.
create function ledger_no_truncate() returns trigger language plpgsql as $$
begin
  raise exception 'stock_ledger cannot be truncated'
    using errcode = 'restrict_violation';
end $$;

create trigger ledger_no_truncate before truncate on stock_ledger
  for each statement execute function ledger_no_truncate();

-- [A3] Weighted-average cost, maintained by the receipt service in the same
-- transaction as the ledger write. Receipts (grn, market, opening, transfer-in)
-- move the average; issues, wastage and count adjustments only read it.
create table item_cost_state (
  item_id       int not null references items(id),
  location_id   int not null references locations(id),
  qty_on_hand   numeric(14,3) not null default 0,
  avg_cost      numeric(14,4) not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (item_id, location_id)
);

-- [A8] The original view had no location_id, so it could not be scoped to an
-- outlet. Its `value` column also summed qty*cost at time of move, which does
-- not return to zero when an item is fully depleted at a different average --
-- valuation now lives in current_stock_valued, off the real average.
create view current_stock as
  select s.location_id,
         l.section_id,
         l.item_id,
         sum(l.qty_base) as qty_base
  from stock_ledger l
  join sections s on s.id = l.section_id
  group by s.location_id, l.section_id, l.item_id;

create view current_stock_valued as
  select cs.location_id,
         cs.section_id,
         cs.item_id,
         cs.qty_base,
         coalesce(ics.avg_cost, 0) as avg_cost,
         round(cs.qty_base * coalesce(ics.avg_cost, 0), 2) as value
  from current_stock cs
  left join item_cost_state ics
    on ics.item_id = cs.item_id and ics.location_id = cs.location_id;

-- ---------------------------------------------------------------------------
-- 3. Documents (each writes one or more ledger rows)
-- ---------------------------------------------------------------------------

create table grn (                                 -- supplier delivery, has invoice
  id            bigserial primary key,
  location_id   int not null references locations(id),
  supplier_id   int not null references suppliers(id),
  invoice_no    text,
  invoice_date  date,
  received_at   timestamptz not null default now(),
  received_by   int not null references users(id),
  photo_url     text,
  total         numeric(14,2),
  is_demo       boolean not null default false
);

create table grn_lines (
  id            bigserial primary key,
  grn_id        bigint not null references grn(id),
  item_pack_id  int not null references item_packs(id),
  qty_packs     numeric(14,3) not null,
  pack_price    numeric(14,2) not null,
  expiry_date   date,
  is_demo       boolean not null default false
);

create table market_purchase (                     -- cash buy, no invoice
  id            bigserial primary key,
  location_id   int not null references locations(id),
  supplier_id   int references suppliers(id),
  bought_at     timestamptz not null default now(),
  bought_by     int not null references users(id),
  cash_given    numeric(14,2),
  cash_returned numeric(14,2),
  photo_url     text,                              -- mandatory in the UI
  is_demo       boolean not null default false
);

create table market_purchase_lines (
  id            bigserial primary key,
  market_id     bigint not null references market_purchase(id),
  item_id       int not null references items(id),
  qty_base      numeric(14,3) not null,
  total_price   numeric(14,2) not null,
  is_demo       boolean not null default false
);

create table issues (                              -- store -> section
  id            bigserial primary key,
  location_id   int not null references locations(id),
  to_section_id int not null references sections(id),
  requested_by  int not null references users(id),
  issued_by     int references users(id),
  requested_at  timestamptz not null default now(),
  issued_at     timestamptz,
  status        text not null default 'requested', -- requested|issued|cancelled
  is_demo       boolean not null default false
);

create table issue_lines (
  id            bigserial primary key,
  issue_id      bigint not null references issues(id),
  item_id       int not null references items(id),
  qty_requested numeric(14,3) not null,
  qty_issued    numeric(14,3),
  is_demo       boolean not null default false
);

create table wastage (
  id            bigserial primary key,
  location_id   int not null references locations(id),
  section_id    int not null references sections(id),
  item_id       int not null references items(id),
  qty_base      numeric(14,3) not null,
  reason_code   text not null references reason_codes(code),
  photo_url     text,
  logged_by     int not null references users(id),
  logged_at     timestamptz not null default now(),
  approved_by   int references users(id),
  is_demo       boolean not null default false
);

create table transfers (                           -- between sections/outlets
  id            bigserial primary key,
  from_section_id int not null references sections(id),
  to_section_id   int not null references sections(id),
  item_id       int not null references items(id),
  qty_base      numeric(14,3) not null,
  sent_by       int not null references users(id),
  received_by   int references users(id),
  sent_at       timestamptz not null default now(),
  received_at   timestamptz,
  is_demo       boolean not null default false
);

create table stock_counts (
  id            bigserial primary key,
  location_id   int not null references locations(id),
  section_id    int not null references sections(id),
  count_type    text not null,                     -- daily_critical|weekly_full|monthly_full
  business_date date not null,
  counted_by    int not null references users(id),
  verified_by   int references users(id),
  closed_at     timestamptz,
  is_demo       boolean not null default false
);

create table stock_count_lines (
  id            bigserial primary key,
  count_id      bigint not null references stock_counts(id),
  item_id       int not null references items(id),
  qty_expected  numeric(14,3) not null,            -- frozen from ledger at open
  qty_counted   numeric(14,3) not null,
  variance_value numeric(14,2) not null,
  is_demo       boolean not null default false
);

-- ---------------------------------------------------------------------------
-- 4. Phase 2 - recipes and production (replaces POS sales import)
-- ---------------------------------------------------------------------------

create table products (                            -- what is sold/made
  id            serial primary key,
  location_id   int not null references locations(id),
  code          text not null,
  name          text not null,
  section_id    int not null references sections(id),  -- who makes it
  yield_qty     numeric(14,3) not null default 1,      -- recipe makes this many
  is_active     boolean not null default true,
  is_demo       boolean not null default false,
  unique (location_id, code)
);

create table recipe_lines (
  id            bigserial primary key,
  product_id    int not null references products(id),
  item_id       int not null references items(id),
  qty_base      numeric(14,3) not null,           -- per yield_qty
  is_demo       boolean not null default false
);

create table production_log (
  id            bigserial primary key,
  location_id   int not null references locations(id),
  section_id    int not null references sections(id),
  business_date date not null,
  product_id    int not null references products(id),
  qty_made      numeric(14,3) not null,
  logged_by     int not null references users(id),
  is_demo       boolean not null default false
);

-- [A4] Theoretical vs actual: the whole point of Phase 2.
--
-- The original computed theoretical only and never joined actual issues, so it
-- could not produce a variance. Actual intake is the positive leg of an issue
-- (the store's negative leg carries the same doc_id in the store section).
create view usage_variance as
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
  where l.doc = 'issue' and l.qty_base > 0
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

-- ---------------------------------------------------------------------------
-- 5. Cleaning module (Phase 1 scope, absent from the original)  [A7]
-- ---------------------------------------------------------------------------

create table cleaning_areas (
  id            serial primary key,
  location_id   int not null references locations(id),
  code          text not null,
  name          text not null,
  is_active     boolean not null default true,
  is_demo       boolean not null default false,
  unique (location_id, code)
);

create type cleaning_frequency as enum ('daily','weekly','monthly');

create table cleaning_tasks (
  id            serial primary key,
  area_id       int not null references cleaning_areas(id),
  name          text not null,
  frequency     cleaning_frequency not null default 'daily',
  is_active     boolean not null default true,
  is_demo       boolean not null default false
);

create table cleaning_log (
  id            bigserial primary key,
  location_id   int not null references locations(id),
  task_id       int not null references cleaning_tasks(id),
  business_date date not null,
  done_by       int not null references users(id),
  done_at       timestamptz not null default now(),
  photo_url     text,
  note          text,
  verified_by   int references users(id),
  is_demo       boolean not null default false,
  unique (task_id, business_date)
);

-- ---------------------------------------------------------------------------
-- 6. Operational support  [A7]
-- ---------------------------------------------------------------------------

-- Document POSTs are replayable without creating duplicates. The client sends
-- an Idempotency-Key; a repeat of the same key returns the stored response.
create table idempotency_keys (
  key           text primary key,
  endpoint      text not null,
  request_hash  text not null,
  response      jsonb,
  status_code   int,
  user_id       int references users(id),
  created_at    timestamptz not null default now()
);

create index on idempotency_keys (created_at);

-- Issue windows (06:00/11:00/17:00) and other per-location process rules.
-- These warn, they do not block -- a process rule the software enforces by
-- nudging, per the build notes.
create table settings (
  location_id   int not null references locations(id),
  key           text not null,
  value         jsonb not null,
  updated_at    timestamptz not null default now(),
  primary key (location_id, key)
);

-- ---------------------------------------------------------------------------
-- 7. Audit
-- ---------------------------------------------------------------------------

create table audit_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  user_id       int references users(id),
  action        text not null,
  entity        text not null,
  entity_id     text,
  before        jsonb,
  after         jsonb
);

create index on audit_log (entity, entity_id);
create index on audit_log (at);

-- ---------------------------------------------------------------------------
-- 8. Foreign-key indexes  [A9]
-- Postgres does not create these automatically; without them every cascade
-- check and most joins in the reports go to a sequential scan.
-- ---------------------------------------------------------------------------

create index on sections (location_id);
create index on users (location_id);
create index on items (category_id);
create index on item_packs (item_id);
create index on supplier_prices (supplier_id);
create index on supplier_prices (item_pack_id);
create index on supplier_prices (item_pack_id, effective_from);
create index on grn (location_id);
create index on grn (supplier_id);
create index on grn_lines (grn_id);
create index on grn_lines (item_pack_id);
create index on market_purchase (location_id);
create index on market_purchase (supplier_id);
create index on market_purchase_lines (market_id);
create index on market_purchase_lines (item_id);
create index on issues (location_id);
create index on issues (to_section_id);
create index on issue_lines (issue_id);
create index on issue_lines (item_id);
create index on wastage (location_id);
create index on wastage (section_id);
create index on wastage (item_id);
create index on wastage (reason_code);
create index on transfers (from_section_id);
create index on transfers (to_section_id);
create index on transfers (item_id);
create index on stock_counts (location_id);
create index on stock_counts (section_id);
create index on stock_counts (business_date);
create index on stock_count_lines (count_id);
create index on stock_count_lines (item_id);
create index on products (location_id);
create index on products (section_id);
create index on recipe_lines (product_id);
create index on recipe_lines (item_id);
create index on production_log (location_id);
create index on production_log (product_id);
create index on production_log (business_date);
create index on cleaning_areas (location_id);
create index on cleaning_tasks (area_id);
create index on cleaning_log (location_id);
create index on cleaning_log (task_id);
create index on cleaning_log (business_date);

commit;
