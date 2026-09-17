/**
 * The setup screens: can the owner actually build the system from nothing?
 *
 * The assertions that matter here are the refusals. Creating an item is easy
 * and would work by accident; what decides whether this is safe to hand over
 * is whether it stops the three edits that quietly destroy history - changing
 * a stock unit after stock has moved in it, changing a pack size after the
 * price history has been written against it, and switching off a section with
 * stock still on its shelves.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { db, makeApp } from './helpers.js';
import type { UserRole } from '../src/db/types.js';

let app: FastifyInstance;
const H: Record<string, Record<string, string>> = {};

/** Unique per run, so a second run does not trip over the first one's rows. */
const tag = () => randomUUID().slice(0, 8).toUpperCase();

async function signIn(role: UserRole) {
    const user = await db
        .selectFrom('users')
        .select(['id', 'location_id'])
        .where('role', '=', role)
        .where('is_active', '=', true)
        .orderBy('id')
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

beforeAll(async () => {
    app = await makeApp();
    for (const role of ['admin', 'management', 'storekeeper'] as const) {
        H[role] = await signIn(role);
    }
});

afterAll(async () => {
    await app.close();
    await db.destroy();
});

describe('who may configure', () => {
    it('is the admin, and nobody else - including management', async () => {
        const mgmt = await app.inject({
            method: 'GET',
            url: '/api/v1/setup/items',
            headers: H['management']!
        });
        expect(mgmt.statusCode).toBe(403);

        const store = await app.inject({
            method: 'POST',
            url: '/api/v1/setup/suppliers',
            headers: H['storekeeper']!,
            payload: { name: 'Someone New' }
        });
        expect(store.statusCode).toBe(403);

        const admin = await app.inject({
            method: 'GET',
            url: '/api/v1/setup/items',
            headers: H['admin']!
        });
        expect(admin.statusCode).toBe(200);
    });
});

describe('building the item master', () => {
    it('creates an item with its packs, and the GRN form can see it straight away', async () => {
        const category = await app.inject({
            method: 'POST',
            url: '/api/v1/setup/categories',
            headers: H['admin']!,
            payload: { name: `Test dry goods ${tag()}`, storage: 'dry' }
        });
        expect(category.statusCode).toBe(201);

        const code = `TST-${tag()}`;
        const created = await app.inject({
            method: 'POST',
            url: '/api/v1/setup/items',
            headers: H['admin']!,
            payload: {
                code,
                name: `Test lentils ${code}`,
                categoryId: category.json().id,
                stockUnit: 'g',
                parLevel: 20000,
                reorderPoint: 5000,
                isCritical: false,
                packs: [
                    { packName: '1 kg pack', qtyInStockUnit: 1000, isDefaultPurchase: false },
                    { packName: '25 kg sack', qtyInStockUnit: 25000, isDefaultPurchase: true }
                ]
            }
        });
        expect(created.statusCode).toBe(201);
        const itemId = created.json().id;

        // The storekeeper receiving a delivery is the whole point of adding it.
        const visible = (
            await app.inject({
                method: 'GET',
                url: `/api/v1/items?search=${encodeURIComponent(code)}`,
                headers: H['storekeeper']!
            })
        ).json();
        expect(visible).toHaveLength(1);
        expect(visible[0].packs).toHaveLength(2);
        expect(visible[0].packs.find((p: { isDefaultPurchase: boolean }) => p.isDefaultPurchase).packName).toBe(
            '25 kg sack'
        );

        // And it is editable while nothing has moved.
        const edited = await app.inject({
            method: 'PATCH',
            url: `/api/v1/setup/items/${itemId}`,
            headers: H['admin']!,
            payload: { stockUnit: 'ml', reorderPoint: 6000 }
        });
        expect(edited.statusCode).toBe(200);
    });

    it('refuses a pack masquerading as a stock unit, and says what to do instead', async () => {
        const category = await db
            .selectFrom('item_categories')
            .select('id')
            .where('is_active', '=', true)
            .executeTakeFirstOrThrow();

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/setup/items',
            headers: H['admin']!,
            payload: {
                code: `BAD-${tag()}`,
                name: 'Rice in the wrong unit',
                categoryId: category.id,
                stockUnit: 'kg',
                packs: [{ packName: '25 kg sack', qtyInStockUnit: 25 }]
            }
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().message).toContain('"g"');
    });

    it('will not change the stock unit of something that has already moved', async () => {
        // An item that has moved, and the unit it did *not* move in.
        //
        // This used to take the first row `limit(1)` handed back and patch it
        // to 'ea' -- so on any seed where that row's item was already counted
        // in 'ea' the request changed nothing, was allowed, and the test failed
        // for a reason that had nothing to do with the rule it was checking.
        // The guard only fires on an actual change of unit, so the test has to
        // actually change one.
        const moved = await db
            .selectFrom('stock_ledger')
            .innerJoin('items', 'items.id', 'stock_ledger.item_id')
            .select(['items.id', 'items.stock_unit'])
            .orderBy('items.id')
            .limit(1)
            .executeTakeFirstOrThrow();

        const differentUnit = moved.stock_unit === 'ea' ? 'g' : 'ea';

        const res = await app.inject({
            method: 'PATCH',
            url: `/api/v1/setup/items/${moved.id}`,
            headers: H['admin']!,
            payload: { stockUnit: differentUnit }
        });

        expect(res.statusCode).toBe(409);
        expect(res.json().message).toContain('retire this item');
    });

    it('will not resize a pack that has already been bought', async () => {
        const used = await db
            .selectFrom('grn_lines')
            .select('item_pack_id')
            .limit(1)
            .executeTakeFirstOrThrow();

        const res = await app.inject({
            method: 'PATCH',
            url: `/api/v1/setup/packs/${used.item_pack_id}`,
            headers: H['admin']!,
            payload: { qtyInStockUnit: 999 }
        });

        expect(res.statusCode).toBe(409);
        expect(res.json().message).toContain('Add a new pack size');

        // Renaming it is fine: the name is a label, the conversion is history.
        const rename = await app.inject({
            method: 'PATCH',
            url: `/api/v1/setup/packs/${used.item_pack_id}`,
            headers: H['admin']!,
            payload: { packName: 'Renamed pack' }
        });
        expect(rename.statusCode).toBe(200);
    });
});

describe('suppliers', () => {
    it('adds one that the delivery screen can immediately use', async () => {
        const name = `Test Supplier ${tag()}`;
        const created = await app.inject({
            method: 'POST',
            url: '/api/v1/setup/suppliers',
            headers: H['admin']!,
            payload: { name, phone: '0771234567', paymentTerms: '30 days' }
        });
        expect(created.statusCode).toBe(201);

        const list = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/suppliers',
                headers: H['storekeeper']!
            })
        ).json();
        const rows = Array.isArray(list) ? list : list.items;
        expect(rows.some((s: { name: string }) => s.name === name)).toBe(true);

        // Same name twice is how you end up with two of everyone.
        const again = await app.inject({
            method: 'POST',
            url: '/api/v1/setup/suppliers',
            headers: H['admin']!,
            payload: { name }
        });
        expect(again.statusCode).toBe(409);
    });
});

describe('branches and sections', () => {
    it('gives a new branch its main store, because a branch without one is inert', async () => {
        const code = `BR${tag().slice(0, 4)}`;
        const created = await app.inject({
            method: 'POST',
            url: '/api/v1/setup/branches',
            headers: H['admin']!,
            payload: { code, name: `Test Branch ${code}`, dayStart: '04:00' }
        });
        expect(created.statusCode).toBe(201);
        const { id, storeSectionId } = created.json();
        expect(storeSectionId).toBeGreaterThan(0);

        const store = await db
            .selectFrom('sections')
            .select(['is_store', 'kind'])
            .where('id', '=', storeSectionId)
            .executeTakeFirstOrThrow();
        expect(store.is_store).toBe(true);
        expect(store.kind).toBe('STORE');

        // A second store is refused: half the system looks the store up by
        // name and would start answering a different one at random.
        const second = await app.inject({
            method: 'POST',
            url: '/api/v1/setup/sections',
            headers: H['admin']!,
            payload: { locationId: id, code: 'STORE2', name: 'Another store', kind: 'STORE' }
        });
        expect(second.statusCode).toBe(409);

        // A second kitchen is not: it is a pastry room, and both are visible
        // to the kitchen logins because both are of kind KITCHEN.
        const pastry = await app.inject({
            method: 'POST',
            url: '/api/v1/setup/sections',
            headers: H['admin']!,
            payload: { locationId: id, code: 'PASTRY', name: 'Pastry room', kind: 'KITCHEN' }
        });
        expect(pastry.statusCode).toBe(201);

        const invented = await app.inject({
            method: 'POST',
            url: '/api/v1/setup/sections',
            headers: H['admin']!,
            payload: { locationId: id, code: 'GARAGE', name: 'Garage', kind: 'GARAGE' }
        });
        expect(invented.statusCode).toBe(400);
    });

    it('will not switch off a section that is still holding stock', async () => {
        const holding = await db
            .selectFrom('current_stock as cs')
            .innerJoin('sections as s', 's.id', 'cs.section_id')
            .select('s.id')
            .where('cs.qty_base', '>', 0)
            .where('s.is_store', '=', false)
            .executeTakeFirstOrThrow();

        const res = await app.inject({
            method: 'PATCH',
            url: `/api/v1/setup/sections/${holding.id}`,
            headers: H['admin']!,
            payload: { isActive: false }
        });

        expect(res.statusCode).toBe(409);
        expect(res.json().message).toContain('stranded');
    });
});
