import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../db/index.js';
import { forbidden, notFound } from '../errors.js';
import {
    assertSectionAllowed,
    assertSectionOpen,
    sectionsForUser,
    sectionsOwnedBy,
    homeSectionFor
} from '../plugins/auth.js';
import { issueWindowsFor } from '../services/settings.js';
import { findReplay, hashBody } from '../services/idempotency.js';
import {
    ask,
    cancelRequest,
    confirmReceived,
    release,
    shortagesFor
} from '../services/requests.js';
import { offsetOf, pageOf, pageQuery, toPage } from '../services/pagination.js';
import { RETURN_WINDOW_DAYS } from '../services/returns.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const shortage = z.object({
    itemId: z.number(),
    name: z.string(),
    stockUnit: z.string(),
    requested: z.number(),
    inStore: z.number(),
    short: z.number(),
    itemPackId: z.number().nullable(),
    packName: z.string().nullable(),
    qtyInStockUnit: z.number().nullable(),
    shortPacks: z.number()
});

const releaseResult = z.object({
    id: z.string(),
    linesReleased: z.number(),
    shortfalls: z.array(
        z.object({
            itemName: z.string(),
            requested: z.number(),
            released: z.number(),
            available: z.number()
        })
    ),
    windowWarning: z.string().nullable()
});

export async function requestRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();

    /** Where am I, and what can I do? Drives the whole simplified UI. */
    r.get(
        '/me/context',
        {
            preHandler: app.authenticate,
            schema: {
                response: {
                    200: z.object({
                        role: z.string(),
                        locationId: z.number(),
                        mySectionIds: z.array(z.number()),
                        homeSectionId: z.number().nullable(),
                        canRelease: z.boolean(),
                        canDecidePurchases: z.boolean(),
                        canManageUsers: z.boolean(),
                        seesAdvanced: z.boolean()
                    })
                }
            }
        },
        async (req) => {
            const role = req.user.role;
            const [mySectionIds, homeSectionId] = await Promise.all([
                sectionsForUser(role, req.locationId),
                homeSectionFor(role, req.locationId)
            ]);
            return {
                role,
                locationId: req.locationId,
                mySectionIds,
                homeSectionId,
                // The storekeeper's alone. Management decides what is bought
                // and approves what comes back; they do not stand at the shelf
                // handing stock over, and a second pair of hands on the store
                // is a second person nobody is checking.
                canRelease: role === 'storekeeper',
                canDecidePurchases: role === 'management',
                canManageUsers: role === 'admin',
                // Counts, wastage, deliveries and the five reports. Kept out of
                // the way of people who only ask for stock.
                seesAdvanced: role === 'management' || role === 'admin'
            };
        }
    );

    /**
     * The agreed handover times. Shown as a hint; never enforced.
     *
     *   "Issue windows, not an always-open store. This is a process rule the
     *    software should enforce by warning, not blocking."
     */
    r.get(
        '/issue-windows',
        {
            preHandler: app.authenticate,
            schema: {
                response: { 200: z.array(z.object({ at: z.string(), label: z.string() })) }
            }
        },
        async (req) => issueWindowsFor(req.locationId)
    );

    /** Check before asking, so the UI can offer a purchase order up front. */
    r.post(
        '/requests/check',
        {
            preHandler: app.authenticate,
            schema: {
                body: z.object({
                    lines: z
                        .array(
                            z.object({
                                itemId: z.number().int().positive(),
                                qtyRequested: z.number().positive()
                            })
                        )
                        .min(1)
                }),
                response: { 200: z.object({ shortages: z.array(shortage) }) }
            }
        },
        async (req) => ({ shortages: await shortagesFor(req.locationId, req.body.lines) })
    );

    r.post(
        '/requests',
        {
            preHandler: app.requireRole('management', 'storekeeper', 'kitchen', 'cleaning'),
            schema: {
                body: z.object({
                    sectionId: z.number().int().positive().optional(),
                    neededBy: dateStr.nullish(),
                    note: z.string().max(500).nullish(),
                    lines: z
                        .array(
                            z.object({
                                itemId: z.number().int().positive(),
                                qtyRequested: z.number().positive()
                            })
                        )
                        .min(1)
                }),
                response: {
                    201: z.object({ id: z.string(), shortages: z.array(shortage) })
                }
            }
        },
        async (req, reply) => {
            // A kitchen or cleaning login does not choose a section - it is
            // theirs. One less decision on a screen used in a hurry.
            const sectionId =
                req.body.sectionId ?? (await homeSectionFor(req.user.role, req.locationId));
            if (!sectionId) throw forbidden('You are not attached to a section at this branch');
            // Naming a section is allowed - the storekeeper raises requests for
            // others - but only one you are entitled to.
            await assertSectionAllowed(req.user.role, req.locationId, sectionId);
            await assertSectionOpen(sectionId);

            const result = await ask({
                locationId: req.locationId,
                sectionId,
                requestedBy: req.user.sub,
                neededBy: req.body.neededBy ?? null,
                note: req.body.note ?? null,
                lines: req.body.lines
            });
            return reply.status(201).send(result);
        }
    );

    /**
     * One request with its lines, for the release panel.
     *
     * This went missing when issues were folded into the request flow: the route
     * lived at GET /issues/:id, that file was retired, and nothing replaced it -
     * but the web app kept calling the old path. Every attempt to open a request
     * for releasing answered 404, which meant the storekeeper could see requests
     * waiting and could not act on a single one of them.
     *
     * `availableInStore` is read from the same place the pre-submit shortage
     * check reads it, so the two screens cannot disagree about what is on the
     * store's shelves.
     */
    r.get(
        '/requests/:id',
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                response: {
                    200: z.object({
                        id: z.string(),
                        status: z.string(),
                        toSectionId: z.number(),
                        lines: z.array(
                            z.object({
                                lineId: z.string(),
                                itemId: z.number(),
                                code: z.string(),
                                name: z.string(),
                                stockUnit: z.string(),
                                qtyRequested: z.number(),
                                qtyIssued: z.number().nullable(),
                                availableInStore: z.number()
                            })
                        )
                    })
                }
            }
        },
        async (req) => {
            const issue = await db
                .selectFrom('issues')
                .select(['id', 'status', 'to_section_id as toSectionId'])
                .where('id', '=', req.params.id)
                .where('location_id', '=', req.locationId)
                .executeTakeFirst();
            if (!issue) throw notFound('That request');

            const store = await db
                .selectFrom('sections')
                .select('id')
                .where('location_id', '=', req.locationId)
                .where('is_store', '=', true)
                .executeTakeFirst();

            const lines = await db
                .selectFrom('issue_lines as l')
                .innerJoin('items', 'items.id', 'l.item_id')
                .leftJoin('current_stock as cs', (join) =>
                    join
                        .onRef('cs.item_id', '=', 'l.item_id')
                        .on('cs.section_id', '=', store?.id ?? -1)
                )
                .select([
                    'l.id as lineId',
                    'l.item_id as itemId',
                    'items.code',
                    'items.name',
                    'items.stock_unit as stockUnit',
                    'l.qty_requested as qtyRequested',
                    'l.qty_issued as qtyIssued',
                    'cs.qty_base as availableInStore'
                ])
                .where('l.issue_id', '=', req.params.id)
                .orderBy('items.name')
                .execute();

            return {
                id: String(issue.id),
                status: issue.status,
                toSectionId: issue.toSectionId,
                lines: lines.map((l) => ({
                    lineId: String(l.lineId),
                    itemId: l.itemId,
                    code: l.code,
                    name: l.name,
                    stockUnit: l.stockUnit,
                    qtyRequested: Number(l.qtyRequested),
                    qtyIssued: l.qtyIssued === null ? null : Number(l.qtyIssued),
                    availableInStore: Number(l.availableInStore ?? 0)
                }))
            };
        }
    );

    /**
     * Releasing is the storekeeper's job and nobody else's.
     *
     * Management used to be able to release too, as a stand-in for the
     * storekeeper being off. In practice it meant the person who approves the
     * spending could also hand the goods out, which is the separation the rest
     * of this system is built to keep: the store holds stock, management
     * decides money, and neither does both. If the storekeeper is away, the
     * answer is another storekeeper login, not a manager reaching past them.
     */
    r.post(
        '/requests/:id/release',
        {
            preHandler: app.requireRole('storekeeper'),
            schema: {
                params: z.object({ id: z.string() }),
                headers: z.object({ 'idempotency-key': z.string().min(8).max(128) }).passthrough(),
                body: z.object({
                    lines: z
                        .array(
                            z.object({ lineId: z.string(), qtyIssued: z.number().nonnegative() })
                        )
                        .default([])
                }),
                response: { 200: releaseResult }
            }
        },
        async (req) => {
            const key = req.headers['idempotency-key'] as string;
            const endpoint = 'POST /requests/:id/release';
            const requestHash = hashBody({ id: req.params.id, ...req.body });

            const replay = await findReplay<z.infer<typeof releaseResult>>(
                key,
                endpoint,
                requestHash
            );
            if (replay) return replay.response;

            return release({
                issueId: req.params.id,
                locationId: req.locationId,
                releasedBy: req.user.sub,
                role: req.user.role,
                lines: req.body.lines,
                idempotency: { key, endpoint, requestHash }
            });
        }
    );

    r.post(
        '/requests/:id/confirm',
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                response: { 200: z.object({ ok: z.literal(true) }) }
            }
        },
        async (req) => {
            // Sections this person belongs to, not the ones they may look at.
            // The storekeeper can see every section; they take delivery in none
            // but their own store.
            const owned = await sectionsOwnedBy(req.user.role, req.locationId);
            await confirmReceived(req.params.id, req.locationId, req.user.sub, owned);
            return { ok: true as const };
        }
    );

    r.post(
        '/requests/:id/cancel',
        {
            preHandler: app.requireRole('management', 'storekeeper', 'kitchen', 'cleaning'),
            schema: {
                params: z.object({ id: z.string() }),
                response: { 200: z.object({ ok: z.literal(true) }) }
            }
        },
        async (req) => {
            const mine = await sectionsForUser(req.user.role, req.locationId);
            await cancelRequest(req.params.id, req.locationId, req.user.sub, mine);
            return { ok: true as const };
        }
    );

    const requestRow = z.object({
        id: z.string(),
        sectionId: z.number(),
        sectionCode: z.string(),
        sectionName: z.string(),
        status: z.string(),
        requestedBy: z.string(),
        requestedAt: z.string(),
        neededBy: z.string().nullable(),
        note: z.string().nullable(),
        lineCount: z.number(),
        /**
         * What was actually asked for. The list used to say only "1 item(s)",
         * which tells nobody whether it is worth walking to the store for -
         * a storekeeper deciding what to pick next needs the name and the
         * amount, not a count.
         */
        lines: z.array(
            z.object({
                itemId: z.number(),
                name: z.string(),
                stockUnit: z.string(),
                qtyRequested: z.number(),
                qtyIssued: z.number().nullable(),
                /**
                 * Handed back against this request.
                 *
                 * A request is history and does not shrink when stock comes
                 * back, so without this the row looks identical after a return
                 * and the person who made it concludes nothing happened. It is
                 * the difference between a screen that is correct and a screen
                 * that is believable.
                 */
                qtyReturned: z.number()
            })
        ),
        releasedBy: z.string().nullable(),
        isMine: z.boolean(),
        /** True when it is waiting on this user to do something. */
        needsMe: z.boolean(),
        /** Total handed back, so the row can say so without walking the lines. */
        qtyReturnedTotal: z.number(),
        /**
         * Days since the stock was released, so a screen can say why Return is
         * no longer offered rather than just withholding it.
         */
        daysSinceReleased: z.number().nullable(),
        /**
         * Whether anything on this request could still go back. False once
         * every line has been fully returned, or the section no longer holds
         * what it was given -- which is when the Return button should stop
         * being offered rather than opening an empty drawer.
         */
        canReturn: z.boolean()
    });

    r.get(
        '/requests',
        {
            preHandler: app.authenticate,
            schema: {
                querystring: pageQuery.extend({
                    status: z.enum(['requested', 'released', 'received', 'cancelled']).optional(),
                    mineOnly: z.coerce.boolean().optional(),
                    /**
                     * One section only. The storekeeper works through the
                     * kitchen's requests, then the bakery's - a single list of
                     * every section at the branch is the wrong shape for that
                     * job. Refused for a section this role has no business in,
                     * rather than quietly returning nothing.
                     */
                    sectionId: z.coerce.number().int().positive().optional(),
                    // "Waiting on me" is the default screen, and it used to be
                    // filtered in the browser over whatever had been fetched.
                    // Once the list is paged that would only ever search the
                    // current page, so the rule moves here, next to the one
                    // that decides the `needsMe` flag on each row.
                    needsMe: z.coerce.boolean().optional()
                }),
                response: { 200: pageOf(requestRow) }
            }
        },
        async (req) => {
            // Two different questions, and they used to share one answer:
            //   mine  - which sections may this person look at (filtering)
            //   owned - which sections is this person part of (isMine, and so
            //           which rows offer "It came" and "Cancel")
            const [mine, owned] = await Promise.all([
                sectionsForUser(req.user.role, req.locationId),
                sectionsOwnedBy(req.user.role, req.locationId)
            ]);
            const canRelease = req.user.role === 'storekeeper';

            let q = db
                .selectFrom('issues')
                .innerJoin('sections', 'sections.id', 'issues.to_section_id')
                .innerJoin('users as asker', 'asker.id', 'issues.requested_by')
                .leftJoin('users as giver', 'giver.id', 'issues.issued_by')
                .leftJoin('issue_lines', 'issue_lines.issue_id', 'issues.id')
                .select(({ fn }) => [
                    'issues.id',
                    'issues.to_section_id as sectionId',
                    'sections.code as sectionCode',
                    'sections.name as sectionName',
                    'issues.status',
                    'asker.name as requestedBy',
                    'issues.requested_at as requestedAt',
                    'issues.needed_by as neededBy',
                    'issues.note',
                    'giver.name as releasedBy',
                    fn.count('issue_lines.id').as('lineCount'),
                    // Age of the release, for the return window. Measured off
                    // issued_at because that is when the goods reached the
                    // section; a request raised on Monday and released on
                    // Friday is four days younger than it looks.
                    sql<number | null>`date_part('day', current_timestamp
                        - coalesce(issues.issued_at, issues.requested_at))`.as(
                        'daysSinceReleased'
                    )
                ])
                .where('issues.location_id', '=', req.locationId)
                .groupBy([
                    'issues.id',
                    'sections.code',
                    'sections.name',
                    'asker.name',
                    'giver.name'
                ]);

            /**
             * The same predicate the `needsMe` flag below is built from, as a
             * where clause. Applied to both the row query and the count so the
             * pager agrees with the list.
             */
            const needsMeFilter = <Q extends { where: any }>(query: Q): Q => {
                // `owned`, not `mine`. The flag on each row below is built from
                // the sections this person belongs to, because confirming that
                // goods arrived is the receiving section's job; filtering on
                // the sections they can merely *see* handed the storekeeper --
                // who can see the whole branch -- a queue of other people's
                // arrivals, every one of them flagged as not theirs. A pager
                // that promises rows the list then greys out is worse than a
                // short list.
                const mineClause = (eb: any) =>
                    owned.length > 0
                        ? eb.and([
                              eb('issues.status', '=', 'released'),
                              eb('issues.to_section_id', 'in', owned)
                          ])
                        : eb.val(false);
                return (query as any).where((eb: any) =>
                    canRelease
                        ? eb.or([eb('issues.status', '=', 'requested'), mineClause(eb)])
                        : mineClause(eb)
                );
            };

            if (req.query.sectionId !== undefined && !mine.includes(req.query.sectionId)) {
                throw forbidden('That section is not one of yours');
            }

            const applyFilters = <Q extends { where: any }>(query: Q): Q => {
                let out = query;
                if (req.query.status) out = (out as any).where('issues.status', '=', req.query.status);
                if (req.query.sectionId !== undefined) {
                    out = (out as any).where('issues.to_section_id', '=', req.query.sectionId);
                } else if (req.query.mineOnly && mine.length > 0) {
                    out = (out as any).where('issues.to_section_id', 'in', mine);
                }
                if (req.query.needsMe) out = needsMeFilter(out);
                return out;
            };

            q = applyFilters(q);

            // Counted off `issues` alone: the row query joins issue_lines to
            // count them, so counting *it* would count lines, not requests.
            const countQ = applyFilters(
                db
                    .selectFrom('issues')
                    .select(({ fn }) => fn.countAll().as('total'))
                    .where('issues.location_id', '=', req.locationId)
            );
            const counted = await countQ.executeTakeFirst();

            const rows = await q
                .orderBy('issues.requested_at', 'desc')
                .limit(req.query.limit)
                .offset(offsetOf(req.query))
                .execute();

            // One extra query for the whole page rather than one per row.
            const lineRows =
                rows.length === 0
                    ? []
                    : await db
                          .selectFrom('issue_lines as l')
                          .innerJoin('items', 'items.id', 'l.item_id')
                          .select([
                              'l.issue_id as issueId',
                              'l.item_id as itemId',
                              'items.name',
                              'items.stock_unit as stockUnit',
                              'l.qty_requested as qtyRequested',
                              'l.qty_issued as qtyIssued'
                          ])
                          .where(
                              'l.issue_id',
                              'in',
                              rows.map((row) => row.id)
                          )
                          .orderBy('items.name')
                          .execute();

            /**
             * Returns already made against this page's requests, and what each
             * section still holds. Two more queries for the whole page rather
             * than one per row -- the same shape as the line fetch above.
             */
            const returnRows =
                rows.length === 0
                    ? []
                    : await db
                          .selectFrom('section_returns')
                          .select(({ fn }) => [
                              'issue_id as issueId',
                              'item_id as itemId',
                              fn.sum('qty_base').as('qtyReturned')
                          ])
                          .where(
                              'issue_id',
                              'in',
                              rows.map((row) => row.id)
                          )
                          .groupBy(['issue_id', 'item_id'])
                          .execute();

            const returnedByLine = new Map<string, number>();
            for (const r of returnRows) {
                returnedByLine.set(`${r.issueId}:${r.itemId}`, Number(r.qtyReturned));
            }

            // What each section on this page actually holds of each item, so a
            // row can say whether anything is left to hand back.
            const heldRows =
                rows.length === 0
                    ? []
                    : await db
                          .selectFrom('current_stock')
                          .select(['section_id as sectionId', 'item_id as itemId', 'qty_base'])
                          .where(
                              'section_id',
                              'in',
                              rows.map((row) => row.sectionId)
                          )
                          .execute();
            const heldBySection = new Map<string, number>();
            for (const h of heldRows) {
                heldBySection.set(`${h.sectionId}:${h.itemId}`, Number(h.qty_base));
            }

            const linesByIssue = new Map<string, typeof lineRows>();
            for (const line of lineRows) {
                const key = String(line.issueId);
                const list = linesByIssue.get(key) ?? [];
                list.push(line);
                linesByIssue.set(key, list);
            }

            const items = rows.map((row) => {
                const isMine = owned.includes(row.sectionId);
                const lines = (linesByIssue.get(String(row.id)) ?? []).map((l) => ({
                    itemId: l.itemId,
                    name: l.name,
                    stockUnit: l.stockUnit,
                    qtyRequested: Number(l.qtyRequested),
                    qtyIssued: l.qtyIssued === null ? null : Number(l.qtyIssued),
                    qtyReturned: returnedByLine.get(`${row.id}:${l.itemId}`) ?? 0
                }));

                // The same arithmetic the return itself applies: issued, less
                // what has gone back, capped by what the section still holds.
                const stillReturnable = lines.some((l) => {
                    const issued = l.qtyIssued ?? 0;
                    const held = heldBySection.get(`${row.sectionId}:${l.itemId}`) ?? 0;
                    return Math.min(issued - l.qtyReturned, held) > 0;
                });

                /**
                 * And the same window. Without it a five-week-old request
                 * offered Return simply because the section holds some of that
                 * item now -- from a release weeks later. The balance is not
                 * evidence that these are the goods that came in on this one.
                 */
                const days =
                    row.daysSinceReleased === null ? null : Number(row.daysSinceReleased);
                const withinWindow = days !== null && days <= RETURN_WINDOW_DAYS;

                return {
                    id: String(row.id),
                    sectionId: row.sectionId,
                    sectionCode: row.sectionCode,
                    sectionName: row.sectionName,
                    status: row.status,
                    requestedBy: row.requestedBy,
                    requestedAt: new Date(row.requestedAt as unknown as string).toISOString(),
                    neededBy: row.neededBy,
                    note: row.note,
                    lineCount: Number(row.lineCount),
                    lines,
                    releasedBy: row.releasedBy,
                    isMine,
                    /**
                     * A request whose whole contents went back is finished, and
                     * has no business sitting in somebody's "Needs me" queue
                     * asking them to confirm the arrival of goods that are on
                     * their way to the supplier. In practice a return now marks
                     * the request received, so this rarely fires -- but a
                     * request released and returned in two sittings would
                     * otherwise linger.
                     */
                    needsMe:
                        (row.status === 'requested' && canRelease) ||
                        (row.status === 'released' &&
                            isMine &&
                            !lines.every(
                                (l) => l.qtyReturned >= (l.qtyIssued ?? 0) && l.qtyReturned > 0
                            )),
                    qtyReturnedTotal: lines.reduce((n, l) => n + l.qtyReturned, 0),
                    daysSinceReleased: days,
                    canReturn:
                        (row.status === 'released' || row.status === 'received') &&
                        withinWindow &&
                        stillReturnable
                };
            });

            return toPage(items, counted?.total, req.query);
        }
    );
}
