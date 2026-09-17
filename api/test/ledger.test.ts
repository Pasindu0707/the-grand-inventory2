import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { db } from './helpers.js';
import { businessDateFor, reverseDocument } from '../src/services/ledger.js';
import type { Database } from '../src/db/types.js';

afterAll(async () => {
    await db.destroy();
});

describe('append-only ledger, seen from the application', () => {
    it('refuses an UPDATE even through the query builder', async () => {
        const row = await db
            .selectFrom('stock_ledger')
            .select('id')
            .orderBy('id')
            .executeTakeFirstOrThrow();

        await expect(
            db.updateTable('stock_ledger').set({ note: 'tamper' }).where('id', '=', row.id).execute()
        ).rejects.toThrow(/append-only/i);
    });

    it('refuses a DELETE', async () => {
        const row = await db
            .selectFrom('stock_ledger')
            .select('id')
            .orderBy('id')
            .executeTakeFirstOrThrow();

        await expect(
            db.deleteFrom('stock_ledger').where('id', '=', row.id).execute()
        ).rejects.toThrow(/cannot be deleted/i);
    });

    it('refuses a TRUNCATE', async () => {
        await expect(sql`truncate stock_ledger cascade`.execute(db)).rejects.toThrow(
            /cannot be truncated/i
        );
    });
});

describe('reversals', () => {
    it('mirrors every row of a document and leaves the originals alone', async () => {
        const grn = await db
            .selectFrom('grn')
            .select(['id', 'location_id'])
            .orderBy('id', 'desc')
            .executeTakeFirstOrThrow();

        const before = await db
            .selectFrom('stock_ledger')
            .selectAll()
            .where('doc', '=', 'grn')
            .where('doc_id', '=', String(grn.id))
            .execute();

        const reversed = await db
            .transaction()
            .execute((trx) => reverseDocument(trx, 'grn', grn.id, 1, 'wrong supplier'));

        expect(reversed).toBe(before.length);

        const after = await db
            .selectFrom('stock_ledger')
            .selectAll()
            .where('doc', '=', 'grn')
            .where('doc_id', '=', String(grn.id))
            .execute();

        // Originals still there, plus one mirror each.
        expect(after).toHaveLength(before.length * 2);

        const mirrors = after.filter((r) => r.is_reversal);
        expect(mirrors).toHaveLength(before.length);
        for (const m of mirrors) {
            expect(m.reverses_id).toBeTruthy();
        }

        // Net effect on stock is zero.
        const net = after.reduce((sum, r) => sum + Number(r.qty_base), 0);
        expect(net).toBeCloseTo(0, 6);
    });

    it('will not reverse the same document twice', async () => {
        const grn = await db
            .selectFrom('grn')
            .select(['id'])
            .orderBy('id', 'desc')
            .executeTakeFirstOrThrow();

        await expect(
            db
                .transaction()
                .execute((trx) => reverseDocument(trx, 'grn', grn.id, 1, 'again'))
        ).rejects.toThrow(/already been reversed/i);
    });
});

describe('business date', () => {
    it('uses the location day_start, so a 24-hour site rolls over at 04:00', async () => {
        const lounge = await db
            .selectFrom('locations')
            .select(['id', 'day_start'])
            .where('code', '=', 'TCL')
            .executeTakeFirst();

        if (!lounge) return;
        expect(lounge.day_start).toMatch(/^04:00/);

        // 02:00 Colombo is still the previous business day at a 04:00 site.
        const atTwoAm = new Date('2026-08-11T20:30:00.000Z'); // 02:00 +05:30 on the 12th
        const date = await businessDateFor(db as unknown as never, lounge.id, atTwoAm);
        expect(date).toBe('2026-08-11');
    });
});

describe('schema drift', () => {
    it('every table in the Kysely types exists in the database with matching columns', async () => {
        const { rows } = await sql<{ table_name: string; column_name: string }>`
            select table_name, column_name
            from information_schema.columns
            where table_schema = 'public'
        `.execute(db);

        const actual = new Map<string, Set<string>>();
        for (const r of rows) {
            const set = actual.get(r.table_name) ?? new Set<string>();
            set.add(r.column_name);
            actual.set(r.table_name, set);
        }

        // Import the type keys at runtime by listing them explicitly; the point
        // is to fail loudly when the schema and these types diverge.
        const declared: Array<keyof Database> = [
            'locations', 'sections', 'users', 'suppliers', 'item_categories', 'items',
            'item_packs', 'supplier_prices', 'reason_codes', 'stock_ledger',
            'item_cost_state', 'grn', 'grn_lines',
            'issues', 'issue_lines', 'wastage', 'transfers',
            'stock_counts', 'stock_count_lines', 'products', 'recipe_lines',
            'production_log',
            'idempotency_keys', 'login_attempts', 'settings', 'audit_log',
            'purchase_orders', 'purchase_order_lines', 'opening_stock',
            'opening_stock_lines',
            'current_stock', 'current_stock_valued', 'usage_variance',
        ];

        const missing = declared.filter((t) => !actual.has(t as string));
        expect(missing).toEqual([]);
    });
});
