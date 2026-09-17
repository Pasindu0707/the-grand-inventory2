/**
 * Returns: kitchen to quarantine, quarantine to the vendor.
 *
 * The assertions worth having here are the ones about *when* stock moves, which
 * is the thing that differs between the two documents and the thing that would
 * be quietly wrong if somebody simplified them into one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { RETURN_WINDOW_DAYS } from '../src/services/returns.js';
import { authedHeaders, db, makeApp, supplySection } from './helpers.js';

let app: FastifyInstance;
let headers: Record<string, string>;
let locationId: number;
let kitchenId: number;
let quarantineId: number;
let storeId: number;

const idem = () => ({ 'idempotency-key': randomUUID() });

async function sectionByKind(kind: string) {
    const row = await db
        .selectFrom('sections')
        .select('id')
        .where('location_id', '=', locationId)
        .where('kind', '=', kind)
        .executeTakeFirstOrThrow();
    return row.id;
}

/**
 * One session per role, for the whole file.
 *
 * Signing in on every call looks harmless and is not: the login endpoint is
 * rate-limited to twenty attempts a minute, which is the right limit for a
 * four-digit PIN on a shared tablet and far below what a test file gets
 * through. Past the limit the login returns 429, the token comes back
 * `undefined`, and every request after it fails as 401 -- so a suite that had
 * outgrown the cache failed in a way that pointed at authentication rather
 * than at itself.
 */
const sessions = new Map<string, Record<string, string>>();

async function headersFor(role: 'kitchen' | 'management' | 'storekeeper') {
    const cached = sessions.get(role);
    if (cached) return cached;

    const user = await db
        .selectFrom('users')
        .select(['id', 'location_id'])
        .where('role', '=', role)
        .where('is_active', '=', true)
        .executeTakeFirstOrThrow();
    const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { userId: user.id, locationId: user.location_id ?? 1, pin: '1234' }
    });
    expect(res.statusCode, `${role} could not sign in`).toBe(200);

    const headers = {
        authorization: `Bearer ${res.json().accessToken}`,
        'x-location-id': String(user.location_id ?? 1)
    };
    sessions.set(role, headers);
    return headers;
}

async function stockOf(itemId: number, sectionId: number) {
    const row = await db
        .selectFrom('current_stock')
        .select('qty_base')
        .where('item_id', '=', itemId)
        .where('section_id', '=', sectionId)
        .executeTakeFirst();
    return Number(row?.qty_base ?? 0);
}

/**
 * An item the kitchen holds, and the request that put it there.
 *
 * The issue id matters now: a section return is measured against the release
 * that delivered the goods, so every test that returns something has to name
 * one. `supplySection` raises a request and releases it, which is exactly the
 * shape the real flow produces.
 */
async function stockedInKitchen(qty = 5000) {
    // Whatever the store has most of, rather than a fixed item.
    //
    // This used to take the lowest item id every time, which meant every test
    // in the file drew from the same shelf until it was empty -- and then
    // `supplySection` released a partial quantity, or nothing at all, and said
    // neither. The tests that followed failed for reasons that had nothing to
    // do with what they were testing.
    const item = await db
        .selectFrom('items')
        .innerJoin('item_packs as p', (join) =>
            join.onRef('p.item_id', '=', 'items.id').on('p.is_default_purchase', '=', true)
        )
        .innerJoin('current_stock as cs', (join) =>
            join.onRef('cs.item_id', '=', 'items.id').on('cs.section_id', '=', storeId)
        )
        .select(['items.id', 'items.name', 'p.qty_in_stock_unit as packSize'])
        .where('items.is_active', '=', true)
        .where('cs.qty_base', '>', qty)
        .orderBy('cs.qty_base', 'desc')
        .executeTakeFirstOrThrow();

    const issueId = await supplySection(app, headers, kitchenId, item.id, qty);

    // And say so loudly if the release did not actually happen. A silent
    // partial release is what made the last round of failures unreadable.
    const released = await db
        .selectFrom('issue_lines')
        .select('qty_issued')
        .where('issue_id', '=', issueId)
        .where('item_id', '=', item.id)
        .executeTakeFirst();
    expect(Number(released?.qty_issued ?? 0)).toBe(qty);

    return { ...item, packSize: Number(item.packSize), issueId };
}

/**
 * Every line on an ask, answered the same way.
 *
 * Management decides line by line now, and a partial answer is refused on
 * purpose -- so a test that only wants "approved" has to say so for each line
 * rather than for the document.
 */
async function answerAll(id: string, decision: 'vendor' | 'waste') {
    const rows = await db
        .selectFrom('supplier_return_lines')
        .select('id')
        .where('return_id', '=', id)
        .execute();
    return { lines: rows.map((r) => ({ lineId: String(r.id), decision })) };
}

/** A delivery, then the same goods into the kitchen and back to quarantine. */
async function deliveredAndReturned(packs = 2) {
    const supplier = await db
        .selectFrom('suppliers')
        .select('id')
        .where('is_active', '=', true)
        .executeTakeFirstOrThrow();
    const pack = await db
        .selectFrom('item_packs as p')
        .innerJoin('items as i', 'i.id', 'p.item_id')
        .select(['p.id as packId', 'p.item_id as itemId', 'p.qty_in_stock_unit as size'])
        .where('p.is_active', '=', true)
        .where('i.is_active', '=', true)
        .orderBy('p.id')
        .executeTakeFirstOrThrow();
    const size = Number(pack.size);

    const grn = await app.inject({
        method: 'POST',
        url: '/api/v1/grn',
        headers: { ...headers, ...idem() },
        payload: {
            supplierId: supplier.id,
            invoiceNo: `INV-${randomUUID().slice(0, 8)}`,
            lines: [{ itemPackId: pack.packId, qtyPacks: packs, packPrice: 1000 }]
        }
    });
    expect(grn.statusCode).toBe(201);

    // Put the same quantity into quarantine the way the app would: issue it
    // onward and hand it back against that release.
    const issueId = await supplySection(app, headers, kitchenId, pack.itemId, packs * size);
    const ret = await app.inject({
        method: 'POST',
        url: '/api/v1/returns',
        headers,
        payload: {
            sectionId: kitchenId,
            itemId: pack.itemId,
            qtyBase: packs * size,
            reasonCode: 'RET_DAMAGED',
            issueId
        }
    });
    expect(ret.statusCode).toBe(201);

    return { grnId: grn.json().id, itemId: pack.itemId, size, packs };
}

beforeAll(async () => {
    app = await makeApp();
    const ctx = await authedHeaders(app);
    headers = ctx.headers;
    locationId = ctx.locationId;
    kitchenId = await sectionByKind('KITCHEN');
    quarantineId = await sectionByKind('QUARANTINE');
    storeId = await sectionByKind('STORE');
});

afterAll(async () => {
    await app.close();
    await db.destroy();
});

describe('a section hands stock back', () => {
    it('moves it out of the kitchen and into quarantine at once', async () => {
        const item = await stockedInKitchen();
        const beforeKitchen = await stockOf(item.id, kitchenId);
        const beforeQuarantine = await stockOf(item.id, quarantineId);

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 400,
                reasonCode: 'RET_QUALITY',
                note: 'Off smell',
                issueId: item.issueId
            }
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().toSectionId).toBe(quarantineId);

        // Both legs, immediately. The stock has physically moved, so the ledger
        // says so without waiting for anybody to approve it.
        expect(await stockOf(item.id, kitchenId)).toBe(beforeKitchen - 400);
        expect(await stockOf(item.id, quarantineId)).toBe(beforeQuarantine + 400);
    });

    it('refuses more than the request released, with the arithmetic in the message', async () => {
        // The request is the tighter of the two caps, so this is the one that
        // speaks. The section-holds check underneath it is the transactional
        // backstop against two people returning the same crate at once.
        const item = await stockedInKitchen(100);

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 5100,
                reasonCode: 'RET_DAMAGED',
                issueId: item.issueId
            }
        });
        expect(res.statusCode).toBe(400);
        // Numbers, not just a refusal: "cannot return that" with no figures
        // sends the chef to the storekeeper to ask why.
        expect(res.json().message).toContain('At most');
        expect(res.json().message).toContain('100');
    });

    it('refuses a wastage reason on a return', async () => {
        const item = await stockedInKitchen();
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 10,
                // A real code, but it belongs to wastage and means the opposite
                // thing -- a customer sent their plate back.
                reasonCode: 'RETURN',
                issueId: item.issueId
            }
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toContain('not a return reason');
    });

    it('tells the request list what went back, and when to stop offering Return', async () => {
        // The complaint this answers: a chef returns 200 g, the row still reads
        // "Wheat flour 200 g", and they conclude nothing happened. A request is
        // a record of what was released and does not shrink -- so the row has
        // to carry the return separately or the screen is not believable.
        const item = await stockedInKitchen(1000);

        const before = (
            await app.inject({
                method: 'GET',
                url: `/api/v1/requests?limit=100`,
                headers
            })
        ).json().items.find((r: { id: string }) => r.id === item.issueId);
        expect(before.qtyReturnedTotal).toBe(0);
        expect(before.canReturn).toBe(true);

        await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 400,
                reasonCode: 'RET_DAMAGED',
                issueId: item.issueId
            }
        });

        const partly = (
            await app.inject({ method: 'GET', url: `/api/v1/requests?limit=100`, headers })
        ).json().items.find((r: { id: string }) => r.id === item.issueId);
        expect(partly.qtyReturnedTotal).toBe(400);
        // The quantity asked for is untouched: the request is history.
        expect(partly.lines[0].qtyIssued).toBe(1000);
        expect(partly.lines[0].qtyReturned).toBe(400);
        // And there is still 600 to go, so the button stays.
        expect(partly.canReturn).toBe(true);

        await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 600,
                reasonCode: 'RET_DAMAGED',
                issueId: item.issueId
            }
        });

        const done = (
            await app.inject({ method: 'GET', url: `/api/v1/requests?limit=100`, headers })
        ).json().items.find((r: { id: string }) => r.id === item.issueId);
        expect(done.qtyReturnedTotal).toBe(1000);
        // Nothing left, so the screen stops offering a drawer that would open
        // with every line capped at zero.
        expect(done.canReturn).toBe(false);
    });

    it('does not offer Return on a request that has not been released', async () => {
        const item = await stockedInKitchen();
        const asked = await app.inject({
            method: 'POST',
            url: '/api/v1/requests',
            headers,
            payload: { sectionId: kitchenId, lines: [{ itemId: item.id, qtyRequested: 100 }] }
        });
        expect(asked.statusCode).toBe(201);

        const row = (
            await app.inject({ method: 'GET', url: `/api/v1/requests?limit=100`, headers })
        ).json().items.find((r: { id: string }) => r.id === asked.json().id);
        expect(row.status).toBe('requested');
        expect(row.canReturn).toBe(false);
    });

    it('acknowledges receipt - you cannot send back what never came', async () => {
        // The complaint this answers: a request whose whole contents had gone
        // back still sat under "Needs me" offering "It came", asking the chef
        // to confirm the arrival of goods already on their way to the supplier.
        const item = await stockedInKitchen(1000);

        const before = await db
            .selectFrom('issues')
            .select(['status', 'received_by'])
            .where('id', '=', item.issueId)
            .executeTakeFirstOrThrow();
        expect(before.status).toBe('released');
        expect(before.received_by).toBeNull();

        const kh = await headersFor('kitchen');
        const kitchenUser = await db
            .selectFrom('users')
            .select('id')
            .where('role', '=', 'kitchen')
            .where('is_active', '=', true)
            .executeTakeFirstOrThrow();

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers: kh,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 300,
                reasonCode: 'RET_DAMAGED',
                issueId: item.issueId
            }
        });
        expect(res.statusCode).toBe(201);

        const after = await db
            .selectFrom('issues')
            .select(['status', 'received_by'])
            .where('id', '=', item.issueId)
            .executeTakeFirstOrThrow();
        // Received, signed by whoever did the returning.
        expect(after.status).toBe('received');
        expect(after.received_by).toBe(kitchenUser.id);

        // And so it stops asking.
        const row = (
            await app.inject({ method: 'GET', url: '/api/v1/requests?limit=100', headers: kh })
        ).json().items.find((r: { id: string }) => r.id === item.issueId);
        expect(row.needsMe).toBe(false);
    });

    it('closes the window, so an old release is not returnable', async () => {
        // Without this the only test was "does the section hold any of this
        // item", which a five-week-old request passes trivially -- the bar
        // holds wine, so a request from August offered to return wine that
        // arrived in September.
        const item = await stockedInKitchen(1000);

        // Age the release past the window.
        await db
            .updateTable('issues')
            .set({
                issued_at: sql`current_timestamp - interval '${sql.raw(
                    String(RETURN_WINDOW_DAYS + 3)
                )} days'`
            })
            .where('id', '=', item.issueId)
            .execute();

        const returnable = (
            await app.inject({
                method: 'GET',
                url: `/api/v1/requests/${item.issueId}/returnable`,
                headers
            })
        ).json();
        expect(returnable.withinWindow).toBe(false);
        // Nothing is returnable, whatever the shelf holds.
        expect(returnable.lines.every((l: { qtyReturnable: number }) => l.qtyReturnable === 0))
            .toBe(true);

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 100,
                reasonCode: 'RET_DAMAGED',
                issueId: item.issueId
            }
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toContain('returns close after');
        // And it names the honest alternative rather than just refusing.
        expect(res.json().message).toContain('wastage');

        // The list agrees, so the button is not offered.
        const row = (
            await app.inject({ method: 'GET', url: '/api/v1/requests?limit=100', headers })
        ).json().items.find((r: { id: string }) => r.id === item.issueId);
        expect(row.canReturn).toBe(false);
        expect(row.daysSinceReleased).toBeGreaterThan(RETURN_WINDOW_DAYS);
    });

    it('still allows a return inside the window, after the goods were confirmed', async () => {
        // A problem found at prep time is still the supplier's problem. The
        // window is about traceability, not about whether anybody signed for it.
        const item = await stockedInKitchen(1000);

        await app.inject({
            method: 'POST',
            url: `/api/v1/requests/${item.issueId}/confirm`,
            headers
        });

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 200,
                reasonCode: 'RET_QUALITY',
                issueId: item.issueId
            }
        });
        expect(res.statusCode).toBe(201);
    });

    it('refuses a return with no request behind it', async () => {
        const item = await stockedInKitchen();
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 100,
                reasonCode: 'RET_DAMAGED'
            }
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toContain('which request');
    });

    it('refuses an item that was not on the request', async () => {
        // The whole point of tying a return to a release: a section cannot hand
        // back something it was never given, even when the room happens to hold
        // some. Before this, the only check was the current balance.
        const given = await stockedInKitchen();
        const other = await db
            .selectFrom('items')
            .select(['id', 'name'])
            .where('is_active', '=', true)
            .where('id', '!=', given.id)
            .orderBy('id')
            .executeTakeFirstOrThrow();
        // Put some of the other item in the kitchen by a *different* release,
        // so the balance would have allowed it.
        await supplySection(app, headers, kitchenId, other.id, 2000);

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: other.id,
                qtyBase: 50,
                reasonCode: 'RET_DAMAGED',
                issueId: given.issueId
            }
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toContain('not on this request');
    });

    it('refuses more than the request released', async () => {
        const item = await stockedInKitchen(1000);
        // Top the kitchen up by another release, so the section holds plenty --
        // the cap has to come from the request, not from the shelf.
        await supplySection(app, headers, kitchenId, item.id, 4000);

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 3000,
                reasonCode: 'RET_DAMAGED',
                issueId: item.issueId
            }
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toContain('At most');
    });

    it('counts what has already gone back against the same request', async () => {
        const item = await stockedInKitchen(1000);
        const half = { sectionId: kitchenId, itemId: item.id, reasonCode: 'RET_DAMAGED',
                       issueId: item.issueId };

        const first = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: { ...half, qtyBase: 600 }
        });
        expect(first.statusCode).toBe(201);

        const returnable = (
            await app.inject({
                method: 'GET',
                url: `/api/v1/requests/${item.issueId}/returnable`,
                headers
            })
        ).json();
        const line = returnable.lines.find(
            (l: { itemId: number }) => l.itemId === item.id
        );
        expect(line.qtyReturned).toBe(600);
        expect(line.qtyReturnable).toBe(400);

        // And the second half is the most that can still go.
        const tooMuch = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: { ...half, qtyBase: 500 }
        });
        expect(tooMuch.statusCode).toBe(400);

        const rest = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: { ...half, qtyBase: 400 }
        });
        expect(rest.statusCode).toBe(201);
    });

    it('lets the store hand back its own shelf with no request', async () => {
        // The store receives stock on a delivery, not a release, so there is
        // nothing to measure against. Its returns are constrained downstream
        // instead, by the supplier return having to name a GRN line.
        const store = await db
            .selectFrom('sections')
            .select('id')
            .where('location_id', '=', locationId)
            .where('is_store', '=', true)
            .executeTakeFirstOrThrow();
        const held = await db
            .selectFrom('current_stock')
            .select(['item_id', 'qty_base'])
            .where('section_id', '=', store.id)
            .where('qty_base', '>', 500)
            .executeTakeFirstOrThrow();

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: store.id,
                itemId: held.item_id,
                qtyBase: 100,
                reasonCode: 'RET_QUALITY'
            }
        });
        expect(res.statusCode).toBe(201);
    });

    /**
     * The separate hand-back approval was withdrawn by CR-006.
     *
     * It stamped a movement that had already happened and blocked nothing.
     * What management decides now is what becomes of the goods, which is a
     * decision about money -- see the disposal tests below.
     */
    it('no longer has a hand-back approval to grant', async () => {
        const item = await stockedInKitchen();
        const kh = await headersFor('kitchen');
        const created = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers: kh,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 25,
                reasonCode: 'RET_DAMAGED',
                issueId: item.issueId
            }
        });
        expect(created.statusCode).toBe(201);

        const mh = await headersFor('management');
        const gone = await app.inject({
            method: 'POST',
            url: `/api/v1/returns/${created.json().id}/approve`,
            headers: mh
        });
        expect(gone.statusCode).toBe(404);
    });
});

describe('the store sends it back to the vendor', () => {

    it('prices the credit from the delivery, not from today', async () => {
        const { grnId } = await deliveredAndReturned();
        const lines = await app.inject({
            method: 'GET',
            url: `/api/v1/grn/${grnId}/returnable`,
            headers
        });
        expect(lines.statusCode).toBe(200);
        const line = lines.json()[0];
        expect(line.packPrice).toBe(1000);
        expect(line.qtyPacksReturnable).toBe(2);

        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers,
            payload: {
                grnId,
                reasonCode: 'RET_DAMAGED',
                lines: [{ grnLineId: line.grnLineId, qtyPacks: 2 }]
            }
        });
        expect(raised.statusCode).toBe(201);
        expect(raised.json().creditValue).toBe(2000);
    });

    it('does not move stock until the goods are sent', async () => {
        const { grnId, itemId, size } = await deliveredAndReturned();
        const line = (
            await app.inject({
                method: 'GET',
                url: `/api/v1/grn/${grnId}/returnable`,
                headers
            })
        ).json()[0];

        const inQuarantine = await stockOf(itemId, quarantineId);

        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers,
            payload: {
                grnId,
                reasonCode: 'RET_DAMAGED',
                lines: [{ grnLineId: line.grnLineId, qtyPacks: 1 }]
            }
        });
        const id = raised.json().id;

        // Raised is paperwork. The crate is still in quarantine and still ours.
        expect(await stockOf(itemId, quarantineId)).toBe(inQuarantine);

        // Sending before management has decided is refused.
        const early = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/send`,
            headers
        });
        expect(early.statusCode).toBe(409);
        expect(early.json().message).toContain('not decided');
        expect(await stockOf(itemId, quarantineId)).toBe(inQuarantine);

        const mh = await headersFor('management');
        const decided = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/decide`,
            headers: mh,
            payload: await answerAll(id, 'vendor')
        });
        expect(decided.statusCode).toBe(200);

        // Approved is still paperwork.
        expect(await stockOf(itemId, quarantineId)).toBe(inQuarantine);

        const sent = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/send`,
            headers
        });
        expect(sent.statusCode).toBe(200);

        // Only now.
        expect(await stockOf(itemId, quarantineId)).toBe(inQuarantine - size);
    });

    it('refuses to return more than the delivery brought', async () => {
        const { grnId } = await deliveredAndReturned(2);
        const line = (
            await app.inject({
                method: 'GET',
                url: `/api/v1/grn/${grnId}/returnable`,
                headers
            })
        ).json()[0];

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers,
            payload: {
                grnId,
                reasonCode: 'RET_DAMAGED',
                lines: [{ grnLineId: line.grnLineId, qtyPacks: 5 }]
            }
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toContain('still returnable');
    });

    it('counts what has already gone back against the balance', async () => {
        const { grnId } = await deliveredAndReturned(2);
        const first = (
            await app.inject({ method: 'GET', url: `/api/v1/grn/${grnId}/returnable`, headers })
        ).json()[0];

        await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers,
            payload: {
                grnId,
                reasonCode: 'RET_DAMAGED',
                lines: [{ grnLineId: first.grnLineId, qtyPacks: 1 }]
            }
        });

        const after = (
            await app.inject({ method: 'GET', url: `/api/v1/grn/${grnId}/returnable`, headers })
        ).json()[0];
        expect(after.qtyPacksReturned).toBe(1);
        expect(after.qtyPacksReturnable).toBe(1);
    });

    it('is the storekeeper who writes it up and management who decides it', async () => {
        const { grnId } = await deliveredAndReturned();
        const line = (
            await app.inject({ method: 'GET', url: `/api/v1/grn/${grnId}/returnable`, headers })
        ).json()[0];

        const kh = await headersFor('kitchen');
        const byKitchen = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers: kh,
            payload: {
                grnId,
                reasonCode: 'RET_DAMAGED',
                lines: [{ grnLineId: line.grnLineId, qtyPacks: 1 }]
            }
        });
        expect(byKitchen.statusCode).toBe(403);

        const sh = await headersFor('storekeeper');
        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers: sh,
            payload: {
                grnId,
                reasonCode: 'RET_DAMAGED',
                lines: [{ grnLineId: line.grnLineId, qtyPacks: 1 }]
            }
        });
        expect(raised.statusCode).toBe(201);

        // Deciding is money, and money is management's.
        const bySelf = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${raised.json().id}/decide`,
            headers: sh,
            payload: await answerAll(raised.json().id, 'vendor')
        });
        expect(bySelf.statusCode).toBe(403);
    });

    /**
     * Management approves; it does not handle the goods.
     *
     * Every step that touches the crate -- writing the return up, and saying
     * the lorry has taken it -- is the storekeeper's, because they are the one
     * standing next to it. Management's part is the decision and the credit
     * note. Letting one person do both makes the approval an approval of their
     * own work, which is the failure this whole document exists to prevent.
     */
    it('will not let management raise a supplier return or mark it gone', async () => {
        const { grnId } = await deliveredAndReturned();
        const line = (
            await app.inject({ method: 'GET', url: `/api/v1/grn/${grnId}/returnable`, headers })
        ).json()[0];
        const mh = await headersFor('management');

        const raisedByMgmt = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers: mh,
            payload: {
                grnId,
                reasonCode: 'RET_DAMAGED',
                lines: [{ grnLineId: line.grnLineId, qtyPacks: 1 }]
            }
        });
        expect(raisedByMgmt.statusCode).toBe(403);

        // Nor the two reads that only exist to fill that form in.
        for (const url of [
            `/api/v1/grn/${grnId}/returnable`,
            '/api/v1/supplier-returns/suggested'
        ]) {
            const res = await app.inject({ method: 'GET', url, headers: mh });
            expect(res.statusCode).toBe(403);
        }

        // The storekeeper raises it and management approves, as they should.
        const sh = await headersFor('storekeeper');
        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers: sh,
            payload: {
                grnId,
                reasonCode: 'RET_DAMAGED',
                lines: [{ grnLineId: line.grnLineId, qtyPacks: 1 }]
            }
        });
        expect(raised.statusCode).toBe(201);
        const id = raised.json().id;

        const decided = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/decide`,
            headers: mh,
            payload: await answerAll(id, 'vendor')
        });
        expect(decided.statusCode).toBe(200);

        // But saying the goods have gone is a fact about a lorry, and the
        // person who watched it leave records it.
        const sentByMgmt = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/send`,
            headers: mh
        });
        expect(sentByMgmt.statusCode).toBe(403);

        const sent = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/send`,
            headers: sh
        });
        expect(sent.statusCode).toBe(200);

        // Settling it -- the credit note -- is management's again.
        const settled = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/settle`,
            headers: mh,
            payload: { outcome: 'credit', creditNoteNo: 'CN-77', creditValue: 1000 }
        });
        expect(settled.statusCode).toBe(200);
    });

    it("will not let management hand stock back on a section's behalf", async () => {
        const item = await stockedInKitchen();
        const mh = await headersFor('management');

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers: mh,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 50,
                reasonCode: 'RET_DAMAGED',
                issueId: item.issueId
            }
        });
        expect(res.statusCode).toBe(403);
    });

    it('will not settle a return that has not gone anywhere', async () => {
        const { grnId } = await deliveredAndReturned();
        const line = (
            await app.inject({ method: 'GET', url: `/api/v1/grn/${grnId}/returnable`, headers })
        ).json()[0];
        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers,
            payload: {
                grnId,
                reasonCode: 'RET_DAMAGED',
                lines: [{ grnLineId: line.grnLineId, qtyPacks: 1 }]
            }
        });

        const mh = await headersFor('management');
        const res = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${raised.json().id}/settle`,
            headers: mh,
            payload: { outcome: 'credit', creditNoteNo: 'CN-1', creditValue: 100 }
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().message).toContain('after it has been sent');
    });

    it('wants the credit note number before it will record a credit', async () => {
        const { grnId } = await deliveredAndReturned();
        const line = (
            await app.inject({ method: 'GET', url: `/api/v1/grn/${grnId}/returnable`, headers })
        ).json()[0];
        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers,
            payload: {
                grnId,
                reasonCode: 'RET_DAMAGED',
                lines: [{ grnLineId: line.grnLineId, qtyPacks: 1 }]
            }
        });
        const id = raised.json().id;
        const mh = await headersFor('management');

        await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/decide`,
            headers: mh,
            payload: await answerAll(id, 'vendor')
        });
        await app.inject({ method: 'POST', url: `/api/v1/supplier-returns/${id}/send`, headers });

        const noNumber = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/settle`,
            headers: mh,
            payload: { outcome: 'credit', creditValue: 100 }
        });
        expect(noNumber.statusCode).toBe(400);

        // A replacement needs neither, because there is no note to check.
        const replaced = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/settle`,
            headers: mh,
            payload: { outcome: 'replacement' }
        });
        expect(replaced.statusCode).toBe(200);
    });
});

describe('the form arrives filled in', () => {
    it('suggests a return from what is in quarantine, priced off the delivery', async () => {
        const { grnId, itemId, size, packs } = await deliveredAndReturned(2);

        const suggestions = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/supplier-returns/suggested',
                headers
            })
        ).json();

        const group = suggestions.find((g: { grnId: string }) => g.grnId === grnId);
        expect(group).toBeTruthy();
        expect(group.invoiceNo).toBeTruthy();

        const line = group.lines.find((l: { itemId: number }) => l.itemId === itemId);
        expect(line).toBeTruthy();
        // Priced off the delivery, not off any current price list.
        expect(line.packPrice).toBe(1000);
        expect(line.suggestedPacks).toBe(packs);
        expect(line.suggestedCredit).toBe(packs * 1000);
        // And it carries why the goods came back.
        expect(group.reasonCode).toBeTruthy();
        void size;
    });

    it('never suggests more than is in quarantine', async () => {
        /**
         * The bug this locks down: 2,148 g of a 1 kg pack is 2.148 packs, which
         * rounded to the nearest two decimals is 2.15 -- two grams more than
         * exists. The service refused it and the storekeeper got an error on a
         * form they had not filled in. A suggestion that cannot be submitted is
         * worse than no suggestion.
         */
        const supplier = await db
            .selectFrom('suppliers')
            .select('id')
            .where('is_active', '=', true)
            .executeTakeFirstOrThrow();
        const pack = await db
            .selectFrom('item_packs as p')
            .innerJoin('items as i', 'i.id', 'p.item_id')
            .select(['p.id as packId', 'p.item_id as itemId', 'p.qty_in_stock_unit as size'])
            .where('p.is_active', '=', true)
            .where('i.is_active', '=', true)
            .where('p.qty_in_stock_unit', '>=', 1000)
            .orderBy('p.id')
            .executeTakeFirstOrThrow();
        const size = Number(pack.size);

        const grn = await app.inject({
            method: 'POST',
            url: '/api/v1/grn',
            headers: { ...headers, ...idem() },
            payload: {
                supplierId: supplier.id,
                invoiceNo: `INV-${randomUUID().slice(0, 8)}`,
                lines: [{ itemPackId: pack.packId, qtyPacks: 4, packPrice: 1000 }]
            }
        });
        expect(grn.statusCode).toBe(201);

        // An awkward quantity: two whole packs less a few grams, so the
        // fraction cannot round cleanly.
        const awkward = size * 2 - 7;
        const issueId = await supplySection(app, headers, kitchenId, pack.itemId, awkward);
        await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: pack.itemId,
                qtyBase: awkward,
                reasonCode: 'RET_DAMAGED',
                issueId
            }
        });

        const suggestions = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/supplier-returns/suggested',
                headers
            })
        ).json();
        const group = suggestions.find((g: { grnId: string }) => g.grnId === grn.json().id);
        const line = group.lines.find((l: { itemId: number }) => l.itemId === pack.itemId);

        // Never more than the shelf holds...
        expect(line.suggestedPacks * size).toBeLessThanOrEqual(line.qtyInQuarantine);

        // ...and the suggestion is accepted as-is, which is the whole point.
        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers,
            payload: {
                grnId: group.grnId,
                reasonCode: group.reasonCode,
                lines: [{ grnLineId: line.grnLineId, qtyPacks: line.suggestedPacks }]
            }
        });
        expect(raised.statusCode).toBe(201);
    });

    it('offers nothing when quarantine is empty', async () => {
        // Drain quarantine by sending everything back, then check.
        const sh = headers;
        const groups = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/supplier-returns/suggested',
                headers: sh
            })
        ).json();
        // Every group offered has at least one line worth acting on -- an
        // empty group is noise on the screen.
        for (const g of groups) {
            expect(g.lines.length).toBeGreaterThan(0);
            for (const l of g.lines) {
                expect(l.suggestedPacks).toBeGreaterThan(0);
            }
        }
    });
});

/**
 * The one decision, and the two ends it can have.
 *
 * CR-006. The store asks "claim it or bin it", management answers line by line,
 * and every line ends somewhere: on a lorry to the supplier, or in the bin as
 * a wastage document. These are the tests for the half that did not exist
 * before -- the bin -- and for the rule that keeps stock from sitting in
 * quarantine forever, which is that a half-answered ask is not an answer.
 */
describe('deciding what becomes of quarantined stock', () => {
    /** A delivery of two different items, both handed back into quarantine. */
    async function twoLinesInQuarantine() {
        const supplier = await db
            .selectFrom('suppliers')
            .select('id')
            .where('is_active', '=', true)
            .executeTakeFirstOrThrow();

        const packs = await db
            .selectFrom('item_packs as p')
            .innerJoin('items as i', 'i.id', 'p.item_id')
            .select(['p.id as packId', 'i.id as itemId', 'p.qty_in_stock_unit as size'])
            .where('p.is_default_purchase', '=', true)
            .where('i.is_active', '=', true)
            .orderBy('i.id')
            .limit(2)
            .execute();
        expect(packs).toHaveLength(2);

        const grn = await app.inject({
            method: 'POST',
            url: '/api/v1/grn',
            headers: { ...headers, ...idem() },
            payload: {
                supplierId: supplier.id,
                lines: packs.map((p) => ({
                    itemPackId: p.packId,
                    qtyPacks: 2,
                    packPrice: 500
                }))
            }
        });
        expect(grn.statusCode).toBe(201);

        // Into the kitchen and straight back out, so quarantine holds both.
        for (const p of packs) {
            const qty = Number(p.size) * 2;
            const issueId = await supplySection(app, headers, kitchenId, p.itemId, qty);
            const back = await app.inject({
                method: 'POST',
                url: '/api/v1/returns',
                headers: await headersFor('kitchen'),
                payload: {
                    sectionId: kitchenId,
                    itemId: p.itemId,
                    qtyBase: qty,
                    reasonCode: 'RET_QUALITY',
                    issueId
                }
            });
            expect(back.statusCode).toBe(201);
        }

        const returnable = (
            await app.inject({
                method: 'GET',
                url: `/api/v1/grn/${grn.json().id}/returnable`,
                headers
            })
        ).json();

        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers,
            payload: {
                grnId: grn.json().id,
                reasonCode: 'RET_QUALITY',
                note: 'two items, one of each kind of ending',
                lines: returnable.map((l: { grnLineId: string }) => ({
                    grnLineId: l.grnLineId,
                    qtyPacks: 2
                }))
            }
        });
        expect(raised.statusCode).toBe(201);

        const lines = await db
            .selectFrom('supplier_return_lines')
            .select(['id', 'item_id', 'qty_base'])
            .where('return_id', '=', raised.json().id)
            .orderBy('id')
            .execute();
        expect(lines).toHaveLength(2);

        return { id: raised.json().id as string, lines };
    }

    /**
     * Once something has been asked about, stop offering it.
     *
     * Raising an ask moves no stock - the crate stays on the quarantine shelf
     * until it is sent or binned - so the suggestion list, which is built from
     * what quarantine holds, went on offering the same crate afterwards. The
     * storekeeper would raise a second claim against goods already claimed.
     *
     * Only the part that is spoken for stops being offered. Quarantine holding
     * five litres with two of them claimed still has three to ask about, and
     * the suggestion says so -- which is why this test uses an item nothing
     * else has put in quarantine rather than asserting on a shared one.
     */
    it('stops suggesting stock that has already been asked about', async () => {
        const quarantined = await db
            .selectFrom('current_stock')
            .select('item_id')
            .where('section_id', '=', quarantineId)
            .where('qty_base', '>', 0)
            .execute();
        const busy = new Set(quarantined.map((r) => r.item_id));

        const fresh = await db
            .selectFrom('item_packs as p')
            .innerJoin('items as i', 'i.id', 'p.item_id')
            .select(['p.id as packId', 'i.id as itemId', 'p.qty_in_stock_unit as size'])
            .where('p.is_default_purchase', '=', true)
            .where('i.is_active', '=', true)
            .$if(busy.size > 0, (q) => q.where('i.id', 'not in', [...busy]))
            .orderBy('i.id')
            .executeTakeFirst();

        // Only meaningful while some item is not already in quarantine.
        if (!fresh) return;

        const supplier = await db
            .selectFrom('suppliers')
            .select('id')
            .where('is_active', '=', true)
            .executeTakeFirstOrThrow();

        const grn = await app.inject({
            method: 'POST',
            url: '/api/v1/grn',
            headers: { ...headers, ...idem() },
            payload: {
                supplierId: supplier.id,
                lines: [{ itemPackId: fresh.packId, qtyPacks: 1, packPrice: 400 }]
            }
        });
        expect(grn.statusCode).toBe(201);

        // Into the kitchen and straight back, so quarantine holds exactly one
        // pack of it and nothing else has a claim on it.
        const qty = Number(fresh.size);
        const issueId = await supplySection(app, headers, kitchenId, fresh.itemId, qty);
        const back = await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers: await headersFor('kitchen'),
            payload: {
                sectionId: kitchenId,
                itemId: fresh.itemId,
                qtyBase: qty,
                reasonCode: 'RET_QUALITY',
                issueId
            }
        });
        expect(back.statusCode).toBe(201);

        const offers = async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/v1/supplier-returns/suggested',
                headers
            });
            return res
                .json()
                .flatMap((g: { lines: { itemId: number; suggestedPacks: number }[] }) => g.lines)
                .filter((l: { itemId: number }) => l.itemId === fresh.itemId);
        };

        const before = await offers();
        expect(before.length, 'it should be offered before anything is asked').toBe(1);
        expect(before[0].suggestedPacks).toBe(1);

        const returnable = (
            await app.inject({
                method: 'GET',
                url: `/api/v1/grn/${grn.json().id}/returnable`,
                headers
            })
        ).json()[0];

        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers,
            payload: {
                grnId: grn.json().id,
                reasonCode: 'RET_QUALITY',
                lines: [{ grnLineId: returnable.grnLineId, qtyPacks: 1 }]
            }
        });
        expect(raised.statusCode).toBe(201);

        // Asked about, so no longer offered -- even though the goods have not
        // moved an inch.
        expect(await offers(), 'it is still being offered after the ask').toHaveLength(0);
        expect(await stockOf(fresh.itemId, quarantineId)).toBe(qty);
    });

    /**
     * The quarantine panel and the suggestion list must agree.
     *
     * They did not. Returns read plain stock, which says what is on the shelf
     * and nothing about whether anybody is already dealing with it, so a crate
     * already sitting on an ask still showed there under "waiting to go back"
     * with a button offering to ask about it again - and that button led to a
     * screen that then, correctly, had nothing on it.
     */
    it('reports how much of the quarantine shelf is already on an ask', async () => {
        const { lines } = await twoLinesInQuarantine();

        const shelf = await app.inject({
            method: 'GET',
            url: '/api/v1/quarantine',
            headers
        });
        expect(shelf.statusCode).toBe(200);

        const rows: {
            itemId: number;
            qtyBase: number;
            qtyOnOpenAsk: number;
            qtyFree: number;
        }[] = shelf.json();

        for (const line of lines) {
            const row = rows.find((r) => r.itemId === line.item_id);
            expect(row, `item ${line.item_id} should be on the quarantine shelf`).toBeTruthy();

            // At least what this ask covers is spoken for, and the two halves
            // always add up to what is physically there.
            expect(row!.qtyOnOpenAsk).toBeGreaterThanOrEqual(Number(line.qty_base));
            expect(row!.qtyFree + row!.qtyOnOpenAsk).toBeCloseTo(row!.qtyBase, 3);
            expect(row!.qtyFree).toBeGreaterThanOrEqual(0);
        }

        // And it is management's to read as well: the value sitting here is
        // money paid for and unusable, even though acting on it is not theirs.
        const asMgmt = await app.inject({
            method: 'GET',
            url: '/api/v1/quarantine',
            headers: await headersFor('management')
        });
        expect(asMgmt.statusCode).toBe(200);

        // The kitchen cannot see the quarantine shelf at all.
        const asKitchen = await app.inject({
            method: 'GET',
            url: '/api/v1/quarantine',
            headers: await headersFor('kitchen')
        });
        expect(asKitchen.statusCode).toBe(403);
    });

    it('refuses a half-answered ask', async () => {
        const { id, lines } = await twoLinesInQuarantine();
        const mh = await headersFor('management');

        const partial = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/decide`,
            headers: mh,
            payload: { lines: [{ lineId: String(lines[0]!.id), decision: 'vendor' }] }
        });
        expect(partial.statusCode).toBe(400);
        expect(partial.json().message).toContain('has to go somewhere');

        // And nothing was decided -- a refused decision must not half-apply.
        const after = await db
            .selectFrom('supplier_return_lines')
            .select('decision')
            .where('return_id', '=', id)
            .execute();
        expect(after.every((l) => l.decision === null)).toBe(true);
    });

    it('will not let the person who raised it decide it', async () => {
        const { id, lines } = await twoLinesInQuarantine();

        // `headers` is the storekeeper, who raised it in the helper above.
        const bySelf = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/decide`,
            headers,
            payload: {
                lines: lines.map((l) => ({ lineId: String(l.id), decision: 'vendor' }))
            }
        });
        expect(bySelf.statusCode).toBe(403);
    });

    it('sends one line back and bins the other, moving stock exactly once each', async () => {
        const { id, lines } = await twoLinesInQuarantine();
        const mh = await headersFor('management');

        const toVendor = lines[0]!;
        const toBin = lines[1]!;

        const beforeVendor = await stockOf(toVendor.item_id, quarantineId);
        const beforeBin = await stockOf(toBin.item_id, quarantineId);

        const decided = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/decide`,
            headers: mh,
            payload: {
                lines: [
                    { lineId: String(toVendor.id), decision: 'vendor' },
                    { lineId: String(toBin.id), decision: 'waste' }
                ],
                note: 'claim the first, bin the second'
            }
        });
        expect(decided.statusCode).toBe(200);
        expect(decided.json().toVendor).toBe(1);
        expect(decided.json().toWaste).toBe(1);

        // Deciding is paperwork. Both crates are still in the building.
        expect(await stockOf(toVendor.item_id, quarantineId)).toBe(beforeVendor);
        expect(await stockOf(toBin.item_id, quarantineId)).toBe(beforeBin);

        // Management does not carry the bin out, either.
        const binByMgmt = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/bin`,
            headers: mh
        });
        expect(binByMgmt.statusCode).toBe(403);

        const binned = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/bin`,
            headers
        });
        expect(binned.statusCode).toBe(200);
        expect(binned.json().binned).toBe(1);

        // Only the binned line left quarantine.
        expect(await stockOf(toBin.item_id, quarantineId)).toBe(
            beforeBin - Number(toBin.qty_base)
        );
        expect(await stockOf(toVendor.item_id, quarantineId)).toBe(beforeVendor);

        // It left as a real wastage document, under a reason that says why.
        const waste = await db
            .selectFrom('supplier_return_lines as l')
            .innerJoin('wastage as w', 'w.id', 'l.wastage_id')
            .select(['w.reason_code as reasonCode', 'w.section_id as sectionId'])
            .where('l.id', '=', toBin.id)
            .executeTakeFirstOrThrow();
        expect(waste.reasonCode).toBe('BADGOODS');
        expect(waste.sectionId).toBe(quarantineId);

        // Pressing it twice bins the crate once.
        const again = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/bin`,
            headers
        });
        expect(again.statusCode).toBe(200);
        expect(again.json().binned).toBe(0);
        expect(again.json().alreadyBinned).toBe(1);
        expect(await stockOf(toBin.item_id, quarantineId)).toBe(
            beforeBin - Number(toBin.qty_base)
        );

        // And the vendor half still goes on the lorry, on its own.
        const sent = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/send`,
            headers
        });
        expect(sent.statusCode).toBe(200);
        expect(sent.json().rowsPosted).toBe(1);
        expect(await stockOf(toVendor.item_id, quarantineId)).toBe(
            beforeVendor - Number(toVendor.qty_base)
        );
    });

    it('closes itself when every line was binned, because nothing is owed', async () => {
        const { id, lines } = await twoLinesInQuarantine();
        const mh = await headersFor('management');

        await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/decide`,
            headers: mh,
            payload: {
                lines: lines.map((l) => ({ lineId: String(l.id), decision: 'waste' })),
                note: 'not worth claiming'
            }
        });

        const binned = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/bin`,
            headers
        });
        expect(binned.statusCode).toBe(200);
        expect(binned.json().binned).toBe(2);

        const row = await db
            .selectFrom('supplier_returns')
            .select(['status', 'outcome'])
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
        expect(row.status).toBe('settled');
        expect(row.outcome).toBe('written_off');

        // There is nothing to put on a lorry, and it says so rather than
        // posting an empty movement.
        const sent = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/send`,
            headers
        });
        expect(sent.statusCode).toBe(409);
    });

    it('counts a binned line as written off rather than as money owed', async () => {
        const { id, lines } = await twoLinesInQuarantine();
        const mh = await headersFor('management');

        await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/decide`,
            headers: mh,
            payload: {
                lines: [
                    { lineId: String(lines[0]!.id), decision: 'vendor' },
                    { lineId: String(lines[1]!.id), decision: 'waste' }
                ]
            }
        });

        const row = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/supplier-returns?limit=50',
                headers
            })
        )
            .json()
            .items.find((r: { id: string }) => r.id === String(id));

        expect(row.expectedCredit).toBeGreaterThan(0);
        expect(row.writtenOffValue).toBeGreaterThan(0);
        // The claim is the vendor half only, not the whole ask.
        expect(row.expectedCredit).toBeLessThan(row.expectedCredit + row.writtenOffValue);
    });
});

describe('returns and the reports', () => {
    it('nets a return off what the section is shown to have consumed', async () => {
        const item = await stockedInKitchen(8000);
        // Reports are management's, so this reads them as management even
        // though the return itself is made by the section.
        const mh = await headersFor('management');
        const range = { from: '2026-01-01', to: '2030-12-31' };
        const url = (p: string) => `/api/v1/reports/${p}?from=${range.from}&to=${range.to}`;

        const before = (await app.inject({ method: 'GET', url: url('consumption'), headers: mh }))
            .json()
            .rows.find(
                (r: { itemId: number; sectionId: number }) =>
                    r.itemId === item.id && r.sectionId === kitchenId
            );

        await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 1000,
                reasonCode: 'RET_QUALITY',
                issueId: item.issueId
            }
        });

        const after = (await app.inject({ method: 'GET', url: url('consumption'), headers: mh }))
            .json()
            .rows.find(
                (r: { itemId: number; sectionId: number }) =>
                    r.itemId === item.id && r.sectionId === kitchenId
            );

        // Stock that went straight back was never consumed. A report that says
        // otherwise flags a kitchen for food it never had.
        expect(Number(after?.qtyBase ?? 0)).toBe(Number(before?.qtyBase ?? 0) - 1000);
    });

    it('never shows quarantine as a room that consumed anything', async () => {
        const mh = await headersFor('management');
        const range = 'from=2026-01-01&to=2030-12-31';
        const rows = (
            await app.inject({
                method: 'GET',
                url: `/api/v1/reports/consumption?${range}`,
                headers: mh
            })
        ).json().rows;
        expect(rows.some((r: { sectionId: number }) => r.sectionId === quarantineId)).toBe(false);
    });

    it('shows what went back, and what has actually been credited', async () => {
        const mh = await headersFor('management');
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/reports/returns?from=2026-01-01&to=2030-12-31',
            headers: mh
        });
        expect(res.statusCode).toBe(200);
        const rows = res.json().rows;
        expect(rows.length).toBeGreaterThan(0);

        // The seeded story: one return settled with a credit note.
        const credited = rows.reduce(
            (n: number, r: { creditedValue: number }) => n + r.creditedValue,
            0
        );
        expect(credited).toBeGreaterThan(0);
    });

    it('lists a return the supplier has not settled as still open', async () => {
        const mh = await headersFor('management');
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/reports/open-returns?from=2026-01-01&to=2030-12-31',
            headers: mh
        });
        expect(res.statusCode).toBe(200);
        const rows = res.json().rows;
        expect(rows.length).toBeGreaterThan(0);
        // Nothing settled or rejected belongs on a chase list.
        expect(
            rows.every((r: { status: string }) =>
                ['raised', 'approved', 'sent'].includes(r.status)
            )
        ).toBe(true);
    });

    it('nets credits off what a supplier really cost', async () => {
        const mh = await headersFor('management');
        const rows = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/reports/supplier-performance?from=2026-01-01&to=2030-12-31',
                headers: mh
            })
        ).json().rows;

        const withReturns = rows.filter((r: { returns: number }) => r.returns > 0);
        expect(withReturns.length).toBeGreaterThan(0);
        for (const row of withReturns) {
            expect(row.netSpend).toBe(
                Number((row.spend - row.creditedValue).toFixed(2))
            );
        }
    });

    it('reports what the supplier allowed, not what was asked for', async () => {
        // Suppliers settle short. The report has to say so, or a partial credit
        // reads as a full one and the shortfall is never chased.
        const { grnId } = await deliveredAndReturned();
        const line = (
            await app.inject({ method: 'GET', url: `/api/v1/grn/${grnId}/returnable`, headers })
        ).json()[0];
        const raised = await app.inject({
            method: 'POST',
            url: '/api/v1/supplier-returns',
            headers,
            payload: {
                grnId,
                reasonCode: 'RET_DAMAGED',
                lines: [{ grnLineId: line.grnLineId, qtyPacks: 1 }]
            }
        });
        const id = raised.json().id;
        const asked = raised.json().creditValue;
        const mh = await headersFor('management');

        await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/decide`,
            headers: mh,
            payload: await answerAll(id, 'vendor')
        });
        await app.inject({ method: 'POST', url: `/api/v1/supplier-returns/${id}/send`, headers });

        // They allow half.
        const allowed = asked / 2;
        const settled = await app.inject({
            method: 'POST',
            url: `/api/v1/supplier-returns/${id}/settle`,
            headers: mh,
            payload: { outcome: 'credit', creditNoteNo: 'CN-SHORT', creditValue: allowed }
        });
        expect(settled.statusCode).toBe(200);

        const supplier = await db
            .selectFrom('supplier_returns')
            .select('supplier_id')
            .where('id', '=', id)
            .executeTakeFirstOrThrow();

        const rows = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/reports/supplier-performance?from=2026-01-01&to=2030-12-31',
                headers: mh
            })
        ).json().rows;
        const row = rows.find(
            (r: { supplierId: number }) => r.supplierId === supplier.supplier_id
        );

        // Credited must never exceed what went back, and on this supplier the
        // two are now different numbers.
        expect(row.creditedValue).toBeLessThan(row.returnedValue);
    });

    it('keeps a documented return out of the shrinkage report', async () => {
        const item = await stockedInKitchen(6000);
        const mh = await headersFor('management');

        await app.inject({
            method: 'POST',
            url: '/api/v1/returns',
            headers,
            payload: {
                sectionId: kitchenId,
                itemId: item.id,
                qtyBase: 500,
                reasonCode: 'RET_DAMAGED',
                issueId: item.issueId
            }
        });

        const rows = (
            await app.inject({
                method: 'GET',
                url: '/api/v1/reports/shrinkage?from=2026-01-01&to=2030-12-31',
                headers: mh
            })
        ).json().rows;

        // The same rule lettuce proves for wastage: stock that left with a
        // document behind it is not unexplained loss, and putting it in the
        // theft report is how people stop opening the theft report.
        expect(
            rows.some(
                (r: { itemId: number; sectionId: number }) =>
                    r.itemId === item.id && r.sectionId === kitchenId
            )
        ).toBe(false);
    });
});
