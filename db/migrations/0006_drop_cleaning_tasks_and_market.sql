-- Two features come out: the cleaning checklist, and the cash market purchase.
--
-- Both were built. Both are being removed because the business does not work
-- the way they assumed.
--
-- ---------------------------------------------------------------------------
-- 1. The cleaning checklist
--
-- Areas, tasks and a daily log of who ticked what. The Grand does not run
-- cleaning off a system, and a checklist nobody fills in is worse than no
-- checklist: the Today screen shows a permanently red panel and people learn
-- to read past it, which costs them the panels that do mean something.
--
-- What is NOT removed: the `cleaning` role, the CLEAN section kind, and the
-- cleaning store's stock. Cleaning staff still sign in, still ask the store
-- for detergent, and still hold it in a section of their own. That was never
-- the checklist -- it is ordinary stock movement that happens to be soap.
--
-- ---------------------------------------------------------------------------
-- 2. Cash market purchases
--
-- A receipt with no invoice, evidenced by a photograph of the slip. Every
-- purchase at The Grand goes through a supplier who invoices, so the document
-- had no occasion to exist -- and a second, looser way to put stock into the
-- ledger is a second thing to reconcile and a second place for a price to
-- come from.
--
-- `suppliers.is_cash_market` goes with it. It existed only to tell the market
-- screen which suppliers to offer; with that screen gone it is a tick box on
-- the supplier form that changes nothing, which is a question every new admin
-- asks exactly once and gets no useful answer to.
--
-- ---------------------------------------------------------------------------
-- What is deliberately left alone: the doc_type enum
--
-- 'market' stays a member of doc_type. Removing a value from a Postgres enum
-- means recreating the type and rewriting every column that uses it, and one
-- of those columns is stock_ledger.doc -- the append-only table. Any system
-- that ever recorded a cash purchase still has those rows and always will;
-- they cannot be deleted, which is the entire point of the ledger. An enum
-- value with no writer left is harmless. A history that no longer parses is
-- not.
--
-- The service that wrote those rows is gone, so nothing can produce a new one.

begin;

-- ---------------------------------------------------------------------------
-- Cleaning checklist
-- ---------------------------------------------------------------------------

-- Ordered by dependency: the log points at a task, the task at an area.
drop table if exists cleaning_log;
drop table if exists cleaning_tasks;
drop table if exists cleaning_areas;

-- Used by cleaning_tasks.frequency and nothing else.
drop type if exists cleaning_frequency;

-- ---------------------------------------------------------------------------
-- Market purchases
-- ---------------------------------------------------------------------------

drop table if exists market_purchase_lines;
drop table if exists market_purchase;

alter table suppliers drop column if exists is_cash_market;

commit;
