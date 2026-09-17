/**
 * Setup: everything the owner needs to build the system from an empty
 * database.
 *
 * Until this existed, `db/reset.sql` handed over a system with no branches, no
 * sections, no items and no suppliers, and nothing in the
 * app could create any of them -- every one arrives through the demo seed.
 * Going live meant a developer with psql, and every new supplier after that
 * meant the same developer again.
 *
 * Admin-only, deliberately. The admin was the login-handout role and is now
 * the configuration role: the person who sets the system up is not the person
 * who receives stock against it. The trade is that a delivery from a supplier
 * nobody has entered yet needs the admin before it can be booked in.
 *
 * Nothing here deletes. Master data is referenced by a ledger that cannot be
 * rewritten, so retiring is `is_active = false` and the row stays.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit } from '../services/ledger.js';
import { offsetOf, pageOf, pageQuery, toPage } from '../services/pagination.js';
import { SECTION_KINDS, sectionKind } from '../plugins/auth.js';
import {
    assertOneStore,
    assertStockUnit,
    clearOtherDefaultPacks,
    itemHasMoved,
    packHasBeenUsed,
    sectionStockLines,
    uniqueViolation
} from '../services/setup.js';

const STORAGE = z.enum(['dry', 'chiller', 'freezer', 'bar', 'chemical', 'packaging', 'gas']);

/** A short code people type and read. Upper-cased so two cannot differ by case. */
const codeStr = z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, 'Letters, numbers, spaces, - and _ only')
    .transform((s) => s.toUpperCase());

const packBody = z.object({
    packName: z.string().trim().min(1).max(60),
    qtyInStockUnit: z.number().positive(),
    isDefaultPurchase: z.boolean().default(false)
});

const packRow = z.object({
    id: z.number(),
    packName: z.string(),
    qtyInStockUnit: z.number(),
    isDefaultPurchase: z.boolean(),
    isActive: z.boolean(),
    /** True once it is on a delivery or an order: its size can no longer move. */
    inUse: z.boolean()
});

const itemRow = z.object({
    id: z.number(),
    code: z.string(),
    name: z.string(),
    categoryId: z.number(),
    categoryName: z.string(),
    stockUnit: z.string(),
    parLevel: z.number(),
    reorderPoint: z.number(),
    shelfLifeDays: z.number().nullable(),
    isCritical: z.boolean(),
    isActive: z.boolean(),
    /** True once it has moved: the stock unit is frozen from here on. */
    hasMoved: z.boolean(),
    packs: z.array(packRow)
});

const ok = z.object({ ok: z.literal(true) });

export async function setupRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();
    const adminOnly = () => app.requireRole('admin');

    /** Every setup change leaves an audit row; this is the one place that does it. */
    const logged = async (
        userId: number,
        entry: {
            action: string;
            entity: string;
            entityId?: string | number | null;
            before?: unknown;
            after?: unknown;
        }
    ): Promise<void> => {
        await db.transaction().execute((trx) => audit(trx, { userId, ...entry }));
    };

    // ── Item categories ─────────────────────────────────────────────────────

    r.get(
        '/setup/categories',
        {
            preHandler: adminOnly(),
            schema: {
                response: {
                    200: z.array(
                        z.object({
                            id: z.number(),
                            name: z.string(),
                            storage: STORAGE,
                            isActive: z.boolean(),
                            itemCount: z.number()
                        })
                    )
                }
            }
        },
        async () => {
            const rows = await db
                .selectFrom('item_categories as c')
                .leftJoin('items as i', (join) =>
                    join.onRef('i.category_id', '=', 'c.id').on('i.is_active', '=', true)
                )
                .select(({ fn }) => [
                    'c.id',
                    'c.name',
                    'c.storage',
                    'c.is_active as isActive',
                    fn.count<number>('i.id').as('itemCount')
                ])
                .groupBy(['c.id', 'c.name', 'c.storage', 'c.is_active'])
                .orderBy('c.name')
                .execute();
            return rows.map((c) => ({ ...c, itemCount: Number(c.itemCount) }));
        }
    );

    r.post(
        '/setup/categories',
        {
            preHandler: adminOnly(),
            schema: {
                body: z.object({ name: z.string().trim().min(2).max(60), storage: STORAGE }),
                response: { 201: z.object({ id: z.number() }) }
            }
        },
        async (req, reply) => {
            const row = await db
                .insertInto('item_categories')
                .values({ name: req.body.name, storage: req.body.storage })
                .returning('id')
                .executeTakeFirstOrThrow()
                .catch((err) =>
                    uniqueViolation(err, `A category called "${req.body.name}" already exists`)
                );

            await logged(req.user.sub, {
                action: 'setup.category.create',
                entity: 'item_categories',
                entityId: row.id,
                after: req.body
            });
            return reply.status(201).send({ id: row.id });
        }
    );

    r.patch(
        '/setup/categories/:id',
        {
            preHandler: adminOnly(),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                body: z.object({
                    name: z.string().trim().min(2).max(60).optional(),
                    storage: STORAGE.optional(),
                    isActive: z.boolean().optional()
                }),
                response: { 200: ok }
            }
        },
        async (req) => {
            const before = await db
                .selectFrom('item_categories')
                .selectAll()
                .where('id', '=', req.params.id)
                .executeTakeFirst();
            if (!before) throw notFound('That category');

            if (req.body.isActive === false) {
                const still = await db
                    .selectFrom('items')
                    .select('id')
                    .where('category_id', '=', req.params.id)
                    .where('is_active', '=', true)
                    .limit(1)
                    .executeTakeFirst();
                if (still) {
                    throw conflict(
                        'Items are still filed under this category. Move or retire them first.'
                    );
                }
            }

            await db
                .updateTable('item_categories')
                .set({
                    name: req.body.name ?? before.name,
                    storage: req.body.storage ?? before.storage,
                    is_active: req.body.isActive ?? before.is_active
                })
                .where('id', '=', req.params.id)
                .execute()
                .catch((err) =>
                    uniqueViolation(err, `A category called "${req.body.name}" already exists`)
                );

            await logged(req.user.sub, {
                action: 'setup.category.update',
                entity: 'item_categories',
                entityId: req.params.id,
                before,
                after: req.body
            });
            return { ok: true as const };
        }
    );

    // ── Items and packs ─────────────────────────────────────────────────────

    r.get(
        '/setup/items',
        {
            preHandler: adminOnly(),
            schema: {
                querystring: pageQuery.extend({
                    search: z.string().max(64).optional(),
                    categoryId: z.coerce.number().int().positive().optional(),
                    includeRetired: z.coerce.boolean().default(false)
                }),
                response: { 200: pageOf(itemRow) }
            }
        },
        async (req) => {
            const search = req.query.search ? `%${req.query.search}%` : null;

            let countQ = db.selectFrom('items').select(({ fn }) => fn.countAll().as('total'));
            if (!req.query.includeRetired) countQ = countQ.where('items.is_active', '=', true);
            if (req.query.categoryId) {
                countQ = countQ.where('items.category_id', '=', req.query.categoryId);
            }
            if (search) {
                countQ = countQ.where((eb) =>
                    eb.or([eb('items.name', 'ilike', search), eb('items.code', 'ilike', search)])
                );
            }
            const counted = await countQ.executeTakeFirst();

            let q = db
                .selectFrom('items')
                .innerJoin('item_categories as c', 'c.id', 'items.category_id')
                .select([
                    'items.id',
                    'items.code',
                    'items.name',
                    'items.category_id as categoryId',
                    'c.name as categoryName',
                    'items.stock_unit as stockUnit',
                    'items.par_level as parLevel',
                    'items.reorder_point as reorderPoint',
                    'items.shelf_life_days as shelfLifeDays',
                    'items.is_critical as isCritical',
                    'items.is_active as isActive'
                ]);
            if (!req.query.includeRetired) q = q.where('items.is_active', '=', true);
            if (req.query.categoryId) q = q.where('items.category_id', '=', req.query.categoryId);
            if (search) {
                q = q.where((eb) =>
                    eb.or([eb('items.name', 'ilike', search), eb('items.code', 'ilike', search)])
                );
            }

            const rows = await q
                .orderBy('items.name')
                .limit(req.query.limit)
                .offset(offsetOf(req.query))
                .execute();

            if (rows.length === 0) return toPage([], counted?.total, req.query);
            const ids = rows.map((i) => i.id);

            const packs = await db
                .selectFrom('item_packs')
                .select([
                    'id',
                    'item_id',
                    'pack_name as packName',
                    'qty_in_stock_unit as qtyInStockUnit',
                    'is_default_purchase as isDefaultPurchase',
                    'is_active as isActive'
                ])
                .where('item_id', 'in', ids)
                .orderBy('id')
                .execute();

            // Which packs are frozen, in two queries rather than two per row: a
            // page of items would otherwise be a round trip per pack just to
            // decide whether one field is editable.
            const usedPackIds = new Set<number>();
            if (packs.length > 0) {
                const packIds = packs.map((p) => p.id);
                const onGrn = await db
                    .selectFrom('grn_lines')
                    .select('item_pack_id')
                    .where('item_pack_id', 'in', packIds)
                    .distinct()
                    .execute();
                for (const h of onGrn) usedPackIds.add(h.item_pack_id);

                const onPo = await db
                    .selectFrom('purchase_order_lines')
                    .select('item_pack_id')
                    .where('item_pack_id', 'in', packIds)
                    .distinct()
                    .execute();
                for (const h of onPo) if (h.item_pack_id !== null) usedPackIds.add(h.item_pack_id);
            }

            const movedRows = await db
                .selectFrom('stock_ledger')
                .select('item_id')
                .where('item_id', 'in', ids)
                .distinct()
                .execute();
            const moved = new Set(movedRows.map((m) => m.item_id));

            const byItem = new Map<number, typeof packs>();
            for (const p of packs) {
                const list = byItem.get(p.item_id) ?? [];
                list.push(p);
                byItem.set(p.item_id, list);
            }

            const items = rows.map((i) => ({
                id: i.id,
                code: i.code,
                name: i.name,
                categoryId: i.categoryId,
                categoryName: i.categoryName,
                stockUnit: i.stockUnit,
                parLevel: Number(i.parLevel),
                reorderPoint: Number(i.reorderPoint),
                shelfLifeDays: i.shelfLifeDays,
                isCritical: i.isCritical,
                isActive: i.isActive,
                hasMoved: moved.has(i.id),
                packs: (byItem.get(i.id) ?? []).map((p) => ({
                    id: p.id,
                    packName: p.packName,
                    qtyInStockUnit: Number(p.qtyInStockUnit),
                    isDefaultPurchase: p.isDefaultPurchase,
                    isActive: p.isActive,
                    inUse: usedPackIds.has(p.id)
                }))
            }));

            return toPage(items, counted?.total, req.query);
        }
    );

    r.post(
        '/setup/items',
        {
            preHandler: adminOnly(),
            schema: {
                body: z.object({
                    code: codeStr,
                    name: z.string().trim().min(2).max(120),
                    categoryId: z.number().int().positive(),
                    stockUnit: z.string().trim().min(1).max(12),
                    parLevel: z.number().nonnegative().default(0),
                    reorderPoint: z.number().nonnegative().default(0),
                    shelfLifeDays: z.number().int().positive().nullish(),
                    isCritical: z.boolean().default(false),
                    /**
                     * At least one, because an item with no pack cannot be
                     * received or ordered -- both work in packs. Something
                     * bought loose gets a pack of "1 kg", which the form
                     * offers by default.
                     */
                    packs: z.array(packBody).min(1)
                }),
                response: { 201: z.object({ id: z.number() }) }
            }
        },
        async (req, reply) => {
            assertStockUnit(req.body.stockUnit);

            const category = await db
                .selectFrom('item_categories')
                .select(['id', 'is_active'])
                .where('id', '=', req.body.categoryId)
                .executeTakeFirst();
            if (!category) throw notFound('That category');
            if (!category.is_active) throw badRequest('That category has been retired');

            if (req.body.packs.filter((p) => p.isDefaultPurchase).length > 1) {
                throw badRequest('Only one pack can be the default for buying');
            }

            const id = await db.transaction().execute(async (trx) => {
                const item = await trx
                    .insertInto('items')
                    .values({
                        code: req.body.code,
                        name: req.body.name,
                        category_id: req.body.categoryId,
                        stock_unit: req.body.stockUnit.trim(),
                        par_level: req.body.parLevel,
                        reorder_point: req.body.reorderPoint,
                        shelf_life_days: req.body.shelfLifeDays ?? null,
                        is_critical: req.body.isCritical,
                        is_active: true,
                        is_demo: false
                    })
                    .returning('id')
                    .executeTakeFirstOrThrow()
                    .catch((err) =>
                        uniqueViolation(err, `Item code "${req.body.code}" is already taken`)
                    );

                // Exactly one default, even if nobody ticked the box: the GRN
                // form needs something to pre-select.
                const ticked = req.body.packs.findIndex((p) => p.isDefaultPurchase);
                const defaultIndex = ticked === -1 ? 0 : ticked;

                for (const [i, p] of req.body.packs.entries()) {
                    await trx
                        .insertInto('item_packs')
                        .values({
                            item_id: item.id,
                            pack_name: p.packName,
                            qty_in_stock_unit: p.qtyInStockUnit,
                            is_default_purchase: i === defaultIndex,
                            is_active: true,
                            is_demo: false
                        })
                        .execute();
                }

                await audit(trx, {
                    userId: req.user.sub,
                    action: 'setup.item.create',
                    entity: 'items',
                    entityId: item.id,
                    after: req.body
                });
                return item.id;
            });

            return reply.status(201).send({ id });
        }
    );

    r.patch(
        '/setup/items/:id',
        {
            preHandler: adminOnly(),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                body: z.object({
                    name: z.string().trim().min(2).max(120).optional(),
                    categoryId: z.number().int().positive().optional(),
                    stockUnit: z.string().trim().min(1).max(12).optional(),
                    parLevel: z.number().nonnegative().optional(),
                    reorderPoint: z.number().nonnegative().optional(),
                    shelfLifeDays: z.number().int().positive().nullish(),
                    isCritical: z.boolean().optional(),
                    isActive: z.boolean().optional()
                }),
                response: { 200: ok }
            }
        },
        async (req) => {
            const before = await db
                .selectFrom('items')
                .selectAll()
                .where('id', '=', req.params.id)
                .executeTakeFirst();
            if (!before) throw notFound('That item');

            if (req.body.stockUnit && req.body.stockUnit.trim() !== before.stock_unit) {
                assertStockUnit(req.body.stockUnit);
                if (await itemHasMoved(req.params.id)) {
                    throw conflict(
                        `${before.name} has already moved in ${before.stock_unit}. Changing the unit now would reinterpret every past figure - retire this item and create a new one instead.`
                    );
                }
            }

            await db
                .updateTable('items')
                .set({
                    name: req.body.name ?? before.name,
                    category_id: req.body.categoryId ?? before.category_id,
                    stock_unit: req.body.stockUnit?.trim() ?? before.stock_unit,
                    par_level: req.body.parLevel ?? before.par_level,
                    reorder_point: req.body.reorderPoint ?? before.reorder_point,
                    shelf_life_days:
                        req.body.shelfLifeDays === undefined
                            ? before.shelf_life_days
                            : req.body.shelfLifeDays,
                    is_critical: req.body.isCritical ?? before.is_critical,
                    is_active: req.body.isActive ?? before.is_active
                })
                .where('id', '=', req.params.id)
                .execute();

            await logged(req.user.sub, {
                action: 'setup.item.update',
                entity: 'items',
                entityId: req.params.id,
                before,
                after: req.body
            });
            return { ok: true as const };
        }
    );

    r.post(
        '/setup/items/:id/packs',
        {
            preHandler: adminOnly(),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                body: packBody,
                response: { 201: z.object({ id: z.number() }) }
            }
        },
        async (req, reply) => {
            const item = await db
                .selectFrom('items')
                .select(['id', 'name'])
                .where('id', '=', req.params.id)
                .executeTakeFirst();
            if (!item) throw notFound('That item');

            const pack = await db
                .insertInto('item_packs')
                .values({
                    item_id: item.id,
                    pack_name: req.body.packName,
                    qty_in_stock_unit: req.body.qtyInStockUnit,
                    is_default_purchase: req.body.isDefaultPurchase,
                    is_active: true,
                    is_demo: false
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            if (req.body.isDefaultPurchase) await clearOtherDefaultPacks(item.id, pack.id);

            await logged(req.user.sub, {
                action: 'setup.pack.create',
                entity: 'item_packs',
                entityId: pack.id,
                after: { itemId: item.id, ...req.body }
            });
            return reply.status(201).send({ id: pack.id });
        }
    );

    r.patch(
        '/setup/packs/:id',
        {
            preHandler: adminOnly(),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                body: z.object({
                    packName: z.string().trim().min(1).max(60).optional(),
                    qtyInStockUnit: z.number().positive().optional(),
                    isDefaultPurchase: z.boolean().optional(),
                    isActive: z.boolean().optional()
                }),
                response: { 200: ok }
            }
        },
        async (req) => {
            const before = await db
                .selectFrom('item_packs')
                .selectAll()
                .where('id', '=', req.params.id)
                .executeTakeFirst();
            if (!before) throw notFound('That pack');

            if (
                req.body.qtyInStockUnit !== undefined &&
                Number(req.body.qtyInStockUnit) !== Number(before.qty_in_stock_unit)
            ) {
                if (await packHasBeenUsed(req.params.id)) {
                    throw conflict(
                        `"${before.pack_name}" has already been bought at ${before.qty_in_stock_unit} per pack. Add a new pack size rather than changing this one, or the price history stops comparing like with like.`
                    );
                }
            }

            if (req.body.isActive === false) {
                const other = await db
                    .selectFrom('item_packs')
                    .select('id')
                    .where('item_id', '=', before.item_id)
                    .where('id', '!=', before.id)
                    .where('is_active', '=', true)
                    .orderBy('id')
                    .executeTakeFirst();
                if (!other) {
                    throw conflict(
                        'This is the only pack left. An item with no pack cannot be received or ordered - retire the item instead.'
                    );
                }
            }

            await db
                .updateTable('item_packs')
                .set({
                    pack_name: req.body.packName ?? before.pack_name,
                    qty_in_stock_unit: req.body.qtyInStockUnit ?? before.qty_in_stock_unit,
                    is_default_purchase: req.body.isDefaultPurchase ?? before.is_default_purchase,
                    is_active: req.body.isActive ?? before.is_active
                })
                .where('id', '=', req.params.id)
                .execute();

            if (req.body.isDefaultPurchase) await clearOtherDefaultPacks(before.item_id, before.id);

            // Retiring the default hands the flag on, so the GRN form always
            // has something to pre-select.
            if (req.body.isActive === false && before.is_default_purchase) {
                const heir = await db
                    .selectFrom('item_packs')
                    .select('id')
                    .where('item_id', '=', before.item_id)
                    .where('id', '!=', before.id)
                    .where('is_active', '=', true)
                    .orderBy('id')
                    .executeTakeFirst();
                if (heir) {
                    await db
                        .updateTable('item_packs')
                        .set({ is_default_purchase: true })
                        .where('id', '=', heir.id)
                        .execute();
                    await clearOtherDefaultPacks(before.item_id, heir.id);
                }
            }

            await logged(req.user.sub, {
                action: 'setup.pack.update',
                entity: 'item_packs',
                entityId: req.params.id,
                before,
                after: req.body
            });
            return { ok: true as const };
        }
    );

    // ── Suppliers ───────────────────────────────────────────────────────────

    r.get(
        '/setup/suppliers',
        {
            preHandler: adminOnly(),
            schema: {
                querystring: pageQuery.extend({
                    search: z.string().max(64).optional(),
                    includeRetired: z.coerce.boolean().default(false)
                }),
                response: {
                    200: pageOf(
                        z.object({
                            id: z.number(),
                            name: z.string(),
                            phone: z.string().nullable(),
                            vatNo: z.string().nullable(),
                            paymentTerms: z.string().nullable(),
                            isActive: z.boolean(),
                            deliveries: z.number()
                        })
                    )
                }
            }
        },
        async (req) => {
            const search = req.query.search ? `%${req.query.search}%` : null;

            let countQ = db.selectFrom('suppliers').select(({ fn }) => fn.countAll().as('total'));
            if (!req.query.includeRetired) countQ = countQ.where('is_active', '=', true);
            if (search) countQ = countQ.where('name', 'ilike', search);
            const counted = await countQ.executeTakeFirst();

            let q = db
                .selectFrom('suppliers')
                .leftJoin('grn', 'grn.supplier_id', 'suppliers.id')
                .select(({ fn }) => [
                    'suppliers.id',
                    'suppliers.name',
                    'suppliers.phone',
                    'suppliers.vat_no as vatNo',
                    'suppliers.payment_terms as paymentTerms',
                    'suppliers.is_active as isActive',
                    fn.count<number>('grn.id').as('deliveries')
                ])
                .groupBy([
                    'suppliers.id',
                    'suppliers.name',
                    'suppliers.phone',
                    'suppliers.vat_no',
                    'suppliers.payment_terms',
                    'suppliers.is_active'
                ]);
            if (!req.query.includeRetired) q = q.where('suppliers.is_active', '=', true);
            if (search) q = q.where('suppliers.name', 'ilike', search);

            const rows = await q
                .orderBy('suppliers.name')
                .limit(req.query.limit)
                .offset(offsetOf(req.query))
                .execute();

            return toPage(
                rows.map((s) => ({ ...s, deliveries: Number(s.deliveries) })),
                counted?.total,
                req.query
            );
        }
    );

    r.post(
        '/setup/suppliers',
        {
            preHandler: adminOnly(),
            schema: {
                body: z.object({
                    name: z.string().trim().min(2).max(120),
                    phone: z.string().trim().max(30).nullish(),
                    vatNo: z.string().trim().max(30).nullish(),
                    paymentTerms: z.string().trim().max(60).nullish()
                }),
                response: { 201: z.object({ id: z.number() }) }
            }
        },
        async (req, reply) => {
            const clash = await db
                .selectFrom('suppliers')
                .select('id')
                .where('name', 'ilike', req.body.name)
                .where('is_active', '=', true)
                .executeTakeFirst();
            if (clash) throw conflict(`"${req.body.name}" is already on the supplier list`);

            const row = await db
                .insertInto('suppliers')
                .values({
                    name: req.body.name,
                    phone: req.body.phone ?? null,
                    vat_no: req.body.vatNo ?? null,
                    payment_terms: req.body.paymentTerms ?? null,
                    is_active: true,
                    is_demo: false
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            await logged(req.user.sub, {
                action: 'setup.supplier.create',
                entity: 'suppliers',
                entityId: row.id,
                after: req.body
            });
            return reply.status(201).send({ id: row.id });
        }
    );

    r.patch(
        '/setup/suppliers/:id',
        {
            preHandler: adminOnly(),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                body: z.object({
                    name: z.string().trim().min(2).max(120).optional(),
                    phone: z.string().trim().max(30).nullish(),
                    vatNo: z.string().trim().max(30).nullish(),
                    paymentTerms: z.string().trim().max(60).nullish(),
                    isActive: z.boolean().optional()
                }),
                response: { 200: ok }
            }
        },
        async (req) => {
            const before = await db
                .selectFrom('suppliers')
                .selectAll()
                .where('id', '=', req.params.id)
                .executeTakeFirst();
            if (!before) throw notFound('That supplier');

            if (req.body.isActive === false) {
                const openPo = await db
                    .selectFrom('purchase_orders')
                    .select('id')
                    .where('supplier_id', '=', req.params.id)
                    .where('status', 'in', ['approved', 'ordered'])
                    .limit(1)
                    .executeTakeFirst();
                if (openPo) {
                    throw conflict(
                        'There is still an open purchase order with this supplier. Receive or close it first.'
                    );
                }
            }

            await db
                .updateTable('suppliers')
                .set({
                    name: req.body.name ?? before.name,
                    phone: req.body.phone === undefined ? before.phone : req.body.phone,
                    vat_no: req.body.vatNo === undefined ? before.vat_no : req.body.vatNo,
                    payment_terms:
                        req.body.paymentTerms === undefined
                            ? before.payment_terms
                            : req.body.paymentTerms,
                    is_active: req.body.isActive ?? before.is_active
                })
                .where('id', '=', req.params.id)
                .execute();

            await logged(req.user.sub, {
                action: 'setup.supplier.update',
                entity: 'suppliers',
                entityId: req.params.id,
                before,
                after: req.body
            });
            return { ok: true as const };
        }
    );

    /**
     * An agreed price for a pack from a supplier.
     *
     * This is what the price-movement report has to compare the first delivery
     * against. Without one, the first surprise price looks exactly like the
     * normal price, and the report only wakes up on the second.
     */
    r.get(
        '/setup/suppliers/:id/prices',
        {
            preHandler: adminOnly(),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                response: {
                    200: z.array(
                        z.object({
                            id: z.number(),
                            itemPackId: z.number(),
                            itemName: z.string(),
                            packName: z.string(),
                            price: z.number(),
                            effectiveFrom: z.string()
                        })
                    )
                }
            }
        },
        async (req) => {
            const rows = await db
                .selectFrom('supplier_prices as sp')
                .innerJoin('item_packs as p', 'p.id', 'sp.item_pack_id')
                .innerJoin('items as i', 'i.id', 'p.item_id')
                .select([
                    'sp.id',
                    'sp.item_pack_id as itemPackId',
                    'i.name as itemName',
                    'p.pack_name as packName',
                    'sp.price',
                    'sp.effective_from as effectiveFrom'
                ])
                .where('sp.supplier_id', '=', req.params.id)
                .orderBy('i.name')
                .orderBy('sp.effective_from', 'desc')
                .execute();
            return rows.map((p) => ({ ...p, price: Number(p.price) }));
        }
    );

    r.post(
        '/setup/suppliers/:id/prices',
        {
            preHandler: adminOnly(),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                body: z.object({
                    itemPackId: z.number().int().positive(),
                    price: z.number().nonnegative(),
                    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
                }),
                response: { 201: z.object({ id: z.number() }) }
            }
        },
        async (req, reply) => {
            const supplier = await db
                .selectFrom('suppliers')
                .select('id')
                .where('id', '=', req.params.id)
                .executeTakeFirst();
            if (!supplier) throw notFound('That supplier');

            const pack = await db
                .selectFrom('item_packs')
                .select('id')
                .where('id', '=', req.body.itemPackId)
                .executeTakeFirst();
            if (!pack) throw notFound('That pack');

            const row = await db
                .insertInto('supplier_prices')
                .values({
                    supplier_id: req.params.id,
                    item_pack_id: req.body.itemPackId,
                    price: req.body.price,
                    effective_from: req.body.effectiveFrom,
                    is_demo: false
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            await logged(req.user.sub, {
                action: 'setup.price.create',
                entity: 'supplier_prices',
                entityId: row.id,
                after: { supplierId: req.params.id, ...req.body }
            });
            return reply.status(201).send({ id: row.id });
        }
    );

    // ── Branches and sections ───────────────────────────────────────────────

    r.get(
        '/setup/section-kinds',
        {
            preHandler: adminOnly(),
            schema: {
                response: {
                    200: z.array(
                        z.object({
                            kind: z.string(),
                            label: z.string(),
                            isStore: z.boolean(),
                            /**
                             * Which roles stand at this kind of shelf.
                             *
                             * Sent so a client can answer "does this person
                             * have anywhere to work at this branch" without
                             * keeping its own copy of the rule. It is the same
                             * table `sectionsOwnedBy` and `homeSectionFor`
                             * judge on, so a warning on screen and a refusal
                             * from the server cannot disagree.
                             */
                            ownedBy: z.array(z.string())
                        })
                    )
                }
            }
        },
        async () =>
            SECTION_KINDS.map((k) => ({
                kind: k.kind,
                label: k.label,
                isStore: k.isStore,
                ownedBy: [...k.ownedBy]
            }))
    );

    r.get(
        '/setup/branches',
        {
            preHandler: adminOnly(),
            schema: {
                response: {
                    200: z.array(
                        z.object({
                            id: z.number(),
                            code: z.string(),
                            name: z.string(),
                            dayStart: z.string(),
                            isActive: z.boolean(),
                            sections: z.array(
                                z.object({
                                    id: z.number(),
                                    code: z.string(),
                                    name: z.string(),
                                    kind: z.string(),
                                    kindLabel: z.string(),
                                    isStore: z.boolean(),
                                    isActive: z.boolean()
                                })
                            )
                        })
                    )
                }
            }
        },
        async () => {
            const branches = await db
                .selectFrom('locations')
                .select(['id', 'code', 'name', 'day_start as dayStart', 'is_active as isActive'])
                .orderBy('id')
                .execute();

            const sections = await db
                .selectFrom('sections')
                .select([
                    'id',
                    'location_id',
                    'code',
                    'name',
                    'kind',
                    'is_store as isStore',
                    'is_active as isActive'
                ])
                .orderBy('id')
                .execute();

            return branches.map((b) => ({
                id: b.id,
                code: b.code,
                name: b.name,
                dayStart: String(b.dayStart).slice(0, 5),
                isActive: b.isActive,
                sections: sections
                    .filter((s) => s.location_id === b.id)
                    .map((s) => ({
                        id: s.id,
                        code: s.code,
                        name: s.name,
                        kind: s.kind,
                        kindLabel: sectionKind(s.kind)?.label ?? s.kind,
                        isStore: s.isStore,
                        isActive: s.isActive
                    }))
            }));
        }
    );

    r.post(
        '/setup/branches',
        {
            preHandler: adminOnly(),
            schema: {
                body: z.object({
                    code: codeStr,
                    name: z.string().trim().min(2).max(80),
                    /** When the business day rolls over. 04:00 for a 24-hour site. */
                    dayStart: z
                        .string()
                        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
                        .default('06:00')
                }),
                response: { 201: z.object({ id: z.number(), storeSectionId: z.number() }) }
            }
        },
        async (req, reply) => {
            const created = await db.transaction().execute(async (trx) => {
                const branch = await trx
                    .insertInto('locations')
                    .values({
                        code: req.body.code,
                        name: req.body.name,
                        day_start: req.body.dayStart,
                        is_active: true,
                        is_demo: false
                    })
                    .returning('id')
                    .executeTakeFirstOrThrow()
                    .catch((err) =>
                        uniqueViolation(err, `Branch code "${req.body.code}" is already taken`)
                    );

                // A branch with no store cannot receive a delivery, issue
                // anything, or answer "what have we got" - half the system
                // looks the store up by name. Creating one by hand as a
                // separate step is a trap, so it comes with the branch.
                const store = await trx
                    .insertInto('sections')
                    .values({
                        location_id: branch.id,
                        code: 'STORE',
                        name: 'Main store',
                        kind: 'STORE',
                        is_store: true,
                        is_active: true,
                        is_demo: false
                    })
                    .returning('id')
                    .executeTakeFirstOrThrow();

                await audit(trx, {
                    userId: req.user.sub,
                    action: 'setup.branch.create',
                    entity: 'locations',
                    entityId: branch.id,
                    after: req.body
                });

                return { id: branch.id, storeSectionId: store.id };
            });

            return reply.status(201).send(created);
        }
    );

    r.patch(
        '/setup/branches/:id',
        {
            preHandler: adminOnly(),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                body: z.object({
                    name: z.string().trim().min(2).max(80).optional(),
                    dayStart: z
                        .string()
                        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
                        .optional(),
                    isActive: z.boolean().optional()
                }),
                response: { 200: ok }
            }
        },
        async (req) => {
            const before = await db
                .selectFrom('locations')
                .selectAll()
                .where('id', '=', req.params.id)
                .executeTakeFirst();
            if (!before) throw notFound('That branch');

            if (req.body.isActive === false) {
                const others = await db
                    .selectFrom('locations')
                    .select('id')
                    .where('is_active', '=', true)
                    .where('id', '!=', req.params.id)
                    .executeTakeFirst();
                if (!others) throw badRequest('This is the only branch left. There has to be one.');
            }

            await db
                .updateTable('locations')
                .set({
                    name: req.body.name ?? before.name,
                    day_start: req.body.dayStart ?? before.day_start,
                    is_active: req.body.isActive ?? before.is_active
                })
                .where('id', '=', req.params.id)
                .execute();

            await logged(req.user.sub, {
                action: 'setup.branch.update',
                entity: 'locations',
                entityId: req.params.id,
                before,
                after: req.body
            });
            return { ok: true as const };
        }
    );

    r.post(
        '/setup/sections',
        {
            preHandler: adminOnly(),
            schema: {
                body: z.object({
                    locationId: z.number().int().positive(),
                    code: codeStr,
                    name: z.string().trim().min(2).max(60),
                    /**
                     * What kind of place it is, which decides who can use it.
                     * Validated against SECTION_KINDS in plugins/auth.ts rather
                     * than an enum here, so that adding a sixth kind stays one
                     * edit in one file.
                     */
                    kind: z.string().trim().max(24)
                }),
                response: { 201: z.object({ id: z.number() }) }
            }
        },
        async (req, reply) => {
            const branch = await db
                .selectFrom('locations')
                .select('id')
                .where('id', '=', req.body.locationId)
                .executeTakeFirst();
            if (!branch) throw notFound('That branch');

            const kind = sectionKind(req.body.kind.toUpperCase());
            if (!kind) {
                throw badRequest(
                    `"${req.body.kind}" is not a kind of section. Pick one of: ${SECTION_KINDS.map(
                        (k) => k.label
                    ).join(', ')}.`
                );
            }
            if (kind.isStore) await assertOneStore(req.body.locationId);

            const row = await db
                .insertInto('sections')
                .values({
                    location_id: req.body.locationId,
                    code: req.body.code,
                    name: req.body.name,
                    kind: kind.kind,
                    is_store: kind.isStore,
                    is_active: true,
                    is_demo: false
                })
                .returning('id')
                .executeTakeFirstOrThrow()
                .catch((err) =>
                    uniqueViolation(
                        err,
                        `This branch already has a section coded "${req.body.code}"`
                    )
                );

            await logged(req.user.sub, {
                action: 'setup.section.create',
                entity: 'sections',
                entityId: row.id,
                after: req.body
            });
            return reply.status(201).send({ id: row.id });
        }
    );

    r.patch(
        '/setup/sections/:id',
        {
            preHandler: adminOnly(),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                body: z.object({
                    name: z.string().trim().min(2).max(60).optional(),
                    isActive: z.boolean().optional()
                }),
                response: { 200: ok }
            }
        },
        async (req) => {
            const before = await db
                .selectFrom('sections')
                .selectAll()
                .where('id', '=', req.params.id)
                .executeTakeFirst();
            if (!before) throw notFound('That section');

            if (req.body.isActive === false) {
                if (before.is_store) {
                    throw conflict(
                        'The main store cannot be switched off - every delivery, issue and count at this branch goes through it. Close the branch instead.'
                    );
                }
                const holding = await sectionStockLines(req.params.id);
                if (holding > 0) {
                    throw conflict(
                        `${before.name} is still holding ${holding} item${
                            holding === 1 ? '' : 's'
                        }. Issue or count it down to nothing first, or the stock is stranded where no screen can reach it.`
                    );
                }
            }

            if (req.body.isActive === true && before.is_store) {
                await assertOneStore(before.location_id, before.id);
            }

            await db
                .updateTable('sections')
                .set({
                    name: req.body.name ?? before.name,
                    is_active: req.body.isActive ?? before.is_active
                })
                .where('id', '=', req.params.id)
                .execute();

            await logged(req.user.sub, {
                action: 'setup.section.update',
                entity: 'sections',
                entityId: req.params.id,
                before,
                after: req.body
            });
            return { ok: true as const };
        }
    );

}
