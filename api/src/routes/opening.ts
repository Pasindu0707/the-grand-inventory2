/**
 * Opening stock - the first entry a section ever gets.
 *
 * Storekeeper and management, not admin: this writes quantities and money into
 * the ledger, and the admin role exists precisely so that the person who hands
 * out logins cannot do that. The safety rail is not the role anyway, it is the
 * service: a section can only be opened while it has no history at all, which
 * makes this a one-time cutover action rather than a way to conjure stock.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertSectionAllowed } from '../plugins/auth.js';
import { findReplay, hashBody } from '../services/idempotency.js';
import { createOpeningStock, openingState } from '../services/opening.js';

const openingResult = z.object({
    id: z.string(),
    businessDate: z.string(),
    lineCount: z.number(),
    totalValue: z.number()
});

export async function openingRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.get(
        '/opening-stock',
        {
            preHandler: app.requireRole('management', 'storekeeper'),
            schema: {
                response: {
                    200: z.array(
                        z.object({
                            sectionId: z.number(),
                            name: z.string(),
                            code: z.string(),
                            isStore: z.boolean(),
                            canOpen: z.boolean(),
                            previouslyReversed: z.boolean(),
                            openedOn: z.string().nullable()
                        })
                    )
                }
            }
        },
        async (req) => openingState(req.locationId)
    );

    r.post(
        '/opening-stock',
        {
            preHandler: app.requireRole('management', 'storekeeper'),
            schema: {
                headers: z.object({ 'idempotency-key': z.string().min(8).max(128) }).passthrough(),
                body: z.object({
                    sectionId: z.number().int().positive(),
                    note: z.string().max(500).nullish(),
                    lines: z
                        .array(
                            z.object({
                                itemId: z.number().int().positive(),
                                // Stock units, because this is a shelf being
                                // counted rather than a delivery being booked
                                // in. The form converts from packs where the
                                // person counting thinks in packs.
                                qtyBase: z.number().positive().max(100_000_000),
                                unitCost: z.number().nonnegative().max(1_000_000)
                            })
                        )
                        .min(1, 'An opening balance needs at least one line')
                }),
                response: { 200: openingResult, 201: openingResult }
            }
        },
        async (req, reply) => {
            await assertSectionAllowed(req.user.role, req.locationId, req.body.sectionId);

            const key = req.headers['idempotency-key'] as string;
            const endpoint = 'POST /opening-stock';
            const requestHash = hashBody(req.body);

            const replay = await findReplay<z.infer<typeof openingResult>>(
                key,
                endpoint,
                requestHash
            );
            if (replay) return reply.status(200).send(replay.response);

            const result = await createOpeningStock({
                locationId: req.locationId,
                sectionId: req.body.sectionId,
                enteredBy: req.user.sub,
                note: req.body.note ?? null,
                lines: req.body.lines,
                idempotency: { key, endpoint, requestHash }
            });

            return reply.status(201).send(result);
        }
    );
}
