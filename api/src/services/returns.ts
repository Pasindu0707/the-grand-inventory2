/**
 * Returns: out of a section, into quarantine, back to the vendor.
 *
 * Two documents, two different rules about when the ledger is written, and the
 * difference is deliberate.
 *
 *   A **section return** is an internal movement that has already happened. The
 *   chef opened the box, the fish was bad, the crate is on its way to the store
 *   whatever anybody approves. So the ledger moves immediately -- kitchen down,
 *   quarantine up -- and a manager reviews it afterwards. Same rule as wastage.
 *
 *   A **supplier return** spends money. The credit note, the replacement, the
 *   argument with the supplier: all of it follows from a decision management
 *   should make before the goods are on the lorry. So it is written up, then
 *   approved, and the ledger moves only when it is marked sent -- which is the
 *   moment the stock actually leaves the building.
 *
 * Cost. A return is not a receipt, so `postDocument` values it at the running
 * weighted average, the same as an issue: it records the cost of what left. The
 * money the supplier owes is a different number entirely -- the pack price on
 * the original GRN line -- and it lives on `supplier_return_lines`. They can
 * differ, and they should be allowed to: forcing the ledger to the invoice
 * price would revalue the stock that stayed on the shelf.
 *
 * **One decision, two possible ends (CR-006).** The store raises the supplier
 * return as an *ask*: here is what is in quarantine, here is the delivery it
 * came in on and what it is worth -- do we claim it, or bin it? Management
 * answers **line by line**, and that answer is the only approval in the chain.
 * A line decided `vendor` leaves on the lorry and is settled against a credit
 * note; a line decided `waste` is binned by the store and posts an ordinary
 * wastage document, so it lands in the waste report where anybody looking for
 * "what did we throw away" will find it.
 *
 * Every line ends somewhere. The old flow had no route for "the supplier will
 * not take it back", which is the common case, so it was done by logging
 * wastage against the quarantine section -- approved by nobody and described
 * in no document.
 */
import { sql } from 'kysely';
import { db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { quarantineSectionFor } from '../plugins/auth.js';
import { audit, businessDateFor, postDocument, type Tx } from './ledger.js';
import type { DisposalDecision, SupplierReturnOutcome } from '../db/types.js';

/**
 * How long a release stays returnable.
 *
 * The real constraint is whether anybody can still tell that what is being
 * handed back came in on *that* release. For fresh fish that is hours; for a
 * sack of flour it could be weeks, and the system cannot know which.
 *
 * So there is a window, and after it the honest instruments are wastage (we
 * spoiled it) or a stock count (we cannot account for it) -- not a supplier
 * return, because by then nobody can say the supplier is at fault.
 *
 * Without this the check was "does the section hold any of this item", which a
 * five-week-old request passes trivially: the bar holds wine, so a request from
 * August offered to return wine that came in September. That is not a return,
 * it is picking a document at random to hang a loss on.
 *
 * Seven days is a guess and belongs on the Phase 0 list to confirm with the
 * owner, the same as the shrinkage floors in reports.ts.
 */
export const RETURN_WINDOW_DAYS = 7;

/**
 * The wastage reason a binned line is written off under.
 *
 * Not "Spoiled / expired": the goods were not spoiled in our fridge, they
 * arrived bad and the supplier would not take them back. Putting somebody
 * else's fault into our spoilage figures is exactly the quiet mislabelling the
 * wastage report exists to avoid. Added by migration 0008.
 */
export const WRITE_OFF_REASON = 'BADGOODS';

// ── Section return ──────────────────────────────────────────────────────────

export interface SectionReturnInput {
    locationId: number;
    fromSectionId: number;
    itemId: number;
    qtyBase: number;
    reasonCode: string;
    note?: string | null;
    photoUrl?: string | null;
    issueId?: string | null;
    returnedBy: number;
}

/** A reason that belongs to the return document, not to wastage. */
async function assertReturnReason(code: string): Promise<void> {
    const row = await db
        .selectFrom('reason_codes')
        .select(['code', 'doc'])
        .where('code', '=', code)
        .executeTakeFirst();
    if (!row) throw badRequest(`Unknown reason code "${code}"`);
    if (row.doc !== 'return') throw badRequest(`"${code}" is not a return reason`);
}

/**
 * Stock the section actually holds right now.
 *
 * Returning more than is on the shelf would drive a section negative, which the
 * system does not permit anywhere else and must not permit here. The check and
 * the write are in one transaction so two chefs returning the same crate cannot
 * both succeed.
 */
async function heldBy(trx: Tx, sectionId: number, itemId: number): Promise<number> {
    const row = await trx
        .selectFrom('current_stock')
        .select('qty_base')
        .where('section_id', '=', sectionId)
        .where('item_id', '=', itemId)
        .executeTakeFirst();
    return Number(row?.qty_base ?? 0);
}

// ── What a section may hand back ────────────────────────────────────────────

export interface IssueReturnableLine {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    /** What the store actually released on this line. */
    qtyIssued: number;
    /** Already handed back against this same request. */
    qtyReturned: number;
    /** Issued less returned, capped by what the section still holds. */
    qtyReturnable: number;
    /** What the section holds right now, across everything. */
    qtyHeld: number;
}

/**
 * The lines of one request, with how much of each can still be handed back.
 *
 * A section holds stock because an issue put it there. So a return is measured
 * against that issue: you may hand back what was released to you, less what you
 * have already handed back, and never more than is still on your shelf.
 *
 * Before this existed the screen offered every item the section *handles* and
 * the only check was the section's current balance. A chef could return four
 * kilos of beef they had never been given, as long as four kilos happened to be
 * in the room -- which turned a return into a way of moving stock sideways with
 * a reason code on it.
 *
 * Summed by item rather than by line: nothing stops a request carrying the same
 * item twice, and two half-returned lines of the same thing is a distinction
 * with no meaning on the shelf.
 */
export async function issueReturnableLines(
    issueId: string,
    locationId: number
): Promise<{
    sectionId: number;
    status: string;
    /** Days since the stock was released. Null while nothing has been. */
    daysSinceReleased: number | null;
    /** False once the window has closed. */
    withinWindow: boolean;
    lines: IssueReturnableLine[];
}> {
    const issue = await db
        .selectFrom('issues')
        .select((eb) => [
            'id',
            'status',
            'to_section_id as sectionId',
            eb.fn<number | null>('date_part', [
                sql.lit('day'),
                sql`current_timestamp - coalesce(issues.issued_at, issues.requested_at)`
            ]).as('daysSinceReleased')
        ])
        .where('id', '=', issueId)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!issue) throw notFound('That request');

    const days = issue.daysSinceReleased === null ? null : Number(issue.daysSinceReleased);
    const withinWindow = days === null ? false : days <= RETURN_WINDOW_DAYS;

    const { rows } = await sql<IssueReturnableLine>`
        select
          i.id                                      as "itemId",
          i.code,
          i.name,
          i.stock_unit                              as "stockUnit",
          sum(l.qty_issued)                         as "qtyIssued",
          coalesce(r.returned, 0)                   as "qtyReturned",
          coalesce(cs.qty_base, 0)                  as "qtyHeld",
          least(
            sum(l.qty_issued) - coalesce(r.returned, 0),
            coalesce(cs.qty_base, 0)
          )                                         as "qtyReturnable"
        from issue_lines l
        join items i on i.id = l.item_id
        left join (
          select sr.item_id, sum(sr.qty_base) as returned
          from section_returns sr
          where sr.issue_id = ${issueId}
          group by sr.item_id
        ) r on r.item_id = i.id
        left join current_stock cs
          on cs.item_id = i.id and cs.section_id = ${issue.sectionId}
        where l.issue_id = ${issueId}
          and l.qty_issued is not null
          and l.qty_issued > 0
        group by i.id, i.code, i.name, i.stock_unit, r.returned, cs.qty_base
        order by i.name
    `.execute(db);

    return {
        sectionId: issue.sectionId,
        status: issue.status,
        daysSinceReleased: days,
        withinWindow,
        lines: rows.map((r) => ({
            ...r,
            qtyIssued: Number(r.qtyIssued),
            qtyReturned: Number(r.qtyReturned),
            qtyHeld: Number(r.qtyHeld),
            // Nothing is returnable once the window has closed, whatever the
            // shelf happens to hold.
            qtyReturnable: withinWindow ? Math.max(0, Number(r.qtyReturnable)) : 0
        }))
    };
}

export async function returnToStore(
    input: SectionReturnInput
): Promise<{ id: string; businessDate: string; toSectionId: number }> {
    if (input.qtyBase <= 0) throw badRequest('Returned quantity must be more than zero');
    await assertReturnReason(input.reasonCode);

    const from = await db
        .selectFrom('sections')
        .select(['id', 'name', 'is_active', 'is_store'])
        .where('id', '=', input.fromSectionId)
        .where('location_id', '=', input.locationId)
        .executeTakeFirst();
    if (!from) throw notFound(`Section ${input.fromSectionId}`);

    const quarantineId = await quarantineSectionFor(input.locationId);
    if (quarantineId === input.fromSectionId) {
        throw badRequest('Stock in quarantine is already back. Send it to the supplier instead.');
    }

    /**
     * Everywhere except the store, a return is measured against the request
     * that delivered the goods.
     *
     * The store is the exception because nothing issues stock *to* the store --
     * it arrives on a delivery, so there is no request to name. Its returns are
     * constrained further down the line instead: a supplier return has to point
     * at a GRN line and at stock that is physically in quarantine.
     */
    if (!from.is_store) {
        if (!input.issueId) {
            throw badRequest(
                'Say which request this came from. Stock is returned against the release ' +
                    'that delivered it, so what can go back is what was actually given to you.'
            );
        }

        const source = await issueReturnableLines(input.issueId, input.locationId);

        if (source.sectionId !== input.fromSectionId) {
            throw badRequest('That request was not released to this section');
        }
        if (source.status !== 'released' && source.status !== 'received') {
            throw badRequest(
                `Nothing has been released on that request yet - it is ${source.status}.`
            );
        }

        if (!source.withinWindow) {
            throw badRequest(
                `That release was ${source.daysSinceReleased} days ago, and returns close after ` +
                    `${RETURN_WINDOW_DAYS}. After that nobody can say the goods on the shelf are ` +
                    'the ones that came in on it. Log it as wastage, or let the next stock count ' +
                    'find it.'
            );
        }

        const line = source.lines.find((l) => l.itemId === input.itemId);
        if (!line) {
            throw badRequest('That item was not on this request');
        }
        if (input.qtyBase > line.qtyReturnable) {
            // Said with the arithmetic in it, because "cannot return that" with
            // no numbers sends people to the storekeeper to ask why.
            throw badRequest(
                `${line.name}: ${line.qtyIssued} ${line.stockUnit} was released on this ` +
                    `request` +
                    (line.qtyReturned > 0
                        ? ` and ${line.qtyReturned} has already gone back`
                        : '') +
                    `, and the section holds ${line.qtyHeld}. ` +
                    `At most ${line.qtyReturnable} can be returned.`
            );
        }
    }

    return db.transaction().execute(async (trx) => {
        const held = await heldBy(trx, input.fromSectionId, input.itemId);
        if (held < input.qtyBase) {
            throw badRequest(
                `${from.name} holds ${held}, so ${input.qtyBase} cannot be returned. ` +
                    'Return what is there, or check the section.'
            );
        }

        const businessDate = await businessDateFor(trx, input.locationId);

        const row = await trx
            .insertInto('section_returns')
            .values({
                location_id: input.locationId,
                from_section_id: input.fromSectionId,
                to_section_id: quarantineId,
                item_id: input.itemId,
                qty_base: input.qtyBase,
                reason_code: input.reasonCode,
                note: input.note ?? null,
                photo_url: input.photoUrl ?? null,
                issue_id: input.issueId ?? null,
                returned_by: input.returnedBy,
                is_demo: false
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        // Both legs in one document, so the movement is a transfer between two
        // sections and the ledger never sees stock appear from nowhere.
        await postDocument(trx, {
            doc: 'return',
            docId: row.id,
            locationId: input.locationId,
            businessDate,
            lines: [
                {
                    sectionId: input.fromSectionId,
                    itemId: input.itemId,
                    qtyBase: -input.qtyBase,
                    reasonCode: input.reasonCode,
                    note: input.note ?? null
                },
                {
                    sectionId: quarantineId,
                    itemId: input.itemId,
                    qtyBase: input.qtyBase,
                    reasonCode: input.reasonCode,
                    note: input.note ?? null
                }
            ],
            createdBy: input.returnedBy
        });

        /**
         * Handing stock back is an acknowledgement that it arrived.
         *
         * You cannot send back what never came, so a return on a release that
         * has not been confirmed confirms it -- by the person doing the
         * returning, which is the truthful signature. Before this, a request
         * whose whole contents had gone back still sat under "Needs me" asking
         * the chef to confirm the arrival of goods that were already on their
         * way to the supplier.
         */
        if (input.issueId) {
            await trx
                .updateTable('issues')
                .set({
                    status: 'received',
                    received_by: input.returnedBy,
                    received_at: new Date()
                })
                .where('id', '=', input.issueId)
                .where('status', '=', 'released')
                .execute();
        }

        await audit(trx, {
            userId: input.returnedBy,
            action: 'return.section',
            entity: 'section_returns',
            entityId: row.id,
            after: {
                fromSectionId: input.fromSectionId,
                itemId: input.itemId,
                qtyBase: input.qtyBase,
                reasonCode: input.reasonCode
            }
        });

        return { id: String(row.id), businessDate, toSectionId: quarantineId };
    });
}

/*
 * The separate hand-back approval was withdrawn by CR-006.
 *
 * It approved something that had already happened -- the stock moved when the
 * section handed the goods over -- and blocked nothing while it sat unapproved,
 * so in practice it was a stamp. What management now decides instead is what
 * actually becomes of the goods: claimed from the supplier, or binned. That is
 * a real decision about real money, and it is the only approval in the chain.
 *
 * `section_returns.approved_by` stays on the table and stays readable. Sixty
 * days of demo data carry it, and dropping a column to tidy up a concept is
 * how you lose the record of who agreed to what last month.
 */

// ── What can still go back ──────────────────────────────────────────────────

export interface ReturnableLine {
    grnLineId: string;
    itemId: number;
    itemCode: string;
    itemName: string;
    stockUnit: string;
    packId: number;
    packName: string;
    qtyInStockUnit: number;
    packPrice: number;
    qtyPacksDelivered: number;
    qtyPacksReturned: number;
    qtyPacksReturnable: number;
    /** What quarantine actually holds of this item, in stock units. */
    qtyInQuarantine: number;
}

/**
 * The lines of one delivery, with how much of each can still go back.
 *
 * Returnable is delivered minus everything already returned against that line,
 * counted from the return lines themselves rather than a stored total. A column
 * that has to be kept in step with the rows beneath it eventually is not.
 *
 * Returns that were rejected do not count against the balance -- the goods
 * never went anywhere -- so only live statuses are subtracted.
 */
export async function returnableLines(
    grnId: string,
    locationId: number
): Promise<ReturnableLine[]> {
    const grn = await db
        .selectFrom('grn')
        .select(['id', 'location_id'])
        .where('id', '=', grnId)
        .executeTakeFirst();
    if (!grn) throw notFound(`Delivery ${grnId}`);
    if (grn.location_id !== locationId) throw notFound(`Delivery ${grnId}`);

    const quarantineId = await quarantineSectionFor(locationId);

    const { rows } = await sql<ReturnableLine>`
        select
          gl.id                                      as "grnLineId",
          i.id                                       as "itemId",
          i.code                                     as "itemCode",
          i.name                                     as "itemName",
          i.stock_unit                               as "stockUnit",
          p.id                                       as "packId",
          p.pack_name                                as "packName",
          p.qty_in_stock_unit                        as "qtyInStockUnit",
          gl.pack_price                              as "packPrice",
          gl.qty_packs                               as "qtyPacksDelivered",
          coalesce(r.returned, 0)                    as "qtyPacksReturned",
          gl.qty_packs - coalesce(r.returned, 0)     as "qtyPacksReturnable",
          coalesce(cs.qty_base, 0)                   as "qtyInQuarantine"
        from grn_lines gl
        join item_packs p on p.id = gl.item_pack_id
        join items i      on i.id = p.item_id
        left join (
          select srl.grn_line_id, sum(srl.qty_packs) as returned
          from supplier_return_lines srl
          join supplier_returns sr on sr.id = srl.return_id
          where sr.status <> 'rejected'
          group by srl.grn_line_id
        ) r on r.grn_line_id = gl.id
        left join current_stock cs
          on cs.item_id = i.id and cs.section_id = ${quarantineId}
        where gl.grn_id = ${grnId}
        order by i.name
    `.execute(db);

    return rows.map((r) => ({
        ...r,
        qtyInStockUnit: Number(r.qtyInStockUnit),
        packPrice: Number(r.packPrice),
        qtyPacksDelivered: Number(r.qtyPacksDelivered),
        qtyPacksReturned: Number(r.qtyPacksReturned),
        qtyPacksReturnable: Number(r.qtyPacksReturnable),
        qtyInQuarantine: Number(r.qtyInQuarantine)
    }));
}

/**
 * What is on the quarantine shelf, and how much of it is already spoken for.
 *
 * The Returns screen was reading plain stock for this, which tells you what is
 * physically there and nothing about whether anybody is already dealing with
 * it. So a crate that had been asked about -- and was sitting on Supplier
 * returns awaiting a decision -- still showed here under "waiting to go back",
 * with a button inviting the storekeeper to ask about it a second time. The
 * button led to a screen that then, correctly, offered them nothing.
 *
 * `qtyOnOpenAsk` is the part already on an ask nobody has carried out yet;
 * `qtyFree` is what is genuinely still to be dealt with. The same subtraction
 * the suggestion list makes, exposed so the two screens cannot disagree.
 */
export interface QuarantineRow {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    qtyBase: number;
    value: number;
    /** Already on an ask that has not been sent or binned yet. */
    qtyOnOpenAsk: number;
    /** Still to be asked about. */
    qtyFree: number;
}

export async function quarantineContents(locationId: number): Promise<QuarantineRow[]> {
    const quarantineId = await quarantineSectionFor(locationId);

    const { rows } = await sql<QuarantineRow>`
        with claimed as (
          select srl.item_id, sum(srl.qty_base) as qty
          from supplier_return_lines srl
          join supplier_returns sr on sr.id = srl.return_id
          where sr.location_id = ${locationId}
            and sr.status in ('raised', 'approved')
            and srl.wastage_id is null
          group by srl.item_id
        )
        select
          i.id                                        as "itemId",
          i.code,
          i.name,
          i.stock_unit                                as "stockUnit",
          cs.qty_base                                 as "qtyBase",
          cs.value,
          least(coalesce(c.qty, 0), cs.qty_base)      as "qtyOnOpenAsk",
          greatest(cs.qty_base - coalesce(c.qty, 0), 0) as "qtyFree"
        from current_stock_valued cs
        join items i on i.id = cs.item_id
        left join claimed c on c.item_id = cs.item_id
        where cs.section_id = ${quarantineId}
          and cs.qty_base > 0
        order by i.name
    `.execute(db);

    return rows.map((r) => ({
        ...r,
        qtyBase: Number(r.qtyBase),
        value: Number(r.value),
        qtyOnOpenAsk: Number(r.qtyOnOpenAsk),
        qtyFree: Number(r.qtyFree)
    }));
}

// ── What is in quarantine, and the delivery it should go back on ────────────

export interface SuggestedReturnLine {
    grnLineId: string;
    itemId: number;
    itemCode: string;
    itemName: string;
    stockUnit: string;
    packName: string;
    qtyInStockUnit: number;
    packPrice: number;
    /** In quarantine now, in stock units. */
    qtyInQuarantine: number;
    /** Still returnable on that delivery line, in packs. */
    qtyPacksReturnable: number;
    /** What to put in the box: the quarantine balance, capped by the line. */
    suggestedPacks: number;
    suggestedCredit: number;
}

export interface SuggestedReturn {
    grnId: string;
    invoiceNo: string | null;
    receivedAt: string;
    supplierId: number;
    supplierName: string;
    /** Carried from the return that put the goods in quarantine. */
    reasonCode: string | null;
    reasonLabel: string | null;
    lines: SuggestedReturnLine[];
    totalCredit: number;
}

/**
 * Everything in quarantine, grouped by the delivery it should go back on.
 *
 * The storekeeper pressed "send it back to the supplier" and then had to type
 * the whole thing in again: which delivery, which reason, how many packs -- all
 * of it already known to the system, and none of it offered. This is the answer
 * to that: the form arrives filled in and they read it rather than rebuild it.
 *
 * **The delivery is a best guess, and has to stay editable.** Nothing in the
 * ledger links a crate in quarantine to the invoice it arrived on: goods come
 * in on a GRN, are issued to a section, and come back. The chain is by item and
 * quantity, not by identity. So the guess is the most recent delivery of that
 * item which still has returnable packs on it, which is right nearly always and
 * wrong when the same item came twice in a week. The screen says it is a
 * suggestion and lets it be changed.
 *
 * The reason comes from the section return that put the goods there, because
 * the chef who opened the box is the one who knows what was wrong with it.
 */
export async function suggestedSupplierReturns(
    locationId: number
): Promise<SuggestedReturn[]> {
    const quarantineId = await quarantineSectionFor(locationId);

    const { rows } = await sql<{
        grnId: string;
        invoiceNo: string | null;
        receivedAt: string;
        supplierId: number;
        supplierName: string;
        reasonCode: string | null;
        reasonLabel: string | null;
        grnLineId: string;
        itemId: number;
        itemCode: string;
        itemName: string;
        stockUnit: string;
        packName: string;
        qtyInStockUnit: number;
        packPrice: number;
        qtyInQuarantine: number;
        qtyPacksReturnable: number;
    }>`
        with
        -- Quarantine stock already spoken for by an ask nobody has carried out
        -- yet.
        --
        -- Raising an ask moves no stock: the crate stays on the quarantine
        -- shelf until it is sent or binned, which is the whole point of the
        -- design. But that means current_stock still shows it, so without this
        -- the same crate is suggested again the moment it has been asked
        -- about -- and the storekeeper raises the same claim twice against the
        -- same goods.
        --
        -- A line that has been binned has left already (wastage_id is set),
        -- and a sent or settled return has left too, so neither is subtracted
        -- twice.
        claimed as (
          select srl.item_id, sum(srl.qty_base) as qty
          from supplier_return_lines srl
          join supplier_returns sr on sr.id = srl.return_id
          where sr.location_id = ${locationId}
            and sr.status in ('raised', 'approved')
            and srl.wastage_id is null
          group by srl.item_id
        ),
        held as (
          select cs.item_id,
                 cs.qty_base - coalesce(c.qty, 0) as qty_base
          from current_stock cs
          left join claimed c on c.item_id = cs.item_id
          where cs.section_id = ${quarantineId}
            and cs.qty_base - coalesce(c.qty, 0) > 0
        ),
        -- Packs already sent back against each delivery line. A rejected
        -- return never left, so it does not count.
        gone as (
          select srl.grn_line_id, sum(srl.qty_packs) as packs
          from supplier_return_lines srl
          join supplier_returns sr on sr.id = srl.return_id
          where sr.status <> 'rejected'
          group by srl.grn_line_id
        ),
        -- Why it came back, from the most recent return of that item.
        why as (
          select distinct on (sr.item_id)
                 sr.item_id, sr.reason_code, rc.label
          from section_returns sr
          join reason_codes rc on rc.code = sr.reason_code
          where sr.location_id = ${locationId}
          order by sr.item_id, sr.returned_at desc
        ),
        candidate as (
          select
            g.id                                        as "grnId",
            g.invoice_no                                as "invoiceNo",
            g.received_at                               as "receivedAt",
            sup.id                                      as "supplierId",
            sup.name                                    as "supplierName",
            w.reason_code                               as "reasonCode",
            w.label                                     as "reasonLabel",
            gl.id                                       as "grnLineId",
            i.id                                        as "itemId",
            i.code                                      as "itemCode",
            i.name                                      as "itemName",
            i.stock_unit                                as "stockUnit",
            p.pack_name                                 as "packName",
            p.qty_in_stock_unit                         as "qtyInStockUnit",
            gl.pack_price                               as "packPrice",
            h.qty_base                                  as "qtyInQuarantine",
            gl.qty_packs - coalesce(gn.packs, 0)        as "qtyPacksReturnable",
            row_number() over (
              partition by h.item_id
              order by g.received_at desc, gl.id desc
            )                                           as rn
          from held h
          join items i       on i.id = h.item_id
          join item_packs p  on p.item_id = h.item_id
          join grn_lines gl  on gl.item_pack_id = p.id
          join grn g         on g.id = gl.grn_id
          join suppliers sup on sup.id = g.supplier_id
          left join gone gn  on gn.grn_line_id = gl.id
          left join why w    on w.item_id = h.item_id
          where g.location_id = ${locationId}
            and gl.qty_packs - coalesce(gn.packs, 0) > 0
        )
        select * from candidate where rn = 1
        order by "receivedAt" desc, "itemName"
    `.execute(db);

    const byGrn = new Map<string, SuggestedReturn>();

    for (const r of rows) {
        const key = String(r.grnId);
        let group = byGrn.get(key);
        if (!group) {
            group = {
                grnId: key,
                invoiceNo: r.invoiceNo,
                receivedAt: new Date(r.receivedAt as unknown as string).toISOString(),
                supplierId: r.supplierId,
                supplierName: r.supplierName,
                reasonCode: r.reasonCode,
                reasonLabel: r.reasonLabel,
                lines: [],
                totalCredit: 0
            };
            byGrn.set(key, group);
        }

        const packSize = Number(r.qtyInStockUnit);
        const held = Number(r.qtyInQuarantine);
        const returnable = Number(r.qtyPacksReturnable);
        const packPrice = Number(r.packPrice);

        /**
         * Rounded DOWN, to the three decimals the column holds.
         *
         * Rounding to the nearest was the obvious thing and it was wrong: 2,148
         * g of a 1 kg pack is 2.148 packs, which rounds to 2.15, which is 2,150
         * g -- two grams more than exists. The service refused it, correctly,
         * and the storekeeper got an error on a form they had not filled in.
         *
         * A suggestion that cannot be submitted is worse than no suggestion, so
         * it floors: never more than is on the shelf, and never more than the
         * delivery line still allows.
         */
        const suggested = packSize > 0
            ? Math.min(Math.floor((held / packSize) * 1000) / 1000, returnable)
            : 0;
        if (suggested <= 0) continue;

        const credit = Number((suggested * packPrice).toFixed(2));
        group.lines.push({
            grnLineId: String(r.grnLineId),
            itemId: r.itemId,
            itemCode: r.itemCode,
            itemName: r.itemName,
            stockUnit: r.stockUnit,
            packName: r.packName,
            qtyInStockUnit: packSize,
            packPrice,
            qtyInQuarantine: held,
            qtyPacksReturnable: returnable,
            suggestedPacks: suggested,
            suggestedCredit: credit
        });
        group.totalCredit = Number((group.totalCredit + credit).toFixed(2));
    }

    // A delivery whose every line rounded away to nothing is not a suggestion.
    return [...byGrn.values()].filter((g) => g.lines.length > 0);
}

// ── Supplier return ─────────────────────────────────────────────────────────

export interface SupplierReturnLineInput {
    grnLineId: string;
    qtyPacks: number;
    sectionReturnId?: string | null;
}

export interface SupplierReturnInput {
    locationId: number;
    grnId: string;
    reasonCode: string;
    note?: string | null;
    lines: SupplierReturnLineInput[];
    raisedBy: number;
}

export interface SupplierReturnResult {
    id: string;
    supplierId: number;
    lineCount: number;
    creditValue: number;
}

export async function raiseSupplierReturn(
    input: SupplierReturnInput
): Promise<SupplierReturnResult> {
    if (input.lines.length === 0) throw badRequest('A return needs at least one line');
    await assertReturnReason(input.reasonCode);

    const grn = await db
        .selectFrom('grn')
        .select(['id', 'supplier_id', 'location_id'])
        .where('id', '=', input.grnId)
        .executeTakeFirst();
    if (!grn) throw notFound(`Delivery ${input.grnId}`);
    if (grn.location_id !== input.locationId) throw notFound(`Delivery ${input.grnId}`);

    const returnable = await returnableLines(input.grnId, input.locationId);
    const byLine = new Map(returnable.map((l) => [String(l.grnLineId), l]));

    return db.transaction().execute(async (trx) => {
        const header = await trx
            .insertInto('supplier_returns')
            .values({
                location_id: input.locationId,
                supplier_id: grn.supplier_id,
                grn_id: input.grnId,
                status: 'raised',
                reason_code: input.reasonCode,
                note: input.note ?? null,
                raised_by: input.raisedBy,
                is_demo: false
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        let creditValue = 0;

        for (const line of input.lines) {
            const source = byLine.get(String(line.grnLineId));
            if (!source) {
                throw badRequest('That line is not on this delivery');
            }
            if (line.qtyPacks <= 0) {
                throw badRequest(`${source.itemName}: return quantity must be more than zero`);
            }
            if (line.qtyPacks > source.qtyPacksReturnable) {
                throw badRequest(
                    `${source.itemName}: only ${source.qtyPacksReturnable} of ` +
                        `${source.qtyPacksDelivered} packs are still returnable on this delivery.`
                );
            }

            // Packs convert once, here, exactly as they do on the way in.
            const qtyBase = line.qtyPacks * source.qtyInStockUnit;
            // A thousandth of a stock unit of tolerance, because this is a
            // product of two decimals compared against a third and binary
            // floating point does not land exactly. The column holds three
            // decimals, so anything finer than that is not a real quantity.
            if (qtyBase > source.qtyInQuarantine + 0.001) {
                throw badRequest(
                    `${source.itemName}: quarantine holds ${source.qtyInQuarantine} ` +
                        `${source.stockUnit}, which is less than the ${qtyBase} being sent back. ` +
                        'The goods have to be in quarantine before they can go to the supplier.'
                );
            }

            const lineCredit = Number((line.qtyPacks * source.packPrice).toFixed(2));
            creditValue += lineCredit;

            await trx
                .insertInto('supplier_return_lines')
                .values({
                    return_id: header.id,
                    grn_line_id: line.grnLineId,
                    item_id: source.itemId,
                    qty_packs: line.qtyPacks,
                    qty_base: qtyBase,
                    pack_price: source.packPrice,
                    line_credit: lineCredit,
                    section_return_id: line.sectionReturnId ?? null,
                    is_demo: false
                })
                .execute();
        }

        await audit(trx, {
            userId: input.raisedBy,
            action: 'return.supplier.raise',
            entity: 'supplier_returns',
            entityId: header.id,
            after: { grnId: input.grnId, lines: input.lines.length, creditValue }
        });

        return {
            id: String(header.id),
            supplierId: grn.supplier_id,
            lineCount: input.lines.length,
            creditValue: Number(creditValue.toFixed(2))
        };
    });
}

export interface DisposalDecisionInput {
    /** One answer per line on the ask. Every line has to get one. */
    lines: { lineId: string; decision: DisposalDecision }[];
    note?: string | null;
}

export interface DisposalDecisionResult {
    id: string;
    toVendor: number;
    toWaste: number;
    /** What is still being claimed, once the binned lines are taken out. */
    creditValue: number;
}

/**
 * Management answers the store's question, line by line.
 *
 * This is the only approval in the chain. Answering it accepts the hand-back
 * that put the goods in quarantine as well -- there is no separate stamp for
 * that any more -- so the reason and the note the section wrote are shown on
 * the ask rather than being buried on a document nobody opens.
 *
 * **Every line must be answered.** A half-decided ask is how stock ends up
 * sitting in quarantine for a month: nobody is refusing it, nobody is claiming
 * it, and nothing is on anybody's list. Partial answers are refused and the
 * message names the lines that were missed.
 */
export async function decideDisposal(
    id: string,
    locationId: number,
    input: DisposalDecisionInput,
    decidedBy: number
): Promise<DisposalDecisionResult> {
    const header = await db
        .selectFrom('supplier_returns')
        .select(['id', 'status', 'raised_by'])
        .where('id', '=', id)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!header) throw notFound(`Return ${id}`);
    if (header.status !== 'raised') {
        throw conflict(`This has already been decided - it is ${header.status}`);
    }
    // A second check is only worth anything if it is a second person.
    if (header.raised_by === decidedBy) {
        throw conflict('You cannot decide an ask you raised yourself');
    }

    const lines = await db
        .selectFrom('supplier_return_lines')
        .select(['id', 'line_credit'])
        .where('return_id', '=', id)
        .execute();
    if (lines.length === 0) throw badRequest('This ask has no lines');

    const answers = new Map(input.lines.map((l) => [String(l.lineId), l.decision]));
    const missed = lines.filter((l) => !answers.has(String(l.id)));
    if (missed.length > 0) {
        throw badRequest(
            `${missed.length} line(s) have no answer. Every line has to go somewhere - ` +
                'back to the supplier, or in the bin.'
        );
    }

    let toVendor = 0;
    let toWaste = 0;
    let creditValue = 0;
    for (const line of lines) {
        if (answers.get(String(line.id)) === 'vendor') {
            toVendor++;
            creditValue += Number(line.line_credit);
        } else {
            toWaste++;
        }
    }

    return db.transaction().execute(async (trx) => {
        for (const line of lines) {
            await trx
                .updateTable('supplier_return_lines')
                .set({ decision: answers.get(String(line.id))! })
                .where('id', '=', line.id)
                .execute();
        }

        await trx
            .updateTable('supplier_returns')
            .set({
                status: 'approved',
                decided_by: decidedBy,
                decision_note: input.note ?? null,
                decided_at: new Date()
            })
            .where('id', '=', id)
            .execute();

        await audit(trx, {
            userId: decidedBy,
            action: 'return.disposal.decide',
            entity: 'supplier_returns',
            entityId: id,
            after: { toVendor, toWaste, creditValue, note: input.note ?? null }
        });

        return { id: String(id), toVendor, toWaste, creditValue };
    });
}

/**
 * The store bins the lines management said to bin. One button.
 *
 * Posts a real wastage document per line, from quarantine, under a reason that
 * says what actually happened -- the goods were bad and nobody would take them
 * back. That puts the write-off in the wastage report, where the question "what
 * did we throw away" is asked, and keeps it out of the unexplained-loss report,
 * where it would read as theft.
 *
 * Idempotent line by line: a line that already carries a wastage document is
 * skipped, so a double tap on a slow connection bins the crate once.
 */
export async function binDecidedLines(
    id: string,
    locationId: number,
    binnedBy: number
): Promise<{ id: string; binned: number; alreadyBinned: number; qtyBase: number }> {
    const header = await db
        .selectFrom('supplier_returns')
        .select(['id', 'status', 'reason_code', 'note'])
        .where('id', '=', id)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!header) throw notFound(`Return ${id}`);
    if (header.status === 'raised') {
        throw conflict('Management has not decided this yet');
    }
    if (header.status === 'rejected') {
        throw conflict('This was rejected, so there is nothing to bin');
    }

    const lines = await db
        .selectFrom('supplier_return_lines')
        .select(['id', 'item_id', 'qty_base', 'wastage_id'])
        .where('return_id', '=', id)
        .where('decision', '=', 'waste')
        .execute();

    if (lines.length === 0) {
        throw badRequest('Nothing on this was marked for the bin');
    }

    const todo = lines.filter((l) => l.wastage_id === null);
    const alreadyBinned = lines.length - todo.length;
    if (todo.length === 0) {
        return { id: String(id), binned: 0, alreadyBinned, qtyBase: 0 };
    }

    const quarantineId = await quarantineSectionFor(locationId);

    // The section return's own reason -- "below the quality agreed" -- says why
    // the goods were bad. The wastage reason says why they were binned rather
    // than claimed, which is a different fact and the one the waste report is
    // grouped by.
    const reasonNote = header.note?.trim()
        ? `Written off after a disposal decision. ${header.note.trim()}`
        : 'Written off after a disposal decision: not taken back by the supplier.';

    let qtyBase = 0;

    await db.transaction().execute(async (trx) => {
        const businessDate = await businessDateFor(trx, locationId);

        for (const line of todo) {
            const held = await heldBy(trx, quarantineId, line.item_id);
            if (held < Number(line.qty_base)) {
                throw badRequest(
                    `Quarantine holds ${held} of one of these items, which is less than the ` +
                        `${line.qty_base} on the line. Something has moved since this was raised.`
                );
            }

            const waste = await trx
                .insertInto('wastage')
                .values({
                    location_id: locationId,
                    section_id: quarantineId,
                    item_id: line.item_id,
                    qty_base: Number(line.qty_base),
                    reason_code: WRITE_OFF_REASON,
                    logged_by: binnedBy,
                    is_demo: false
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            await postDocument(trx, {
                doc: 'wastage',
                docId: waste.id,
                locationId,
                businessDate,
                lines: [
                    {
                        sectionId: quarantineId,
                        itemId: line.item_id,
                        qtyBase: -Number(line.qty_base),
                        reasonCode: WRITE_OFF_REASON,
                        note: reasonNote
                    }
                ],
                createdBy: binnedBy
            });

            await trx
                .updateTable('supplier_return_lines')
                .set({ wastage_id: waste.id })
                .where('id', '=', line.id)
                .execute();

            qtyBase += Number(line.qty_base);
        }

        await settleIfFinished(trx, id, binnedBy);

        await audit(trx, {
            userId: binnedBy,
            action: 'return.disposal.bin',
            entity: 'supplier_returns',
            entityId: id,
            after: { lines: todo.length, qtyBase }
        });
    });

    return { id: String(id), binned: todo.length, alreadyBinned, qtyBase };
}

/**
 * Close the ask when nothing is left to do on it.
 *
 * An ask that was binned in full has no vendor lines and so will never be sent
 * or settled against a credit note -- leaving it open would put it on the
 * store's list forever. One where some lines went to the supplier stays open
 * until that half is sent and settled, because the money is still outstanding.
 */
async function settleIfFinished(trx: Tx, id: string, by: number): Promise<void> {
    const lines = await trx
        .selectFrom('supplier_return_lines')
        .select(['decision', 'wastage_id'])
        .where('return_id', '=', id)
        .execute();

    const anyVendor = lines.some((l) => l.decision === 'vendor');
    const allBinned = lines
        .filter((l) => l.decision === 'waste')
        .every((l) => l.wastage_id !== null);

    if (anyVendor || !allBinned) return;

    await trx
        .updateTable('supplier_returns')
        .set({
            status: 'settled',
            outcome: 'written_off',
            settled_by: by,
            settled_at: new Date(),
            settle_note: 'Binned in full - nothing was claimed from the supplier'
        })
        .where('id', '=', id)
        .execute();
}

/**
 * The goods have gone. This is the only place a supplier return writes stock.
 *
 * Everything before this is paperwork: while a return sits at raised or
 * approved the crate is still in quarantine and still ours, and the stock
 * figure should say so.
 */
export async function sendSupplierReturn(
    id: string,
    locationId: number,
    sentBy: number
): Promise<{ id: string; businessDate: string; rowsPosted: number }> {
    const header = await db
        .selectFrom('supplier_returns')
        .select(['id', 'status', 'reason_code'])
        .where('id', '=', id)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!header) throw notFound(`Supplier return ${id}`);
    if (header.status === 'raised') {
        throw conflict('Management has not decided this yet');
    }
    if (header.status !== 'approved') {
        throw conflict(`A return that is ${header.status} cannot be sent`);
    }

    // Only what management said to claim. Lines they marked for the bin never
    // go on the lorry -- they are binned here, by the store, and leave
    // quarantine as wastage instead.
    const lines = await db
        .selectFrom('supplier_return_lines')
        .select(['item_id', 'qty_base'])
        .where('return_id', '=', id)
        .where('decision', '=', 'vendor')
        .execute();
    if (lines.length === 0) {
        throw badRequest(
            'Nothing on this is going back to the supplier - every line was marked for the ' +
                'bin. Use "Bin them" instead.'
        );
    }

    const quarantineId = await quarantineSectionFor(locationId);

    return db.transaction().execute(async (trx) => {
        const businessDate = await businessDateFor(trx, locationId);

        for (const line of lines) {
            const held = await heldBy(trx, quarantineId, line.item_id);
            if (held < Number(line.qty_base)) {
                throw badRequest(
                    `Quarantine holds ${held} of one of these items, which is less than the ` +
                        `${line.qty_base} on the return. Something has moved since it was raised.`
                );
            }
        }

        await postDocument(trx, {
            doc: 'return',
            docId: id,
            locationId,
            businessDate,
            lines: lines.map((l, i) => ({
                sectionId: quarantineId,
                itemId: l.item_id,
                qtyBase: -Number(l.qty_base),
                docLine: i + 1,
                reasonCode: header.reason_code
            })),
            createdBy: sentBy
        });

        await trx
            .updateTable('supplier_returns')
            .set({ status: 'sent', sent_by: sentBy, sent_at: new Date() })
            .where('id', '=', id)
            .execute();

        await audit(trx, {
            userId: sentBy,
            action: 'return.supplier.send',
            entity: 'supplier_returns',
            entityId: id,
            after: { lines: lines.length }
        });

        return { id: String(id), businessDate, rowsPosted: lines.length };
    });
}

export interface SettleInput {
    outcome: SupplierReturnOutcome;
    creditNoteNo?: string | null;
    creditValue?: number | null;
    note?: string | null;
}

/**
 * What the supplier did about it, recorded weeks after the goods went.
 *
 * A credit needs its note number and its value, because the point of recording
 * it is being able to check it against the statement. A replacement and a
 * write-off need neither -- one arrives as an ordinary delivery, the other is
 * money nobody is getting back.
 */
export async function settleSupplierReturn(
    id: string,
    locationId: number,
    input: SettleInput,
    settledBy: number
): Promise<void> {
    const row = await db
        .selectFrom('supplier_returns')
        .select(['id', 'status'])
        .where('id', '=', id)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
    if (!row) throw notFound(`Supplier return ${id}`);
    if (row.status === 'settled') throw conflict('This return is already settled');
    if (row.status !== 'sent') {
        throw conflict('A return is settled after it has been sent, not before');
    }

    if (input.outcome === 'credit') {
        if (!input.creditNoteNo?.trim()) {
            throw badRequest('A credit needs its credit note number to be worth recording');
        }
        if (input.creditValue === undefined || input.creditValue === null) {
            throw badRequest('A credit needs the amount the supplier actually allowed');
        }
    }

    await db.transaction().execute(async (trx) => {
        await trx
            .updateTable('supplier_returns')
            .set({
                status: 'settled',
                outcome: input.outcome,
                credit_note_no: input.creditNoteNo ?? null,
                credit_value: input.creditValue ?? null,
                settle_note: input.note ?? null,
                settled_by: settledBy,
                settled_at: new Date()
            })
            .where('id', '=', id)
            .execute();
        await audit(trx, {
            userId: settledBy,
            action: 'return.supplier.settle',
            entity: 'supplier_returns',
            entityId: id,
            after: { outcome: input.outcome, creditValue: input.creditValue }
        });
    });
}
