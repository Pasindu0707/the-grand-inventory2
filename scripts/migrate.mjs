/**
 * Applies db/migrations/*.sql in filename order, once each.
 *
 * Each migration file manages its own transaction (0001_init.sql opens with
 * `begin;`), so the runner does not wrap them -- it only records what ran.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, DATABASE_URL, redact } from './db.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

const client = await connect();
console.log(`→ ${redact(DATABASE_URL)}`);

await client.query(`
  create table if not exists schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
  )`);

const applied = new Set(
    (await client.query('select filename from schema_migrations')).rows.map((r) => r.filename)
);

const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

let ran = 0;
for (const file of files) {
    if (applied.has(file)) {
        console.log(`  skip  ${file}`);
        continue;
    }
    process.stdout.write(`  apply ${file} ... `);
    try {
        await client.query(readFileSync(join(DIR, file), 'utf8'));
        await client.query('insert into schema_migrations (filename) values ($1)', [file]);
        console.log('ok');
        ran++;
    } catch (err) {
        console.log('FAILED');
        console.error(`\n${err.message}\n`);
        await client.end();
        process.exit(1);
    }
}

console.log(ran ? `\n${ran} migration(s) applied.` : '\nAlready up to date.');
await client.end();
