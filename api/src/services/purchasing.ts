/**
 * Purchase orders, from "we are out of rice" to the lorry arriving.
 *
 * What was here before recorded a wish. A purchase order had no supplier, no
 * pack size and no idea whether the goods ever turned up: you ordered ten
 * sacks, six came, and the order sat at "ordered" looking exactly like one
 * that had been delivered in full. The only way to raise one at all was to ask
 * the store for something it did not have, so the storekeeper -- the one
 * person who can see the shelf going empty -- could not order anything until
 * somebody else had already gone short.
 *
 * Three things changed.
 *
 * Ordering happens in **packs**. "5 x 50 kg sack" is what you say to a
 * supplier and what comes back on the invoice, and it is the same unit a GRN
 * is entered in, so a delivery against an order needs no re-typing and no
 * second chance to get a pack conversion wrong. The stock-unit figure is
 * carried alongside for the shortage arithmetic, converted once, here.
 *
 * Receipt is **partial by default**. Each line accumulates what has arrived,
 * the order stays open on the balance, and it closes itself only when every
 * line is covered -- or when management closes it short, on purpose, with a
 * note saying so.
 *
 * And an order can be raised **before** anyone goes short, off the reorder
 * points that were already in the item master and until now only ever fed a
 * report nobody could act on directly.
 */
import { db } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { audit, type Tx } from './ledger.js';
import { shortagesFor } from './requests.js';
import type { PoStatus } from '../db/types.js';

/** Statuses where the goods have not arrived and the order is still live. */
const OPEN_STATUSES: readonly PoStatus[] = ['requested', 'approved', 'ordered'];

/** Statuses a delivery may be booked against. */
const RECEIVABLE: readonly PoStatus[] = ['approved', 'ordered'];

export interface RaisePoLine {
    itemPackId: number;
    qtyPacks: number;
    /** Estimated price for one pack. */
    estPrice?: number | null;
}

export interface RaisePoInput {
    locationId: number;
    raisedBy: number;
    supplierId?: number | null;
    issueId?: string | null;
    neededBy?: string | null;
    reason?: string | null;
    lines: RaisePoLine[];
}

export async function raisePurchaseOrder(input: RaisePoInput): Promise<{ id: string }> {
    if (input.lines.length === 0) throw badRequest('Add at least one item');

    const packIds = input.lines.map((l) => l.itemPackId);
    const packs = await db
        .selectFrom('item_packs')
        .innerJoin('items', 'items.id', 'item_packs.item_id')
        .select([
            'item_packs.id as packId',
            'item_packs.item_id as itemId',
            'item_packs.pack_name as packName',
            'item_packs.qty_in_stock_unit as qtyInStockUnit',
            'item_packs.is_active as packActive',
            'items.name as itemName',
            'items.is_active as itemActive'
        ])
        .where('item_packs.id', 'in', packIds)
        .execute();

    const byPack = new Map(packs.map((p) => [p.packId, p]));
    for (const line of input.lines) {
        const pack = byPack.get(line.itemPackId);
        if (!pack) throw notFound(`Item pack ${line.itemPackId}`);
        if (!pack.packActive || !pack.itemActive) {
            throw badRequest(`${pack.itemName} (${pack.packName}) has been retired`);
        }
        if (line.qtyPacks <= 0) throw badRequest(`${pack.itemName}: order at least one pack`);
    }

    if (input.supplierId) {
        const supplier = await db
            .selectFrom('suppliers')
            .select('id')
            .where('id', '=', input.supplierId)
            .where('is_active', '=', true)
            .executeTakeFirst();
        if (!supplier) throw notFound('That supplier');
    }

    // The conversion, once. Everything downstream of this line is stock units.
    const converted = input.lines.map((l) => {
        const pack = byPack.get(l.itemPackId)!;
        return {
            ...l,
            itemId: pack.itemId,
            qtyBase: l.qtyPacks * Number(pack.qtyInStockUnit)
        };
    });

    // What the store had at the time, so management can see how short it was
    // without going and looking. Several lines can be the same item in
    // different packs, so the shortage lookup is done per item.
    const perItem = new Map<number, number>();
    for (const c of converted) {
        perItem.set(c.itemId, (perItem.get(c.itemId) ?? 0) + c.qtyBase);
    }
    const shortages = await shortagesFor(
        input.locationId,
        [...perItem].map(([itemId, qtyRequested]) => ({ itemId, qtyRequested }))
    );
    const inStore = new Map(shortages.map((s) => [s.itemId, s.inStore]));

    return db.transaction().execute(async (trx) => {
        const po = await trx
            .insertInto('purchase_orders')
            .values({
                location_id: input.locationId,
                issue_id: input.issueId ?? null,
                supplier_id: input.supplierId ?? null,
                raised_by: input.raisedBy,
                needed_by: input.neededBy ?? null,
                reason: input.reason ?? null,
                status: 'requested',
                is_demo: false
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        for (const line of converted) {
            await trx
                .insertInto('purchase_order_lines')
                .values({
                    po_id: po.id,
                    item_id: line.itemId,
                    item_pack_id: line.itemPackId,
                    qty_packs: line.qtyPacks,
                    qty_base: line.qtyBase,
                    // Absent from the shortage list means the store can cover
                    // it -- which is normal for an order raised off reorder
                    // points, before anyone has gone short.
                    qty_in_store: inStore.get(line.itemId) ?? 0,
                    est_price: line.estPrice ?? null,
                    is_demo: false
                })
                .execute();
        }

        await audit(trx, {
            userId: input.raisedBy,
            action: 'po.raise',
            entity: 'purchase_orders',
            entityId: po.id,
            after: {
                lines: input.lines.length,
                issueId: input.issueId ?? null,
                supplierId: input.supplierId ?? null
            }
        });

        return { id: String(po.id) };
    });
}

export async function decidePurchaseOrder(
    poId: string,
    locationId: number,
    decidedBy: number,
    decision: 'approved' | 'rejected' | 'ordered' | 'done',
    note?: string | null,
    supplierId?: number | null
): Promise<void> {
    const po = await db
        .selectFrom('purchase_orders')
        .select(['id', 'status', 'supplier_id'])
        .where('id', '=', poId)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!po) throw notFound('That purchase order');
    if (po.status === 'rejected' || po.status === 'done') {
        throw conflict(`That purchase order is already ${po.status}`);
    }

    if (supplierId) {
        const supplier = await db
            .selectFrom('suppliers')
            .select('id')
            .where('id', '=', supplierId)
            .where('is_active', '=', true)
            .executeTakeFirst();
        if (!supplier) throw notFound('That supplier');
    }

    // "Ordered" means it has been placed with someone. Placing an order with
    // nobody in particular is how a delivery arrives that nothing can be
    // matched against.
    if (decision === 'ordered' && !supplierId && !po.supplier_id) {
        throw badRequest('Say who it was ordered from before marking it ordered');
    }

    await db.transaction().execute(async (trx) => {
        await trx
            .updateTable('purchase_orders')
            .set({
                status: decision,
                supplier_id: supplierId ?? po.supplier_id,
                decided_by: decidedBy,
                decided_at: new Date(),
                decision_note: note ?? null,
                // Marked done by hand rather than by a delivery: the order is
                // finished either way, and closed_at is what "finished" means.
                closed_at: decision === 'done' || decision === 'rejected' ? new Date() : null
            })
            .where('id', '=', poId)
            .execute();

        await audit(trx, {
            userId: decidedBy,
            action: `po.${decision}`,
            entity: 'purchase_orders',
            entityId: poId,
            after: { note: note ?? null, supplierId: supplierId ?? po.supplier_id }
        });
    });
}

/**
 * Close an order that will never be delivered in full.
 *
 * The supplier had six sacks and that is the end of it. Without this the order
 * sits open forever and the follow-up list stops being read, which costs more
 * than the four sacks did.
 */
export async function closePurchaseOrderShort(
    poId: string,
    locationId: number,
    closedBy: number,
    note: string
): Promise<void> {
    const po = await db
        .selectFrom('purchase_orders')
        .select(['id', 'status'])
        .where('id', '=', poId)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!po) throw notFound('That purchase order');
    if (!OPEN_STATUSES.includes(po.status)) {
        throw conflict(`That purchase order is already ${po.status}`);
    }

    await db.transaction().execute(async (trx) => {
        await trx
            .updateTable('purchase_orders')
            .set({
                status: 'done',
                decided_by: closedBy,
                decided_at: new Date(),
                decision_note: note,
                closed_at: new Date()
            })
            .where('id', '=', poId)
            .execute();

        await audit(trx, {
            userId: closedBy,
            action: 'po.closeShort',
            entity: 'purchase_orders',
            entityId: poId,
            after: { note }
        });
    });
}

/**
 * Book a delivery against an order.
 *
 * Called from inside createGrn's transaction, so the delivery and its effect
 * on the order either both happen or neither does. Matching is by item rather
 * than by line: a supplier who sends the same rice in a different sack has
 * still delivered the rice, and refusing to match it would leave the order
 * open forever over a packaging detail.
 */
export async function applyReceiptToPo(
    trx: Tx,
    poId: string,
    locationId: number,
    supplierId: number,
    receivedBy: number,
    received: { itemId: number; qtyBase: number }[]
): Promise<void> {
    const po = await trx
        .selectFrom('purchase_orders')
        .select(['id', 'status', 'supplier_id'])
        .where('id', '=', poId)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!po) throw notFound('That purchase order');

    if (!RECEIVABLE.includes(po.status)) {
        throw conflict(
            po.status === 'requested'
                ? 'Management has not approved that purchase order yet'
                : `That purchase order is already ${po.status}`
        );
    }

    if (po.supplier_id !== null && po.supplier_id !== supplierId) {
        throw conflict(
            'That order was placed with a different supplier. Enter this delivery on its own rather than against the order.'
        );
    }

    const lines = await trx
        .selectFrom('purchase_order_lines')
        .select(['id', 'item_id', 'qty_base', 'qty_received_base'])
        .where('po_id', '=', poId)
        .orderBy('id')
        .execute();

    const wanted = new Map<number, number>();
    for (const r of received) wanted.set(r.itemId, (wanted.get(r.itemId) ?? 0) + r.qtyBase);

    // One item can legitimately be on an order twice -- "2 x 1 kg pack" and
    // "1 x 25 kg sack" of the same rice is a real order, and the raise form
    // allows it because they are different packs. So what arrived is filled
    // against each line of that item in turn rather than dumped on the first
    // one, which would leave the second permanently outstanding and the order
    // permanently open.
    for (const line of lines) {
        const arrived = wanted.get(line.item_id);
        if (arrived === undefined || arrived <= 0) continue;

        const alreadyIn = Number(line.qty_received_base);
        const outstanding = Math.max(0, Number(line.qty_base) - alreadyIn);

        // The last line of an item takes any surplus: over-delivery is real,
        // and the stock has physically arrived either way.
        const isLastForItem = !lines.some(
            (other) => other.item_id === line.item_id && Number(other.id) > Number(line.id)
        );
        const take = isLastForItem ? arrived : Math.min(arrived, outstanding);
        if (take <= 0) continue;

        await trx
            .updateTable('purchase_order_lines')
            .set({ qty_received_base: round3(alreadyIn + take) })
            .where('id', '=', line.id)
            .execute();

        wanted.set(line.item_id, round3(arrived - take));
    }

    const after = await trx
        .selectFrom('purchase_order_lines')
        .select(['qty_base', 'qty_received_base'])
        .where('po_id', '=', poId)
        .execute();

    const complete = after.every(
        (l) => Number(l.qty_received_base) >= Number(l.qty_base)
    );

    await trx
        .updateTable('purchase_orders')
        .set(
            complete
                ? { status: 'done', closed_at: new Date() }
                : // Part-delivered orders move to "ordered" if they were still
                  // sitting at "approved": something has physically been sent,
                  // whether or not anyone pressed the button first.
                  { status: 'ordered' }
        )
        .where('id', '=', poId)
        .execute();

    await audit(trx, {
        userId: receivedBy,
        action: complete ? 'po.received' : 'po.partReceived',
        entity: 'purchase_orders',
        entityId: poId,
        after: { lines: received.length }
    });
}

export interface SuggestedLine {
    itemId: number;
    name: string;
    stockUnit: string;
    inStore: number;
    reorderPoint: number;
    parLevel: number;
    itemPackId: number | null;
    packName: string | null;
    qtyInStockUnit: number | null;
    /** Whole packs needed to get back up to par. */
    suggestedPacks: number;
    lastPrice: number | null;
}

/**
 * What the main store should be ordering, before anybody goes short.
 *
 * Reorder point and par level have been sitting in the item master since the
 * first migration, feeding a report that told you the shelf was empty and left
 * you to do something about it somewhere else. This is the "something about
 * it": everything at or below its reorder point, with the quantity that would
 * bring it back to par, in whole packs, at the price it was last bought for.
 *
 * Rounded up, because you cannot buy two thirds of a sack.
 */
export async function suggestedOrder(locationId: number): Promise<SuggestedLine[]> {
    const store = await db
        .selectFrom('sections')
        .select('id')
        .where('location_id', '=', locationId)
        .where('is_store', '=', true)
        .where('is_active', '=', true)
        .executeTakeFirst();
    if (!store) throw badRequest('This branch has no main store');

    const rows = await db
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
            'items.id as itemId',
            'items.name',
            'items.stock_unit as stockUnit',
            'items.reorder_point as reorderPoint',
            'items.par_level as parLevel',
            'cs.qty_base as qty',
            'p.id as itemPackId',
            'p.pack_name as packName',
            'p.qty_in_stock_unit as qtyInStockUnit'
        ])
        .where('items.is_active', '=', true)
        .where('items.reorder_point', '>', 0)
        .execute();

    const low = rows.filter(
        (r) => Number(r.qty ?? 0) <= Number(r.reorderPoint)
    );
    if (low.length === 0) return [];

    // Last price paid per pack, so the estimate is a real number rather than
    // a guess typed in by whoever is raising the order.
    const packIds = low.map((r) => r.itemPackId).filter((id): id is number => id !== null);
    const lastPrice = new Map<number, number>();
    if (packIds.length > 0) {
        const prices = await db
            .selectFrom('supplier_prices')
            .select(['item_pack_id', 'price', 'effective_from'])
            .where('item_pack_id', 'in', packIds)
            .orderBy('effective_from', 'desc')
            .execute();
        for (const p of prices) {
            if (!lastPrice.has(p.item_pack_id)) lastPrice.set(p.item_pack_id, Number(p.price));
        }
    }

    return low
        .map((r) => {
            const inStore = Math.max(0, Number(r.qty ?? 0));
            const par = Number(r.parLevel);
            const packSize = r.qtyInStockUnit === null ? null : Number(r.qtyInStockUnit);
            // Back up to par, or one reorder point's worth if nobody has set a
            // par level -- an order of zero packs helps no one.
            const shortfall = Math.max(par - inStore, Number(r.reorderPoint) - inStore, 0);

            return {
                itemId: r.itemId,
                name: r.name,
                stockUnit: r.stockUnit,
                inStore,
                reorderPoint: Number(r.reorderPoint),
                parLevel: par,
                itemPackId: r.itemPackId,
                packName: r.packName,
                qtyInStockUnit: packSize,
                suggestedPacks:
                    packSize && packSize > 0 ? Math.max(1, Math.ceil(shortfall / packSize)) : 0,
                lastPrice: r.itemPackId === null ? null : lastPrice.get(r.itemPackId) ?? null
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Guard for the routes: only management spends money. */
export function assertCanDecide(role: string): void {
    if (role !== 'management') {
        throw forbidden('Only management can decide a purchase');
    }
}

/** Quantities are numeric(14,3); keep the arithmetic on that grid. */
function round3(n: number): number {
    return Math.round(n * 1000) / 1000;
}
