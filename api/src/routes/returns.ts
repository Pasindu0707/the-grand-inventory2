/**
 * Returns.
 *
 * Two documents with different rules about who may act, because they are two
 * different decisions.
 *
 * A **section return** is anybody who holds stock handing it back. Kitchen,
 * cleaning, the store itself: the same people who may log wastage, because it
 * is the same judgement -- these goods are not fit to use. Approval afterwards
 * is management's, and never your own return.
 *
 * A **supplier return** is money. The storekeeper writes it up because only
 * they can see what is really in quarantine; management decides it, exactly as
 * they decide a purchase. The stock moves on send, and send is refused until
 * the decision exists.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../db/index.js';
import { assertSectionAllowed, assertSectionOpen, sectionsForUser } from '../plugins/auth.js';
import { offsetOf, pageOf, pageQuery, toPage } from '../services/pagination.js';
import {
    issueReturnableLines,
    binDecidedLines,
    decideDisposal,
    quarantineContents,
    raiseSupplierReturn,
    returnToStore,
    returnableLines,
    sendSupplierReturn,
    settleSupplierReturn,
    suggestedSupplierReturns
} from '../services/returns.js';

const sectionReturnRow = z.object({
    id: z.string(),
    itemId: z.number(),
    itemName: z.string(),
    stockUnit: z.string(),
    qtyBase: z.number(),
    fromSection: z.string(),
    reasonCode: z.string(),
    reasonLabel: z.string(),
    note: z.string().nullable(),
    photoUrl: z.string().nullable(),
    returnedBy: z.string(),
    returnedAt: z.string(),
    approvedBy: z.string().nullable(),
    /** Still sitting in quarantine and not yet on a supplier return. */
    onSupplierReturn: z.boolean()
});

const supplierReturnLine = z.object({
    id: z.string(),
    grnLineId: z.string(),
    itemId: z.number(),
    itemName: z.string(),
    stockUnit: z.string(),
    packName: z.string(),
    qtyPacks: z.number(),
    qtyBase: z.number(),
    packPrice: z.number(),
    lineCredit: z.number(),
    /** What management answered for this line. Null until they have. */
    decision: z.enum(['vendor', 'waste']).nullable(),
    /** A waste line that has actually been binned. */
    binned: z.boolean()
});

const supplierReturnRow = z.object({
    id: z.string(),
    status: z.enum(['raised', 'approved', 'rejected', 'sent', 'settled']),
    supplierId: z.number(),
    supplierName: z.string(),
    grnId: z.string(),
    invoiceNo: z.string().nullable(),
    reasonCode: z.string(),
    reasonLabel: z.string(),
    note: z.string().nullable(),
    raisedBy: z.string(),
    raisedAt: z.string(),
    decidedBy: z.string().nullable(),
    decisionNote: z.string().nullable(),
    sentAt: z.string().nullable(),
    outcome: z.enum(['credit', 'replacement', 'written_off']).nullable(),
    creditNoteNo: z.string().nullable(),
    creditValue: z.number().nullable(),
    settledAt: z.string().nullable(),
    /**
     * What is being claimed from the supplier. Before a decision that is every
     * line; afterwards only the lines management said to claim, because a
     * binned line is money written off rather than money owed.
     */
    expectedCredit: z.number(),
    /** The other half: what was decided into the bin, at invoice value. */
    writtenOffValue: z.number(),
    lines: z.array(supplierReturnLine)
});

export async function returnRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();

    // ── Section returns ─────────────────────────────────────────────────────

    r.post(
        '/returns',
        {
            // Handing stock back is done by whoever is holding it: the section
            // it was released to, or the storekeeper for bad stock found on the
            // store's own shelf. Admin is absent here as everywhere that
            // touches stock, and so now is management -- they stand at no
            // shelf, and the person who approves a return should not also be
            // the person who wrote it up.
            preHandler: app.requireRole('storekeeper', 'kitchen', 'cleaning'),
            schema: {
                body: z.object({
                    sectionId: z.number().int().positive(),
                    itemId: z.number().int().positive(),
                    qtyBase: z.number().positive(),
                    reasonCode: z.string().min(1).max(32),
                    note: z.string().max(500).nullish(),
                    photoUrl: z.string().max(512).nullish(),
                    /**
                     * The release this came from. Required for every section
                     * except the store, which receives stock on a delivery
                     * rather than a release and so has no request to name.
                     * The service enforces that; it is nullish here because
                     * one of the two callers legitimately omits it.
                     */
                    issueId: z.string().nullish()
                }),
                response: {
                    201: z.object({
                        id: z.string(),
                        businessDate: z.string(),
                        toSectionId: z.number()
                    })
                }
            }
        },
        async (req, reply) => {
            // The section it comes *from* has to be one of yours. The section it
            // goes to is the branch's quarantine and is resolved by the service,
            // so a section login never names a room it cannot see.
            await assertSectionAllowed(req.user.role, req.locationId, req.body.sectionId);
            await assertSectionOpen(req.body.sectionId);

            const result = await returnToStore({
                locationId: req.locationId,
                fromSectionId: req.body.sectionId,
                itemId: req.body.itemId,
                qtyBase: req.body.qtyBase,
                reasonCode: req.body.reasonCode,
                note: req.body.note ?? null,
                photoUrl: req.body.photoUrl ?? null,
                issueId: req.body.issueId ?? null,
                returnedBy: req.user.sub
            });
            return reply.status(201).send(result);
        }
    );

    r.get(
        '/returns',
        {
            preHandler: app.authenticate,
            schema: {
                querystring: pageQuery.extend({
                    pendingOnly: z.coerce.boolean().optional(),
                    /** In quarantine and not yet on a supplier return. */
                    awaitingSupplier: z.coerce.boolean().optional()
                }),
                response: { 200: pageOf(sectionReturnRow) }
            }
        },
        async (req) => {
            const mine = await sectionsForUser(req.user.role, req.locationId);

            const base = () => {
                let q = db
                    .selectFrom('section_returns as sr')
                    .innerJoin('items as i', 'i.id', 'sr.item_id')
                    .innerJoin('sections as fs', 'fs.id', 'sr.from_section_id')
                    .innerJoin('users as u', 'u.id', 'sr.returned_by')
                    .innerJoin('reason_codes as rc', 'rc.code', 'sr.reason_code')
                    .leftJoin('users as au', 'au.id', 'sr.approved_by')
                    .where('sr.location_id', '=', req.locationId);
                // A section sees what it sent back, not the whole branch.
                if (mine.length > 0) q = q.where('sr.from_section_id', 'in', mine);
                if (req.query.pendingOnly) q = q.where('sr.approved_by', 'is', null);
                return q;
            };

            const counted = await base()
                .select(({ fn }) => fn.countAll().as('total'))
                .executeTakeFirst();

            const rows = await base()
                .leftJoin('supplier_return_lines as srl', 'srl.section_return_id', 'sr.id')
                .select([
                    'sr.id',
                    'i.id as itemId',
                    'i.name as itemName',
                    'i.stock_unit as stockUnit',
                    'sr.qty_base as qtyBase',
                    'fs.name as fromSection',
                    'sr.reason_code as reasonCode',
                    'rc.label as reasonLabel',
                    'sr.note',
                    'sr.photo_url as photoUrl',
                    'u.name as returnedBy',
                    'sr.returned_at as returnedAt',
                    'au.name as approvedBy',
                    'srl.id as supplierLineId'
                ])
                .distinctOn(['sr.returned_at', 'sr.id'])
                .orderBy('sr.returned_at', 'desc')
                .orderBy('sr.id', 'desc')
                .limit(req.query.limit)
                .offset(offsetOf(req.query))
                .execute();

            const items = rows
                .filter((row) => !req.query.awaitingSupplier || row.supplierLineId === null)
                .map((row) => ({
                    id: String(row.id),
                    itemId: row.itemId,
                    itemName: row.itemName,
                    stockUnit: row.stockUnit,
                    qtyBase: Number(row.qtyBase),
                    fromSection: row.fromSection,
                    reasonCode: row.reasonCode,
                    reasonLabel: row.reasonLabel,
                    note: row.note,
                    photoUrl: row.photoUrl,
                    returnedBy: row.returnedBy,
                    returnedAt: new Date(row.returnedAt as unknown as string).toISOString(),
                    approvedBy: row.approvedBy,
                    onSupplierReturn: row.supplierLineId !== null
                }));

            return toPage(items, counted?.total, req.query);
        }
    );

    /*
     * `POST /returns/:id/approve` was withdrawn by CR-006.
     *
     * It approved a movement that had already happened and blocked nothing
     * while it sat unapproved. The decision that matters -- claim it from the
     * supplier, or bin it -- is now the only approval in the chain, and it
     * lives on the disposal below.
     */

    /**
     * What can still be handed back off one request.
     *
     * This is the screen's whole data source. It is keyed on the request rather
     * than on the item because that is the question the chef is actually
     * answering -- "this delivery was wrong" -- and because it is what stops a
     * return being a way to move stock the section was never given.
     */
    r.get(
        '/requests/:id/returnable',
        {
            preHandler: app.requireRole('management', 'storekeeper', 'kitchen', 'cleaning'),
            schema: {
                params: z.object({ id: z.string() }),
                response: {
                    200: z.object({
                        sectionId: z.number(),
                        status: z.string(),
                        daysSinceReleased: z.number().nullable(),
                        withinWindow: z.boolean(),
                        lines: z.array(
                            z.object({
                                itemId: z.number(),
                                code: z.string(),
                                name: z.string(),
                                stockUnit: z.string(),
                                qtyIssued: z.number(),
                                qtyReturned: z.number(),
                                qtyReturnable: z.number(),
                                qtyHeld: z.number()
                            })
                        )
                    })
                }
            }
        },
        async (req) => {
            const result = await issueReturnableLines(req.params.id, req.locationId);
            // The same boundary every other section-scoped read honours: you
            // see requests released to a section you work with, and no others.
            await assertSectionAllowed(req.user.role, req.locationId, result.sectionId);
            return result;
        }
    );

    // ── What can go back to a supplier ──────────────────────────────────────

    r.get(
        '/grn/:id/returnable',
        {
            preHandler: app.requireRole('storekeeper'),
            schema: {
                params: z.object({ id: z.string() }),
                response: {
                    200: z.array(
                        z.object({
                            grnLineId: z.string(),
                            itemId: z.number(),
                            itemCode: z.string(),
                            itemName: z.string(),
                            stockUnit: z.string(),
                            packId: z.number(),
                            packName: z.string(),
                            qtyInStockUnit: z.number(),
                            packPrice: z.number(),
                            qtyPacksDelivered: z.number(),
                            qtyPacksReturned: z.number(),
                            qtyPacksReturnable: z.number(),
                            qtyInQuarantine: z.number()
                        })
                    )
                }
            }
        },
        async (req) => {
            const rows = await returnableLines(req.params.id, req.locationId);
            return rows.map((row) => ({ ...row, grnLineId: String(row.grnLineId) }));
        }
    );

    // ── Supplier returns ────────────────────────────────────────────────────

    /**
     * Everything in quarantine, already worked out into returns.
     *
     * The screen opens on this rather than on an empty form. The delivery, the
     * reason and the pack quantities are all things the system knows, and
     * asking the storekeeper to type them again was asking them to reconstruct
     * from memory what is sitting in a database.
     */
    /**
     * The quarantine shelf, with how much of each line is already spoken for.
     *
     * Open to management as well as the store: the value sitting here is money
     * paid for and unusable, which is theirs to watch even though the acting
     * on it is not.
     */
    r.get(
        '/quarantine',
        {
            preHandler: app.requireRole('management', 'storekeeper'),
            schema: {
                response: {
                    200: z.array(
                        z.object({
                            itemId: z.number(),
                            code: z.string(),
                            name: z.string(),
                            stockUnit: z.string(),
                            qtyBase: z.number(),
                            value: z.number(),
                            qtyOnOpenAsk: z.number(),
                            qtyFree: z.number()
                        })
                    )
                }
            }
        },
        async (req) => quarantineContents(req.locationId)
    );

    r.get(
        '/supplier-returns/suggested',
        {
            preHandler: app.requireRole('storekeeper'),
            schema: {
                response: {
                    200: z.array(
                        z.object({
                            grnId: z.string(),
                            invoiceNo: z.string().nullable(),
                            receivedAt: z.string(),
                            supplierId: z.number(),
                            supplierName: z.string(),
                            reasonCode: z.string().nullable(),
                            reasonLabel: z.string().nullable(),
                            totalCredit: z.number(),
                            lines: z.array(
                                z.object({
                                    grnLineId: z.string(),
                                    itemId: z.number(),
                                    itemCode: z.string(),
                                    itemName: z.string(),
                                    stockUnit: z.string(),
                                    packName: z.string(),
                                    qtyInStockUnit: z.number(),
                                    packPrice: z.number(),
                                    qtyInQuarantine: z.number(),
                                    qtyPacksReturnable: z.number(),
                                    suggestedPacks: z.number(),
                                    suggestedCredit: z.number()
                                })
                            )
                        })
                    )
                }
            }
        },
        async (req) => suggestedSupplierReturns(req.locationId)
    );

    r.post(
        '/supplier-returns',
        {
            // The storekeeper writes it up; management decides it. Both
            // in one pair of hands is an approval that approves nothing.
            preHandler: app.requireRole('storekeeper'),
            schema: {
                body: z.object({
                    grnId: z.string(),
                    reasonCode: z.string().min(1).max(32),
                    note: z.string().max(500).nullish(),
                    lines: z
                        .array(
                            z.object({
                                grnLineId: z.string(),
                                qtyPacks: z.number().positive(),
                                sectionReturnId: z.string().nullish()
                            })
                        )
                        .min(1)
                }),
                response: {
                    201: z.object({
                        id: z.string(),
                        supplierId: z.number(),
                        lineCount: z.number(),
                        creditValue: z.number()
                    })
                }
            }
        },
        async (req, reply) => {
            const result = await raiseSupplierReturn({
                locationId: req.locationId,
                grnId: req.body.grnId,
                reasonCode: req.body.reasonCode,
                note: req.body.note ?? null,
                lines: req.body.lines.map((l) => ({
                    grnLineId: l.grnLineId,
                    qtyPacks: l.qtyPacks,
                    sectionReturnId: l.sectionReturnId ?? null
                })),
                raisedBy: req.user.sub
            });
            return reply.status(201).send(result);
        }
    );

    r.get(
        '/supplier-returns',
        {
            preHandler: app.requireRole('management', 'storekeeper'),
            schema: {
                querystring: pageQuery.extend({
                    status: z
                        .enum(['raised', 'approved', 'rejected', 'sent', 'settled'])
                        .optional(),
                    /** Sent, and the supplier has not settled it. */
                    openOnly: z.coerce.boolean().optional()
                }),
                response: { 200: pageOf(supplierReturnRow) }
            }
        },
        async (req) => {
            const base = () => {
                let q = db
                    .selectFrom('supplier_returns as sr')
                    .where('sr.location_id', '=', req.locationId);
                if (req.query.status) q = q.where('sr.status', '=', req.query.status);
                if (req.query.openOnly) q = q.where('sr.status', '=', 'sent');
                return q;
            };

            const counted = await base()
                .select(({ fn }) => fn.countAll().as('total'))
                .executeTakeFirst();

            const heads = await base()
                .innerJoin('suppliers as s', 's.id', 'sr.supplier_id')
                .innerJoin('grn', 'grn.id', 'sr.grn_id')
                .innerJoin('users as u', 'u.id', 'sr.raised_by')
                .innerJoin('reason_codes as rc', 'rc.code', 'sr.reason_code')
                .leftJoin('users as du', 'du.id', 'sr.decided_by')
                .select([
                    'sr.id',
                    'sr.status',
                    'sr.supplier_id as supplierId',
                    's.name as supplierName',
                    'sr.grn_id as grnId',
                    'grn.invoice_no as invoiceNo',
                    'sr.reason_code as reasonCode',
                    'rc.label as reasonLabel',
                    'sr.note',
                    'u.name as raisedBy',
                    'sr.raised_at as raisedAt',
                    'du.name as decidedBy',
                    'sr.decision_note as decisionNote',
                    'sr.sent_at as sentAt',
                    'sr.outcome',
                    'sr.credit_note_no as creditNoteNo',
                    'sr.credit_value as creditValue',
                    'sr.settled_at as settledAt'
                ])
                .orderBy('sr.raised_at', 'desc')
                .limit(req.query.limit)
                .offset(offsetOf(req.query))
                .execute();

            const ids = heads.map((h) => String(h.id));
            const lines = ids.length
                ? await db
                      .selectFrom('supplier_return_lines as l')
                      .innerJoin('items as i', 'i.id', 'l.item_id')
                      .innerJoin('grn_lines as gl', 'gl.id', 'l.grn_line_id')
                      .innerJoin('item_packs as p', 'p.id', 'gl.item_pack_id')
                      .select([
                          'l.id',
                          'l.return_id as returnId',
                          'l.grn_line_id as grnLineId',
                          'i.id as itemId',
                          'i.name as itemName',
                          'i.stock_unit as stockUnit',
                          'p.pack_name as packName',
                          'l.qty_packs as qtyPacks',
                          'l.qty_base as qtyBase',
                          'l.pack_price as packPrice',
                          'l.line_credit as lineCredit',
                          'l.decision',
                          'l.wastage_id as wastageId'
                      ])
                      .where('l.return_id', 'in', ids)
                      .execute()
                : [];

            const byReturn = new Map<string, typeof lines>();
            for (const l of lines) {
                const key = String(l.returnId);
                const list = byReturn.get(key) ?? [];
                list.push(l);
                byReturn.set(key, list);
            }

            const items = heads.map((h) => {
                const mine = byReturn.get(String(h.id)) ?? [];
                return {
                    id: String(h.id),
                    status: h.status,
                    supplierId: h.supplierId,
                    supplierName: h.supplierName,
                    grnId: String(h.grnId),
                    invoiceNo: h.invoiceNo,
                    reasonCode: h.reasonCode,
                    reasonLabel: h.reasonLabel,
                    note: h.note,
                    raisedBy: h.raisedBy,
                    raisedAt: new Date(h.raisedAt as unknown as string).toISOString(),
                    decidedBy: h.decidedBy,
                    decisionNote: h.decisionNote,
                    sentAt: h.sentAt ? new Date(h.sentAt as unknown as string).toISOString() : null,
                    outcome: h.outcome,
                    creditNoteNo: h.creditNoteNo,
                    creditValue: h.creditValue === null ? null : Number(h.creditValue),
                    settledAt: h.settledAt
                        ? new Date(h.settledAt as unknown as string).toISOString()
                        : null,
                    /*
                     * What is actually being claimed.
                     *
                     * Before a decision that is every line, because the ask is
                     * "claim all of this, or bin it". Afterwards it is only the
                     * lines management said to claim -- a binned line is money
                     * written off, not money owed, and counting it here would
                     * overstate what is coming back.
                     */
                    expectedCredit: Number(
                        mine
                            .filter((l) => l.decision !== 'waste')
                            .reduce((n, l) => n + Number(l.lineCredit), 0)
                            .toFixed(2)
                    ),
                    writtenOffValue: Number(
                        mine
                            .filter((l) => l.decision === 'waste')
                            .reduce((n, l) => n + Number(l.lineCredit), 0)
                            .toFixed(2)
                    ),
                    lines: mine.map((l) => ({
                        id: String(l.id),
                        grnLineId: String(l.grnLineId),
                        itemId: l.itemId,
                        itemName: l.itemName,
                        stockUnit: l.stockUnit,
                        packName: l.packName,
                        qtyPacks: Number(l.qtyPacks),
                        qtyBase: Number(l.qtyBase),
                        packPrice: Number(l.packPrice),
                        lineCredit: Number(l.lineCredit),
                        decision: l.decision,
                        binned: l.wastageId !== null
                    }))
                };
            });

            return toPage(items, counted?.total, req.query);
        }
    );

    /**
     * The one decision in the whole chain: for each line, claim it or bin it.
     *
     * Reserved to management because both answers are money -- one asks a
     * supplier for a credit, the other writes the value off -- and because the
     * person who raised the ask must not be the one who grants it.
     */
    r.post(
        '/supplier-returns/:id/decide',
        {
            preHandler: app.requireRole('management'),
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    lines: z
                        .array(
                            z.object({
                                lineId: z.string(),
                                decision: z.enum(['vendor', 'waste'])
                            })
                        )
                        .min(1),
                    note: z.string().max(500).nullish()
                }),
                response: {
                    200: z.object({
                        id: z.string(),
                        toVendor: z.number(),
                        toWaste: z.number(),
                        creditValue: z.number()
                    })
                }
            }
        },
        async (req) =>
            decideDisposal(
                req.params.id,
                req.locationId,
                { lines: req.body.lines, note: req.body.note ?? null },
                req.user.sub
            )
    );

    /**
     * The store bins what management said to bin. One button.
     *
     * The physical act belongs to the person standing next to the bin, the same
     * way marking a return gone belongs to the person who watched the lorry
     * leave.
     */
    r.post(
        '/supplier-returns/:id/bin',
        {
            preHandler: app.requireRole('storekeeper'),
            schema: {
                params: z.object({ id: z.string() }),
                response: {
                    200: z.object({
                        id: z.string(),
                        binned: z.number(),
                        alreadyBinned: z.number(),
                        qtyBase: z.number()
                    })
                }
            }
        },
        async (req) => binDecidedLines(req.params.id, req.locationId, req.user.sub)
    );

    r.post(
        '/supplier-returns/:id/send',
        {
            // Marking it gone is a physical fact about a lorry, recorded
            // by the person who watched it leave.
            preHandler: app.requireRole('storekeeper'),
            schema: {
                params: z.object({ id: z.string() }),
                response: {
                    200: z.object({
                        id: z.string(),
                        businessDate: z.string(),
                        rowsPosted: z.number()
                    })
                }
            }
        },
        async (req) => sendSupplierReturn(req.params.id, req.locationId, req.user.sub)
    );

    r.post(
        '/supplier-returns/:id/settle',
        {
            preHandler: app.requireRole('management'),
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    outcome: z.enum(['credit', 'replacement', 'written_off']),
                    creditNoteNo: z.string().max(64).nullish(),
                    creditValue: z.number().nonnegative().nullish(),
                    note: z.string().max(500).nullish()
                }),
                response: { 200: z.object({ ok: z.literal(true) }) }
            }
        },
        async (req) => {
            await settleSupplierReturn(
                req.params.id,
                req.locationId,
                {
                    outcome: req.body.outcome,
                    creditNoteNo: req.body.creditNoteNo ?? null,
                    creditValue: req.body.creditValue ?? null,
                    note: req.body.note ?? null
                },
                req.user.sub
            );
            return { ok: true as const };
        }
    );
}
