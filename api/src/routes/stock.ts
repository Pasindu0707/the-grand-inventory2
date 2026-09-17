import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../db/index.js';
import { assertSectionAllowed, sectionsForUser } from '../plugins/auth.js';
import { offsetOf, pageOf, pageQuery, toPage } from '../services/pagination.js';

export async function stockRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();

    /**
     * Current stock, derived from the ledger every time.
     *
     * There is deliberately no stock_qty column anywhere to drift out of step
     * with the movements that produced it. `belowReorder` is computed here
     * rather than stored for the same reason.
     */
    r.get(
        '/stock',
        {
            preHandler: app.authenticate,
            schema: {
                querystring: pageQuery.extend({
                    sectionId: z.coerce.number().int().positive().optional(),
                    search: z.string().max(64).optional(),
                    belowReorder: z.coerce.boolean().optional(),
                }),
                response: {
                    // `totalValue` rides alongside the page envelope rather than
                    // inside it: it is the value of everything the filter
                    // matches, not of the twenty-five rows on this page. A stock
                    // valuation that changed when you clicked "next" would be
                    // worse than useless.
                    200: pageOf(
                        z.object({
                            itemId: z.number(),
                            code: z.string(),
                            name: z.string(),
                            stockUnit: z.string(),
                            sectionId: z.number(),
                            sectionCode: z.string(),
                            qtyBase: z.number(),
                            avgCost: z.number(),
                            value: z.number(),
                            reorderPoint: z.number(),
                            parLevel: z.number(),
                            isCritical: z.boolean(),
                            belowReorder: z.boolean(),
                        })
                    ).extend({ totalValue: z.number() }),
                },
            },
        },
        async (req) => {
            let q = db
                .selectFrom('current_stock_valued as cs')
                .innerJoin('items', 'items.id', 'cs.item_id')
                .innerJoin('sections', 'sections.id', 'cs.section_id')
                .select([
                    'cs.item_id as itemId',
                    'items.code',
                    'items.name',
                    'items.stock_unit as stockUnit',
                    'cs.section_id as sectionId',
                    'sections.code as sectionCode',
                    'cs.qty_base as qtyBase',
                    'cs.avg_cost as avgCost',
                    'cs.value',
                    'items.reorder_point as reorderPoint',
                    'items.par_level as parLevel',
                    'items.is_critical as isCritical',
                ])
                .where('cs.location_id', '=', req.locationId)
                .where('items.is_active', '=', true);

            // Asking for a section is fine; asking for someone else's is not.
            // With none named, a role that owns particular sections sees those
            // and no more - the endpoint used to hand back the whole branch.
            if (req.query.sectionId) {
                await assertSectionAllowed(req.user.role, req.locationId, req.query.sectionId);
                q = q.where('cs.section_id', '=', req.query.sectionId);
            } else {
                const mine = await sectionsForUser(req.user.role, req.locationId);
                q = q.where('cs.section_id', 'in', mine);
            }

            if (req.query.search) {
                const term = `%${req.query.search}%`;
                q = q.where((eb) =>
                    eb.or([eb('items.name', 'ilike', term), eb('items.code', 'ilike', term)])
                );
            }

            if (req.query.belowReorder) {
                q = q.whereRef('cs.qty_base', '<', 'items.reorder_point');
            }

            // Count and value the whole filtered set before slicing to a page,
            // by reusing the same builder with a different select.
            const summary = await q
                .clearSelect()
                .select(({ fn }) => [fn.countAll().as('total'), fn.sum('cs.value').as('value')])
                .executeTakeFirst();

            const rows = await q
                .orderBy('items.name')
                .limit(req.query.limit)
                .offset(offsetOf(req.query))
                .execute();

            const items = rows.map((s) => ({
                ...s,
                qtyBase: Number(s.qtyBase),
                avgCost: Number(s.avgCost),
                value: Number(s.value),
                reorderPoint: Number(s.reorderPoint),
                parLevel: Number(s.parLevel),
                belowReorder: Number(s.qtyBase) < Number(s.reorderPoint),
            }));

            return {
                ...toPage(items, summary?.total, req.query),
                totalValue: Math.round(Number(summary?.value ?? 0) * 100) / 100,
            };
        }
    );
}
