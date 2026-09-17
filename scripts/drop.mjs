/**
 * Drops and recreates the public schema. Development only -- it exists so
 * `db:reset-all` can rebuild from nothing.
 *
 * Refuses to run against anything that does not look like a local database,
 * because "drop schema public cascade" pointed at production is not a mistake
 * you get to make twice.
 */
import { connect, DATABASE_URL, redact } from './db.mjs';

const isLocal = /@(localhost|127\.0\.0\.1|db):/.test(DATABASE_URL);
if (!isLocal && process.env['I_KNOW_WHAT_I_AM_DOING'] !== 'yes') {
    console.error(`\nRefusing to drop a non-local database: ${redact(DATABASE_URL)}`);
    console.error('Set I_KNOW_WHAT_I_AM_DOING=yes to override.\n');
    process.exit(1);
}

const client = await connect();
await client.query('drop schema if exists public cascade');
await client.query('create schema public');
console.log(`dropped and recreated schema public on ${redact(DATABASE_URL)}`);
await client.end();
