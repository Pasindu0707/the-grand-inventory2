/**
 * The request flow - the thing the whole app is for.
 *
 *   1. ASK       Kitchen or Cleaning asks for stock, and says when they need it
 *   2. RELEASE   Management OR the storekeeper approves and hands it over
 *   3. CONFIRM   The section that asked says it arrived
 *
 * Stock moves at step 2, not step 3: that is when it physically leaves the
 * store. Step 3 is an acknowledgement, so stock released but not yet confirmed
 * still counts as the section's - which is right, because it is sitting in
 * their room. What confirmation gives you is a list of handovers nobody
 * acknowledged, which is where things go missing between two rooms.
 *
 * When the store cannot cover a request, the shortfall becomes a purchase
 * order aimed at management, because they are the only people who decide that
 * money gets spent.
 */
import { db } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { audit, businessDateFor, postDocument, type LedgerLine } from './ledger.js';
import { claimKey, storeResponse } from './idempotency.js';
import { issueWindowsFor, windowWarning } from './settings.js';
import type { UserRole } from '../db/types.js';

/** Who may approve and release a request. */
export const CAN_RELEASE: ReadonlySet<UserRole> = new Set<UserRole>([
    'management',
    'storekeeper'
]);

export interface AskInput {
    locationId: number;
    sectionId: number;
    requestedBy: number;
    neededBy?: string | null;
    note?: string | null;
    lines: { itemId: number; qtyRequested: number }[];
}

export async function ask(input: AskInput): Promise<{ id: string; shortages: Shortage[] }> {
    if (input.lines.length === 0) throw badRequest('Add at least one item to the request');

    const section = await db
        .selectFrom('sections')
        .select(['id', 'is_store'])
        .where('id', '=', input.sectionId)
        .where('location_id', '=', input.locationId)
        .executeTakeFirst();
    if (!section) throw notFound('That section');
    if (section.is_store) throw badRequest('The store cannot ask itself for stock');

    const shortages = await shortagesFor(input.locationId, input.lines);

    const id = await db.transaction().execute(async (trx) => {
        const issue = await trx
            .insertInto('issues')
            .values({
                location_id: input.locationId,
                to_section_id: input.sectionId,
                requested_by: input.requestedBy,
                status: 'requested',
                needed_by: input.neededBy ?? null,
                note: input.note ?? null,
                is_demo: false
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        for (const line of input.lines) {
            if (line.qtyRequested <= 0) throw badRequest('Quantity must be more than zero');
            await trx
                .insertInto('issue_lines')
                .values({
                    issue_id: issue.id,
                    item_id: line.itemId,
                    qty_requested: line.qtyRequested,
                    is_demo: false
                })
                .execute();
        }

        await audit(trx, {
            userId: input.requestedBy,
            action: 'request.ask',
            entity: 'issues',
            entityId: issue.id,
            after: { sectionId: input.sectionId, lines: input.lines.length, neededBy: input.neededBy }
        });

        return String(issue.id);
    });

    return { id, shortages };
}

export interface Shortage {
    itemId: number;
    name: string;
    stockUnit: string;
    requested: number;
    inStore: number;
    short: number;
    /**
     * The pack this would be ordered in, and how many of them cover the gap.
     * Purchase orders are raised in packs, so the shortage has to arrive
     * knowing which pack -- otherwise the screen that offers "and buy the
     * rest" has to go and look it up before it can offer anything.
     */
    itemPackId: number | null;
    packName: string | null;
    qtyInStockUnit: number | null;
    shortPacks: number;
}

/** What the store cannot cover right now. Drives the purchase-order prompt. */
export async function shortagesFor(
    locationId: number,
    lines: { itemId: number; qtyRequested: number }[]
): Promise<Shortage[]> {
    if (lines.length === 0) return [];

    const store = await db
        .selectFrom('sections')
        .select('id')
        .where('location_id', '=', locationId)
        .where('is_store', '=', true)
        .executeTakeFirst();
    if (!store) return [];

    const items = await db
        .selectFrom('items')
        .leftJoin('current_stock as cs', (join) =>
            join.onRef('cs.item_id', '=', 'items.id').on('cs.section_id', '=', store.id)
        )
        .leftJoin('item_packs as p', (join) =>
            join
                .onRef('p.item_id', '=', 'items.id')
                .on('p.is_default_purchase', '=', true)
                .on('p.is_active', '=', true)
        )
        .select([
            'items.id',
            'items.name',
            'items.stock_unit as stockUnit',
            'cs.qty_base as qty',
            'p.id as itemPackId',
            'p.pack_name as packName',
            'p.qty_in_stock_unit as qtyInStockUnit'
        ])
        .where(
            'items.id',
            'in',
            lines.map((l) => l.itemId)
        )
        .execute();

    const byId = new Map(items.map((i) => [i.id, i]));
    const out: Shortage[] = [];

    for (const line of lines) {
        const item = byId.get(line.itemId);
        if (!item) continue;
        const inStore = Math.max(0, Number(item.qty ?? 0));
        if (inStore < line.qtyRequested) {
            const short = Math.round((line.qtyRequested - inStore) * 1000) / 1000;
            const packSize =
                item.qtyInStockUnit === null ? null : Number(item.qtyInStockUnit);
            out.push({
                itemId: item.id,
                name: item.name,
                stockUnit: item.stockUnit,
                requested: line.qtyRequested,
                inStore,
                short,
                itemPackId: item.itemPackId,
                packName: item.packName,
                qtyInStockUnit: packSize,
                // Rounded up: you cannot buy two thirds of a sack.
                shortPacks: packSize && packSize > 0 ? Math.ceil(short / packSize) : 0
            });
        }
    }
    return out;
}

export interface ReleaseInput {
    issueId: string;
    locationId: number;
    releasedBy: number;
    role: UserRole;
    /** Omitted lines go out at the requested quantity. */
    lines: { lineId: string; qtyIssued: number }[];
    idempotency: { key: string; endpoint: string; requestHash: string };
}

export interface ReleaseResult {
    id: string;
    linesReleased: number;
    shortfalls: { itemName: string; requested: number; released: number; available: number }[];
    /**
     * Set when the handover happened outside the agreed windows
     * (06:00 / 11:00 / 17:00). Advisory only - it never blocks, because a
     * handover that happened at 14:00 happened, and refusing to record it would
     * only make the stock figure wrong as well as the process.
     */
    windowWarning: string | null;
}

export async function release(input: ReleaseInput): Promise<ReleaseResult> {
    if (!CAN_RELEASE.has(input.role)) {
        throw forbidden('Only management or the storekeeper can release stock');
    }

    const issue = await db
        .selectFrom('issues')
        .selectAll()
        .where('id', '=', input.issueId)
        .where('location_id', '=', input.locationId)
        .executeTakeFirst();
    if (!issue) throw notFound('That request');
    if (issue.status === 'cancelled') throw conflict('That request was cancelled');
    if (issue.status !== 'requested') throw conflict('That request has already been released');

    const store = await db
        .selectFrom('sections')
        .select('id')
        .where('location_id', '=', input.locationId)
        .where('is_store', '=', true)
        .executeTakeFirstOrThrow();

    const lines = await db
        .selectFrom('issue_lines')
        .innerJoin('items', 'items.id', 'issue_lines.item_id')
        .select([
            'issue_lines.id as lineId',
            'issue_lines.item_id as itemId',
            'issue_lines.qty_requested as qtyRequested',
            'items.name as itemName'
        ])
        .where('issue_lines.issue_id', '=', input.issueId)
        .execute();

    const wanted = new Map(input.lines.map((l) => [String(l.lineId), l.qtyIssued]));

    const onHand = new Map<number, number>();
    for (const row of await db
        .selectFrom('current_stock')
        .select(['item_id', 'qty_base'])
        .where('section_id', '=', store.id)
        .execute()) {
        onHand.set(row.item_id, Number(row.qty_base));
    }

    const warning = windowWarning(await issueWindowsFor(input.locationId), new Date());

    return db.transaction().execute(async (trx) => {
        await claimKey(
            trx,
            input.idempotency.key,
            input.idempotency.endpoint,
            input.idempotency.requestHash,
            input.releasedBy
        );

        const businessDate = await businessDateFor(trx, input.locationId);
        const ledgerLines: LedgerLine[] = [];
        const shortfalls: ReleaseResult['shortfalls'] = [];
        let docLine = 0;

        for (const line of lines) {
            const asked = Number(line.qtyRequested);
            const target = wanted.get(String(line.lineId)) ?? asked;
            if (target < 0) throw badRequest(`${line.itemName}: quantity cannot be negative`);

            const available = Math.max(0, onHand.get(line.itemId) ?? 0);
            const released = Math.min(target, available);

            if (released < target) {
                shortfalls.push({
                    itemName: line.itemName,
                    requested: target,
                    released,
                    available
                });
            }

            await trx
                .updateTable('issue_lines')
                .set({ qty_issued: released })
                .where('id', '=', line.lineId)
                .execute();

            if (released <= 0) continue;

            docLine += 1;
            ledgerLines.push({
                sectionId: store.id,
                itemId: line.itemId,
                qtyBase: -released,
                docLine
            });
            ledgerLines.push({
                sectionId: issue.to_section_id,
                itemId: line.itemId,
                qtyBase: released,
                docLine
            });
        }

        if (ledgerLines.length === 0) {
            throw badRequest('Nothing could be released - the store has none of these items');
        }

        await postDocument(trx, {
            doc: 'issue',
            docId: issue.id,
            locationId: input.locationId,
            businessDate,
            lines: ledgerLines,
            createdBy: input.releasedBy
        });

        await trx
            .updateTable('issues')
            .set({
                status: 'released',
                issued_by: input.releasedBy,
                issued_at: new Date(),
                approved_by: input.releasedBy,
                approved_at: new Date()
            })
            .where('id', '=', issue.id)
            .execute();

        await audit(trx, {
            userId: input.releasedBy,
            action: 'request.release',
            entity: 'issues',
            entityId: issue.id,
            after: { lines: ledgerLines.length / 2, shortfalls: shortfalls.length }
        });

        const result: ReleaseResult = {
            id: String(issue.id),
            linesReleased: ledgerLines.length / 2,
            shortfalls,
            windowWarning: warning
        };

        await storeResponse(trx, input.idempotency.key, result, 200);
        return result;
    });
}

/**
 * The section that asked confirms it arrived.
 *
 * Deliberately restricted to the requesting section: a storekeeper confirming
 * their own handover would make the step meaningless.
 */
export async function confirmReceived(
    issueId: string,
    locationId: number,
    userId: number,
    userSectionIds: number[]
): Promise<void> {
    const issue = await db
        .selectFrom('issues')
        .select(['id', 'status', 'to_section_id', 'issued_by'])
        .where('id', '=', issueId)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!issue) throw notFound('That request');
    if (issue.status === 'received') throw conflict('Already confirmed');
    if (issue.status !== 'released') throw conflict('That has not been released yet');

    if (!userSectionIds.includes(issue.to_section_id)) {
        throw forbidden('Only the section that asked for it can confirm it arrived');
    }
    if (issue.issued_by === userId) {
        throw badRequest('The person who released it cannot also confirm it arrived');
    }

    await db.transaction().execute(async (trx) => {
        await trx
            .updateTable('issues')
            .set({ status: 'received', received_by: userId, received_at: new Date() })
            .where('id', '=', issueId)
            .execute();
        await audit(trx, {
            userId,
            action: 'request.confirm',
            entity: 'issues',
            entityId: issueId
        });
    });
}

export async function cancelRequest(
    issueId: string,
    locationId: number,
    userId: number,
    userSectionIds: number[]
): Promise<void> {
    const issue = await db
        .selectFrom('issues')
        .select(['id', 'status', 'to_section_id'])
        .where('id', '=', issueId)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!issue) throw notFound('That request');
    if (issue.status !== 'requested') {
        throw conflict('Stock has already moved - this needs a reversal, not a cancellation');
    }
    // Anyone signed in could cancel anyone's request, from any section. It is
    // the one step in the flow that had no check on it at all.
    if (!userSectionIds.includes(issue.to_section_id)) {
        throw forbidden('Only the section that asked for it can cancel it');
    }

    await db.transaction().execute(async (trx) => {
        await trx.updateTable('issues').set({ status: 'cancelled' }).where('id', '=', issueId).execute();
        await audit(trx, { userId, action: 'request.cancel', entity: 'issues', entityId: issueId });
    });
}
