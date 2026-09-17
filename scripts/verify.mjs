/**
 * Phase A exit criterion.
 *
 * Proves the four things that cannot be checked by reading the schema:
 *   1. the ledger is genuinely append-only (update / delete / truncate all raise)
 *   2. reset.sql actually empties the demo ledger -- the original silently did not
 *   3. a real (is_demo = false) row survives reset even with the escape GUC set
 *   4. schema -> seed -> reset -> re-seed runs clean twice in a row
 *
 *   npm run db:verify
 */
import { execSync } from 'node:child_process';
import { connect } from './db.mjs';

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m, d) => {
    failures++;
    console.log(`  ✗ ${m}${d ? `\n      ${d}` : ''}`);
};

const one = async (c, sql, args) => (await c.query(sql, args)).rows[0];

/** Asserts a statement raises. Wrapped in a savepoint so the session survives. */
async function mustRaise(c, label, sql) {
    await c.query('savepoint probe');
    try {
        await c.query(sql);
        await c.query('rollback to savepoint probe');
        fail(`${label} -- statement was ALLOWED`);
    } catch (err) {
        await c.query('rollback to savepoint probe');
        pass(`${label} -- blocked: ${err.message.split('\n')[0]}`);
    }
}

const run = (cmd) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });

/** execSync puts the useful part on stderr, which is easy to lose. */
const detail = (err) =>
    [err.stderr, err.stdout, err.message]
        .filter(Boolean)
        .join('\n')
        .split('\n')
        .filter((l) => l.trim())
        .slice(-6)
        .join('\n      ');

// ── Build from nothing ──────────────────────────────────────────────────────
console.log('\nBuilding schema and demo data from scratch...');
run('npm run db:drop');
run('npm run db:migrate');
run('npm run db:generate');
run('npm run db:seed');

let c = await connect();

// ── Seed sanity ─────────────────────────────────────────────────────────────
console.log('\nSeed data');
const led = await one(c, 'select count(*)::int n from stock_ledger');
led.n > 10000 ? pass(`ledger has ${led.n} rows`) : fail(`ledger has only ${led.n} rows`);

const sp = await one(c, 'select count(*)::int n from supplier_prices');
sp.n > 0 ? pass(`supplier_prices seeded (${sp.n} price points) [A5]`) : fail('supplier_prices is empty [A5]');

const ics = await one(c, 'select count(*)::int n from item_cost_state where avg_cost > 0');
ics.n > 0 ? pass(`item_cost_state populated (${ics.n} items) [A3]`) : fail('item_cost_state is empty [A3]');

const pin = await one(c, "select pin_hash from users where is_demo limit 1");
/^\$2[aby]\$\d{2}\$/.test(pin.pin_hash)
    ? pass('user PINs are real bcrypt hashes [A6]')
    : fail(`pin_hash is not bcrypt: ${pin.pin_hash} [A6]`);

// ── A8 / A4: the rewritten views ────────────────────────────────────────────
console.log('\nViews');
const cs = await one(
    c,
    'select count(*)::int n, count(distinct location_id)::int locs from current_stock'
);
cs.n > 0 && cs.locs > 0
    ? pass(`current_stock returns ${cs.n} rows and is scoped by location [A8]`)
    : fail('current_stock is empty or unscoped [A8]');

const val = await one(
    c,
    'select round(sum(value))::bigint v from current_stock_valued where qty_base > 0'
);
Number(val.v) > 0
    ? pass(`current_stock_valued totals Rs ${Number(val.v).toLocaleString('en-LK')} [A3/A8]`)
    : fail('current_stock_valued is zero -- avg_cost is not wired up [A3/A8]');

const uv = await one(c, `
  select count(*)::int n,
         count(*) filter (where theoretical_qty > 0 and actual_qty > 0)::int both,
         count(*) filter (where variance_pct is not null)::int pct
  from usage_variance`);
uv.n > 0 && uv.both > 0 && uv.pct > 0
    ? pass(`usage_variance returns ${uv.n} rows, ${uv.both} with both sides, ${uv.pct} with a % [A4]`)
    : fail(`usage_variance is not producing a comparison (n=${uv.n}, both=${uv.both}, pct=${uv.pct}) [A4]`);

// ── A2: sequences advanced past the seeded ids ──────────────────────────────
console.log('\nSequences [A2]');
// Read the sequence relations directly. pg_sequences.last_value is NULL
// whenever is_called is false -- which is precisely the state setval(seq, n,
// false) leaves behind -- so that view cannot answer this question.
const seqs = await c.query(`
  select tab.relname as tabname, seq.relname as seqname
  from pg_class seq
  join pg_depend d on d.objid = seq.oid
    and d.classid = 'pg_class'::regclass and d.deptype = 'a'
  join pg_class tab on tab.oid = d.refobjid
  join pg_namespace n on n.oid = seq.relnamespace
  where seq.relkind = 'S' and n.nspname = current_schema()
  order by tab.relname`);

const stale = [];
for (const r of seqs.rows) {
    const max = await one(c, `select coalesce(max(id),0)::bigint m from ${r.tabname}`);
    const st = await one(c, `select last_value, is_called from ${r.seqname}`);
    const next = st.is_called ? Number(st.last_value) + 1 : Number(st.last_value);
    if (Number(max.m) > 0 && next <= Number(max.m)) {
        stale.push(`${r.tabname} (next=${next}, max id=${max.m})`);
    }
}
stale.length === 0
    ? pass(`all ${seqs.rows.length} sequences advanced past seeded ids`)
    : fail(`${stale.length} sequence(s) would collide on first real insert`, stale.join('\n      '));

// ── A1: append-only really is append-only ───────────────────────────────────
console.log('\nLedger immutability [A1]');
await c.query('begin');
await mustRaise(c, 'UPDATE a ledger row', 'update stock_ledger set note = $$tamper$$ where id = (select min(id) from stock_ledger)');
await mustRaise(c, 'DELETE a demo row without the GUC', 'delete from stock_ledger where id = (select min(id) from stock_ledger)');
await mustRaise(c, 'TRUNCATE the ledger', 'truncate stock_ledger cascade');

// A real row must survive even when the demo-reset escape is open.
await c.query(`set local grand.allow_demo_reset = 'on'`);
await c.query(`
  insert into stock_ledger
    (business_date, location_id, section_id, item_id, qty_base, unit_cost,
     doc, doc_id, created_by, is_demo)
  select '2026-08-10', 1, 1, min(item_id), 1, 1, 'opening', 999999, 1, false
  from stock_ledger`);
await mustRaise(
    c,
    'DELETE a REAL row while the demo-reset GUC is open',
    'delete from stock_ledger where not is_demo'
);
await c.query('rollback');

// ── A1: reset.sql actually works ────────────────────────────────────────────
console.log('\nCutover [A1]');
await c.end();
try {
    run('npm run db:reset');
    c = await connect();
    const after = await one(c, 'select count(*)::int n from stock_ledger');
    after.n === 0
        ? pass('reset.sql emptied the demo ledger')
        : fail(`reset.sql left ${after.n} rows behind -- this is the original bug`);

    const items = await one(c, 'select count(*)::int n from items');
    items.n === 0 ? pass('demo master data removed') : fail(`${items.n} demo items remain`);
} catch (err) {
    c = await connect();
    fail('reset.sql failed to run', detail(err));
}

// ── Re-seed on top of a reset database ──────────────────────────────────────
console.log('\nRe-seed after reset');
await c.end();
try {
    run('npm run db:seed');
    c = await connect();
    const again = await one(c, 'select count(*)::int n from stock_ledger');
    again.n > 10000
        ? pass(`re-seeded cleanly (${again.n} rows) -- cycle is repeatable`)
        : fail(`re-seed produced only ${again.n} rows`);
} catch (err) {
    c = await connect();
    fail('re-seed failed', detail(err));
}

await c.end();

console.log(
    failures === 0
        ? '\nPhase A verified - all checks passed.\n'
        : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
