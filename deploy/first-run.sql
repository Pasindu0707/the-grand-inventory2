-- First run only: the five branches.
--
--   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
--     exec -T db psql -U grand -d thegrand < deploy/first-run.sql
--
-- Why this file has to exist.
--
-- Migrations create the locations table but never populate it, and the only
-- rows that ever existed came from the demo seed. That leaves a real deadlock
-- on a fresh production database:
--
--   * POST /api/v1/auth/login requires a locationId
--   * a fresh database has no locations
--   * so nobody can log in -- including the admin whose job is to create the
--     branches through Setup
--
-- Everything else in the system can be built from the Setup screens once
-- someone is logged in: sections, items, suppliers, staff. Only this first
-- step needs to happen outside the app.
--
-- is_demo is false on purpose. Demo rows are what db/reset.sql deletes before
-- go-live, and the ledger guard treats them differently. These are real.
--
-- Edit the names to match the signage before running it. The codes are what
-- scripts/wipe-and-admins.mjs and the reports expect, so keep those.

insert into locations (code, name, day_start, is_active, is_demo) values
  ('GB',   'The Grand Gastrobar',       '06:00', true, false),
  ('ESP',  'Grand Espresso Bar',        '06:00', true, false),
  -- The Coffee Lounge runs 04:00 to 04:00: it is a 24-hour site, so "today"
  -- there does not end when it does everywhere else.
  ('TCL',  'The Grand Coffee Lounge',   '04:00', true, false),
  ('KAT',  'The Grand Cafe Katuneriya', '06:00', true, false),
  ('BANQ', 'Banquet hall',              '06:00', true, false)
on conflict (code) do nothing;

select id, code, name, day_start from locations order by id;
