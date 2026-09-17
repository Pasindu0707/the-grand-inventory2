import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { config } from '../config.js';
import type { Database } from './types.js';

/**
 * node-postgres returns `numeric` as a string to avoid precision loss. Every
 * numeric in this schema is numeric(14,3) or numeric(14,4), so the scaled
 * integer tops out around 1e18... which is past 2^53. In practice the values
 * are stock quantities and Sri Lankan rupee amounts, nowhere near that, and
 * working with strings everywhere costs more than it buys.
 *
 * The rule that makes this safe: arithmetic on money and quantities happens in
 * Postgres, on `numeric`. JavaScript only ever carries values in and out.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => Number.parseFloat(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => v); // bigint stays a string

// `date` must not become a JS Date: business_date is a calendar day in the
// location's timezone, and Date would drag it through UTC and shift it.
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

export const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
});

export const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
});

export type DB = typeof db;
