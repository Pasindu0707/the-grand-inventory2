/**
 * The only module in this codebase permitted to write to stock_ledger.
 *
 *   "Never write to stock_ledger from a controller. One service function per
 *    document type; the document is the API, the ledger is a consequence."
 *
 * eslint.config.js enforces that with no-restricted-imports, so the rule holds
 * against the next person as well as the current one.
 *
 * Two invariants live here and nowhere else:
 *
 *   1. business_date comes from the location's day_start, never from the
 *      client's clock. The Coffee Lounge runs 04:00-04:00, so "today" there is
 *      not "today" anywhere else, and a count taken at 02:00 belongs to the
 *      previous business day.
 *
 *   2. Weighted-average cost is recomputed on receipts only, inside the same
 *      transaction as the ledger rows, in SQL. Issues, wastage and count
 *      adjustments read the average and must not move it -- otherwise issuing
 *      stock would silently revalue what is left.
 */
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database, DocType } from '../db/types.js';
import { db } from '../db/index.js';
import { badRequest } from '../errors.js';

export type Tx = Transaction<Database>;

/** Movements that establish or change cost. Everything else only consumes it. */
const RECEIPT_DOCS: ReadonlySet<DocType> = new Set<DocType>(['grn', 'opening']);

export interface LedgerLine {
    sectionId: number;
    itemId: number;
    /** Signed, in the item's stock_unit. Negative removes stock. */
    qtyBase: number;
    /**
     * Cost per stock unit for receipts. Omitted for issues and adjustments,
     * which are valued at the current weighted average.
     */
    unitCost?: number;
    docLine?: number;
    reasonCode?: string | null;
    note?: string | null;
}

export interface PostDocumentInput {
    doc: DocType;
    docId: number | string;
    locationId: number;
    lines: LedgerLine[];
    createdBy: number;
    /** Defaults to the location's current business date. */
    businessDate?: string;
    isReversal?: boolean;
    reversesId?: string | null;
    isDemo?: boolean;
}

/**
 * The business date for a location right now.
 *
 * Postgres does the arithmetic because `day_start` is a `time` and the shift is
 * a calendar operation -- doing it in JS would mean reconstructing timezone
 * rules that the database already has.
 */
export async function businessDateFor(
    trx: Kysely<Database> | Tx,
    locationId: number,
    at: Date = new Date()
): Promise<string> {
    const row = await sql<{ business_date: string }>`
        select ((${at}::timestamptz at time zone 'Asia/Colombo')
                - (select day_start from locations where id = ${locationId}))::date
               as business_date
    `.execute(trx);

    const value = row.rows[0]?.business_date;
    if (!value) throw badRequest(`Unknown location ${locationId}`);
    return value;
}

/**
 * Writes one document's movements to the ledger.
 *
 * Must be called inside a transaction that also writes the document rows: the
 * document and its ledger effect either both exist or neither does.
 */
export async function postDocument(trx: Tx, input: PostDocumentInput): Promise<void> {
    if (input.lines.length === 0) {
        throw badRequest('A document must move at least one line');
    }

    const businessDate =
        input.businessDate ?? (await businessDateFor(trx, input.locationId));
    const isReceipt = RECEIPT_DOCS.has(input.doc);

    for (const line of input.lines) {
        if (line.qtyBase === 0) {
            throw badRequest(`Zero quantity on item ${line.itemId} - nothing to record`);
        }

        let unitCost: number;

        if (isReceipt && line.qtyBase > 0) {
            if (line.unitCost === undefined) {
                throw badRequest(`Receipt line for item ${line.itemId} has no unit cost`);
            }
            // A receipt records what was actually paid, not the average it
            // produces. The average is derived state and lives in
            // item_cost_state; the price on the invoice exists nowhere else and
            // is what the supplier price-movement report reads.
            await applyReceiptCost(
                trx,
                line.itemId,
                input.locationId,
                line.qtyBase,
                line.unitCost
            );
            unitCost = line.unitCost;
        } else {
            unitCost = await currentAverageCost(trx, line.itemId, input.locationId);
            await adjustQtyOnHand(trx, line.itemId, input.locationId, line.qtyBase);
        }

        await trx
            .insertInto('stock_ledger')
            .values({
                business_date: businessDate,
                location_id: input.locationId,
                section_id: line.sectionId,
                item_id: line.itemId,
                qty_base: line.qtyBase,
                unit_cost: unitCost,
                doc: input.doc,
                doc_id: String(input.docId),
                doc_line: line.docLine ?? null,
                reason_code: line.reasonCode ?? null,
                created_by: input.createdBy,
                is_reversal: input.isReversal ?? false,
                reverses_id: input.reversesId ?? null,
                note: line.note ?? null,
                is_demo: input.isDemo ?? false,
            })
            .execute();
    }
}

/**
 * Moves the weighted average and returns the new value.
 *
 *   new_avg = (qty_on_hand * old_avg + qty_in * receipt_cost)
 *             / (qty_on_hand + qty_in)
 *
 * Done as one INSERT ... ON CONFLICT so concurrent receipts for the same item
 * serialise on the row rather than racing through a read-modify-write. If stock
 * on hand is negative (over-issued, and the count has not caught up yet) the
 * weighting is meaningless, so the receipt cost simply becomes the new average.
 */
async function applyReceiptCost(
    trx: Tx,
    itemId: number,
    locationId: number,
    qtyIn: number,
    receiptCost: number
): Promise<number> {
    // Every parameter is cast explicitly. Without the casts Postgres sees
    // `unknown * unknown` in the weighting expression and cannot pick an
    // operator -- bind parameters carry no type of their own.
    const qty = sql<number>`${qtyIn}::numeric(14,3)`;
    const cost = sql<number>`${receiptCost}::numeric(14,4)`;

    const row = await sql<{ avg_cost: number }>`
        insert into item_cost_state (item_id, location_id, qty_on_hand, avg_cost, updated_at)
        values (${itemId}::int, ${locationId}::int, ${qty}, ${cost}, now())
        on conflict (item_id, location_id) do update set
          avg_cost = case
            when item_cost_state.qty_on_hand + ${qty} <= 0 then ${cost}
            when item_cost_state.qty_on_hand <= 0 then ${cost}
            else (item_cost_state.qty_on_hand * item_cost_state.avg_cost
                  + ${qty} * ${cost})
                 / (item_cost_state.qty_on_hand + ${qty})
          end,
          qty_on_hand = item_cost_state.qty_on_hand + ${qty},
          updated_at = now()
        returning avg_cost
    `.execute(trx);

    return row.rows[0]!.avg_cost;
}

async function currentAverageCost(
    trx: Tx,
    itemId: number,
    locationId: number
): Promise<number> {
    const row = await trx
        .selectFrom('item_cost_state')
        .select('avg_cost')
        .where('item_id', '=', itemId)
        .where('location_id', '=', locationId)
        .executeTakeFirst();

    // No cost state means nothing has ever been received. Valuing at zero is
    // honest -- inventing a price would put a fictional number in a report.
    return row?.avg_cost ?? 0;
}

async function adjustQtyOnHand(
    trx: Tx,
    itemId: number,
    locationId: number,
    delta: number
): Promise<void> {
    const d = sql<number>`${delta}::numeric(14,3)`;
    await sql`
        insert into item_cost_state (item_id, location_id, qty_on_hand, avg_cost, updated_at)
        values (${itemId}::int, ${locationId}::int, ${d}, 0, now())
        on conflict (item_id, location_id) do update set
          qty_on_hand = item_cost_state.qty_on_hand + ${d},
          updated_at = now()
    `.execute(trx);
}

/**
 * Corrections are reversals, never edits.
 *
 * Emits mirror-image rows for every movement of the original document, each
 * pointing back at the row it undoes. The originals stay exactly where they
 * are, which is the entire reason the ledger is trustworthy.
 */
export async function reverseDocument(
    trx: Tx,
    doc: DocType,
    docId: number | string,
    reversedBy: number,
    note: string
): Promise<number> {
    const originals = await trx
        .selectFrom('stock_ledger')
        .selectAll()
        .where('doc', '=', doc)
        .where('doc_id', '=', String(docId))
        .where('is_reversal', '=', false)
        .execute();

    if (originals.length === 0) {
        throw badRequest(`No ledger rows for ${doc} ${docId}`);
    }

    const already = await trx
        .selectFrom('stock_ledger')
        .select('id')
        .where('reverses_id', 'in', originals.map((o) => o.id))
        .executeTakeFirst();

    if (already) throw badRequest(`${doc} ${docId} has already been reversed`);

    for (const o of originals) {
        await trx
            .insertInto('stock_ledger')
            .values({
                business_date: o.business_date,
                location_id: o.location_id,
                section_id: o.section_id,
                item_id: o.item_id,
                qty_base: -o.qty_base,
                unit_cost: o.unit_cost,
                doc: o.doc,
                doc_id: o.doc_id,
                doc_line: o.doc_line,
                reason_code: o.reason_code,
                created_by: reversedBy,
                is_reversal: true,
                reverses_id: o.id,
                note,
                is_demo: o.is_demo,
            })
            .execute();

        await adjustQtyOnHand(trx, o.item_id, o.location_id, -o.qty_base);
    }

    return originals.length;
}

/** Writes an audit row. Every mutation should leave one. */
export async function audit(
    trx: Tx,
    entry: {
        userId: number;
        action: string;
        entity: string;
        entityId?: string | number | null;
        before?: unknown;
        after?: unknown;
    }
): Promise<void> {
    await trx
        .insertInto('audit_log')
        .values({
            user_id: entry.userId,
            action: entry.action,
            entity: entry.entity,
            entity_id: entry.entityId == null ? null : String(entry.entityId),
            before: entry.before === undefined ? null : JSON.stringify(entry.before),
            after: entry.after === undefined ? null : JSON.stringify(entry.after),
        })
        .execute();
}

export { db };
