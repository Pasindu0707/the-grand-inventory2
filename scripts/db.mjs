/** Shared connection helper for the db:* scripts. */
import pg from 'pg';

export const DATABASE_URL =
    process.env['DATABASE_URL'] ?? 'postgres://grand:grand_dev@localhost:5433/thegrand';

export async function connect() {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    try {
        await client.connect();
    } catch (err) {
        console.error(`\nCannot reach Postgres at ${redact(DATABASE_URL)}`);
        console.error(`  ${err.message}\n`);
        console.error('Start the local database with:  docker compose up -d');
        console.error('Or point elsewhere with:        $env:DATABASE_URL = "postgres://..."\n');
        process.exit(1);
    }
    return client;
}

export function redact(url) {
    return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}
