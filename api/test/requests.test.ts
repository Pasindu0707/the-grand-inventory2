/**
 * The request flow, which is what the app is for:
 *   kitchen asks → management or storekeeper releases → kitchen confirms.
 * Plus purchase orders when the store cannot cover it, and admin user
 * management.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { db, makeApp } from './helpers.js';
import type { UserRole } from '../src/db/types.js';

let app: FastifyInstance;
const H: Record<string, Record<string, string>> = {};
let kitchenSectionId = 0;
let storeSectionId = 0;

const idem = () => ({ 'idempotency-key': randomUUID() });

async function signIn(role: UserRole, locationId = 1) {
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
        payload: { userId: user.id, locationId: user.location_id ?? locationId, pin: '1234' }
    });

    return {
        userId: user.id,
        headers: {
            authorization: `Bearer ${res.json().accessToken}`,
            'x-location-id': String(user.location_id ?? locationId)
        }
    };
}

async function sectionId(code: string, locationId = 1) {
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

async function wellStocked() {
    // Carries its default purchase pack: purchase orders are raised in packs,
    // so a test that wants to order something needs to know which one.
    const row = await db
        .selectFrom('current_stock as cs')
        .innerJoin('items', 'items.id', 'cs.item_id')
        .innerJoin('item_packs as p', (join) =>
            join.onRef('p.item_id', '=', 'items.id').on('p.is_default_purchase', '=', true)
        )
        .select(['items.id', 'items.name', 'cs.qty_base', 'p.id as packId'])
        .where('cs.section_id', '=', storeSectionId)
        .where('cs.qty_base', '>', 5000)
        .orderBy('cs.qty_base', 'desc')
        .executeTakeFirstOrThrow();
    return {
        id: row.id,
        name: row.name,
        qty: Number(row.qty_base),
        packId: row.packId
    };
}

beforeAll(async () => {
    app = await makeApp();
    for (const role of ['admin', 'management', 'storekeeper', 'kitchen', 'cleaning'] as const) {
        H[role] = (await signIn(role)).headers;
    }
    kitchenSectionId = await sectionId('KITCHEN');
    storeSectionId = await sectionId('STORE');
});

afterAll(async () => {
    await app.close();
    await db.destroy();
});

describe('who am I', () => {
    it('tells each role what it can do, so the UI never has to guess', async () => {
        const kitchen = (
            await app.inject({ method: 'GET', url: '/api/v1/me/context', headers: H['kitchen']! })
        ).json();
        expect(kitchen.canRelease).toBe(false);
        expect(kitchen.seesAdvanced).toBe(false);
        expect(kitchen.homeSectionId).toBe(kitchenSectionId);

        const store = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/me/context',
                headers: H['storekeeper']!
            })
        ).json();
        expect(store.canRelease).toBe(true);
        expect(store.canDecidePurchases).toBe(false);
        expect(store.seesAdvanced).toBe(false);

        const mgmt = (
            await app.inject({ method: 'GET', url: '/api/v1/me/context', headers: H['management']! })
        ).json();
        // Management decides money and approves what comes back. They do
        // not stand at the shelf handing stock over -- see the release route.
        expect(mgmt.canRelease).toBe(false);
        expect(mgmt.canDecidePurchases).toBe(true);
        expect(mgmt.seesAdvanced).toBe(true);

        const admin = (
            await app.inject({ method: 'GET', url: '/api/v1/me/context', headers: H['admin']! })
        ).json();
        expect(admin.canManageUsers).toBe(true);
        expect(admin.canRelease).toBe(false);
    });
});

describe('ask → release → confirm', () => {
    it('runs the whole way through and moves stock at release', async () => {
        const item = await wellStocked();
        const storeBefore = await stockOf(item.id, storeSectionId);
        const kitchenBefore = await stockOf(item.id, kitchenSectionId);

        // Kitchen does not pick a section - it is theirs.
        const asked = await app.inject({
            method: 'POST',
            url: '/api/v1/requests',
            headers: H['kitchen']!,
            payload: {
                neededBy: '2026-08-20',
                note: 'for Saturday service',
                lines: [{ itemId: item.id, qtyRequested: 800 }]
            }
        });
        expect(asked.statusCode).toBe(201);
        const id = asked.json().id;

        // Nothing has moved yet: a request is a piece of paper.
        expect(await stockOf(item.id, storeSectionId)).toBe(storeBefore);

        const released = await app.inject({
            method: 'POST',
            url: `/api/v1/requests/${id}/release`,
            headers: { ...H['storekeeper']!, ...idem() },
            payload: { lines: [] }
        });
        expect(released.statusCode).toBe(200);

        expect(await stockOf(item.id, storeSectionId)).toBe(storeBefore - 800);
        expect(await stockOf(item.id, kitchenSectionId)).toBe(kitchenBefore + 800);

        const confirmed = await app.inject({
            method: 'POST',
            url: `/api/v1/requests/${id}/confirm`,
            headers: H['kitchen']!
        });
        expect(confirmed.statusCode).toBe(200);

        const row = await db
            .selectFrom('issues')
            .select(['status', 'received_by', 'needed_by'])
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
        expect(row.status).toBe('received');
        expect(row.received_by).toBeTruthy();
        expect(row.needed_by).toBe('2026-08-20');
    });

    it('reports the issue-window status but never blocks on it', async () => {
        const windows = (
            await app.inject({ method: 'GET', url: '/api/v1/issue-windows', headers: H['kitchen']! })
        ).json();
        expect(windows.map((w: { at: string }) => w.at)).toEqual(['06:00', '11:00', '17:00']);

        const item = await wellStocked();
        const asked = await app.inject({
            method: 'POST',
            url: '/api/v1/requests',
            headers: H['kitchen']!,
            payload: { lines: [{ itemId: item.id, qtyRequested: 25 }] }
        });
        const res = await app.inject({
            method: 'POST',
            url: `/api/v1/requests/${asked.json().id}/release`,
            headers: { ...H['storekeeper']!, ...idem() },
            payload: { lines: [] }
        });

        // Whatever the clock says, the stock moved and the document exists.
        expect(res.statusCode).toBe(200);
        expect(res.json()).toHaveProperty('windowWarning');
    });

    it('refuses release by the kitchen or the cleaner', async () => {
        const item = await wellStocked();
        const asked = await app.inject({
            method: 'POST',
            url: '/api/v1/requests',
            headers: H['kitchen']!,
            payload: { lines: [{ itemId: item.id, qtyRequested: 10 }] }
        });
        const id = asked.json().id;

        for (const role of ['kitchen', 'cleaning'] as const) {
            const res = await app.inject({
                method: 'POST',
                url: `/api/v1/requests/${id}/release`,
                headers: { ...H[role]!, ...idem() },
                payload: { lines: [] }
            });
            expect(res.statusCode).toBe(403);
        }
    });

    /**
     * Releasing belongs to the storekeeper alone.
     *
     * Management used to be allowed to release as a stand-in. In practice that
     * let the people who approve the spending also hand the goods out, which
     * is the one separation the rest of this system is built to keep. A
     * storekeeper who is away is covered by another storekeeper login, not by
     * a manager reaching past them.
     */
    it('will not let management release, however senior they are', async () => {
        const item = await wellStocked();
        const asked = await app.inject({
            method: 'POST',
            url: '/api/v1/requests',
            headers: H['kitchen']!,
            payload: { lines: [{ itemId: item.id, qtyRequested: 20 }] }
        });

        const res = await app.inject({
            method: 'POST',
            url: `/api/v1/requests/${asked.json().id}/release`,
            headers: { ...H['management']!, ...idem() },
            payload: { lines: [] }
        });
        expect(res.statusCode).toBe(403);

        // And the request is untouched: a refusal must not half-release.
        const after = await app.inject({
            method: 'GET',
            url: `/api/v1/requests/${asked.json().id}`,
            headers: H['storekeeper']!
        });
        expect(after.json().status).toBe('requested');
    });

    it('will not let the cleaner confirm the kitchen’s delivery', async () => {
        const item = await wellStocked();
        const asked = await app.inject({
            method: 'POST',
            url: '/api/v1/requests',
            headers: H['kitchen']!,
            payload: { lines: [{ itemId: item.id, qtyRequested: 15 }] }
        });
        const id = asked.json().id;
        await app.inject({
            method: 'POST',
            url: `/api/v1/requests/${id}/release`,
            headers: { ...H['storekeeper']!, ...idem() },
            payload: { lines: [] }
        });

        const wrong = await app.inject({
            method: 'POST',
            url: `/api/v1/requests/${id}/confirm`,
            headers: H['cleaning']!
        });
        expect(wrong.statusCode).toBe(403);
    });

    it('will not release the same request twice', async () => {
        const item = await wellStocked();
        const asked = await app.inject({
            method: 'POST',
            url: '/api/v1/requests',
            headers: H['kitchen']!,
            payload: { lines: [{ itemId: item.id, qtyRequested: 10 }] }
        });
        const id = asked.json().id;

        const first = await app.inject({
            method: 'POST',
            url: `/api/v1/requests/${id}/release`,
            headers: { ...H['storekeeper']!, ...idem() },
            payload: { lines: [] }
        });
        const second = await app.inject({
            method: 'POST',
            url: `/api/v1/requests/${id}/release`,
            headers: { ...H['storekeeper']!, ...idem() },
            payload: { lines: [] }
        });

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(409);
    });

    it('shows each role what is waiting on them', async () => {
        const item = await wellStocked();
        await app.inject({
            method: 'POST',
            url: '/api/v1/requests',
            headers: H['cleaning']!,
            payload: { lines: [{ itemId: item.id, qtyRequested: 5 }] }
        });

        const forStore = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/requests?status=requested',
                headers: H['storekeeper']!
            })
        ).json();
        expect(forStore.items.some((r: { needsMe: boolean }) => r.needsMe)).toBe(true);

        // The kitchen is not being asked to release anything.
        const forKitchen = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/requests?status=requested',
                headers: H['kitchen']!
            })
        ).json();
        expect(forKitchen.items.every((r: { needsMe: boolean }) => !r.needsMe)).toBe(true);
    });

    it('filters requests to one section, and refuses a section that is not yours', async () => {
        const sections = await db
            .selectFrom('sections')
            .select(['id', 'code'])
            .where('location_id', '=', 1)
            .execute();
        const kitchen = sections.find((s) => s.code === 'KITCHEN')!;
        const cleaning = sections.find((s) => s.code === 'CLEAN')!;

        // The storekeeper works the whole branch, one section at a time.
        const forStore = await app.inject({
            method: 'GET',
            url: `/api/v1/requests?sectionId=${kitchen.id}&limit=100`,
            headers: H['storekeeper']!
        });
        expect(forStore.statusCode).toBe(200);
        expect(
            forStore.json().items.every((r: { sectionId: number }) => r.sectionId === kitchen.id)
        ).toBe(true);

        // A kitchen login has no business in the cleaning store, and is told so
        // rather than quietly handed an empty list.
        const peek = await app.inject({
            method: 'GET',
            url: `/api/v1/requests?sectionId=${cleaning.id}`,
            headers: H['kitchen']!
        });
        expect(peek.statusCode).toBe(403);
    });

    it('lets only the receiving section say it came - not the people who handed it over', async () => {
        const kitchen = await sectionId('KITCHEN');
        const released = await db
            .selectFrom('issues')
            .select('id')
            .where('location_id', '=', 1)
            .where('status', '=', 'released')
            .where('to_section_id', '=', kitchen)
            .executeTakeFirst();
        expect(released).toBeTruthy();
        const url = `/api/v1/requests/${released!.id}/confirm`;

        // The storekeeper can see every section, and used to count as a member
        // of all of them - so the person who released the stock could also sign
        // for having received it.
        const store = await app.inject({ method: 'POST', url, headers: H['storekeeper']! });
        expect(store.statusCode).toBe(403);

        // Management runs the branch but stands at no shelf.
        const mgmt = await app.inject({ method: 'POST', url, headers: H['management']! });
        expect(mgmt.statusCode).toBe(403);

        // The kitchen asked for it, so the kitchen confirms it.
        const kitchenSays = await app.inject({ method: 'POST', url, headers: H['kitchen']! });
        expect(kitchenSays.statusCode).toBe(200);
    });

    it('serves one request with its lines, which the release panel cannot open without', async () => {
        const waiting = await db
            .selectFrom('issues')
            .select('id')
            .where('location_id', '=', 1)
            .where('status', '=', 'requested')
            .executeTakeFirst();
        expect(waiting).toBeTruthy();

        const res = await app.inject({
            method: 'GET',
            url: `/api/v1/requests/${waiting!.id}`,
            headers: H['storekeeper']!
        });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body.lines.length).toBeGreaterThan(0);
        // Every field the release panel binds to.
        for (const key of ['lineId', 'itemId', 'name', 'stockUnit', 'qtyRequested', 'availableInStore']) {
            expect(body.lines[0]).toHaveProperty(key);
        }

        const missing = await app.inject({
            method: 'GET',
            url: '/api/v1/requests/99999999',
            headers: H['storekeeper']!
        });
        expect(missing.statusCode).toBe(404);
    });
});

describe('when the store is short', () => {
    it('says so up front, before the request is even placed', async () => {
        const item = await wellStocked();
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/requests/check',
            headers: H['kitchen']!,
            payload: { lines: [{ itemId: item.id, qtyRequested: item.qty + 500_000 }] }
        });

        expect(res.statusCode).toBe(200);
        const shortages = res.json().shortages;
        expect(shortages).toHaveLength(1);
        expect(shortages[0].short).toBeGreaterThan(0);
    });

    it('will not let the kitchen buy its way around the store', async () => {
        const item = await wellStocked();

        // The kitchen cannot see the store's shelf, so it is in no position to
        // say something must be bought. It asks; the store decides.
        for (const role of ['kitchen', 'cleaning'] as const) {
            const res = await app.inject({
                method: 'POST',
                url: '/api/v1/purchase-orders',
                headers: H[role]!,
                payload: { lines: [{ itemPackId: item.packId, qtyPacks: 2 }] }
            });
            expect(res.statusCode).toBe(403);
        }
    });

    it('turns the shortfall into a purchase order that only management can decide', async () => {
        const item = await wellStocked();

        // Raised by the storekeeper: the person who just watched the shelf come
        // up short releasing the kitchen's request.
        const po = await app.inject({
            method: 'POST',
            url: '/api/v1/purchase-orders',
            headers: H['storekeeper']!,
            payload: {
                neededBy: '2026-08-25',
                reason: 'not enough in the store for Saturday',
                lines: [{ itemPackId: item.packId, qtyPacks: 2 }]
            }
        });
        expect(po.statusCode).toBe(201);
        const poId = po.json().id;

        // The storekeeper handles stock, not money.
        const storeTry = await app.inject({
            method: 'POST',
            url: `/api/v1/purchase-orders/${poId}/decide`,
            headers: H['storekeeper']!,
            payload: { decision: 'approved' }
        });
        expect(storeTry.statusCode).toBe(403);

        const ok = await app.inject({
            method: 'POST',
            url: `/api/v1/purchase-orders/${poId}/decide`,
            headers: H['management']!,
            payload: { decision: 'approved', note: 'buy at the pola' }
        });
        expect(ok.statusCode).toBe(200);

        const list = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/purchase-orders',
                headers: H['management']!
            })
        ).json();
        const found = list.items.find((p: { id: string }) => p.id === poId);
        expect(found.status).toBe('approved');
        expect(found.decidedBy).toBeTruthy();
        // Records what the store had at the time, so the decision can be read back.
        expect(found.lines[0]).toHaveProperty('qtyInStore');
    });

    it('shows a login only its own purchases unless it asks for the branch', async () => {
        // The storekeeper raised the purchase above. The kitchen raised
        // nothing -- it cannot -- so "mine" is empty for them rather than
        // quietly showing somebody else's order as their own.
        const mine = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/purchase-orders?mine=true',
                headers: H['kitchen']!
            })
        ).json();
        expect(mine.total).toBe(0);

        // Reading is not restricted: a section can still see what the store is
        // buying for the branch, which is how they learn their shortfall is
        // being dealt with.
        const branch = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/purchase-orders',
                headers: H['kitchen']!
            })
        ).json();
        expect(branch.total).toBeGreaterThan(0);

        // And the raiser sees their own.
        const store = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/purchase-orders?mine=true',
                headers: H['storekeeper']!
            })
        ).json();
        expect(store.total).toBeGreaterThan(0);
        expect(store.items.every((p: { raisedBy: string }) => !!p.raisedBy)).toBe(true);
    });
});

describe('admin', () => {
    it('creates a login that can immediately sign in', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/v1/admin/users',
            headers: H['admin']!,
            payload: {
                name: `Test Kitchen ${randomUUID().slice(0, 8)}`,
                role: 'kitchen',
                locationId: 1,
                pin: '2468'
            }
        });
        expect(created.statusCode).toBe(201);

        const login = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { userId: created.json().id, locationId: 1, pin: '2468' }
        });
        expect(login.statusCode).toBe(200);
        expect(login.json().user.role).toBe('kitchen');
    });

    it('refuses a duplicate name - two identical tiles is a login nobody can pick', async () => {
        // The name is created here rather than assumed to exist. Asserting on a
        // fixed name left behind by an earlier run passes on a database that
        // has been used and fails on a freshly seeded one, which is exactly
        // backwards.
        const name = `Test Kitchen ${randomUUID().slice(0, 8)}`;
        const first = await app.inject({
            method: 'POST',
            url: '/api/v1/admin/users',
            headers: H['admin']!,
            payload: { name, role: 'kitchen', locationId: 1, pin: '1357' }
        });
        expect(first.statusCode).toBe(201);

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/admin/users',
            headers: H['admin']!,
            payload: { name, role: 'kitchen', locationId: 1, pin: '1357' }
        });
        expect(res.statusCode).toBe(409);
    });

    it('is the only role allowed to create logins', async () => {
        for (const role of ['management', 'storekeeper', 'kitchen', 'cleaning'] as const) {
            const res = await app.inject({
                method: 'POST',
                url: '/api/v1/admin/users',
                headers: H[role]!,
                payload: { name: `Sneaky ${role}`, role: 'management', locationId: 1, pin: '1111' }
            });
            expect(res.statusCode).toBe(403);
        }
    });

    it('will not let the last admin be switched off', async () => {
        const admin = await db
            .selectFrom('users')
            .select('id')
            .where('role', '=', 'admin')
            .where('is_active', '=', true)
            .executeTakeFirstOrThrow();

        const res = await app.inject({
            method: 'PATCH',
            url: `/api/v1/admin/users/${admin.id}`,
            headers: H['admin']!,
            payload: { isActive: false }
        });

        // Otherwise nobody can ever add a login again, and the failure is silent
        // until someone needs one.
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/only admin/i);
    });

    it('can put someone at any of the five branches', async () => {
        const branches = (
            await app.inject({ method: 'GET', url: '/api/v1/admin/branches', headers: H['admin']! })
        ).json();
        const codes = branches.map((b: { code: string }) => b.code);
        expect(codes).toEqual(expect.arrayContaining(['GB', 'ESP', 'TCL', 'KAT', 'BANQ']));

        const lounge = branches.find((b: { code: string }) => b.code === 'TCL');
        const created = await app.inject({
            method: 'POST',
            url: '/api/v1/admin/users',
            headers: H['admin']!,
            payload: {
                name: `Lounge Kitchen ${randomUUID().slice(0, 8)}`,
                role: 'kitchen',
                locationId: lounge.id,
                pin: '3690'
            }
        });
        expect(created.statusCode).toBe(201);

        // And they land at their own branch, not the Gastrobar.
        const login = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { userId: created.json().id, locationId: lounge.id, pin: '3690' }
        });
        expect(login.statusCode).toBe(200);
        expect(login.json().location.code).toBe('TCL');
    });
});

describe('branches do not leak into each other', () => {
    it('a Gastrobar login cannot act at the Coffee Lounge', async () => {
        const lounge = await db
            .selectFrom('locations')
            .select('id')
            .where('code', '=', 'TCL')
            .executeTakeFirstOrThrow();

        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/requests',
            headers: { ...H['kitchen']!, 'x-location-id': String(lounge.id) }
        });
        expect(res.statusCode).toBe(403);
    });
});
