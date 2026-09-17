import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { badRequest, notFound } from '../errors.js';
import { createGrn } from '../services/grn.js';
import { findReplay, hashBody } from '../services/idempotency.js';
import { db } from '../db/index.js';
import { offsetOf, pageOf, pageQuery, toPage } from '../services/pagination.js';

const grnResult = z.object({
    id: z.string(),
    total: z.number(),
    businessDate: z.string(),
    lineCount: z.number(),
    priceWarnings: z.array(
        z.object({
            itemPackId: z.number(),
            itemName: z.string(),
            packName: z.string(),
            previousPrice: z.number(),
            newPrice: z.number(),
            changePct: z.number(),
        })
    ),
});

export async function grnRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();

    /**
     * What this supplier charged last time, per pack.
     *
     * The build notes say a price jump is "warned inline, before the lorry
     * leaves, not in a report a fortnight later". Until now the warning came
     * back with the save response -- which is after the delivery is recorded
     * and, in practice, after the driver has gone. The storekeeper's own
     * question at the door is simpler than a report: is this the price we
     * agreed? So the last price is readable while the line is being typed.
     *
     * Read from `supplier_prices`, which is the same table `createGrn`
     * compares against when it decides whether to warn. Two sources for one
     * number is how a screen ends up disagreeing with the document it just
     * produced.
     */
    r.get(
        '/suppliers/:id/last-prices',
        {
            preHandler: app.requireRole('storekeeper', 'management'),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                response: {
                    200: z.array(
                        z.object({
                            itemPackId: z.number(),
                            price: z.number(),
                            effectiveFrom: z.string(),
                        })
                    ),
                },
            },
        },
        async (req) => {
            const rows = await db
                .selectFrom('supplier_prices')
                .select(['item_pack_id as itemPackId', 'price', 'effective_from as effectiveFrom'])
                .where('supplier_id', '=', req.params.id)
                .orderBy('item_pack_id')
                .orderBy('effective_from', 'desc')
                // Two changes on one day are ordinary, and effective_from is a
                // date. The later row wins, the same way createGrn breaks the
                // tie -- otherwise the screen and the document it produces can
                // compare against different prices.
                .orderBy('id', 'desc')
                .execute();

            // One row per pack: the most recent. Done here rather than with a
            // distinct-on so the shape stays obvious.
            const latest = new Map<number, { itemPackId: number; price: number; effectiveFrom: string }>();
            for (const row of rows) {
                if (latest.has(row.itemPackId)) continue;
                latest.set(row.itemPackId, {
                    itemPackId: row.itemPackId,
                    price: Number(row.price),
                    effectiveFrom: String(row.effectiveFrom),
                });
            }
            return [...latest.values()];
        }
    );

    r.post(
        '/grn',
        {
            preHandler: app.requireRole('storekeeper', 'management'),
            schema: {
                headers: z.object({ 'idempotency-key': z.string().min(8).max(128) }).passthrough(),
                body: z.object({
                    supplierId: z.number().int().positive(),
                    /** Set when this delivery fills a purchase order. */
                    poId: z.string().nullish(),
                    invoiceNo: z.string().max(64).nullish(),
                    invoiceDate: z
                        .string()
                        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
                        .nullish(),
                    photoUrl: z.string().max(512).nullish(),
                    lines: z
                        .array(
                            z.object({
                                itemPackId: z.number().int().positive(),
                                // Packs, never stock units. Fractional packs are
                                // real: half a sack gets delivered.
                                qtyPacks: z.number().positive().max(100_000),
                                packPrice: z.number().nonnegative().max(100_000_000),
                                expiryDate: z
                                    .string()
                                    .regex(/^\d{4}-\d{2}-\d{2}$/)
                                    .nullish(),
                            })
                        )
                        .min(1, 'A GRN needs at least one line'),
                }),
                response: { 200: grnResult, 201: grnResult },
            },
        },
        async (req, reply) => {
            const key = req.headers['idempotency-key'] as string;
            const endpoint = 'POST /grn';
            const requestHash = hashBody(req.body);

            const replay = await findReplay<z.infer<typeof grnResult>>(key, endpoint, requestHash);
            if (replay) {
                // Same key, same body: hand back the original result rather than
                // receiving the same delivery twice.
                return reply.status(200).send(replay.response);
            }

            const result = await createGrn({
                locationId: req.locationId,
                supplierId: req.body.supplierId,
                poId: req.body.poId ?? null,
                invoiceNo: req.body.invoiceNo ?? null,
                invoiceDate: req.body.invoiceDate ?? null,
                photoUrl: req.body.photoUrl ?? null,
                lines: req.body.lines.map((l) => ({
                    itemPackId: l.itemPackId,
                    qtyPacks: l.qtyPacks,
                    packPrice: l.packPrice,
                    expiryDate: l.expiryDate ?? null,
                })),
                receivedBy: req.user.sub,
                idempotency: { key, endpoint, requestHash },
            });

            return reply.status(201).send(result);
        }
    );

    r.get(
        '/grn',
        {
            preHandler: app.authenticate,
            schema: {
                // Was the only list with its own `{ rows, total }` shape and a
                // raw offset. Moved onto the shared page envelope so every list
                // in the app answers the same way.
                querystring: pageQuery.extend({
                    /** Matches the supplier's name or the invoice number. */
                    search: z.string().trim().max(120).optional(),
                }),
                response: {
                    200: pageOf(
                        z.object({
                            id: z.string(),
                            supplierName: z.string(),
                            invoiceNo: z.string().nullable(),
                            invoiceDate: z.string().nullable(),
                            receivedAt: z.string(),
                            receivedBy: z.string(),
                            /** Set when it filled a purchase order. */
                            poId: z.string().nullable(),
                            total: z.number().nullable(),
                            lineCount: z.number(),
                        })
                    ),
                },
            },
        },
        async (req) => {
            // The search has to be applied to the count as well as the rows, or
            // the pager describes a different set from the list under it.
            const search = req.query.search;
            const base = db
                .selectFrom('grn')
                .innerJoin('suppliers', 'suppliers.id', 'grn.supplier_id')
                .where('grn.location_id', '=', req.locationId)
                .$if(!!search, (q) =>
                    q.where((eb) =>
                        eb.or([
                            eb('suppliers.name', 'ilike', `%${search}%`),
                            eb('grn.invoice_no', 'ilike', `%${search}%`),
                        ])
                    )
                );

            const [rows, count] = await Promise.all([
                base
                    .innerJoin('users', 'users.id', 'grn.received_by')
                    .leftJoin('grn_lines', 'grn_lines.grn_id', 'grn.id')
                    .select(({ fn }) => [
                        'grn.id',
                        'suppliers.name as supplierName',
                        'grn.invoice_no as invoiceNo',
                        'grn.invoice_date as invoiceDate',
                        'grn.received_at as receivedAt',
                        'grn.po_id as poId',
                        'users.name as receivedBy',
                        // Derived from the lines, not read from grn.total. The
                        // stored column is a convenience that can be null
                        // (seeded rows never set it) or stale; the lines are
                        // the document. Same principle as stock itself.
                        sql<number>`coalesce(sum(grn_lines.qty_packs * grn_lines.pack_price), 0)`.as(
                            'total'
                        ),
                        fn.count('grn_lines.id').as('lineCount'),
                    ])
                    .groupBy(['grn.id', 'suppliers.name', 'users.name'])
                    .orderBy('grn.received_at', 'desc')
                    .limit(req.query.limit)
                    .offset(offsetOf(req.query))
                    .execute(),
                base.select(({ fn }) => fn.countAll().as('n')).executeTakeFirstOrThrow(),
            ]);

            const items = rows.map((r2) => ({
                id: String(r2.id),
                supplierName: r2.supplierName,
                invoiceNo: r2.invoiceNo,
                invoiceDate: r2.invoiceDate === null ? null : String(r2.invoiceDate),
                receivedAt: new Date(r2.receivedAt as unknown as string).toISOString(),
                receivedBy: r2.receivedBy,
                poId: r2.poId === null ? null : String(r2.poId),
                total: Number(r2.total ?? 0),
                lineCount: Number(r2.lineCount),
            }));

            return toPage(items, count.n, req.query);
        }
    );

    /**
     * One delivery, read back.
     *
     * A delivery could be entered and then never looked at again: the only way
     * to find last Tuesday's invoice was the picker on the supplier-returns
     * form, which is a strange place to keep a record and is closed to anyone
     * who cannot raise one. A goods received note is a document the business
     * keeps, so it has a page.
     *
     * Each line carries what has already gone back to the supplier against it,
     * from the same query the return form uses -- so the answer to "did we get
     * a credit for the bad half of that delivery" is on the delivery.
     */
    r.get(
        '/grn/:id',
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                response: {
                    200: z.object({
                        id: z.string(),
                        supplierId: z.number(),
                        supplierName: z.string(),
                        invoiceNo: z.string().nullable(),
                        invoiceDate: z.string().nullable(),
                        receivedAt: z.string(),
                        receivedBy: z.string(),
                        poId: z.string().nullable(),
                        photoUrl: z.string().nullable(),
                        total: z.number(),
                        lines: z.array(
                            z.object({
                                id: z.string(),
                                itemId: z.number(),
                                itemCode: z.string(),
                                itemName: z.string(),
                                stockUnit: z.string(),
                                packName: z.string(),
                                qtyInStockUnit: z.number(),
                                qtyPacks: z.number(),
                                packPrice: z.number(),
                                qtyBase: z.number(),
                                lineTotal: z.number(),
                                /** Packs already sent back to the supplier. */
                                qtyPacksReturned: z.number(),
                            })
                        ),
                    }),
                },
            },
        },
        async (req) => {
            const head = await db
                .selectFrom('grn')
                .innerJoin('suppliers', 'suppliers.id', 'grn.supplier_id')
                .innerJoin('users', 'users.id', 'grn.received_by')
                .select([
                    'grn.id',
                    'grn.supplier_id as supplierId',
                    'suppliers.name as supplierName',
                    'grn.invoice_no as invoiceNo',
                    'grn.invoice_date as invoiceDate',
                    'grn.received_at as receivedAt',
                    'grn.po_id as poId',
                    'grn.photo_url as photoUrl',
                    'users.name as receivedBy',
                ])
                .where('grn.id', '=', req.params.id)
                .where('grn.location_id', '=', req.locationId)
                .executeTakeFirst();

            if (!head) throw notFound(`Delivery ${req.params.id}`);

            const { rows } = await sql<{
                id: string;
                itemId: number;
                itemCode: string;
                itemName: string;
                stockUnit: string;
                packName: string;
                qtyInStockUnit: number;
                qtyPacks: number;
                packPrice: number;
                qtyPacksReturned: number;
            }>`
                select
                  gl.id                    as "id",
                  i.id                     as "itemId",
                  i.code                   as "itemCode",
                  i.name                   as "itemName",
                  i.stock_unit             as "stockUnit",
                  p.pack_name              as "packName",
                  p.qty_in_stock_unit      as "qtyInStockUnit",
                  gl.qty_packs             as "qtyPacks",
                  gl.pack_price            as "packPrice",
                  coalesce(r.returned, 0)  as "qtyPacksReturned"
                from grn_lines gl
                join item_packs p on p.id = gl.item_pack_id
                join items i      on i.id = p.item_id
                left join (
                  select srl.grn_line_id, sum(srl.qty_packs) as returned
                  from supplier_return_lines srl
                  join supplier_returns sr on sr.id = srl.return_id
                  where sr.status <> 'rejected'
                  group by srl.grn_line_id
                ) r on r.grn_line_id = gl.id
                where gl.grn_id = ${req.params.id}
                order by i.name
            `.execute(db);

            const lines = rows.map((l) => {
                const qtyPacks = Number(l.qtyPacks);
                const packPrice = Number(l.packPrice);
                const qtyInStockUnit = Number(l.qtyInStockUnit);
                return {
                    id: String(l.id),
                    itemId: l.itemId,
                    itemCode: l.itemCode,
                    itemName: l.itemName,
                    stockUnit: l.stockUnit,
                    packName: l.packName,
                    qtyInStockUnit,
                    qtyPacks,
                    packPrice,
                    qtyBase: qtyPacks * qtyInStockUnit,
                    lineTotal: qtyPacks * packPrice,
                    qtyPacksReturned: Number(l.qtyPacksReturned),
                };
            });

            return {
                id: String(head.id),
                supplierId: head.supplierId,
                supplierName: head.supplierName,
                invoiceNo: head.invoiceNo,
                invoiceDate: head.invoiceDate === null ? null : String(head.invoiceDate),
                receivedAt: new Date(head.receivedAt as unknown as string).toISOString(),
                receivedBy: head.receivedBy,
                poId: head.poId === null ? null : String(head.poId),
                photoUrl: head.photoUrl,
                // Derived from the lines, like the list: the stored column is a
                // convenience that can be null or stale.
                total: lines.reduce((n, l) => n + l.lineTotal, 0),
                lines,
            };
        }
    );
}

export { badRequest };
