/**
 * Goods received note: a supplier delivery with an invoice.
 *
 * The one conversion rule the whole system rests on lives here. Users enter
 * *packs* -- "2 x 20 L can" -- because that is what arrives on the lorry and
 * what the invoice says. The pack is converted to stock units exactly once, at
 * entry, and everything downstream is in stock units. If grams ever reach a
 * field a human types into, something has gone wrong.
 */
import { db } from '../db/index.js';
import { badRequest, notFound } from '../errors.js';
import { audit, businessDateFor, postDocument, type LedgerLine } from './ledger.js';
import { claimKey, storeResponse } from './idempotency.js';
import { applyReceiptToPo } from './purchasing.js';

export interface GrnLineInput {
    itemPackId: number;
    qtyPacks: number;
    packPrice: number;
    expiryDate?: string | null;
}

export interface CreateGrnInput {
    locationId: number;
    supplierId: number;
    /**
     * The order this delivery is against, if it was ordered rather than simply
     * turning up. Booking it here rather than through a separate "receive"
     * endpoint keeps one code path for stock arriving: the order is told what
     * came in the same transaction that moves the ledger, so a delivery can
     * never be recorded while the order it fills stays open.
     */
    poId?: string | null;
    invoiceNo?: string | null;
    invoiceDate?: string | null;
    photoUrl?: string | null;
    lines: GrnLineInput[];
    receivedBy: number;
    idempotency: { key: string; endpoint: string; requestHash: string };
}

export interface PriceWarning {
    itemPackId: number;
    itemName: string;
    packName: string;
    previousPrice: number;
    newPrice: number;
    changePct: number;
}

export interface CreateGrnResult {
    id: string;
    total: number;
    businessDate: string;
    lineCount: number;
    /** Surfaced so the UI can flag a jump before the user walks away. */
    priceWarnings: PriceWarning[];
}

/** A price move beyond this is worth interrupting someone about. */
const PRICE_WARN_PCT = 10;

export async function createGrn(input: CreateGrnInput): Promise<CreateGrnResult> {
    if (input.lines.length === 0) throw badRequest('A GRN needs at least one line');

    const packIds = input.lines.map((l) => l.itemPackId);

    const packs = await db
        .selectFrom('item_packs')
        .innerJoin('items', 'items.id', 'item_packs.item_id')
        .select([
            'item_packs.id as pack_id',
            'item_packs.item_id',
            'item_packs.pack_name',
            'item_packs.qty_in_stock_unit',
            'items.name as item_name',
            'items.stock_unit',
        ])
        .where('item_packs.id', 'in', packIds)
        .execute();

    const byPack = new Map(packs.map((p) => [p.pack_id, p]));
    for (const id of packIds) {
        if (!byPack.has(id)) throw notFound(`Item pack ${id}`);
    }

    const supplier = await db
        .selectFrom('suppliers')
        .select(['id', 'name'])
        .where('id', '=', input.supplierId)
        .where('is_active', '=', true)
        .executeTakeFirst();
    if (!supplier) throw notFound(`Supplier ${input.supplierId}`);

    const store = await db
        .selectFrom('sections')
        .select('id')
        .where('location_id', '=', input.locationId)
        .where('is_store', '=', true)
        .executeTakeFirst();
    if (!store) throw badRequest('This location has no main store section');

    // Deliveries land in the store, and the store is just another section --
    // which is what keeps every movement a section-to-section transfer.
    const storeSectionId = store.id;

    /**
     * The price this supplier last charged for each pack.
     *
     * Ordered by id as well as date. `effective_from` is a date, not a
     * timestamp, and two price changes on one day are ordinary -- a corrected
     * entry, or a second delivery the same afternoon. With only the date in
     * the sort, "the most recent" was whichever row Postgres happened to hand
     * back first, so the same delivery could be judged against either price
     * from one save to the next. The higher id is the later row.
     */
    const previousPrices = await db
        .selectFrom('supplier_prices')
        .select(['item_pack_id', 'price', 'effective_from'])
        .where('supplier_id', '=', input.supplierId)
        .where('item_pack_id', 'in', packIds)
        .orderBy('effective_from', 'desc')
        .orderBy('id', 'desc')
        .execute();

    const lastPrice = new Map<number, number>();
    for (const p of previousPrices) {
        if (!lastPrice.has(p.item_pack_id)) lastPrice.set(p.item_pack_id, p.price);
    }

    return db.transaction().execute(async (trx) => {
        await claimKey(
            trx,
            input.idempotency.key,
            input.idempotency.endpoint,
            input.idempotency.requestHash,
            input.receivedBy
        );

        const businessDate = await businessDateFor(trx, input.locationId);
        const total = input.lines.reduce((sum, l) => sum + l.qtyPacks * l.packPrice, 0);

        const grn = await trx
            .insertInto('grn')
            .values({
                location_id: input.locationId,
                supplier_id: input.supplierId,
                invoice_no: input.invoiceNo ?? null,
                invoice_date: input.invoiceDate ?? null,
                received_by: input.receivedBy,
                photo_url: input.photoUrl ?? null,
                total,
                po_id: input.poId ?? null,
                is_demo: false,
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        const ledgerLines: LedgerLine[] = [];
        const priceWarnings: PriceWarning[] = [];

        for (const [i, line] of input.lines.entries()) {
            const pack = byPack.get(line.itemPackId)!;

            if (line.qtyPacks <= 0) {
                throw badRequest(`${pack.item_name}: quantity must be more than zero`);
            }
            if (line.packPrice < 0) {
                throw badRequest(`${pack.item_name}: price cannot be negative`);
            }

            await trx
                .insertInto('grn_lines')
                .values({
                    grn_id: grn.id,
                    item_pack_id: line.itemPackId,
                    qty_packs: line.qtyPacks,
                    pack_price: line.packPrice,
                    expiry_date: line.expiryDate ?? null,
                    is_demo: false,
                })
                .execute();

            // The conversion. Packs in, stock units from here on.
            const qtyBase = line.qtyPacks * pack.qty_in_stock_unit;
            const unitCost = line.packPrice / pack.qty_in_stock_unit;

            ledgerLines.push({
                sectionId: storeSectionId,
                itemId: pack.item_id,
                qtyBase,
                unitCost,
                docLine: i + 1,
            });

            const prev = lastPrice.get(line.itemPackId);
            if (prev !== undefined && prev > 0) {
                const changePct = ((line.packPrice - prev) / prev) * 100;
                if (Math.abs(changePct) >= PRICE_WARN_PCT) {
                    priceWarnings.push({
                        itemPackId: line.itemPackId,
                        itemName: pack.item_name,
                        packName: pack.pack_name,
                        previousPrice: prev,
                        newPrice: line.packPrice,
                        changePct: Math.round(changePct * 10) / 10,
                    });
                }
            }

            // Price history is recorded on change, so the movement report reads
            // a real table instead of reconstructing it from GRN lines.
            if (prev !== line.packPrice) {
                await trx
                    .insertInto('supplier_prices')
                    .values({
                        supplier_id: input.supplierId,
                        item_pack_id: line.itemPackId,
                        price: line.packPrice,
                        effective_from: businessDate,
                        is_demo: false,
                    })
                    .execute();
            }
        }

        if (input.poId) {
            await applyReceiptToPo(
                trx,
                input.poId,
                input.locationId,
                input.supplierId,
                input.receivedBy,
                ledgerLines.map((l) => ({ itemId: l.itemId, qtyBase: l.qtyBase }))
            );
        }

        await postDocument(trx, {
            doc: 'grn',
            docId: grn.id,
            locationId: input.locationId,
            businessDate,
            lines: ledgerLines,
            createdBy: input.receivedBy,
        });

        await audit(trx, {
            userId: input.receivedBy,
            action: 'grn.create',
            entity: 'grn',
            entityId: grn.id,
            after: {
                supplierId: input.supplierId,
                total,
                lineCount: input.lines.length,
                poId: input.poId ?? null,
            },
        });

        const result: CreateGrnResult = {
            id: String(grn.id),
            total: Math.round(total * 100) / 100,
            businessDate,
            lineCount: input.lines.length,
            priceWarnings,
        };

        await storeResponse(trx, input.idempotency.key, result, 201);
        return result;
    });
}
