/**
 * The purchasing cycle, end to end: raise, approve, order, part-deliver,
 * finish. Plus the opening balance a section gets before any of that.
 *
 * The case worth testing is the short delivery. An order that closes itself
 * the moment anything arrives looks fine in every demo and loses four sacks in
 * production, because the thing it stops showing you is the thing you needed
 * to chase.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { db, makeApp } from './helpers.js';
import type { UserRole } from '../src/db/types.js';

let app: FastifyInstance;
const H: Record<string, Record<string, string>> = {};

const idem = () => ({ 'idempotency-key': randomUUID() });
const tag = () => randomUUID().slice(0, 8).toUpperCase();

async function signIn(role: UserRole, locationId?: number) {
    const user = await db
        .selectFrom('users')
        .select(['id', 'location_id'])
        .where('role', '=', role)
        .where('is_active', '=', true)
        .orderBy('id')
        .executeTakeFirstOrThrow();

    const at = locationId ?? user.location_id ?? 1;
    const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { userId: user.id, locationId: at, pin: '1234' }
    });

    return {
        authorization: `Bearer ${res.json().accessToken}`,
        'x-location-id': String(at)
    };
}

/** An item with a default purchase pack, which is what an order is placed in. */
async function orderable() {
    const row = await db
        .selectFrom('items')
        .innerJoin('item_packs as p', (join) =>
            join.onRef('p.item_id', '=', 'items.id').on('p.is_default_purchase', '=', true)
        )
        .select([
            'items.id as itemId',
            'items.name',
            'p.id as packId',
            'p.qty_in_stock_unit as packSize'
        ])
        .where('items.is_active', '=', true)
        .orderBy('items.id')
        .executeTakeFirstOrThrow();
    return { ...row, packSize: Number(row.packSize) };
}

async function poById(id: string, headers: Record<string, string>) {
    const list = (
        await app.inject({ method: 'GET', url: '/api/v1/purchase-orders?limit=200', headers })
    ).json();
    return list.items.find((p: { id: string }) => p.id === id);
}

beforeAll(async () => {
    app = await makeApp();
    for (const role of ['admin', 'management', 'storekeeper', 'kitchen'] as const) {
        H[role] = await signIn(role);
    }
});

afterAll(async () => {
    await app.close();
    await db.destroy();
});

describe('raising a purchase order', () => {
    it('lets the storekeeper order before anyone has gone short', async () => {
        const item = await orderable();

        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/purchase-orders',
            headers: H['storekeeper']!,
            payload: {
                reason: 'running low on the shelf',
                neededBy: '2026-09-01',
                lines: [{ itemPackId: item.packId, qtyPacks: 4, estPrice: 1200 }]
            }
        });
        expect(raised.statusCode).toBe(201);

        const po = await poById(raised.json().id, H['management']!);
        expect(po.status).toBe('requested');
        // Ordered in packs, held in stock units: the conversion happens once.
        expect(po.lines[0].qtyPacks).toBe(4);
        expect(po.lines[0].qtyBase).toBe(4 * item.packSize);
        expect(po.estimatedTotal).toBe(4800);
    });

    it('refuses to mark an order "ordered" without saying who it went to', async () => {
        const item = await orderable();
        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/purchase-orders',
            headers: H['storekeeper']!,
            payload: { lines: [{ itemPackId: item.packId, qtyPacks: 1 }] }
        });

        const res = await app.inject({
            method: 'POST',
            url: `/api/v1/purchase-orders/${raised.json().id}/decide`,
            headers: H['management']!,
            payload: { decision: 'ordered' }
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().message).toContain('who it was ordered from');
    });
});

describe('a short delivery', () => {
    it('keeps the order open on the balance, then closes it when the rest arrives', async () => {
        const item = await orderable();
        const supplier = await db
            .selectFrom('suppliers')
            .select('id')
            .where('is_active', '=', true)
            .executeTakeFirstOrThrow();

        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/purchase-orders',
            headers: H['storekeeper']!,
            payload: { lines: [{ itemPackId: item.packId, qtyPacks: 10, estPrice: 1000 }] }
        });
        const poId = raised.json().id;

        // Nothing can be received against it until management has said yes.
        const tooEarly = await app.inject({
            method: 'POST',
            url: '/api/v1/grn',
            headers: { ...H['storekeeper']!, ...idem() },
            payload: {
                supplierId: supplier.id,
                poId,
                lines: [{ itemPackId: item.packId, qtyPacks: 1, packPrice: 1000 }]
            }
        });
        expect(tooEarly.statusCode).toBe(409);
        expect(tooEarly.json().message).toContain('not approved');

        await app.inject({
            method: 'POST',
            url: `/api/v1/purchase-orders/${poId}/decide`,
            headers: H['management']!,
            payload: { decision: 'ordered', supplierId: supplier.id, note: 'call them Monday' }
        });

        // Six of the ten turn up.
        const part = await app.inject({
            method: 'POST',
            url: '/api/v1/grn',
            headers: { ...H['storekeeper']!, ...idem() },
            payload: {
                supplierId: supplier.id,
                poId,
                invoiceNo: `INV-${tag()}`,
                lines: [{ itemPackId: item.packId, qtyPacks: 6, packPrice: 1000 }]
            }
        });
        expect(part.statusCode).toBe(201);

        const open = await poById(poId, H['management']!);
        expect(open.status).toBe('ordered');
        expect(open.partReceived).toBe(true);
        expect(open.lines[0].qtyReceivedBase).toBe(6 * item.packSize);
        expect(open.lines[0].qtyOutstandingBase).toBe(4 * item.packSize);
        expect(open.closedAt).toBeNull();

        // And the stock actually arrived, order or no order.
        const inStore = await db
            .selectFrom('stock_ledger')
            .select('id')
            .where('doc', '=', 'grn')
            .where('doc_id', '=', String(part.json().id))
            .execute();
        expect(inStore.length).toBe(1);

        const rest = await app.inject({
            method: 'POST',
            url: '/api/v1/grn',
            headers: { ...H['storekeeper']!, ...idem() },
            payload: {
                supplierId: supplier.id,
                poId,
                lines: [{ itemPackId: item.packId, qtyPacks: 4, packPrice: 1000 }]
            }
        });
        expect(rest.statusCode).toBe(201);

        const done = await poById(poId, H['management']!);
        expect(done.status).toBe('done');
        expect(done.partReceived).toBe(false);
        expect(done.lines[0].qtyOutstandingBase).toBe(0);
        expect(done.closedAt).not.toBeNull();
    });

    it('refuses a delivery from a supplier the order was not placed with', async () => {
        const item = await orderable();
        const [a, b] = await db
            .selectFrom('suppliers')
            .select('id')
            .where('is_active', '=', true)
            .orderBy('id')
            .limit(2)
            .execute();

        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/purchase-orders',
            headers: H['storekeeper']!,
            payload: { lines: [{ itemPackId: item.packId, qtyPacks: 2 }] }
        });
        const poId = raised.json().id;

        await app.inject({
            method: 'POST',
            url: `/api/v1/purchase-orders/${poId}/decide`,
            headers: H['management']!,
            payload: { decision: 'ordered', supplierId: a!.id }
        });

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/grn',
            headers: { ...H['storekeeper']!, ...idem() },
            payload: {
                supplierId: b!.id,
                poId,
                lines: [{ itemPackId: item.packId, qtyPacks: 2, packPrice: 900 }]
            }
        });

        expect(res.statusCode).toBe(409);
        expect(res.json().message).toContain('different supplier');
    });

    it('can be closed short, with a reason, by management only', async () => {
        const item = await orderable();
        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/purchase-orders',
            headers: H['storekeeper']!,
            payload: { lines: [{ itemPackId: item.packId, qtyPacks: 3 }] }
        });
        const poId = raised.json().id;

        const storeTry = await app.inject({
            method: 'POST',
            url: `/api/v1/purchase-orders/${poId}/close`,
            headers: H['storekeeper']!,
            payload: { note: 'never mind' }
        });
        expect(storeTry.statusCode).toBe(403);

        const closed = await app.inject({
            method: 'POST',
            url: `/api/v1/purchase-orders/${poId}/close`,
            headers: H['management']!,
            payload: { note: 'supplier had no more stock' }
        });
        expect(closed.statusCode).toBe(200);

        const po = await poById(poId, H['management']!);
        expect(po.status).toBe('done');
        expect(po.decisionNote).toBe('supplier had no more stock');
    });

    it('fills both lines when the same item is ordered in two pack sizes', async () => {
        // A real order: two 1 kg packs for the shelf and a sack for the store.
        // Matching a delivery by item alone used to dump everything on the
        // first line, leaving the second outstanding forever and the order
        // permanently open.
        // The seed gives every item one pack, so the second size is made here
        // rather than hunted for: depending on another test file having left
        // a two-pack item behind makes this pass or fail on run order.
        const base = await orderable();
        const added = await app.inject({
            method: 'POST',
            url: `/api/v1/setup/items/${base.itemId}/packs`,
            headers: H['admin']!,
            payload: {
                packName: `Bulk sack ${tag()}`,
                qtyInStockUnit: base.packSize * 10,
                isDefaultPurchase: false
            }
        });
        expect(added.statusCode).toBe(201);

        const small = { id: base.packId, size: base.packSize };
        const large = { id: added.json().id, size: base.packSize * 10 };
        const supplier = await db
            .selectFrom('suppliers')
            .select('id')
            .where('is_active', '=', true)
            .executeTakeFirstOrThrow();

        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/purchase-orders',
            headers: H['storekeeper']!,
            payload: {
                lines: [
                    { itemPackId: small!.id, qtyPacks: 2 },
                    { itemPackId: large!.id, qtyPacks: 1 }
                ]
            }
        });
        expect(raised.statusCode).toBe(201);
        const poId = raised.json().id;

        await app.inject({
            method: 'POST',
            url: `/api/v1/purchase-orders/${poId}/decide`,
            headers: H['management']!,
            payload: { decision: 'ordered', supplierId: supplier.id }
        });

        // Everything arrives, in the packs it was ordered in.
        const delivered = await app.inject({
            method: 'POST',
            url: '/api/v1/grn',
            headers: { ...H['storekeeper']!, ...idem() },
            payload: {
                supplierId: supplier.id,
                poId,
                lines: [
                    { itemPackId: small!.id, qtyPacks: 2, packPrice: 500 },
                    { itemPackId: large!.id, qtyPacks: 1, packPrice: 900 }
                ]
            }
        });
        expect(delivered.statusCode).toBe(201);

        const po = await poById(poId, H['management']!);
        for (const line of po.lines) {
            expect(line.qtyOutstandingBase).toBe(0);
        }
        expect(po.status).toBe('done');
    });
});

describe('what to order next', () => {
    it('suggests whole packs for everything at or below its reorder point', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/purchase-orders/suggested',
            headers: H['storekeeper']!
        });
        expect(res.statusCode).toBe(200);

        const rows = res.json();
        for (const row of rows) {
            expect(row.inStore).toBeLessThanOrEqual(row.reorderPoint);
            // Whole packs, and never an order for nothing.
            if (row.itemPackId !== null) {
                expect(row.suggestedPacks).toBeGreaterThan(0);
                expect(Number.isInteger(row.suggestedPacks)).toBe(true);
            }
        }

        // The kitchen has no business ordering for the store.
        const kitchen = await app.inject({
            method: 'GET',
            url: '/api/v1/purchase-orders/suggested',
            headers: H['kitchen']!
        });
        expect(kitchen.statusCode).toBe(403);
    });
});

describe('opening stock', () => {
    it('opens a fresh section once, and refuses the second time', async () => {
        // A brand new branch is the only place with a section that has never
        // moved -- which is the state this document exists for.
        const code = `OP${tag().slice(0, 4)}`;
        const branch = await app.inject({
            method: 'POST',
            url: '/api/v1/setup/branches',
            headers: H['admin']!,
            payload: { code, name: `Opening test ${code}` }
        });
        expect(branch.statusCode).toBe(201);
        const { id: locationId, storeSectionId } = branch.json();

        // Signed in after the branch exists, or the token would not carry it.
        const mgmt = await signIn('management', locationId);

        const waiting = (
            await app.inject({ method: 'GET', url: '/api/v1/opening-stock', headers: mgmt })
        ).json();
        expect(waiting.find((s: { sectionId: number }) => s.sectionId === storeSectionId).canOpen).toBe(
            true
        );

        const item = await orderable();
        const opened = await app.inject({
            method: 'POST',
            url: '/api/v1/opening-stock',
            headers: { ...mgmt, ...idem() },
            payload: {
                sectionId: storeSectionId,
                note: 'counted at handover',
                lines: [{ itemId: item.itemId, qtyBase: 5000, unitCost: 0.42 }]
            }
        });
        expect(opened.statusCode).toBe(201);
        expect(opened.json().totalValue).toBe(2100);

        // The stock is really there, valued at what was entered.
        const valued = await db
            .selectFrom('current_stock_valued')
            .select(['qty_base', 'avg_cost'])
            .where('section_id', '=', storeSectionId)
            .where('item_id', '=', item.itemId)
            .executeTakeFirstOrThrow();
        expect(Number(valued.qty_base)).toBe(5000);
        expect(Number(valued.avg_cost)).toBe(0.42);

        // Second time is a stock count's job, not an opening balance's.
        const again = await app.inject({
            method: 'POST',
            url: '/api/v1/opening-stock',
            headers: { ...mgmt, ...idem() },
            payload: {
                sectionId: storeSectionId,
                lines: [{ itemId: item.itemId, qtyBase: 100, unitCost: 1 }]
            }
        });
        expect(again.statusCode).toBe(409);
        expect(again.json().message).toContain('stock count');
    });

    it('is not something the admin can do', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/opening-stock',
            headers: { ...H['admin']!, ...idem() },
            payload: { sectionId: 1, lines: [{ itemId: 1, qtyBase: 1, unitCost: 1 }] }
        });
        expect(res.statusCode).toBe(403);
    });
});
