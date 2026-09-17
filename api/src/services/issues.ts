/**
 * Issues: stock leaving the store for a section.
 *
 * Two steps on purpose. A section *requests*, the storekeeper *fulfils*, and
 * the quantity issued may differ from the quantity asked for - which is the
 * normal case, not an error. The ledger only moves at fulfilment, because a
 * request is a piece of paper and nothing has physically moved yet.
 *
 * Each fulfilment writes two ledger legs: out of the store, into the section.
 * The store is just another section, so this is an ordinary section-to-section
 * transfer with no special casing.
 */
import { db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit, businessDateFor, postDocument, type LedgerLine } from './ledger.js';
import { claimKey, storeResponse } from './idempotency.js';
import { issueWindowsFor, windowWarning } from './settings.js';

export interface RequestIssueInput {
    locationId: number;
    toSectionId: number;
    requestedBy: number;
    lines: { itemId: number; qtyRequested: number }[];
}

export interface FulfilIssueInput {
    issueId: string;
    locationId: number;
    issuedBy: number;
    /** Omitted lines are issued at the requested quantity; 0 means nothing went. */
    lines: { lineId: string; qtyIssued: number }[];
    note?: string | null;
    idempotency: { key: string; endpoint: string; requestHash: string };
}

export interface FulfilResult {
    id: string;
    businessDate: string;
    linesIssued: number;
    /** Present when the issue happened outside an agreed window. Advisory only. */
    windowWarning: string | null;
    shortfalls: { itemName: string; requested: number; issued: number; available: number }[];
}

export async function requestIssue(input: RequestIssueInput): Promise<{ id: string }> {
    if (input.lines.length === 0) throw badRequest('An issue request needs at least one line');

    const section = await db
        .selectFrom('sections')
        .select(['id', 'is_store'])
        .where('id', '=', input.toSectionId)
        .where('location_id', '=', input.locationId)
        .executeTakeFirst();
    if (!section) throw notFound(`Section ${input.toSectionId}`);
    if (section.is_store) throw badRequest('The store cannot issue to itself');

    return db.transaction().execute(async (trx) => {
        const issue = await trx
            .insertInto('issues')
            .values({
                location_id: input.locationId,
                to_section_id: input.toSectionId,
                requested_by: input.requestedBy,
                status: 'requested',
                is_demo: false
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        for (const line of input.lines) {
            if (line.qtyRequested <= 0) throw badRequest('Requested quantity must be more than zero');
            await trx
                .insertInto('issue_lines')
                .values({
                    issue_id: issue.id,
                    item_id: line.itemId,
                    qty_requested: line.qtyRequested,
                    is_demo: false
                })
                .execute();
        }

        await audit(trx, {
            userId: input.requestedBy,
            action: 'issue.request',
            entity: 'issues',
            entityId: issue.id,
            after: { toSectionId: input.toSectionId, lineCount: input.lines.length }
        });

        return { id: String(issue.id) };
    });
}

export async function fulfilIssue(input: FulfilIssueInput): Promise<FulfilResult> {
    const issue = await db
        .selectFrom('issues')
        .selectAll()
        .where('id', '=', input.issueId)
        .where('location_id', '=', input.locationId)
        .executeTakeFirst();
    if (!issue) throw notFound(`Issue ${input.issueId}`);
    if (issue.status !== 'requested') {
        throw conflict(`This issue is already ${issue.status}`);
    }

    const store = await db
        .selectFrom('sections')
        .select('id')
        .where('location_id', '=', input.locationId)
        .where('is_store', '=', true)
        .executeTakeFirstOrThrow();

    const lines = await db
        .selectFrom('issue_lines')
        .innerJoin('items', 'items.id', 'issue_lines.item_id')
        .select([
            'issue_lines.id as lineId',
            'issue_lines.item_id as itemId',
            'issue_lines.qty_requested as qtyRequested',
            'items.name as itemName',
            'items.stock_unit as stockUnit'
        ])
        .where('issue_lines.issue_id', '=', input.issueId)
        .execute();

    const requestedById = new Map(input.lines.map((l) => [String(l.lineId), l.qtyIssued]));

    // On-hand in the store, so a shortfall can be reported rather than issuing
    // stock that is not there and driving the section negative.
    const onHand = new Map<number, number>();
    for (const row of await db
        .selectFrom('current_stock')
        .select(['item_id', 'qty_base'])
        .where('section_id', '=', store.id)
        .execute()) {
        onHand.set(row.item_id, Number(row.qty_base));
    }

    const windows = await issueWindowsFor(input.locationId);
    const warning = windowWarning(windows, new Date());

    return db.transaction().execute(async (trx) => {
        await claimKey(
            trx,
            input.idempotency.key,
            input.idempotency.endpoint,
            input.idempotency.requestHash,
            input.issuedBy
        );

        const businessDate = await businessDateFor(trx, input.locationId);
        const ledgerLines: LedgerLine[] = [];
        const shortfalls: FulfilResult['shortfalls'] = [];
        let docLine = 0;

        for (const line of lines) {
            const asked = Number(line.qtyRequested);
            const wanted = requestedById.get(String(line.lineId)) ?? asked;
            if (wanted < 0) throw badRequest(`${line.itemName}: issued quantity cannot be negative`);

            const available = onHand.get(line.itemId) ?? 0;
            const issued = Math.min(wanted, Math.max(0, available));

            if (issued < wanted) {
                shortfalls.push({
                    itemName: line.itemName,
                    requested: wanted,
                    issued,
                    available: Math.max(0, available)
                });
            }

            await trx
                .updateTable('issue_lines')
                .set({ qty_issued: issued })
                .where('id', '=', line.lineId)
                .execute();

            if (issued <= 0) continue;

            docLine += 1;
            // Out of the store...
            ledgerLines.push({
                sectionId: store.id,
                itemId: line.itemId,
                qtyBase: -issued,
                docLine
            });
            // ...and into the section that asked for it.
            ledgerLines.push({
                sectionId: issue.to_section_id,
                itemId: line.itemId,
                qtyBase: issued,
                docLine
            });
        }

        if (ledgerLines.length === 0) {
            throw badRequest('Nothing was issued - every line came to zero');
        }

        await postDocument(trx, {
            doc: 'issue',
            docId: issue.id,
            locationId: input.locationId,
            businessDate,
            lines: ledgerLines,
            createdBy: input.issuedBy
        });

        await trx
            .updateTable('issues')
            .set({ status: 'issued', issued_by: input.issuedBy, issued_at: new Date() })
            .where('id', '=', issue.id)
            .execute();

        await audit(trx, {
            userId: input.issuedBy,
            action: 'issue.fulfil',
            entity: 'issues',
            entityId: issue.id,
            after: {
                linesIssued: ledgerLines.length / 2,
                offWindow: warning !== null,
                note: input.note ?? null
            }
        });

        const result: FulfilResult = {
            id: String(issue.id),
            businessDate,
            linesIssued: ledgerLines.length / 2,
            windowWarning: warning,
            shortfalls
        };

        await storeResponse(trx, input.idempotency.key, result, 200);
        return result;
    });
}

export async function cancelIssue(
    issueId: string,
    locationId: number,
    userId: number
): Promise<void> {
    const issue = await db
        .selectFrom('issues')
        .select(['id', 'status'])
        .where('id', '=', issueId)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!issue) throw notFound(`Issue ${issueId}`);
    if (issue.status !== 'requested') {
        // An issued document is history. Correcting it is a reversal, not a
        // status change.
        throw conflict(`Cannot cancel an issue that is already ${issue.status}`);
    }

    await db.transaction().execute(async (trx) => {
        await trx
            .updateTable('issues')
            .set({ status: 'cancelled' })
            .where('id', '=', issueId)
            .execute();
        await audit(trx, {
            userId,
            action: 'issue.cancel',
            entity: 'issues',
            entityId: issueId
        });
    });
}
