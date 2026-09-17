/**
 * Purchase orders.
 *
 * Raising one is the storekeeper's job, and management's -- the two people who
 * can actually look at the store's shelf before deciding something has to be
 * bought. A section asks for stock; if the store cannot cover it, the
 * storekeeper raises the purchase for the shortfall. That way nobody orders a
 * sack of flour that is sitting in the store already, and the buying decision
 * starts from what the store really holds.
 *
 * Deciding one is management and only management: it is the single action in
 * this system that spends money.
 *
 * Receiving is not here. A delivery against an order is entered as a GRN with
 * a `poId`, so there is one way for stock to arrive and one place that
 * converts packs into stock units. See services/grn.ts.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../db/index.js';
import { offsetOf, pageOf, pageQuery, toPage } from '../services/pagination.js';
import {
    closePurchaseOrderShort,
    decidePurchaseOrder,
    raisePurchaseOrder,
    suggestedOrder
} from '../services/purchasing.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const poLine = z.object({
    itemId: z.number(),
    name: z.string(),
    stockUnit: z.string(),
    qtyBase: z.number(),
    /** What was in the store when it was raised. */
    qtyInStore: z.number(),
    itemPackId: z.number().nullable(),
    packName: z.string().nullable(),
    qtyPacks: z.number().nullable(),
    estPrice: z.number().nullable(),
    qtyReceivedBase: z.number(),
    /** Still to come. Zero once the line is fully delivered. */
    qtyOutstandingBase: z.number()
});

const purchaseOrder = z.object({
    id: z.string(),
    status: z.string(),
    raisedBy: z.string(),
    raisedAt: z.string(),
    supplierId: z.number().nullable(),
    supplierName: z.string().nullable(),
    neededBy: z.string().nullable(),
    reason: z.string().nullable(),
    decidedBy: z.string().nullable(),
    decisionNote: z.string().nullable(),
    closedAt: z.string().nullable(),
    /** True when something has arrived but not everything. */
    partReceived: z.boolean(),
    estimatedTotal: z.number().nullable(),
    lines: z.array(poLine)
});

export async function purchasingRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.post(
        '/purchase-orders',
        {
            // Not kitchen or cleaning. Their way in is a request: they ask for
            // stock, and the shortfall the store cannot cover is what the
            // storekeeper turns into a purchase.
            preHandler: app.requireRole('management', 'storekeeper'),
            schema: {
                body: z.object({
                    issueId: z.string().nullish(),
                    supplierId: z.number().int().positive().nullish(),
                    neededBy: dateStr.nullish(),
                    reason: z.string().max(500).nullish(),
                    lines: z
                        .array(
                            z.object({
                                // Packs, not stock units: what you say to a
                                // supplier, and what comes back on the invoice.
                                itemPackId: z.number().int().positive(),
                                qtyPacks: z.number().positive().max(100_000),
                                estPrice: z.number().nonnegative().max(100_000_000).nullish()
                            })
                        )
                        .min(1)
                }),
                response: { 201: z.object({ id: z.string() }) }
            }
        },
        async (req, reply) => {
            const result = await raisePurchaseOrder({
                locationId: req.locationId,
                raisedBy: req.user.sub,
                issueId: req.body.issueId ?? null,
                supplierId: req.body.supplierId ?? null,
                neededBy: req.body.neededBy ?? null,
                reason: req.body.reason ?? null,
                lines: req.body.lines.map((l) => ({
                    itemPackId: l.itemPackId,
                    qtyPacks: l.qtyPacks,
                    estPrice: l.estPrice ?? null
                }))
            });
            return reply.status(201).send(result);
        }
    );

    r.post(
        '/purchase-orders/:id/decide',
        {
            // Only management. Buying is the one thing that spends money.
            preHandler: app.requireRole('management'),
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    decision: z.enum(['approved', 'rejected', 'ordered', 'done']),
                    note: z.string().max(500).nullish(),
                    /** Who it is being bought from, if it was not named up front. */
                    supplierId: z.number().int().positive().nullish()
                }),
                response: { 200: z.object({ ok: z.literal(true) }) }
            }
        },
        async (req) => {
            await decidePurchaseOrder(
                req.params.id,
                req.locationId,
                req.user.sub,
                req.body.decision,
                req.body.note ?? null,
                req.body.supplierId ?? null
            );
            return { ok: true as const };
        }
    );

    /**
     * The rest is never coming. Closing it short takes a reason, because in six
     * weeks "why did we only get six sacks" is a real question.
     */
    r.post(
        '/purchase-orders/:id/close',
        {
            preHandler: app.requireRole('management'),
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({ note: z.string().min(3).max(500) }),
                response: { 200: z.object({ ok: z.literal(true) }) }
            }
        },
        async (req) => {
            await closePurchaseOrderShort(
                req.params.id,
                req.locationId,
                req.user.sub,
                req.body.note
            );
            return { ok: true as const };
        }
    );

    /**
     * What the store should be ordering, off the reorder points in the item
     * master. The point of this screen is that nobody has to have gone short
     * first.
     */
    r.get(
        '/purchase-orders/suggested',
        {
            preHandler: app.requireRole('management', 'storekeeper'),
            schema: {
                response: {
                    200: z.array(
                        z.object({
                            itemId: z.number(),
                            name: z.string(),
                            stockUnit: z.string(),
                            inStore: z.number(),
                            reorderPoint: z.number(),
                            parLevel: z.number(),
                            itemPackId: z.number().nullable(),
                            packName: z.string().nullable(),
                            qtyInStockUnit: z.number().nullable(),
                            suggestedPacks: z.number(),
                            lastPrice: z.number().nullable()
                        })
                    )
                }
            }
        },
        async (req) => suggestedOrder(req.locationId)
    );

    r.get(
        '/purchase-orders',
        {
            preHandler: app.authenticate,
            schema: {
                querystring: pageQuery.extend({
                    status: z
                        .enum(['requested', 'approved', 'rejected', 'ordered', 'done'])
                        .optional(),
                    /** Everything not yet delivered or rejected, in one filter. */
                    open: z.coerce.boolean().optional(),
                    /**
                     * Only what this person raised.
                     *
                     * The screen has always told a section login "What you asked
                     * to be bought" while handing back every purchase order at
                     * the branch - true only for as long as one person was the
                     * only one asking. The raiser is the sole ownership marker
                     * available: a purchase order carries no section, and most
                     * are raised standalone rather than from a short request, so
                     * there is nothing to reach a section through.
                     */
                    mine: z.coerce.boolean().optional()
                }),
                response: { 200: pageOf(purchaseOrder) }
            }
        },
        async (req) => {
            let q = db
                .selectFrom('purchase_orders as po')
                .innerJoin('users as raiser', 'raiser.id', 'po.raised_by')
                .leftJoin('users as decider', 'decider.id', 'po.decided_by')
                .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
                .select([
                    'po.id',
                    'po.status',
                    'raiser.name as raisedBy',
                    'po.raised_at as raisedAt',
                    'po.supplier_id as supplierId',
                    's.name as supplierName',
                    'po.needed_by as neededBy',
                    'po.reason',
                    'decider.name as decidedBy',
                    'po.decision_note as decisionNote',
                    'po.closed_at as closedAt'
                ])
                .where('po.location_id', '=', req.locationId);

            let countQ = db
                .selectFrom('purchase_orders as po')
                .select(({ fn }) => fn.countAll().as('total'))
                .where('po.location_id', '=', req.locationId);

            if (req.query.status) {
                q = q.where('po.status', '=', req.query.status);
                countQ = countQ.where('po.status', '=', req.query.status);
            }
            if (req.query.open) {
                q = q.where('po.status', 'in', ['requested', 'approved', 'ordered']);
                countQ = countQ.where('po.status', 'in', ['requested', 'approved', 'ordered']);
            }
            if (req.query.mine) {
                q = q.where('po.raised_by', '=', req.user.sub);
                countQ = countQ.where('po.raised_by', '=', req.user.sub);
            }
            const counted = await countQ.executeTakeFirst();

            const orders = await q
                .orderBy('po.raised_at', 'desc')
                .limit(req.query.limit)
                .offset(offsetOf(req.query))
                .execute();
            if (orders.length === 0) return toPage([], counted?.total, req.query);

            const lines = await db
                .selectFrom('purchase_order_lines as l')
                .innerJoin('items', 'items.id', 'l.item_id')
                .leftJoin('item_packs as p', 'p.id', 'l.item_pack_id')
                .select([
                    'l.po_id',
                    'items.id as itemId',
                    'items.name',
                    'items.stock_unit as stockUnit',
                    'l.qty_base as qtyBase',
                    'l.qty_in_store as qtyInStore',
                    'l.item_pack_id as itemPackId',
                    'p.pack_name as packName',
                    'l.qty_packs as qtyPacks',
                    'l.est_price as estPrice',
                    'l.qty_received_base as qtyReceivedBase'
                ])
                .where(
                    'l.po_id',
                    'in',
                    orders.map((o) => o.id)
                )
                .orderBy('l.id')
                .execute();

            const byPo = new Map<string, typeof lines>();
            for (const line of lines) {
                const key = String(line.po_id);
                const list = byPo.get(key) ?? [];
                list.push(line);
                byPo.set(key, list);
            }

            const items = orders.map((o) => {
                const mine = (byPo.get(String(o.id)) ?? []).map((l) => {
                    const qtyBase = Number(l.qtyBase);
                    const received = Number(l.qtyReceivedBase);
                    return {
                        itemId: l.itemId,
                        name: l.name,
                        stockUnit: l.stockUnit,
                        qtyBase,
                        qtyInStore: Number(l.qtyInStore),
                        itemPackId: l.itemPackId,
                        packName: l.packName,
                        qtyPacks: l.qtyPacks === null ? null : Number(l.qtyPacks),
                        estPrice: l.estPrice === null ? null : Number(l.estPrice),
                        qtyReceivedBase: received,
                        qtyOutstandingBase: Math.max(0, Math.round((qtyBase - received) * 1000) / 1000)
                    };
                });

                // Only worth showing when every line has a price to add up;
                // a total missing half its lines reads as a cheap order.
                const priced = mine.filter((l) => l.estPrice !== null && l.qtyPacks !== null);
                const estimatedTotal =
                    priced.length === mine.length && mine.length > 0
                        ? Math.round(
                              priced.reduce((sum, l) => sum + l.estPrice! * l.qtyPacks!, 0) * 100
                          ) / 100
                        : null;

                return {
                    id: String(o.id),
                    status: o.status,
                    raisedBy: o.raisedBy,
                    raisedAt: new Date(o.raisedAt as unknown as string).toISOString(),
                    supplierId: o.supplierId,
                    supplierName: o.supplierName,
                    neededBy: o.neededBy,
                    reason: o.reason,
                    decidedBy: o.decidedBy,
                    decisionNote: o.decisionNote,
                    closedAt: o.closedAt ? new Date(o.closedAt).toISOString() : null,
                    partReceived:
                        mine.some((l) => l.qtyReceivedBase > 0) &&
                        mine.some((l) => l.qtyOutstandingBase > 0),
                    estimatedTotal,
                    lines: mine
                };
            });

            return toPage(items, counted?.total, req.query);
        }
    );
}
