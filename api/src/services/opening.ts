/**
 * Opening stock: what was already on the shelf on day one.
 *
 * Step 7 of the go-live runbook is "opening count in every section", and until
 * now there was no document behind it. `doc_type` has carried an 'opening'
 * value since the first migration and nothing has ever written one, so the
 * only way to get real stock into a fresh system was to enter it as a delivery
 * from a supplier who never delivered it -- which puts a fictional invoice in
 * the price history and makes the first month's supplier report nonsense.
 *
 * It is its own document because it is its own event. An opening balance is
 * stock that was already there; a count is a discrepancy found later. A report
 * that cannot tell them apart reads day one as the largest variance of the
 * year.
 *
 * Two rules make this safe to hand to the storekeeper rather than a developer:
 *
 *   - a section can only be opened while it has no history at all. Once
 *     anything has moved there, the opening balance is already established and
 *     the honest instrument is a stock count.
 *   - the cost entered becomes the section's starting weighted average, so it
 *     is asked for per line rather than assumed. Stock valued at zero quietly
 *     reports every later issue as free.
 */
import { db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit, businessDateFor, postDocument, type LedgerLine } from './ledger.js';
import { claimKey, storeResponse } from './idempotency.js';

export interface OpeningStockInput {
    locationId: number;
    sectionId: number;
    enteredBy: number;
    note?: string | null;
    lines: { itemId: number; qtyBase: number; unitCost: number }[];
    idempotency: { key: string; endpoint: string; requestHash: string };
}

export interface OpeningStockResult {
    id: string;
    businessDate: string;
    lineCount: number;
    totalValue: number;
}

/** Has anything ever happened in this section? */
export async function sectionHasHistory(sectionId: number): Promise<boolean> {
    const row = await db
        .selectFrom('stock_ledger')
        .select('id')
        .where('section_id', '=', sectionId)
        .limit(1)
        .executeTakeFirst();
    return !!row;
}

export interface OpeningEligibility {
    canOpen: boolean;
    /** True when a previous opening balance was entered and then reversed. */
    previouslyReversed: boolean;
}

/**
 * May this section still be given an opening balance?
 *
 * "Nothing has ever moved here" was the original rule, and it was too strict in
 * the one case that actually happens: the opening was typed wrong. Reversing it
 * leaves the correcting rows behind -- that is the whole point of an append-only
 * ledger -- so under the old rule the section was locked out of ever having a
 * correct opening balance. The only remaining instrument was a stock count,
 * which values an item nothing has ever received at zero and makes every later
 * issue of it look free.
 *
 * So the door stays open while nothing has happened to the section *except*
 * opening documents that have since been fully reversed. One movement of any
 * other kind -- a delivery, an issue, a count -- and it closes for good, because
 * from that moment the shelf has a history and a correction is a discrepancy,
 * not a starting point.
 */
export async function openingEligibility(sectionId: number): Promise<OpeningEligibility> {
    // Asked separately, and first, because a live section can have a great many
    // ledger rows and this settles it without reading them.
    const foreign = await db
        .selectFrom('stock_ledger')
        .select('id')
        .where('section_id', '=', sectionId)
        .where('doc', '!=', 'opening')
        .limit(1)
        .executeTakeFirst();
    if (foreign) return { canOpen: false, previouslyReversed: false };

    const rows = await db
        .selectFrom('stock_ledger')
        .select(['id', 'is_reversal', 'reverses_id'])
        .where('section_id', '=', sectionId)
        .where('doc', '=', 'opening')
        .execute();

    if (rows.length === 0) return { canOpen: true, previouslyReversed: false };

    const undone = new Set(
        rows.filter((r) => r.is_reversal).map((r) => String(r.reverses_id))
    );
    const originals = rows.filter((r) => !r.is_reversal);
    const allUndone = originals.every((r) => undone.has(String(r.id)));

    return { canOpen: allUndone, previouslyReversed: allUndone };
}

export async function createOpeningStock(
    input: OpeningStockInput
): Promise<OpeningStockResult> {
    if (input.lines.length === 0) throw badRequest('An opening balance needs at least one line');

    const section = await db
        .selectFrom('sections')
        .select(['id', 'name', 'location_id', 'is_active'])
        .where('id', '=', input.sectionId)
        .executeTakeFirst();
    if (!section) throw notFound('That section');
    if (section.location_id !== input.locationId) {
        throw badRequest('That section belongs to a different branch');
    }
    if (!section.is_active) throw badRequest('That section has been switched off');

    if (!(await openingEligibility(input.sectionId)).canOpen) {
        throw conflict(
            `${section.name} already has stock movements. Its opening balance is set - reverse the opening document if it was wrong, or use a stock count to correct what is on the shelf.`
        );
    }

    const items = await db
        .selectFrom('items')
        .select(['id', 'name', 'is_active'])
        .where(
            'id',
            'in',
            input.lines.map((l) => l.itemId)
        )
        .execute();
    const byId = new Map(items.map((i) => [i.id, i]));

    const seen = new Set<number>();
    for (const line of input.lines) {
        const item = byId.get(line.itemId);
        if (!item) throw notFound(`Item ${line.itemId}`);
        if (!item.is_active) throw badRequest(`${item.name} has been retired`);
        if (line.qtyBase <= 0) {
            throw badRequest(`${item.name}: leave it off rather than opening at zero`);
        }
        if (line.unitCost < 0) throw badRequest(`${item.name}: cost cannot be negative`);
        if (seen.has(line.itemId)) throw badRequest(`${item.name} is on the list twice`);
        seen.add(line.itemId);
    }

    return db.transaction().execute(async (trx) => {
        await claimKey(
            trx,
            input.idempotency.key,
            input.idempotency.endpoint,
            input.idempotency.requestHash,
            input.enteredBy
        );

        const businessDate = await businessDateFor(trx, input.locationId);

        const doc = await trx
            .insertInto('opening_stock')
            .values({
                location_id: input.locationId,
                section_id: input.sectionId,
                business_date: businessDate,
                entered_by: input.enteredBy,
                note: input.note ?? null,
                is_demo: false
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        const ledgerLines: LedgerLine[] = [];

        for (const [i, line] of input.lines.entries()) {
            await trx
                .insertInto('opening_stock_lines')
                .values({
                    opening_id: doc.id,
                    item_id: line.itemId,
                    qty_base: line.qtyBase,
                    unit_cost: line.unitCost,
                    is_demo: false
                })
                .execute();

            ledgerLines.push({
                sectionId: input.sectionId,
                itemId: line.itemId,
                qtyBase: line.qtyBase,
                unitCost: line.unitCost,
                docLine: i + 1
            });
        }

        // 'opening' is a receipt as far as the ledger is concerned: it
        // establishes cost rather than consuming it, which is exactly what an
        // opening balance does.
        await postDocument(trx, {
            doc: 'opening',
            docId: doc.id,
            locationId: input.locationId,
            businessDate,
            lines: ledgerLines,
            createdBy: input.enteredBy
        });

        const totalValue =
            Math.round(
                input.lines.reduce((sum, l) => sum + l.qtyBase * l.unitCost, 0) * 100
            ) / 100;

        await audit(trx, {
            userId: input.enteredBy,
            action: 'opening.create',
            entity: 'opening_stock',
            entityId: doc.id,
            after: { sectionId: input.sectionId, lineCount: input.lines.length, totalValue }
        });

        const result: OpeningStockResult = {
            id: String(doc.id),
            businessDate,
            lineCount: input.lines.length,
            totalValue
        };

        await storeResponse(trx, input.idempotency.key, result, 201);
        return result;
    });
}

export interface SectionOpeningState {
    sectionId: number;
    name: string;
    code: string;
    isStore: boolean;
    /** False once anything has moved: the opening balance is already set. */
    canOpen: boolean;
    /** A previous opening balance was entered here and then reversed. */
    previouslyReversed: boolean;
    openedOn: string | null;
}

/** Which sections at this branch are still waiting for an opening balance. */
export async function openingState(locationId: number): Promise<SectionOpeningState[]> {
    const sections = await db
        .selectFrom('sections')
        .select(['id', 'code', 'name', 'is_store as isStore'])
        .where('location_id', '=', locationId)
        .where('is_active', '=', true)
        .orderBy('is_store', 'desc')
        .orderBy('name')
        .execute();
    if (sections.length === 0) return [];

    const ids = sections.map((s) => s.id);

    const eligibility = new Map(
        await Promise.all(
            ids.map(async (id) => [id, await openingEligibility(id)] as const)
        )
    );

    const opened = await db
        .selectFrom('opening_stock')
        .select(['section_id', 'business_date'])
        .where('section_id', 'in', ids)
        .execute();
    const openedOn = new Map(opened.map((o) => [o.section_id, o.business_date]));

    return sections.map((s) => {
        const state = eligibility.get(s.id) ?? { canOpen: true, previouslyReversed: false };
        return {
            sectionId: s.id,
            name: s.name,
            code: s.code,
            isStore: s.isStore,
            canOpen: state.canOpen,
            previouslyReversed: state.previouslyReversed,
            // A reversed opening keeps its document row, so the date is still
            // there. Reporting it would read as "already done" beside a button
            // that says otherwise.
            openedOn: state.canOpen ? null : openedOn.get(s.id) ?? null
        };
    });
}
