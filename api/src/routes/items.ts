import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../db/index.js';
import { homeSectionFor } from '../plugins/auth.js';

export async function itemRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();

    /**
     * The item master with its packs. The GRN form needs both together: you
     * pick an item, then the pack it arrived in, and one item can legitimately
     * have several ("1 kg pack" and "50 kg sack" of the same sugar).
     */
    r.get(
        '/items',
        {
            preHandler: app.authenticate,
            schema: {
                querystring: z.object({
                    search: z.string().max(64).optional(),
                    criticalOnly: z.coerce.boolean().optional(),
                    /**
                     * Narrow the list to things this person's own section
                     * actually deals in. A cleaner asking for stock was being
                     * shown all hundred items, chicken and gin included, and had
                     * to find the four they wanted among them.
                     *
                     * "Deals in" is read from the ledger rather than a
                     * configured catalogue: anything the section has ever been
                     * issued, received or counted. That keeps itself up to date
                     * with no list for anyone to maintain, and it survives being
                     * out of stock - which is exactly when you ask for
                     * something. Roles without a section of their own
                     * (management, storekeeper) are unaffected.
                     */
                    mySection: z.coerce.boolean().optional(),
                }),
                response: {
                    200: z.array(
                        z.object({
                            id: z.number(),
                            code: z.string(),
                            name: z.string(),
                            stockUnit: z.string(),
                            categoryName: z.string(),
                            parLevel: z.number(),
                            reorderPoint: z.number(),
                            isCritical: z.boolean(),
                            packs: z.array(
                                z.object({
                                    id: z.number(),
                                    packName: z.string(),
                                    qtyInStockUnit: z.number(),
                                    isDefaultPurchase: z.boolean(),
                                })
                            ),
                        })
                    ),
                },
            },
        },
        async (req) => {
            let q = db
                .selectFrom('items')
                .innerJoin('item_categories as c', 'c.id', 'items.category_id')
                .select([
                    'items.id',
                    'items.code',
                    'items.name',
                    'items.stock_unit as stockUnit',
                    'c.name as categoryName',
                    'items.par_level as parLevel',
                    'items.reorder_point as reorderPoint',
                    'items.is_critical as isCritical',
                ])
                .where('items.is_active', '=', true);

            if (req.query.search) {
                const term = `%${req.query.search}%`;
                q = q.where((eb) =>
                    eb.or([eb('items.name', 'ilike', term), eb('items.code', 'ilike', term)])
                );
            }
            if (req.query.criticalOnly) q = q.where('items.is_critical', '=', true);

            if (req.query.mySection) {
                const sectionId = await homeSectionFor(req.user.role, req.locationId);
                if (sectionId !== null) {
                    q = q.where('items.id', 'in', (eb) =>
                        eb
                            .selectFrom('stock_ledger')
                            .select('item_id')
                            .where('section_id', '=', sectionId)
                            .distinct()
                    );
                }
            }

            const items = await q.orderBy('items.name').execute();
            if (items.length === 0) return [];

            const packs = await db
                .selectFrom('item_packs')
                .select([
                    'id',
                    'item_id',
                    'pack_name as packName',
                    'qty_in_stock_unit as qtyInStockUnit',
                    'is_default_purchase as isDefaultPurchase',
                ])
                .where(
                    'item_id',
                    'in',
                    items.map((i) => i.id)
                )
                // A retired pack stays in the ledger's history but must not be
                // offered on a new delivery -- retiring it is how the owner
                // says the supplier has stopped selling that size.
                .where('is_active', '=', true)
                .execute();

            const byItem = new Map<number, typeof packs>();
            for (const p of packs) {
                const list = byItem.get(p.item_id) ?? [];
                list.push(p);
                byItem.set(p.item_id, list);
            }

            return items.map((i) => ({
                ...i,
                parLevel: Number(i.parLevel),
                reorderPoint: Number(i.reorderPoint),
                packs: (byItem.get(i.id) ?? []).map((p) => ({
                    id: p.id,
                    packName: p.packName,
                    qtyInStockUnit: Number(p.qtyInStockUnit),
                    isDefaultPurchase: p.isDefaultPurchase,
                })),
            }));
        }
    );

    r.get(
        '/suppliers',
        {
            preHandler: app.authenticate,
            schema: {
                response: {
                    200: z.array(
                        z.object({
                            id: z.number(),
                            name: z.string(),
                            phone: z.string().nullable(),
                        })
                    ),
                },
            },
        },
        async () =>
            (
                await db
                    .selectFrom('suppliers')
                    .select(['id', 'name', 'phone'])
                    .where('is_active', '=', true)
                    .orderBy('name')
                    .execute()
            ).map((s) => ({ ...s }))
    );
}
