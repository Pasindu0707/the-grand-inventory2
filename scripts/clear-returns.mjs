/**
 * Empty the returns half of the system so the flow can be walked from zero.
 *
 * Removes section returns, supplier returns, anything binned under a disposal
 * decision, and every ledger row those produced -- then puts the quarantine
 * shelf back to nothing.
 *
 *   node scripts/clear-returns.mjs             # says what it would remove
 *   node scripts/clear-returns.mjs --confirm   # removes it
 *
 * **It can only ever remove demo rows, by construction.** The delete runs
 * inside `set local grand.allow_demo_reset = 'on'`, and ledger_guard() lets
 * that GUC through for `is_demo` rows only -- a real row raises, the
 * transaction rolls back, and nothing is lost. That is the whole point of the
 * append-only ledger and this script does not get an exemption from it.
 *
 * So if you have been testing by hand, your own returns are real rows and will
 * still be here afterwards. The script says so and tells you the only thing
 * that clears them, which is rebuilding the database:
 *
 *   npm run db:reset-all
 *
 * Deleting ledger rows moves stock, so `item_cost_state.qty_on_hand` -- which
 * is maintained incrementally as documents are posted -- is recomputed from the
 * ledger afterwards for every item touched. Without that the balance the
 * weighted-average cost is calculated against would drift away from the
 * movements behind it, which is the one thing this schema is built to prevent.
 */
import { connect } from './db.mjs';

const confirm = process.argv.includes('--confirm');

/** The documents that make up a return, in the order the foreign keys allow. */
const COUNTS = [
    ['supplier_return_lines', 'select count(*)::int n from supplier_return_lines'],
    ['supplier_returns', 'select count(*)::int n from supplier_returns'],
    ['section_returns', 'select count(*)::int n from section_returns'],
    [
        'wastage from a bin decision',
        "select count(*)::int n from wastage where reason_code = 'BADGOODS'"
    ],
    ['ledger rows (return)', "select count(*)::int n from stock_ledger where doc = 'return'"],
    [
        'ledger rows (binned)',
        "select count(*)::int n from stock_ledger where doc = 'wastage' and reason_code = 'BADGOODS'"
    ]
];

const db = await connect();
try {
    console.log('The Grand - clear the returns\n' + '='.repeat(52));

    // What is there, split by whether the ledger will let it go.
    const { rows: split } = await db.query(`
        select
          (select count(*)::int from section_returns where is_demo)      as demo_section,
          (select count(*)::int from section_returns where not is_demo)  as real_section,
          (select count(*)::int from supplier_returns where is_demo)     as demo_supplier,
          (select count(*)::int from supplier_returns where not is_demo) as real_supplier
    `);
    const s = split[0];

    console.log('\nOn the books now:');
    for (const [label, sql] of COUNTS) {
        const { rows } = await db.query(sql);
        console.log(`  ${String(rows[0].n).padStart(6)}  ${label}`);
    }

    console.log(
        `\n  demo   ${s.demo_section} section return(s), ${s.demo_supplier} supplier return(s)  <- removable` +
            `\n  real   ${s.real_section} section return(s), ${s.real_supplier} supplier return(s)  <- the ledger will not release these`
    );

    if (s.real_section > 0 || s.real_supplier > 0) {
        console.log(
            '\n  Real rows are permanent. That is the point of the ledger, not a\n' +
                '  limitation of this script. To get a genuinely empty system:\n' +
                '\n      npm run db:reset-all\n' +
                '\n  which drops the schema and rebuilds it with fresh demo data.'
        );
    }

    if (!confirm) {
        console.log('\nNothing removed. Run again with --confirm to do it.');
    } else {
    await db.query('begin');
    try {
        await db.query("set local grand.allow_demo_reset = 'on'");

        // Which items are about to move, so the cost state can be put right.
        const { rows: touched } = await db.query(`
            select distinct item_id, location_id
            from stock_ledger
            where is_demo
              and (doc = 'return' or (doc = 'wastage' and reason_code = 'BADGOODS'))
        `);

        await db.query(`
            delete from stock_ledger
            where is_demo
              and (doc = 'return' or (doc = 'wastage' and reason_code = 'BADGOODS'))
        `);
        await db.query('delete from supplier_return_lines where is_demo');
        await db.query('delete from supplier_returns where is_demo');
        await db.query('delete from section_returns where is_demo');
        await db.query("delete from wastage where is_demo and reason_code = 'BADGOODS'");

        // Stock moved, so the balance the moving average is weighted against
        // has to be recomputed from what the ledger now says.
        for (const t of touched) {
            await db.query(
                `update item_cost_state
                    set qty_on_hand = coalesce((
                          select sum(qty_base) from stock_ledger
                          where item_id = $1 and location_id = $2
                        ), 0),
                        updated_at = now()
                  where item_id = $1 and location_id = $2`,
                [t.item_id, t.location_id]
            );
        }

        await db.query('commit');
        console.log(`\nRemoved. ${touched.length} item balance(s) recomputed from the ledger.`);
    } catch (err) {
        await db.query('rollback');
        console.error(`\nNothing was removed: ${err.message}`);
        console.error('The ledger refused it, and the whole transaction rolled back.');
        process.exit(1);
    }

    const { rows: after } = await db.query(`
        select coalesce(sum(cs.qty_base), 0)::float as qty
        from current_stock cs
        join sections s on s.id = cs.section_id
        where s.kind = 'QUARANTINE'
    `);
    console.log(`Quarantine now holds ${after[0].qty} across all branches.`);
    }
} finally {
    await db.end();
}
