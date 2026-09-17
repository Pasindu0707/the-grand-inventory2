/** Runs one .sql file against DATABASE_URL. Usage: node scripts/run-sql.mjs <file> */
import { readFileSync } from 'node:fs';
import { connect } from './db.mjs';

const file = process.argv[2];
if (!file) {
    console.error('usage: node scripts/run-sql.mjs <file.sql>');
    process.exit(1);
}

const client = await connect();
const started = Date.now();
try {
    await client.query(readFileSync(file, 'utf8'));
    console.log(`${file} ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
} catch (err) {
    console.error(`${file} FAILED\n\n${err.message}\n`);
    process.exitCode = 1;
} finally {
    await client.end();
}
