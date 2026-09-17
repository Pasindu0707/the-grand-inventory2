import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { db } from '../db/index.js';
import { badRequest, forbidden, notFound, unauthorized } from '../errors.js';
import type { UserRole } from '../db/types.js';

export interface AccessClaims {
    sub: number;
    name: string;
    role: UserRole;
    /** Home location. Null for group-wide roles (owner). */
    homeLocationId: number | null;
    /** Locations this user may act in. Owner gets every active location. */
    locations: number[];
    typ: 'access' | 'refresh';
}

declare module 'fastify' {
    interface FastifyRequest {
        /** Populated by `authenticate`. */
        user: AccessClaims;
        /**
         * The location this request acts on, from the x-location-id header,
         * already checked against the token's allowed set.
         */
        locationId: number;
    }
    interface FastifyInstance {
        authenticate: (req: FastifyRequest) => Promise<void>;
        requireRole: (...roles: UserRole[]) => (req: FastifyRequest) => Promise<void>;
    }
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: AccessClaims;
        user: AccessClaims;
    }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
    /**
     * Verifies the bearer token and resolves the active location.
     *
     * The location comes from a header rather than the token because owners and
     * managers move between outlets within one session. It is never trusted as
     * given -- it has to be in the set the token was issued with, which is what
     * stops a chef at the Gastrobar reading the Coffee Lounge's stock by
     * editing a header.
     */
    app.decorate('authenticate', async (req: FastifyRequest) => {
        try {
            await req.jwtVerify();
        } catch {
            throw unauthorized('Session expired, sign in again');
        }

        if (req.user.typ !== 'access') {
            throw unauthorized('Wrong token type');
        }

        const header = req.headers['x-location-id'];
        const requested = header ? Number(Array.isArray(header) ? header[0] : header) : NaN;

        if (Number.isFinite(requested)) {
            if (!req.user.locations.includes(requested)) {
                throw forbidden('You do not have access to that location');
            }
            req.locationId = requested;
        } else {
            const fallback = req.user.homeLocationId ?? req.user.locations[0];
            if (fallback === undefined) throw forbidden('No location available for this user');
            req.locationId = fallback;
        }
    });

    app.decorate('requireRole', (...roles: UserRole[]) => async (req: FastifyRequest) => {
        await app.authenticate(req);
        if (!roles.includes(req.user.role)) {
            throw forbidden(`This action needs one of: ${roles.join(', ')}`);
        }
    });
});

/** Locations a user may act in. Group-wide users get all active ones. */
export async function locationsForUser(
    userId: number,
    homeLocationId: number | null
): Promise<number[]> {
    if (homeLocationId !== null) return [homeLocationId];
    const rows = await db
        .selectFrom('locations')
        .select('id')
        .where('is_active', '=', true)
        .execute();
    return rows.map((r) => r.id);
}

/**
 * Every kind of place stock can sit, and who is allowed to stand there.
 *
 * This is the only list of section kinds in the system. Permission checks read
 * it, and so does the setup form that creates sections, which is what makes
 * adding a sixth kind a single edit rather than an archaeology exercise: add a
 * row here and a branch can have one, the right roles see it, and the form
 * offers it. There is deliberately no matching check constraint in the
 * database -- a constraint there would make it two edits, and the second a
 * migration.
 *
 * `ownedBy` is membership, not visibility: it answers "may this person sign
 * for stock arriving here", which is why the storekeeper owns only the store
 * even though they can see the whole branch. Letting the person who handed the
 * stock over also confirm it arrived makes the confirmation step confirm
 * nothing.
 */
export interface SectionKind {
    kind: string;
    /** What the setup form calls it. */
    label: string;
    isStore: boolean;
    ownedBy: UserRole[];
}

export const SECTION_KINDS: readonly SectionKind[] = [
    { kind: 'STORE', label: 'Main store', isStore: true, ownedBy: ['storekeeper'] },
    /**
     * The one kind of production room there is.
     *
     * BAKERY and BAR used to be kinds of their own. Both were owned by the
     * same role, held stock the same way, and asked the store for it through
     * the same request -- so the only thing the split bought was a decision
     * ("am I the bakery or the kitchen tonight?") for a person who does both.
     * A branch that genuinely works its pastry bench as a separate shelf makes
     * a second section of kind KITCHEN and names it Pastry; the kind is what
     * decides who may stand there, and the name is what tells them which door.
     */
    { kind: 'KITCHEN', label: 'Kitchen', isStore: false, ownedBy: ['kitchen'] },
    { kind: 'CLEAN', label: 'Cleaning store', isStore: false, ownedBy: ['cleaning'] },
    /**
     * Where returned goods wait for the supplier to take them back.
     *
     * Owned by the storekeeper and visible to nobody else, which is the point:
     * faulty stock sitting in the main store's balance is faulty stock the
     * kitchen can ask for again tomorrow. Nothing is ever issued out of here --
     * requests are filled from the section marked `isStore`, and this is not
     * it. Stock leaves quarantine exactly once, on a supplier return.
     *
     * A section login never names this section. It returns *from* its own
     * shelf and the server resolves the destination, so the fact that kitchen
     * cannot see quarantine does not stop kitchen returning into it.
     */
    { kind: 'QUARANTINE', label: 'Quarantine', isStore: false, ownedBy: ['storekeeper'] }
];

export const sectionKind = (kind: string): SectionKind | undefined =>
    SECTION_KINDS.find((k) => k.kind === kind);

/** The kinds a role belongs to. Management and admin stand at no shelf. */
function kindsOwnedBy(role: UserRole): string[] {
    return SECTION_KINDS.filter((k) => k.ownedBy.includes(role)).map((k) => k.kind);
}

/**
 * Which sections a role may look at, as opposed to belong to.
 *
 * Management, the storekeeper and the admin run the branch and see all of it.
 * Everyone else sees the kinds they own, which is what stops the kitchen and
 * the cleaning store reaching into each other.
 */
function kindsVisibleTo(role: UserRole): string[] | 'all' {
    if (role === 'admin' || role === 'management' || role === 'storekeeper') return 'all';
    return kindsOwnedBy(role);
}

export async function sectionsOwnedBy(role: UserRole, locationId: number): Promise<number[]> {
    const kinds = kindsOwnedBy(role);
    if (kinds.length === 0) return [];
    const rows = await db
        .selectFrom('sections')
        .select('id')
        .where('location_id', '=', locationId)
        .where('kind', 'in', kinds)
        .execute();
    return rows.map((r) => r.id);
}

/**
 * Refuse a section this role has no business in.
 *
 * Every endpoint that took a section id took it on trust: a kitchen login could
 * log wastage against the cleaning store, open a count there, or raise a request
 * in its name, simply by sending a different number. The screens never offered
 * it, which is not the same thing as it being disallowed.
 *
 * Judged on `sectionsForUser` - what this role may work with - rather than
 * `sectionsOwnedBy`, so the storekeeper and management keep the run of the
 * branch. It only stops kitchen and cleaning reaching into each other.
 */
export async function assertSectionAllowed(
    role: UserRole,
    locationId: number,
    sectionId: number
): Promise<void> {
    const mine = await sectionsForUser(role, locationId);
    if (!mine.includes(sectionId)) {
        throw forbidden('That section is not one of yours');
    }
}

/**
 * A retired section keeps its history but takes no new work.
 *
 * The other half of the rule below: `sectionsForUser` still lists switched-off
 * sections so last month's documents stay readable, so something has to stop
 * new ones being filed against them. It is a separate call rather than part of
 * `assertSectionAllowed` because the read paths -- stock, the document lists,
 * the reports -- must keep working for a section that has closed.
 *
 * Called at the route, next to the permission check, so the next endpoint that
 * takes a section id has both guards in front of it in one place.
 */
export async function assertSectionOpen(...sectionIds: number[]): Promise<void> {
    const ids = [...new Set(sectionIds)];
    if (ids.length === 0) return;

    const rows = await db
        .selectFrom('sections')
        .select(['id', 'name', 'is_active'])
        .where('id', 'in', ids)
        .execute();

    for (const id of ids) {
        const row = rows.find((r) => r.id === id);
        if (!row) throw notFound(`Section ${id}`);
        if (!row.is_active) {
            throw badRequest(
                `"${row.name}" has been switched off. Turn it back on in Branches and sections if this is still in use.`
            );
        }
    }
}

/**
 * Retired sections are deliberately still in here. Switching a section off
 * stops anyone filing new documents against it (setup refuses to retire one
 * still holding stock), but its history has to stay readable -- dropping it
 * from this list would make last month's issues disappear from every screen
 * that filters by section.
 */
export async function sectionsForUser(role: UserRole, locationId: number): Promise<number[]> {
    const kinds = kindsVisibleTo(role);
    let q = db.selectFrom('sections').select('id').where('location_id', '=', locationId);
    if (kinds !== 'all') q = q.where('kind', 'in', kinds);
    return (await q.execute()).map((r) => r.id);
}

/**
 * The branch's quarantine section.
 *
 * Resolved server-side on every return, so a section login never names a
 * destination it is not allowed to see. Returns an instruction rather than a
 * bare 404 because the person who hits this -- a chef holding a crate of bad
 * fish -- is not the person who can fix it.
 */
export async function quarantineSectionFor(locationId: number): Promise<number> {
    const row = await db
        .selectFrom('sections')
        .select('id')
        .where('location_id', '=', locationId)
        .where('kind', '=', 'QUARANTINE')
        .where('is_active', '=', true)
        .orderBy('id')
        .executeTakeFirst();

    if (!row) {
        throw badRequest(
            'This branch has no quarantine section, so there is nowhere to put returned stock. ' +
                'An admin adds one under Branches and sections.'
        );
    }
    return row.id;
}

/** The one section a role primarily works out of, for defaults in the UI. */
export async function homeSectionFor(
    role: UserRole,
    locationId: number
): Promise<number | null> {
    // Roles that stand at no shelf of their own default to the store, which is
    // where their work starts: it is the section a manager opening a count or
    // a stock screen means without saying so.
    const kinds = kindsOwnedBy(role);
    const wanted = kinds.length > 0 ? kinds : ['STORE'];

    const row = await db
        .selectFrom('sections')
        .select('id')
        .where('location_id', '=', locationId)
        .where('kind', 'in', wanted)
        .where('is_active', '=', true)
        .orderBy('id')
        .executeTakeFirst();
    return row?.id ?? null;
}
