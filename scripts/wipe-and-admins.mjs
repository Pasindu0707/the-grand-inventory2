/**
 * Empty the system, keep the branches, and leave one admin login at each.
 *
 *   node scripts/wipe-and-admins.mjs            preview: says what it will do
 *   node scripts/wipe-and-admins.mjs --confirm  actually does it
 *
 * The wipe takes every user with it, including the one who would have created
 * the next one, so the two halves belong in the same script: a database with
 * branches and no logins is a database nobody can get into.
 *
 * PINs are printed. On a shared store-room tablet a four-digit PIN is
 * identification rather than a secret (HANDBOOK.md, "Choosing a PIN"), but
 * these are still the keys to the whole system -- change them once the real
 * people are in.
 */
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { connect, redact, DATABASE_URL } from './db.mjs';

/** One admin per branch. Deliberately not 1234, which the handbook warns off. */
const DEFAULT_PINS = { GB: '1001', ESP: '2002', TCL: '3003', KAT: '4004', BANQ: '5005' };

const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
};
const has = (flag) => process.argv.includes(flag);

const randomPin = () => String(Math.floor(Math.random() * 9000) + 1000);

const client = await connect();
console.log(`\n→ ${redact(DATABASE_URL)}\n`);

try {
    const { rows: branches } = await client.query(
        'select id, code, name from locations where is_active order by id'
    );
    if (branches.length === 0) {
        console.error('No branches. Nothing to keep -- run npm run db:migrate first.\n');
        process.exit(1);
    }

    const counts = await client.query(`
        select (select count(*) from stock_ledger) as ledger,
               (select count(*) from items)        as items,
               (select count(*) from suppliers)    as suppliers,
               (select count(*) from users)        as users,
               (select count(*) from sections)     as sections`);
    const c = counts.rows[0];

    console.log('  Will DELETE');
    console.log(`    ${String(c.ledger).padStart(6)}  ledger rows`);
    console.log(`    ${String(c.items).padStart(6)}  items (and their packs, prices, recipes)`);
    console.log(`    ${String(c.suppliers).padStart(6)}  suppliers`);
    console.log(`    ${String(c.users).padStart(6)}  users`);
    console.log('            every GRN, purchase order, issue, count and wastage\n');
    console.log('  Will KEEP');
    console.log(`    ${String(branches.length).padStart(6)}  branches`);
    console.log(`    ${String(c.sections).padStart(6)}  sections`);
    console.log('            item categories and wastage reason codes\n');

    if (!has('--confirm')) {
        console.log('  Nothing done. Re-run with --confirm to go ahead.\n');
        process.exit(0);
    }

    const sql = await readFile(new URL('../db/wipe-keep-branches.sql', import.meta.url), 'utf8');
    await client.query(sql);
    console.log('  Wiped.\n');

    const fixedPin = arg('--pin');
    const created = [];

    for (const b of branches) {
        const pin = fixedPin ?? (has('--random') ? randomPin() : DEFAULT_PINS[b.code] ?? randomPin());
        const { rows } = await client.query(
            `insert into users (location_id, name, role, pin_hash, is_active, is_demo)
             values ($1, $2, 'admin', $3, true, false)
             returning id`,
            [b.id, `Admin ${b.code}`, await bcrypt.hash(pin, 10)]
        );
        created.push({ id: rows[0].id, branch: b.code, name: `Admin ${b.code}`, pin, at: b.name });
    }

    console.log('  Admin logins - one per branch\n');
    console.log('    branch  name       PIN   sign in at');
    console.log('    ' + '-'.repeat(58));
    for (const u of created) {
        console.log(
            `    ${u.branch.padEnd(6)}  ${u.name.padEnd(9)}  ${u.pin}  ${u.at}`
        );
    }

    const ledger = await client.query('select count(*) from stock_ledger');
    console.log(`\n  stock_ledger is now ${ledger.rows[0].count} rows.`);
    console.log('  Sign in at http://localhost:4200 and start with Setup.\n');
} finally {
    await client.end();
}
