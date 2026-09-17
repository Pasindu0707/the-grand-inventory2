-- Five roles, five branches, and the request workflow.
--
-- The eight-role model came from the schema draft and was too fine-grained for
-- the people who actually use this: a chef, a baker and a bar hand all do the
-- same thing here, which is ask the store for stock. Collapsing to five roles
-- that match how the business is actually organised removes a category of
-- "which one am I?" confusion that no amount of UI polish would fix.
--
--   admin        creates logins, nothing else
--   management   approves, decides purchases, sees everything
--   storekeeper  holds the store, releases stock
--   kitchen      asks for stock, confirms it arrived
--   cleaning     same, for cleaning supplies

begin;

-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------

-- A new type rather than ALTER TYPE ... ADD VALUE: adding an enum value and
-- using it in the same transaction is not allowed, and this way the old values
-- cannot linger on a row nobody remembers to migrate.
create type app_role as enum ('admin', 'management', 'storekeeper', 'kitchen', 'cleaning');

alter table users add column new_role app_role;

update users set new_role = (case role
    when 'owner'       then 'management'
    when 'manager'     then 'management'
    when 'purchasing'  then 'management'
    when 'storekeeper' then 'storekeeper'
    when 'cleaning'    then 'cleaning'
    -- chef, bar and baker all become kitchen: same job as far as this
    -- system is concerned.
    else 'kitchen'
end)::app_role;

alter table users alter column new_role set not null;
alter table users drop column role;
alter table users rename column new_role to role;
drop type user_role;

create index on users (role);

-- The update above is a no-op on a fresh database and does the real work on an
-- existing one. Branch and section *data* deliberately lives in the seed, not
-- here: a migration runs before any location exists, so anything selecting from
-- `locations` at this point would silently insert nothing. That mistake has
-- already been made once in this project.

-- ---------------------------------------------------------------------------
-- 2. The request workflow
--
-- Four steps, because that is what actually happens in the building:
--   requested  the kitchen asks, and says when they need it by
--   released   management or the storekeeper approves and hands it over
--   received   the kitchen confirms it arrived
--   cancelled  it was not needed after all
--
-- Stock moves at RELEASE, not at receipt: that is the moment it physically
-- leaves the store. Confirmation is an acknowledgement, so an unconfirmed
-- release still shows in the section's stock -- which is right, because it is
-- physically sitting there.
-- ---------------------------------------------------------------------------

alter table issues
    add column needed_by    date,
    add column note         text,
    add column approved_by  int references users(id),
    add column approved_at  timestamptz,
    add column received_by  int references users(id),
    add column received_at  timestamptz;

create index on issues (status, location_id);
create index on issues (needed_by);

-- ---------------------------------------------------------------------------
-- 3. Purchase orders
--
-- Raised when the store cannot cover a request. Every one goes to management:
-- they are the only people who decide that money gets spent.
-- ---------------------------------------------------------------------------

create type po_status as enum ('requested', 'approved', 'rejected', 'ordered', 'done');

create table purchase_orders (
    id            bigserial primary key,
    location_id   int not null references locations(id),
    -- Set when the PO came out of a request the store could not fill, so the
    -- two can be read together later.
    issue_id      bigint references issues(id),
    raised_by     int not null references users(id),
    raised_at     timestamptz not null default now(),
    needed_by     date,
    reason        text,
    status        po_status not null default 'requested',
    decided_by    int references users(id),
    decided_at    timestamptz,
    decision_note text,
    is_demo       boolean not null default false
);

create table purchase_order_lines (
    id            bigserial primary key,
    po_id         bigint not null references purchase_orders(id) on delete cascade,
    item_id       int not null references items(id),
    qty_base      numeric(14,3) not null,
    -- What the store had at the time, so management can see how short it was.
    qty_in_store  numeric(14,3) not null default 0,
    est_price     numeric(14,2),
    is_demo       boolean not null default false
);

create index on purchase_orders (location_id, status);
create index on purchase_orders (raised_by);
create index on purchase_order_lines (po_id);
create index on purchase_order_lines (item_id);

commit;
