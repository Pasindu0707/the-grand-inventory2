import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../db/index.js';
import { offsetOf, pageOf, pageQuery, toPage } from '../services/pagination.js';
import { assertSectionAllowed, assertSectionOpen, sectionsForUser } from '../plugins/auth.js';
import { badRequest, notFound } from '../errors.js';
import { approveWastage, logWastage, receiveTransfer, transfer } from '../services/wastage.js';
import { closeCount, openCount, saveCountLines, verifyCount } from '../services/counts.js';
import { reverseDocument } from '../services/ledger.js';

export async function documentRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();

    // Issues used to live here as a two-step request/fulfil pair. They are
    // now the four-step flow in routes/requests.ts - ask, release, confirm -
    // and having both would have left two ways to do the same thing, which is
    // exactly the kind of thing that makes an app feel complicated.

    // ── Wastage ─────────────────────────────────────────────────────────────

    r.get(
        '/reason-codes',
        {
            preHandler: app.authenticate,
            schema: {
                querystring: z.object({ doc: z.string().optional() }),
                response: {
                    200: z.array(z.object({ code: z.string(), doc: z.string(), label: z.string() }))
                }
            }
        },
        async (req) => {
            let q = db.selectFrom('reason_codes').select(['code', 'doc', 'label']);
            if (req.query.doc) q = q.where('doc', '=', req.query.doc as 'wastage');
            return q.orderBy('label').execute();
        }
    );

    r.post(
        '/wastage',
        {
            preHandler: app.requireRole('management', 'storekeeper', 'kitchen', 'cleaning'),
            schema: {
                body: z.object({
                    sectionId: z.number().int().positive(),
                    itemId: z.number().int().positive(),
                    qtyBase: z.number().positive(),
                    reasonCode: z.string().min(2).max(20),
                    photoUrl: z.string().max(512).nullish(),
                    note: z.string().max(500).nullish()
                }),
                response: { 201: z.object({ id: z.string(), businessDate: z.string() }) }
            }
        },
        async (req, reply) => {
            await assertSectionAllowed(req.user.role, req.locationId, req.body.sectionId);
            await assertSectionOpen(req.body.sectionId);
            const result = await logWastage({
                locationId: req.locationId,
                sectionId: req.body.sectionId,
                itemId: req.body.itemId,
                qtyBase: req.body.qtyBase,
                reasonCode: req.body.reasonCode,
                photoUrl: req.body.photoUrl ?? null,
                note: req.body.note ?? null,
                loggedBy: req.user.sub
            });
            return reply.status(201).send(result);
        }
    );

    r.post(
        '/wastage/:id/approve',
        {
            preHandler: app.requireRole('management'),
            schema: {
                params: z.object({ id: z.string() }),
                response: { 200: z.object({ ok: z.literal(true) }) }
            }
        },
        async (req) => {
            await approveWastage(req.params.id, req.locationId, req.user.sub);
            return { ok: true as const };
        }
    );

    r.get(
        '/wastage',
        {
            preHandler: app.authenticate,
            schema: {
                querystring: pageQuery.extend({
                    pendingOnly: z.coerce.boolean().optional(),
                    sectionId: z.coerce.number().int().positive().optional()
                }),
                response: {
                    200: pageOf(
                        z.object({
                            id: z.string(),
                            itemName: z.string(),
                            sectionCode: z.string(),
                            qtyBase: z.number(),
                            stockUnit: z.string(),
                            reasonCode: z.string(),
                            reasonLabel: z.string(),
                            loggedBy: z.string(),
                            loggedAt: z.string(),
                            approved: z.boolean()
                        })
                    )
                }
            }
        },
        async (req) => {
            // The wastage book is per section: the kitchen has no reason to read
            // what the cleaning store threw away, and vice versa. Management and
            // the storekeeper still see the branch.
            const mine = await sectionsForUser(req.user.role, req.locationId);
            if (req.query.sectionId !== undefined) {
                await assertSectionAllowed(req.user.role, req.locationId, req.query.sectionId);
            }
            const sectionFilter = <Q extends { where: any }>(query: Q): Q => {
                if (req.query.sectionId !== undefined) {
                    return (query as any).where('wastage.section_id', '=', req.query.sectionId);
                }
                return (query as any).where('wastage.section_id', 'in', mine);
            };

            let q = db
                .selectFrom('wastage')
                .innerJoin('items', 'items.id', 'wastage.item_id')
                .innerJoin('sections', 'sections.id', 'wastage.section_id')
                .innerJoin('users', 'users.id', 'wastage.logged_by')
                .innerJoin('reason_codes', 'reason_codes.code', 'wastage.reason_code')
                .select([
                    'wastage.id',
                    'items.name as itemName',
                    'items.stock_unit as stockUnit',
                    'sections.code as sectionCode',
                    'wastage.qty_base as qtyBase',
                    'wastage.reason_code as reasonCode',
                    'reason_codes.label as reasonLabel',
                    'users.name as loggedBy',
                    'wastage.logged_at as loggedAt',
                    'wastage.approved_by as approvedBy'
                ])
                .where('wastage.location_id', '=', req.locationId);

            if (req.query.pendingOnly) q = q.where('wastage.approved_by', 'is', null);
            q = sectionFilter(q);

            let countQ = db
                .selectFrom('wastage')
                .select(({ fn }) => fn.countAll().as('total'))
                .where('wastage.location_id', '=', req.locationId);
            if (req.query.pendingOnly) countQ = countQ.where('wastage.approved_by', 'is', null);
            countQ = sectionFilter(countQ);
            const counted = await countQ.executeTakeFirst();

            const rows = await q
                .orderBy('wastage.logged_at', 'desc')
                .limit(req.query.limit)
                .offset(offsetOf(req.query))
                .execute();

            const items = rows.map((row) => ({
                id: String(row.id),
                itemName: row.itemName,
                sectionCode: row.sectionCode,
                qtyBase: Number(row.qtyBase),
                stockUnit: row.stockUnit,
                reasonCode: row.reasonCode,
                reasonLabel: row.reasonLabel,
                loggedBy: row.loggedBy,
                loggedAt: new Date(row.loggedAt as unknown as string).toISOString(),
                approved: row.approvedBy !== null
            }));

            return toPage(items, counted?.total, req.query);
        }
    );

    // ── Transfers ───────────────────────────────────────────────────────────

    r.post(
        '/transfers',
        {
            preHandler: app.requireRole('management', 'storekeeper'),
            schema: {
                body: z.object({
                    fromSectionId: z.number().int().positive(),
                    toSectionId: z.number().int().positive(),
                    itemId: z.number().int().positive(),
                    qtyBase: z.number().positive()
                }),
                response: { 201: z.object({ id: z.string(), completed: z.boolean() }) }
            }
        },
        async (req, reply) => {
            await assertSectionOpen(req.body.fromSectionId, req.body.toSectionId);
            const result = await transfer({ ...req.body, sentBy: req.user.sub });
            return reply.status(201).send(result);
        }
    );

    r.post(
        '/transfers/:id/receive',
        {
            preHandler: app.requireRole('management', 'storekeeper'),
            schema: {
                params: z.object({ id: z.string() }),
                response: { 200: z.object({ id: z.string() }) }
            }
        },
        async (req) => receiveTransfer(req.params.id, req.user.sub)
    );

    // ── Counts ──────────────────────────────────────────────────────────────

    const countLine = z.object({
        lineId: z.string(),
        itemId: z.number(),
        code: z.string(),
        name: z.string(),
        stockUnit: z.string(),
        qtyExpected: z.number(),
        qtyCounted: z.number().nullable()
    });

    r.post(
        '/counts/open',
        {
            preHandler: app.requireRole('management', 'storekeeper', 'kitchen', 'cleaning'),
            schema: {
                body: z.object({
                    sectionId: z.number().int().positive(),
                    countType: z.enum(['daily_critical', 'weekly_full', 'monthly_full'])
                }),
                response: { 201: z.object({ id: z.string(), lines: z.array(countLine) }) }
            }
        },
        async (req, reply) => {
            await assertSectionAllowed(req.user.role, req.locationId, req.body.sectionId);
            await assertSectionOpen(req.body.sectionId);
            const result = await openCount({
                locationId: req.locationId,
                sectionId: req.body.sectionId,
                countType: req.body.countType,
                countedBy: req.user.sub
            });
            return reply.status(201).send(result);
        }
    );

    r.put(
        '/counts/:id/lines',
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    lines: z
                        .array(
                            z.object({
                                lineId: z.string(),
                                qtyCounted: z.number().nonnegative().nullable()
                            })
                        )
                        .min(1)
                }),
                response: { 200: z.object({ ok: z.literal(true) }) }
            }
        },
        async (req) => {
            await saveCountLines(req.params.id, req.locationId, req.body.lines);
            return { ok: true as const };
        }
    );

    r.post(
        '/counts/:id/close',
        {
            preHandler: app.requireRole('management', 'storekeeper', 'kitchen', 'cleaning'),
            schema: {
                params: z.object({ id: z.string() }),
                response: {
                    200: z.object({
                        id: z.string(),
                        adjustments: z.number(),
                        counted: z.number(),
                        skipped: z.number(),
                        varianceValue: z.number(),
                        biggest: z.array(
                            z.object({
                                name: z.string(),
                                varianceQty: z.number(),
                                varianceValue: z.number()
                            })
                        )
                    })
                }
            }
        },
        async (req) => closeCount(req.params.id, req.locationId, req.user.sub)
    );

    r.post(
        '/counts/:id/verify',
        {
            preHandler: app.requireRole('management'),
            schema: {
                params: z.object({ id: z.string() }),
                response: { 200: z.object({ ok: z.literal(true) }) }
            }
        },
        async (req) => {
            await verifyCount(req.params.id, req.locationId, req.user.sub);
            return { ok: true as const };
        }
    );

    r.get(
        '/counts/:id',
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                response: {
                    200: z.object({
                        id: z.string(),
                        countType: z.string(),
                        sectionId: z.number(),
                        businessDate: z.string(),
                        closed: z.boolean(),
                        verified: z.boolean(),
                        lines: z.array(countLine)
                    })
                }
            }
        },
        async (req) => {
            const count = await db
                .selectFrom('stock_counts')
                .selectAll()
                .where('id', '=', req.params.id)
                .where('location_id', '=', req.locationId)
                .executeTakeFirst();
            if (!count) throw notFound(`Count ${req.params.id}`);

            const lines = await db
                .selectFrom('stock_count_lines')
                .innerJoin('items', 'items.id', 'stock_count_lines.item_id')
                .select([
                    'stock_count_lines.id as lineId',
                    'items.id as itemId',
                    'items.code',
                    'items.name',
                    'items.stock_unit as stockUnit',
                    'stock_count_lines.qty_expected as qtyExpected',
                    'stock_count_lines.qty_counted as qtyCounted'
                ])
                .where('stock_count_lines.count_id', '=', req.params.id)
                .orderBy('items.name')
                .execute();

            return {
                id: String(count.id),
                countType: count.count_type,
                sectionId: count.section_id,
                businessDate: count.business_date,
                closed: count.closed_at !== null,
                verified: count.verified_by !== null,
                lines: lines.map((l) => ({
                    lineId: String(l.lineId),
                    itemId: l.itemId,
                    code: l.code,
                    name: l.name,
                    stockUnit: l.stockUnit,
                    qtyExpected: Number(l.qtyExpected),
                    qtyCounted: l.qtyCounted === null ? null : Number(l.qtyCounted)
                }))
            };
        }
    );

    r.get(
        '/counts',
        {
            preHandler: app.authenticate,
            schema: {
                querystring: pageQuery.extend({
                    openOnly: z.coerce.boolean().optional(),
                    sectionId: z.coerce.number().int().positive().optional()
                }),
                response: {
                    200: pageOf(
                        z.object({
                            id: z.string(),
                            countType: z.string(),
                            sectionCode: z.string(),
                            businessDate: z.string(),
                            countedBy: z.string(),
                            closed: z.boolean(),
                            verified: z.boolean()
                        })
                    )
                }
            }
        },
        async (req) => {
            const mine = await sectionsForUser(req.user.role, req.locationId);
            if (req.query.sectionId !== undefined) {
                await assertSectionAllowed(req.user.role, req.locationId, req.query.sectionId);
            }
            const sectionFilter = <Q extends { where: any }>(query: Q): Q => {
                if (req.query.sectionId !== undefined) {
                    return (query as any).where('stock_counts.section_id', '=', req.query.sectionId);
                }
                return (query as any).where('stock_counts.section_id', 'in', mine);
            };

            let q = db
                .selectFrom('stock_counts')
                .innerJoin('sections', 'sections.id', 'stock_counts.section_id')
                .innerJoin('users', 'users.id', 'stock_counts.counted_by')
                .select([
                    'stock_counts.id',
                    'stock_counts.count_type as countType',
                    'sections.code as sectionCode',
                    'stock_counts.business_date as businessDate',
                    'users.name as countedBy',
                    'stock_counts.closed_at as closedAt',
                    'stock_counts.verified_by as verifiedBy'
                ])
                .where('stock_counts.location_id', '=', req.locationId);

            if (req.query.openOnly) q = q.where('stock_counts.closed_at', 'is', null);
            q = sectionFilter(q);

            let countQ = db
                .selectFrom('stock_counts')
                .select(({ fn }) => fn.countAll().as('total'))
                .where('stock_counts.location_id', '=', req.locationId);
            if (req.query.openOnly) countQ = countQ.where('stock_counts.closed_at', 'is', null);
            countQ = sectionFilter(countQ);
            const counted = await countQ.executeTakeFirst();

            const rows = await q
                .orderBy('stock_counts.business_date', 'desc')
                .orderBy('stock_counts.id', 'desc')
                .limit(req.query.limit)
                .offset(offsetOf(req.query))
                .execute();

            const items = rows.map((row) => ({
                id: String(row.id),
                countType: row.countType,
                sectionCode: row.sectionCode,
                businessDate: row.businessDate,
                countedBy: row.countedBy,
                closed: row.closedAt !== null,
                verified: row.verifiedBy !== null
            }));

            return toPage(items, counted?.total, req.query);
        }
    );

    // ── Reversals ───────────────────────────────────────────────────────────

    /**
     * The only way to correct a posted document.
     *
     *   "Corrections are reversals. New row, is_reversal = true, reverses_id
     *    set."
     *
     * There is deliberately no edit and no delete anywhere in this API.
     */
    r.post(
        '/documents/:doc/:id/reverse',
        {
            preHandler: app.requireRole('management'),
            schema: {
                params: z.object({
                    doc: z.enum([
                        'grn',
                        'issue',
                        'wastage',
                        'transfer',
                        'count',
                        // An opening balance typed wrong used to be
                        // permanent: not reversible here, and the section
                        // could never be opened again. That left a stock
                        // count as the only instrument, which values a
                        // never-received item at zero and quietly poisons
                        // every report that reads cost.
                        'opening'
                    ]),
                    id: z.string()
                }),
                body: z.object({ reason: z.string().min(5).max(500) }),
                response: { 200: z.object({ rowsReversed: z.number() }) }
            }
        },
        async (req) => {
            if (!req.body.reason.trim()) throw badRequest('A reversal needs a reason');
            const rowsReversed = await db
                .transaction()
                .execute((trx) =>
                    reverseDocument(trx, req.params.doc, req.params.id, req.user.sub, req.body.reason)
                );
            return { rowsReversed };
        }
    );
}
