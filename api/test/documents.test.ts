import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authedHeaders, db, makeApp, supplySection } from './helpers.js';

let app: FastifyInstance;
let headers: Record<string, string>;
let locationId: number;
let storeId: number;
let kitchenId: number;

async function sectionId(code: string) {
    const row = await db
        .selectFrom('sections')
        .select('id')
        .where('location_id', '=', locationId)
        .where('code', '=', code)
        .executeTakeFirstOrThrow();
    return row.id;
}

async function stockOf(itemId: number, section: number) {
    const row = await db
        .selectFrom('current_stock')
        .select('qty_base')
        .where('item_id', '=', itemId)
        .where('section_id', '=', section)
        .executeTakeFirst();
    return Number(row?.qty_base ?? 0);
}

/** An item the store definitely holds, so issues are not all shortfalls. */
async function wellStockedItem() {
    const row = await db
        .selectFrom('current_stock as cs')
        .innerJoin('items', 'items.id', 'cs.item_id')
        .select(['items.id', 'items.name', 'cs.qty_base'])
        .where('cs.section_id', '=', storeId)
        .where('cs.qty_base', '>', 5000)
        .orderBy('cs.qty_base', 'desc')
        .executeTakeFirstOrThrow();
    return { id: row.id, name: row.name, qty: Number(row.qty_base) };
}

beforeAll(async () => {
    app = await makeApp();
    const ctx = await authedHeaders(app);
    headers = ctx.headers;
    locationId = ctx.locationId;
    storeId = await sectionId('STORE');
    kitchenId = await sectionId('KITCHEN');
});

afterAll(async () => {
    await app.close();
    await db.destroy();
});

describe('the cleaning store keeps its own shelf', () => {
    /**
     * Cleaning was excluded from counts and wastage while kitchen had both,
     * and nothing ever justified the difference. The effect was that the one
     * person who stands at the cleaning shelf could neither count it nor say
     * what they had broken -- so a split drum of degreaser left the ledger
     * believing it was still there, and surfaced weeks later as *shrinkage*,
     * which is the report that means somebody took it.
     *
     * The section boundary is unchanged: cleaning still reaches nothing but
     * its own store. That is asserted at the end.
     */
    async function cleaningHeaders() {
        const user = await db
            .selectFrom('users')
            .select(['id', 'location_id'])
            .where('role', '=', 'cleaning')
            .where('is_active', '=', true)
            .executeTakeFirstOrThrow();
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { userId: user.id, locationId: user.location_id ?? 1, pin: '1234' }
        });
        return {
            authorization: `Bearer ${res.json().accessToken}`,
            'x-location-id': String(user.location_id ?? 1)
        };
    }

    it('lets a cleaning login log wastage and count its own store', async () => {
        const ch = await cleaningHeaders();
        const clean = await sectionId('CLEAN');
        const item = await db
            .selectFrom('current_stock')
            .select(['item_id', 'qty_base'])
            .where('section_id', '=', clean)
            .where('qty_base', '>', 10)
            .executeTakeFirstOrThrow();

        const waste = await app.inject({
            method: 'POST',
            url: '/api/v1/wastage',
            headers: ch,
            payload: {
                sectionId: clean,
                itemId: item.item_id,
                qtyBase: 1,
                reasonCode: 'SPOIL'
            }
        });
        expect(waste.statusCode).toBe(201);

        const opened = await app.inject({
            method: 'POST',
            url: '/api/v1/counts/open',
            headers: ch,
            payload: { sectionId: clean, countType: 'daily_critical' }
        });
        expect(opened.statusCode).toBe(201);

        const closed = await app.inject({
            method: 'POST',
            url: `/api/v1/counts/${opened.json().id}/close`,
            headers: ch
        });
        expect(closed.statusCode).toBe(200);
    });

    it('still refuses a cleaning login the kitchen', async () => {
        const ch = await cleaningHeaders();
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/counts/open',
            headers: ch,
            payload: { sectionId: kitchenId, countType: 'daily_critical' }
        });
        expect(res.statusCode).toBe(403);
    });

    it('still refuses a cleaning login the verification of its own work', async () => {
        const ch = await cleaningHeaders();
        const clean = await sectionId('CLEAN');
        const opened = await app.inject({
            method: 'POST',
            url: '/api/v1/counts/open',
            headers: ch,
            payload: { sectionId: clean, countType: 'daily_critical' }
        });
        await app.inject({
            method: 'POST',
            url: `/api/v1/counts/${opened.json().id}/close`,
            headers: ch
        });
        const verify = await app.inject({
            method: 'POST',
            url: `/api/v1/counts/${opened.json().id}/verify`,
            headers: ch
        });
        expect(verify.statusCode).toBe(403);
    });
});

describe('section boundaries', () => {
    /**
     * Every endpoint that took a section id took it on trust. The screens
     * never offered another section, which is not the same as it being
     * refused - and a section login could reach into any other by sending a
     * different number.
     */
    it('refuses a kitchen login every door into the cleaning store', async () => {
        const kitchen = await db
            .selectFrom('users')
            .select(['id', 'location_id'])
            .where('role', '=', 'kitchen')
            .where('is_active', '=', true)
            .executeTakeFirstOrThrow();
        const login = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { userId: kitchen.id, locationId: kitchen.location_id ?? 1, pin: '1234' }
        });
        const kh = {
            authorization: `Bearer ${login.json().accessToken}`,
            'x-location-id': String(kitchen.location_id ?? 1)
        };
        const clean = await sectionId('CLEAN');
        const item = await db
            .selectFrom('current_stock')
            .select('item_id')
            .where('section_id', '=', clean)
            .executeTakeFirstOrThrow();

        const attempts = [
            app.inject({
                method: 'POST',
                url: '/api/v1/wastage',
                headers: kh,
                payload: {
                    sectionId: clean,
                    itemId: item.item_id,
                    qtyBase: 1,
                    reasonCode: 'SPOIL'
                }
            }),
            app.inject({
                method: 'POST',
                url: '/api/v1/counts/open',
                headers: kh,
                payload: { sectionId: clean, countType: 'daily_critical' }
            }),
            app.inject({ method: 'GET', url: `/api/v1/stock?sectionId=${clean}`, headers: kh }),
            app.inject({ method: 'GET', url: `/api/v1/wastage?sectionId=${clean}`, headers: kh }),
            app.inject({ method: 'GET', url: `/api/v1/counts?sectionId=${clean}`, headers: kh })
        ];

        for (const res of await Promise.all(attempts)) {
            expect(res.statusCode).toBe(403);
        }

        // And with no section named, the lists narrow themselves rather than
        // handing back the whole branch.
        const stock = await app.inject({
            method: 'GET',
            url: '/api/v1/stock?limit=200',
            headers: kh
        });
        const codes = new Set(
            stock.json().items.map((r: { sectionCode: string }) => r.sectionCode)
        );
        expect(codes.has('CLEAN')).toBe(false);
        expect(codes.has('STORE')).toBe(false);
    });
});

describe('wastage', () => {
    it('reduces the section it was wasted from', async () => {
        const item = await wellStockedItem();
        await supplySection(app, headers, kitchenId, item.id, 500);

        const before = await stockOf(item.id, kitchenId);

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/wastage',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 100,
                reasonCode: 'SPOIL'
            }
        });

        expect(res.statusCode).toBe(201);
        expect(await stockOf(item.id, kitchenId)).toBe(before - 100);
    });

    it('rejects an unknown reason code', async () => {
        const item = await wellStockedItem();
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/wastage',
            headers,
            payload: { sectionId: kitchenId, itemId: item.id, qtyBase: 1, reasonCode: 'NOPE' }
        });
        expect(res.statusCode).toBe(400);
    });

    it('rejects a reason code belonging to another document type', async () => {
        const item = await wellStockedItem();
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/wastage',
            headers,
            // A real code, but it belongs to counts.
            payload: { sectionId: kitchenId, itemId: item.id, qtyBase: 1, reasonCode: 'COUNTADJ' }
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('transfers', () => {
    it('posts both legs at once within one outlet', async () => {
        const item = await wellStockedItem();
        // Kitchen to the cleaning store. With BAKERY and BAR gone there are
        // two rooms left that both hold stock, which is all a transfer needs.
        const otherId = await sectionId('CLEAN');

        await supplySection(app, headers, kitchenId, item.id, 300);

        const kitchenBefore = await stockOf(item.id, kitchenId);
        const bakeryBefore = await stockOf(item.id, otherId);

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/transfers',
            headers,
            payload: {
                fromSectionId: kitchenId,
                toSectionId: otherId,
                itemId: item.id,
                qtyBase: 100
            }
        });

        expect(res.statusCode).toBe(201);
        expect(res.json().completed).toBe(true);
        expect(await stockOf(item.id, kitchenId)).toBe(kitchenBefore - 100);
        expect(await stockOf(item.id, otherId)).toBe(bakeryBefore + 100);
    });

    it('refuses a transfer to the same section', async () => {
        const item = await wellStockedItem();
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/transfers',
            headers,
            payload: {
                fromSectionId: kitchenId,
                toSectionId: kitchenId,
                itemId: item.id,
                qtyBase: 1
            }
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('stock counts', () => {
    // One open count per section, type and business day is a unique
    // constraint, so a count left open by one test makes the next one 409.
    // An open count has posted nothing to the ledger, so the cleanest start
    // is no open counts at all.
    beforeEach(async () => {
        const open = await db
            .selectFrom('stock_counts')
            .select('id')
            .where('closed_at', 'is', null)
            .execute();
        if (open.length === 0) return;
        const ids = open.map((r) => r.id);
        await db.deleteFrom('stock_count_lines').where('count_id', 'in', ids).execute();
        await db.deleteFrom('stock_counts').where('id', 'in', ids).execute();
    });

    it('freezes expected at open, and a later movement does not absorb the variance', async () => {
        const open = await app.inject({
            method: 'POST',
            url: '/api/v1/counts/open',
            headers,
            payload: { sectionId: storeId, countType: 'daily_critical' }
        });
        expect(open.statusCode).toBe(201);

        const countId = open.json().id;
        const line = open.json().lines[0];
        const expectedAtOpen = line.qtyExpected;

        // Something moves while the count is being walked.
        await supplySection(app, headers, kitchenId, line.itemId, 50);

        const reread = await app.inject({ method: 'GET', url: `/api/v1/counts/${countId}`, headers });
        const rereadLine = reread.json().lines.find((l: { lineId: string }) => l.lineId === line.lineId);

        // Still the figure from when the count opened. If this re-read live it
        // would quietly swallow the difference and hide real shrinkage.
        expect(rereadLine.qtyExpected).toBe(expectedAtOpen);
    });

    it('writes a COUNTADJ adjustment that makes the ledger agree with the shelf', async () => {
        const open = await app.inject({
            method: 'POST',
            url: '/api/v1/counts/open',
            headers,
            payload: { sectionId: kitchenId, countType: 'daily_critical' }
        });
        const countId = open.json().id;
        const lines = open.json().lines as {
            lineId: string;
            itemId: number;
            qtyExpected: number;
        }[];

        // One item is 25 units short on the shelf: the signature of shrinkage.
        const target = lines[0];
        const shortBy = 25;

        await app.inject({
            method: 'PUT',
            url: `/api/v1/counts/${countId}/lines`,
            headers,
            payload: {
                lines: lines.map((l) => ({
                    lineId: l.lineId,
                    qtyCounted: l.lineId === target.lineId ? Math.max(0, l.qtyExpected - shortBy) : l.qtyExpected
                }))
            }
        });

        const before = await stockOf(target!.itemId, kitchenId);

        const close = await app.inject({
            method: 'POST',
            url: `/api/v1/counts/${countId}/close`,
            headers
        });

        expect(close.statusCode).toBe(200);
        expect(close.json().adjustments).toBeGreaterThanOrEqual(1);

        const after = await stockOf(target.itemId, kitchenId);
        expect(after).toBe(before - shortBy);

        // The adjustment is on the ledger as a count row with a reason code,
        // not an edit of anything that came before it.
        const adj = await db
            .selectFrom('stock_ledger')
            .selectAll()
            .where('doc', '=', 'count')
            .where('doc_id', '=', String(countId))
            .execute();
        expect(adj.length).toBeGreaterThanOrEqual(1);
        expect(adj.every((r) => r.reason_code === 'COUNTADJ')).toBe(true);
    });

    it('leaves untouched lines alone - a partial count adjusts only what was counted', async () => {
        const kitchenId = await sectionId('KITCHEN');
        const open = await app.inject({
            method: 'POST',
            url: '/api/v1/counts/open',
            headers,
            payload: { sectionId: kitchenId, countType: 'weekly_full' }
        });
        expect(open.statusCode).toBe(201);
        const countId = open.json().id;
        const lines = open.json().lines as {
            lineId: string;
            itemId: number;
            qtyExpected: number;
        }[];
        expect(lines.length).toBeGreaterThan(2);

        // Count exactly one line, two short. Everything else is left blank -
        // which under the old NOT NULL default meant "counted zero" and would
        // have written the whole section off.
        //
        // The line has to be one the section actually holds some of. Taking
        // lines[0] on trust worked until the kitchen's contents shifted and the
        // first line came back expecting zero: counting zero short of zero is
        // no variance at all, so nothing moved and the test failed for a reason
        // that had nothing to do with partial counts.
        const shortBy = 2;
        const target = lines.find((l) => l.qtyExpected > shortBy);
        const untouched = lines.find((l) => l !== target);
        expect(target, 'the kitchen holds nothing worth counting short').toBeTruthy();
        expect(untouched).toBeTruthy();
        const before = await stockOf(target!.itemId, kitchenId);
        const untouchedBefore = await stockOf(untouched!.itemId, kitchenId);

        await app.inject({
            method: 'PUT',
            url: `/api/v1/counts/${countId}/lines`,
            headers,
            payload: {
                lines: [
                    {
                        lineId: target!.lineId,
                        qtyCounted: target!.qtyExpected - shortBy
                    }
                ]
            }
        });

        const close = await app.inject({
            method: 'POST',
            url: `/api/v1/counts/${countId}/close`,
            headers
        });
        expect(close.statusCode).toBe(200);
        expect(close.json().counted).toBe(1);
        expect(close.json().skipped).toBe(lines.length - 1);

        // The counted line moved; the blank one did not.
        expect(await stockOf(target!.itemId, kitchenId)).toBe(before - shortBy);
        expect(await stockOf(untouched!.itemId, kitchenId)).toBe(untouchedBefore);

        // And only the counted line produced a ledger row.
        const adj = await db
            .selectFrom('stock_ledger')
            .selectAll()
            .where('doc', '=', 'count')
            .where('doc_id', '=', String(countId))
            .execute();
        expect(adj.length).toBe(1);
        expect(adj[0]!.item_id).toBe(target!.itemId);
    });

    it('scopes the daily count to what the section actually holds', async () => {
        const open = await app.inject({
            method: 'POST',
            url: '/api/v1/counts/open',
            headers,
            payload: { sectionId: await sectionId('KITCHEN'), countType: 'daily_critical' }
        });
        expect(open.statusCode).toBe(201);

        const lines = open.json().lines as { itemId: number }[];
        const held = await db
            .selectFrom('current_stock')
            .select('item_id')
            .where('section_id', '=', await sectionId('KITCHEN'))
            .execute();
        const heldIds = new Set(held.map((r) => r.item_id));

        // Nothing the kitchen has never stocked. It used to be handed all
        // thirty-two critical items in the group.
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.every((l) => heldIds.has(l.itemId))).toBe(true);
    });

    it('will not close the same count twice', async () => {
        const open = await app.inject({
            method: 'POST',
            url: '/api/v1/counts/open',
            headers,
            payload: { sectionId: await sectionId('KITCHEN'), countType: 'daily_critical' }
        });
        const countId = open.json().id;

        const first = await app.inject({ method: 'POST', url: `/api/v1/counts/${countId}/close`, headers });
        const second = await app.inject({ method: 'POST', url: `/api/v1/counts/${countId}/close`, headers });

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(409);
    });

    it('refuses to let the counter verify their own count', async () => {
        const open = await app.inject({
            method: 'POST',
            url: '/api/v1/counts/open',
            headers,
            payload: { sectionId: await sectionId('CLEAN'), countType: 'daily_critical' }
        });
        const countId = open.json().id;
        await app.inject({ method: 'POST', url: `/api/v1/counts/${countId}/close`, headers });

        // The storekeeper counted it. A manager token is a different person...
        const manager = await db
            .selectFrom('users')
            .select(['id', 'location_id'])
            .where('role', '=', 'management')
            .executeTakeFirstOrThrow();
        const login = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { userId: manager.id, locationId: manager.location_id ?? 1, pin: '1234' }
        });
        const mgrHeaders = {
            authorization: `Bearer ${login.json().accessToken}`,
            'x-location-id': String(manager.location_id ?? 1)
        };

        const ok = await app.inject({
            method: 'POST',
            url: `/api/v1/counts/${countId}/verify`,
            headers: mgrHeaders
        });
        expect(ok.statusCode).toBe(200);
    });
});

describe('reversals', () => {
    it('undoes a wastage document and nets its effect to zero', async () => {
        const item = await wellStockedItem();
        await supplySection(app, headers, kitchenId, item.id, 200);

        const waste = await app.inject({
            method: 'POST',
            url: '/api/v1/wastage',
            headers,
            payload: { sectionId: kitchenId, itemId: item.id, qtyBase: 60, reasonCode: 'SPOIL' }
        });
        const wastageId = waste.json().id;
        const afterWaste = await stockOf(item.id, kitchenId);

        const manager = await db
            .selectFrom('users')
            .select(['id', 'location_id'])
            .where('role', '=', 'management')
            .executeTakeFirstOrThrow();
        const login = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { userId: manager.id, locationId: manager.location_id ?? 1, pin: '1234' }
        });
        const mgrHeaders = {
            authorization: `Bearer ${login.json().accessToken}`,
            'x-location-id': String(manager.location_id ?? 1)
        };

        const rev = await app.inject({
            method: 'POST',
            url: `/api/v1/documents/wastage/${wastageId}/reverse`,
            headers: mgrHeaders,
            payload: { reason: 'logged against the wrong item' }
        });

        expect(rev.statusCode).toBe(200);
        expect(await stockOf(item.id, kitchenId)).toBe(afterWaste + 60);

        // The original row is untouched; the correction sits beside it.
        const rows = await db
            .selectFrom('stock_ledger')
            .selectAll()
            .where('doc', '=', 'wastage')
            .where('doc_id', '=', String(wastageId))
            .execute();
        expect(rows).toHaveLength(2);
        expect(rows.filter((r) => r.is_reversal)).toHaveLength(1);
    });

    it('refuses a reversal from a role that cannot approve', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/documents/wastage/1/reverse',
            headers,
            payload: { reason: 'storekeeper should not be able to do this' }
        });
        expect(res.statusCode).toBe(403);
    });
});
