import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { forbidden, tooManyRequests, unauthorized } from '../errors.js';
import { locationsForUser, type AccessClaims } from '../plugins/auth.js';

const ROLE = z.enum(['admin', 'management', 'storekeeper', 'kitchen', 'cleaning']);

/** A valid hash of a value nobody can supply, for constant-time failed logins. */
const DUMMY_HASH = bcrypt.hashSync('__no_such_user__', 10);

const sessionSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    user: z.object({
        id: z.number(),
        name: z.string(),
        role: ROLE,
        homeLocationId: z.number().nullable(),
    }),
    location: z.object({
        id: z.number(),
        code: z.string(),
        name: z.string(),
        dayStart: z.string(),
    }),
    locations: z.array(z.object({ id: z.number(), code: z.string(), name: z.string() })),
    sections: z.array(
        z.object({
            id: z.number(),
            code: z.string(),
            name: z.string(),
            /**
             * What kind of room it is. `code` is a short label an admin may
             * name anything; the kind carries the meaning, and a screen that
             * has to leave quarantine out of a picker needs the meaning.
             */
            kind: z.string(),
            isStore: z.boolean(),
            /**
             * Switched-off sections are still sent, because last month's
             * documents have to stay readable. The flag is what lets a picker
             * that files new work leave them out.
             */
            isActive: z.boolean(),
        })
    ),
});

export async function authRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();

    /**
     * Everything the login screen needs before anyone has authenticated:
     * which outlets exist and who works at each.
     *
     * This deliberately lists names. The device is a shared tablet in a store
     * room -- people tap their own face rather than typing an email -- so the
     * roster is not a secret from the people standing in front of it. PIN
     * hashes are of course never included.
     */
    r.get(
        '/bootstrap',
        {
            config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
            schema: {
                response: {
                    200: z.object({
                        locations: z.array(
                            z.object({ id: z.number(), code: z.string(), name: z.string() })
                        ),
                        users: z.array(
                            z.object({
                                id: z.number(),
                                name: z.string(),
                                role: ROLE,
                                locationId: z.number().nullable(),
                            })
                        ),
                    }),
                },
            },
        },
        async () => {
            const [locations, users] = await Promise.all([
                db
                    .selectFrom('locations')
                    .select(['id', 'code', 'name'])
                    .where('is_active', '=', true)
                    .orderBy('id')
                    .execute(),
                db
                    .selectFrom('users')
                    .select(['id', 'name', 'role', 'location_id'])
                    .where('is_active', '=', true)
                    .orderBy('name')
                    .execute(),
            ]);

            return {
                locations,
                users: users.map((u) => ({
                    id: u.id,
                    name: u.name,
                    role: u.role,
                    locationId: u.location_id,
                })),
            };
        }
    );

    r.post(
        '/login',
        {
            config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
            schema: {
                body: z.object({
                    userId: z.number().int().positive(),
                    locationId: z.number().int().positive(),
                    pin: z.string().min(4).max(6).regex(/^\d+$/, 'PIN is digits only'),
                }),
                response: { 200: sessionSchema },
            },
        },
        async (req) => {
            const { userId, locationId, pin } = req.body;

            const user = await db
                .selectFrom('users')
                .selectAll()
                .where('id', '=', userId)
                .where('is_active', '=', true)
                .executeTakeFirst();

            const attempt = await db
                .selectFrom('login_attempts')
                .selectAll()
                .where('user_id', '=', userId)
                .executeTakeFirst();

            if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
                const mins = Math.ceil(
                    (new Date(attempt.locked_until).getTime() - Date.now()) / 60_000
                );
                throw tooManyRequests(`Too many wrong PINs. Try again in ${mins} minute(s).`);
            }

            // Always run a real comparison, even for a user id that does not
            // exist, so "no such user" and "wrong PIN" take the same time and
            // the response cannot be used to enumerate accounts.
            const ok = (await bcrypt.compare(pin, user?.pin_hash ?? DUMMY_HASH)) && !!user;

            if (!ok) {
                await recordFailure(userId, user !== undefined);
                throw unauthorized('Wrong PIN');
            }

            const allowed = await locationsForUser(user!.id, user!.location_id);
            if (!allowed.includes(locationId)) {
                throw forbidden('You are not assigned to that location');
            }

            await db.deleteFrom('login_attempts').where('user_id', '=', userId).execute();

            return buildSession(app, user!, locationId, allowed);
        }
    );

    r.post(
        '/refresh',
        {
            config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
            schema: {
                body: z.object({ refreshToken: z.string() }),
                response: {
                    200: z.object({ accessToken: z.string(), refreshToken: z.string() }),
                },
            },
        },
        async (req) => {
            let claims: AccessClaims;
            try {
                claims = app.jwt.verify<AccessClaims>(req.body.refreshToken);
            } catch {
                throw unauthorized('Refresh token is not valid');
            }
            if (claims.typ !== 'refresh') throw unauthorized('Wrong token type');

            // Re-read the user: a deactivated account must not be able to keep
            // refreshing its way into the system for the next 30 days.
            const user = await db
                .selectFrom('users')
                .selectAll()
                .where('id', '=', claims.sub)
                .where('is_active', '=', true)
                .executeTakeFirst();
            if (!user) throw unauthorized('Account is no longer active');

            const locations = await locationsForUser(user.id, user.location_id);
            const base = {
                sub: user.id,
                name: user.name,
                role: user.role,
                homeLocationId: user.location_id,
                locations,
            };

            return {
                accessToken: app.jwt.sign(
                    { ...base, typ: 'access' },
                    { expiresIn: config.ACCESS_TOKEN_TTL }
                ),
                refreshToken: app.jwt.sign(
                    { ...base, typ: 'refresh' },
                    { expiresIn: config.REFRESH_TOKEN_TTL }
                ),
            };
        }
    );

    r.get(
        '/me',
        {
            preHandler: app.authenticate,
            schema: {
                response: {
                    200: z.object({
                        id: z.number(),
                        name: z.string(),
                        role: ROLE,
                        locationId: z.number(),
                        locations: z.array(z.number()),
                    }),
                },
            },
        },
        async (req) => ({
            id: req.user.sub,
            name: req.user.name,
            role: req.user.role,
            locationId: req.locationId,
            locations: req.user.locations,
        })
    );
}

async function recordFailure(userId: number, userExists: boolean) {
    if (!userExists) return;

    const next = await db
        .insertInto('login_attempts')
        .values({ user_id: userId, failed_count: 1, last_attempt_at: new Date() })
        .onConflict((oc) =>
            oc.column('user_id').doUpdateSet((eb) => ({
                failed_count: eb('login_attempts.failed_count', '+', 1),
                last_attempt_at: new Date(),
            }))
        )
        .returning('failed_count')
        .executeTakeFirstOrThrow();

    if (next.failed_count >= config.MAX_PIN_ATTEMPTS) {
        await db
            .updateTable('login_attempts')
            .set({
                locked_until: new Date(Date.now() + config.PIN_LOCKOUT_MINUTES * 60_000),
                failed_count: 0,
            })
            .where('user_id', '=', userId)
            .execute();
    }
}

async function buildSession(
    app: FastifyInstance,
    user: { id: number; name: string; role: AccessClaims['role']; location_id: number | null },
    locationId: number,
    allowed: number[]
) {
    const [location, locations, sections] = await Promise.all([
        db
            .selectFrom('locations')
            .select(['id', 'code', 'name', 'day_start'])
            .where('id', '=', locationId)
            .executeTakeFirstOrThrow(),
        db
            .selectFrom('locations')
            .select(['id', 'code', 'name'])
            .where('id', 'in', allowed)
            .orderBy('id')
            .execute(),
        db
            .selectFrom('sections')
            .select(['id', 'code', 'name', 'kind', 'is_store', 'is_active'])
            .where('location_id', '=', locationId)
            .orderBy('id')
            .execute(),
    ]);

    const base = {
        sub: user.id,
        name: user.name,
        role: user.role,
        homeLocationId: user.location_id,
        locations: allowed,
    };

    return {
        accessToken: app.jwt.sign({ ...base, typ: 'access' }, { expiresIn: config.ACCESS_TOKEN_TTL }),
        refreshToken: app.jwt.sign(
            { ...base, typ: 'refresh' },
            { expiresIn: config.REFRESH_TOKEN_TTL }
        ),
        user: {
            id: user.id,
            name: user.name,
            role: user.role,
            homeLocationId: user.location_id,
        },
        location: {
            id: location.id,
            code: location.code,
            name: location.name,
            dayStart: location.day_start,
        },
        locations,
        sections: sections.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            kind: s.kind,
            isStore: s.is_store,
            isActive: s.is_active,
        })),
    };
}
