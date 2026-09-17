-- Empty the system for a real start, keeping the branches.
--
-- Differs from db/reset.sql in two ways that matter:
--
--   1. It keeps `locations` and `sections`. A branch without its sections is
--      not a branch you can do anything with -- stock has to sit somewhere --
--      so the store, kitchen, bar and cleaning rooms stay as structure.
--   2. It deletes regardless of `is_demo`. reset.sql only removes demo rows,
--      which is right for a go-live cutover; this is for emptying a system
--      that has been used for trials and may hold a mix of both.
--
-- Kept on purpose, because they are lookups rather than business data:
--   item_categories   13 generic categories (Dry goods, Dairy, Bar spirits...)
--   reason_codes      wastage and count reasons the app depends on
--
-- Everything else goes: ledger, documents, items, packs, suppliers, prices,
-- recipes, products, counts, returns, and every user.
--
-- Run through scripts/wipe-and-admins.mjs, which also creates the logins that
-- the wipe takes with it. Running this file alone leaves a database nobody can
-- sign in to.

begin;

-- The ledger guard permits a delete only for is_demo rows and only while this
-- setting is on. Real rows still cannot be deleted, so a system that has taken
-- live GRNs is deliberately not wipeable by this script -- that is the whole
-- point of an append-only ledger, and the answer there is a fresh database.
set local grand.allow_demo_reset = 'on';

delete from stock_ledger;
delete from item_cost_state;

delete from stock_count_lines;
delete from stock_counts;
delete from opening_stock_lines;
delete from opening_stock;
delete from production_log;
delete from supplier_return_lines;
delete from supplier_returns;
delete from section_returns;
delete from wastage;
delete from issue_lines;
delete from grn_lines;
delete from grn;
-- A GRN points at the purchase order, the order at the request it came from,
-- so the trio unwinds in that order: GRN above, then order, then request.
delete from purchase_order_lines;
delete from purchase_orders;
delete from issues;
delete from transfers;
delete from recipe_lines;
delete from products;
delete from supplier_prices;
delete from item_packs;
delete from items;
delete from suppliers;

-- Per-branch settings (day start, issue windows) are branch configuration, not
-- data, so they stay with the branch.

-- Users last: audit rows, login lockouts and idempotency keys all point at them.
delete from audit_log;
delete from idempotency_keys;
delete from login_attempts;
delete from users;

-- The branches survived a wipe, so they are no longer demo scaffolding. This
-- also puts them out of reach of db/reset.sql, which deletes by is_demo -- a
-- later cutover run must not take the branches with it.
update locations set is_demo = false;
update sections  set is_demo = false;

commit;
