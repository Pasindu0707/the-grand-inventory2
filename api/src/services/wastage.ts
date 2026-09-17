/**
 * Wastage and transfers.
 *
 * Both write the ledger the moment the stock physically moves, not when
 * somebody gets round to approving it. Approval is a review of an event that
 * already happened; withholding the ledger row until then would mean the stock
 * figure is knowingly wrong for as long as the manager is busy.
 */
import { db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit, businessDateFor, postDocument } from './ledger.js';

export interface LogWastageInput {
    locationId: number;
    sectionId: number;
    itemId: number;
    qtyBase: number;
    reasonCode: string;
    photoUrl?: string | null;
    note?: string | null;
    loggedBy: number;
}

export async function logWastage(input: LogWastageInput): Promise<{ id: string; businessDate: string }> {
    if (input.qtyBase <= 0) throw badRequest('Wasted quantity must be more than zero');

    const reason = await db
        .selectFrom('reason_codes')
        .select(['code', 'doc'])
        .where('code', '=', input.reasonCode)
        .executeTakeFirst();
    if (!reason) throw badRequest(`Unknown reason code "${input.reasonCode}"`);
    if (reason.doc !== 'wastage') {
        throw badRequest(`"${input.reasonCode}" is not a wastage reason`);
    }

    const section = await db
        .selectFrom('sections')
        .select('id')
        .where('id', '=', input.sectionId)
        .where('location_id', '=', input.locationId)
        .executeTakeFirst();
    if (!section) throw notFound(`Section ${input.sectionId}`);

    return db.transaction().execute(async (trx) => {
        const businessDate = await businessDateFor(trx, input.locationId);

        const waste = await trx
            .insertInto('wastage')
            .values({
                location_id: input.locationId,
                section_id: input.sectionId,
                item_id: input.itemId,
                qty_base: input.qtyBase,
                reason_code: input.reasonCode,
                photo_url: input.photoUrl ?? null,
                logged_by: input.loggedBy,
                is_demo: false
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        await postDocument(trx, {
            doc: 'wastage',
            docId: waste.id,
            locationId: input.locationId,
            businessDate,
            lines: [
                {
                    sectionId: input.sectionId,
                    itemId: input.itemId,
                    qtyBase: -input.qtyBase,
                    reasonCode: input.reasonCode,
                    note: input.note ?? null
                }
            ],
            createdBy: input.loggedBy
        });

        await audit(trx, {
            userId: input.loggedBy,
            action: 'wastage.log',
            entity: 'wastage',
            entityId: waste.id,
            after: { itemId: input.itemId, qtyBase: input.qtyBase, reasonCode: input.reasonCode }
        });

        return { id: String(waste.id), businessDate };
    });
}

export async function approveWastage(
    wastageId: string,
    locationId: number,
    approvedBy: number
): Promise<void> {
    const row = await db
        .selectFrom('wastage')
        .select(['id', 'approved_by'])
        .where('id', '=', wastageId)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!row) throw notFound(`Wastage ${wastageId}`);
    if (row.approved_by) throw conflict('Already approved');

    await db.transaction().execute(async (trx) => {
        await trx
            .updateTable('wastage')
            .set({ approved_by: approvedBy })
            .where('id', '=', wastageId)
            .execute();
        await audit(trx, {
            userId: approvedBy,
            action: 'wastage.approve',
            entity: 'wastage',
            entityId: wastageId
        });
    });
}

// ── Transfers ───────────────────────────────────────────────────────────────

export interface TransferInput {
    fromSectionId: number;
    toSectionId: number;
    itemId: number;
    qtyBase: number;
    sentBy: number;
}

export interface TransferResult {
    id: string;
    /** True when both legs posted immediately (same outlet). */
    completed: boolean;
}

/**
 * Within one outlet, a transfer is instantaneous: someone carries a tray from
 * the bakery to the kitchen, and both legs post together.
 *
 * Between outlets it is not - stock sits in a van. So the send leg posts now
 * and the receiving leg waits for someone at the far end to confirm. Until
 * then the stock is off both books, which is honest: nobody can count it.
 */
export async function transfer(input: TransferInput): Promise<TransferResult> {
    if (input.qtyBase <= 0) throw badRequest('Transfer quantity must be more than zero');
    if (input.fromSectionId === input.toSectionId) {
        throw badRequest('Source and destination are the same section');
    }

    const sections = await db
        .selectFrom('sections')
        .select(['id', 'location_id', 'name'])
        .where('id', 'in', [input.fromSectionId, input.toSectionId])
        .execute();

    const from = sections.find((s) => s.id === input.fromSectionId);
    const to = sections.find((s) => s.id === input.toSectionId);
    if (!from) throw notFound(`Section ${input.fromSectionId}`);
    if (!to) throw notFound(`Section ${input.toSectionId}`);

    const sameLocation = from.location_id === to.location_id;

    return db.transaction().execute(async (trx) => {
        const row = await trx
            .insertInto('transfers')
            .values({
                from_section_id: input.fromSectionId,
                to_section_id: input.toSectionId,
                item_id: input.itemId,
                qty_base: input.qtyBase,
                sent_by: input.sentBy,
                received_at: sameLocation ? new Date() : null,
                received_by: sameLocation ? input.sentBy : null,
                is_demo: false
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        await postDocument(trx, {
            doc: 'transfer',
            docId: row.id,
            locationId: from.location_id,
            lines: [{ sectionId: input.fromSectionId, itemId: input.itemId, qtyBase: -input.qtyBase }],
            createdBy: input.sentBy
        });

        if (sameLocation) {
            await postDocument(trx, {
                doc: 'transfer',
                docId: row.id,
                locationId: to.location_id,
                lines: [{ sectionId: input.toSectionId, itemId: input.itemId, qtyBase: input.qtyBase }],
                createdBy: input.sentBy
            });
        }

        await audit(trx, {
            userId: input.sentBy,
            action: sameLocation ? 'transfer.complete' : 'transfer.send',
            entity: 'transfers',
            entityId: row.id,
            after: { ...input, sameLocation }
        });

        return { id: String(row.id), completed: sameLocation };
    });
}

export async function receiveTransfer(
    transferId: string,
    receivedBy: number
): Promise<{ id: string }> {
    const row = await db
        .selectFrom('transfers')
        .selectAll()
        .where('id', '=', transferId)
        .executeTakeFirst();
    if (!row) throw notFound(`Transfer ${transferId}`);
    if (row.received_at) throw conflict('This transfer has already been received');

    const to = await db
        .selectFrom('sections')
        .select(['id', 'location_id'])
        .where('id', '=', row.to_section_id)
        .executeTakeFirstOrThrow();

    await db.transaction().execute(async (trx) => {
        await postDocument(trx, {
            doc: 'transfer',
            docId: row.id,
            locationId: to.location_id,
            lines: [
                { sectionId: row.to_section_id, itemId: row.item_id, qtyBase: Number(row.qty_base) }
            ],
            createdBy: receivedBy
        });

        await trx
            .updateTable('transfers')
            .set({ received_at: new Date(), received_by: receivedBy })
            .where('id', '=', transferId)
            .execute();

        await audit(trx, {
            userId: receivedBy,
            action: 'transfer.receive',
            entity: 'transfers',
            entityId: transferId
        });
    });

    return { id: String(transferId) };
}
