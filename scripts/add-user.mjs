/**
 * Add or update a person.
 *
 * There is no user-management screen yet (see HANDBOOK.md, "Known gaps"), and
 * hand-writing a bcrypt hash into psql is how people end up with an account
 * nobody can log into. This does it properly.
 *
 *   node scripts/add-user.mjs --name "Kamal Perera" --role kitchen --pin 4821
 *   node scripts/add-user.mjs --name "Nuwan" --role management --pin 9137 --group
 *   node scripts/add-user.mjs --name "Sunil Fernando" --pin 5566   (reset a PIN)
 *   node scripts/add-user.mjs --list
 *   node scripts/add-user.mjs --name "Old Staff" --deactivate
 *
 * Roles: admin management storekeeper kitchen cleaning
 */
import bcrypt from 'bcryptjs';
import { connect, redact, DATABASE_URL } from './db.mjs';

// The five roles from migration 0003. The eight-role list that used to be
// here was left behind by that migration, so every --role this script would
// accept was one the database had already dropped: `--role admin` -- the one
// step the go-live runbook needs a terminal for -- was refused outright.
const ROLES = ['admin', 'management', 'storekeeper', 'kitchen', 'cleaning'];

function arg(flag) {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
}
const has = (flag) => process.argv.includes(flag);

const client = await connect();
console.log(`→ ${redact(DATABASE_URL)}\n`);

try {
    if (has('--list')) {
        const { rows } = await client.query(`
            select u.id, u.name, u.role, u.is_active, u.is_demo,
                   coalesce(l.code, 'ALL') as location
            from users u
            left join locations l on l.id = u.location_id
            order by u.is_active desc, u.role, u.name`);

        console.log('  id  name                  role          outlet  active  demo');
        console.log('  ' + '-'.repeat(64));
        for (const r of rows) {
            console.log(
                `  ${String(r.id).padStart(2)}  ${r.name.padEnd(20).slice(0, 20)}  ` +
                    `${r.role.padEnd(12)}  ${String(r.location).padEnd(6)}  ` +
                    `${r.is_active ? ' yes  ' : ' NO   '}  ${r.is_demo ? 'yes' : 'no'}`
            );
        }
        console.log(`\n  ${rows.length} user(s).\n`);
        process.exit(0);
    }

    const name = arg('--name');
    if (!name) {
        console.error('Missing --name. Run with --list to see who exists.\n');
        process.exit(1);
    }

    const existing = await client.query('select * from users where name = $1', [name]);

    if (has('--deactivate')) {
        if (existing.rowCount === 0) {
            console.error(`No user called "${name}".\n`);
            process.exit(1);
        }
        await client.query('update users set is_active = false where name = $1', [name]);
        // Deactivating rather than deleting: their name is on every document
        // they ever created, and the ledger does not forget.
        console.log(`  "${name}" deactivated. Their history is untouched.\n`);
        process.exit(0);
    }

    const pin = arg('--pin');
    if (!pin || !/^\d{4,6}$/.test(pin)) {
        console.error('Missing or invalid --pin. Four to six digits.\n');
        process.exit(1);
    }

    // Real salt, unlike the fixed one the demo generator uses for determinism.
    const pinHash = await bcrypt.hash(pin, 10);

    if (existing.rowCount > 0) {
        const role = arg('--role');
        if (role && !ROLES.includes(role)) {
            console.error(`Unknown role "${role}". One of: ${ROLES.join(', ')}\n`);
            process.exit(1);
        }
        await client.query(
            `update users
               set pin_hash = $2,
                   role = coalesce($3, role),
                   is_active = true
             where name = $1`,
            [name, pinHash, role ?? null]
        );
        // Any lockout from failed attempts is cleared with the new PIN.
        await client.query('delete from login_attempts where user_id = $1', [
            existing.rows[0].id
        ]);
        console.log(`  Updated "${name}". New PIN set, account active.\n`);
        process.exit(0);
    }

    const role = arg('--role');
    if (!role || !ROLES.includes(role)) {
        console.error(`Missing or unknown --role. One of: ${ROLES.join(', ')}\n`);
        process.exit(1);
    }

    // Group-wide users (management, admin) have no home location and can act
    // at any branch.
    let locationId = null;
    if (!has('--group')) {
        const code = arg('--outlet') ?? 'GB';
        const loc = await client.query('select id, name from locations where code = $1', [code]);
        if (loc.rowCount === 0) {
            const all = await client.query('select code from locations order by id');
            console.error(
                `No outlet "${code}". Available: ${all.rows.map((r) => r.code).join(', ')}\n`
            );
            process.exit(1);
        }
        locationId = loc.rows[0].id;
    }

    const inserted = await client.query(
        `insert into users (location_id, name, phone, role, pin_hash, is_active, is_demo)
         values ($1, $2, $3, $4, $5, true, false)
         returning id`,
        [locationId, name, arg('--phone') ?? null, role, pinHash]
    );

    console.log(
        `  Added "${name}" (id ${inserted.rows[0].id}) as ${role}` +
            `${locationId ? '' : ', group-wide'}.`
    );
    console.log('  They appear on the login screen immediately.\n');
} finally {
    await client.end();
}
