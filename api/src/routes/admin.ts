/**
 * Admin: creating and managing logins.
 *
 * The admin does exactly this and nothing else. They cannot receive stock,
 * release a request or approve a purchase - which is the point of having the
 * role at all. Someone has to be able to hand out logins without that also
 * granting them the run of the inventory.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { offsetOf, pageOf, pageQuery, toPage } from '../services/pagination.js';
import { badRequest, conflict, notFound } from '../errors.js';

const ROLE = z.enum(['admin', 'management', 'storekeeper', 'kitchen', 'cleaning']);

const userRow = z.object({
    id: z.number(),
    name: z.string(),
    role: ROLE,
    locationId: z.number().nullable(),
    locationCode: z.string().nullable(),
    phone: z.string().nullable(),
    isActive: z.boolean(),
    isLocked: z.boolean()
});

export async function adminRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();
    const adminOnly = () => app.requireRole('admin');

    /** Branches, so the admin can put someone at the right one. */
    r.get(
        '/admin/branches',
        {
            preHandler: adminOnly(),
            schema: {
                response: {
                    200: z.array(
                        z.object({ id: z.number(), code: z.string(), name: z.string() })
                    )
                }
            }
        },
        async () =>
            db
                .selectFrom('locations')
                .select(['id', 'code', 'name'])
                .where('is_active', '=', true)
                .orderBy('id')
                .execute()
    );

    r.get(
        '/admin/users',
        {
            preHandler: adminOnly(),
            schema: {
                querystring: pageQuery.extend({
                    includeInactive: z.coerce.boolean().default(true)
                }),
                response: { 200: pageOf(userRow) }
            }
        },
        async (req) => {
            let q = db
                .selectFrom('users as u')
                .leftJoin('locations as l', 'l.id', 'u.location_id')
                .leftJoin('login_attempts as la', 'la.user_id', 'u.id')
                .select([
                    'u.id',
                    'u.name',
                    'u.role',
                    'u.location_id as locationId',
                    'l.code as locationCode',
                    'u.phone',
                    'u.is_active as isActive',
                    'la.locked_until as lockedUntil'
                ]);

            if (!req.query.includeInactive) q = q.where('u.is_active', '=', true);

            let countQ = db.selectFrom('users as u').select(({ fn }) => fn.countAll().as('total'));
            if (!req.query.includeInactive) countQ = countQ.where('u.is_active', '=', true);
            const counted = await countQ.executeTakeFirst();

            // Ordered by role then name, so a page is a contiguous slice of that
            // ordering and the role cards on the admin's home still group
            // cleanly - only the boundary role is split across two pages.
            const rows = await q
                .orderBy('u.role')
                .orderBy('u.name')
                .limit(req.query.limit)
                .offset(offsetOf(req.query))
                .execute();

            const items = rows.map((u) => ({
                id: u.id,
                name: u.name,
                role: u.role,
                locationId: u.locationId,
                locationCode: u.locationCode,
                phone: u.phone,
                isActive: u.isActive,
                isLocked: u.lockedUntil !== null && new Date(u.lockedUntil) > new Date()
            }));

            return toPage(items, counted?.total, req.query);
        }
    );

    r.post(
        '/admin/users',
        {
            preHandler: adminOnly(),
            schema: {
                body: z.object({
                    name: z.string().min(2).max(80),
                    role: ROLE,
                    // Null means group-wide: they can work at any branch.
                    locationId: z.number().int().positive().nullish(),
                    pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits'),
                    phone: z.string().max(30).nullish()
                }),
                response: { 201: userRow }
            }
        },
        async (req, reply) => {
            const clash = await db
                .selectFrom('users')
                .select('id')
                .where('name', '=', req.body.name)
                .where('is_active', '=', true)
                .executeTakeFirst();
            if (clash) {
                // Names are how people identify themselves on the login screen.
                // Two active "Kamal"s and nobody can tell which tile is theirs.
                throw conflict(`Someone called "${req.body.name}" already has a login`);
            }

            if (req.body.locationId) {
                const loc = await db
                    .selectFrom('locations')
                    .select('id')
                    .where('id', '=', req.body.locationId)
                    .executeTakeFirst();
                if (!loc) throw notFound('That branch');
            }

            const inserted = await db
                .insertInto('users')
                .values({
                    name: req.body.name,
                    role: req.body.role,
                    location_id: req.body.locationId ?? null,
                    phone: req.body.phone ?? null,
                    pin_hash: await bcrypt.hash(req.body.pin, 10),
                    is_active: true,
                    is_demo: false
                })
                .returning(['id', 'name', 'role', 'location_id', 'phone', 'is_active'])
                .executeTakeFirstOrThrow();

            const code = req.body.locationId
                ? (
                      await db
                          .selectFrom('locations')
                          .select('code')
                          .where('id', '=', req.body.locationId)
                          .executeTakeFirst()
                  )?.code ?? null
                : null;

            return reply.status(201).send({
                id: inserted.id,
                name: inserted.name,
                role: inserted.role,
                locationId: inserted.location_id,
                locationCode: code,
                phone: inserted.phone,
                isActive: inserted.is_active,
                isLocked: false
            });
        }
    );

    r.patch(
        '/admin/users/:id',
        {
            preHandler: adminOnly(),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                body: z.object({
                    role: ROLE.optional(),
                    locationId: z.number().int().positive().nullish(),
                    phone: z.string().max(30).nullish(),
                    /** Set a new PIN. Also clears any lockout. */
                    pin: z.string().regex(/^\d{4,6}$/).optional(),
                    isActive: z.boolean().optional()
                }),
                response: { 200: z.object({ ok: z.literal(true) }) }
            }
        },
        async (req) => {
            const target = await db
                .selectFrom('users')
                .selectAll()
                .where('id', '=', req.params.id)
                .executeTakeFirst();
            if (!target) throw notFound('That user');

            // Do not let the last admin be demoted or switched off. Locking
            // everyone out of user management is a very quiet disaster.
            const losingAdmin =
                target.role === 'admin' &&
                ((req.body.role !== undefined && req.body.role !== 'admin') ||
                    req.body.isActive === false);

            if (losingAdmin) {
                const others = await db
                    .selectFrom('users')
                    .select('id')
                    .where('role', '=', 'admin')
                    .where('is_active', '=', true)
                    .where('id', '!=', target.id)
                    .executeTakeFirst();
                if (!others) {
                    throw badRequest(
                        'This is the only admin. Make someone else an admin first, or nobody will be able to add logins.'
                    );
                }
            }

            await db
                .updateTable('users')
                .set({
                    role: req.body.role ?? target.role,
                    location_id:
                        req.body.locationId === undefined
                            ? target.location_id
                            : req.body.locationId,
                    phone: req.body.phone === undefined ? target.phone : req.body.phone,
                    pin_hash: req.body.pin
                        ? await bcrypt.hash(req.body.pin, 10)
                        : target.pin_hash,
                    is_active: req.body.isActive ?? target.is_active
                })
                .where('id', '=', req.params.id)
                .execute();

            if (req.body.pin || req.body.isActive) {
                await db.deleteFrom('login_attempts').where('user_id', '=', req.params.id).execute();
            }

            return { ok: true as const };
        }
    );

    /** Clear a lockout without changing the PIN - the common support call. */
    r.post(
        '/admin/users/:id/unlock',
        {
            preHandler: adminOnly(),
            schema: {
                params: z.object({ id: z.coerce.number().int().positive() }),
                response: { 200: z.object({ ok: z.literal(true) }) }
            }
        },
        async (req) => {
            await db.deleteFrom('login_attempts').where('user_id', '=', req.params.id).execute();
            return { ok: true as const };
        }
    );
}
