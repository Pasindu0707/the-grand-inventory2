/**
 * The operating reports.
 *
 * The five in reports.ts all ask the same question from different angles: is
 * the stock figure true? These ask a different one - is the operation working?
 * Orders that nobody chased, sections the store keeps letting down, suppliers
 * who send eight of the ten sacks, money asleep on a shelf. None of it is
 * visible in a stock balance, and all of it costs money.
 *
 * They are deliberately in their own file. A report that measures people is a
 * different kind of thing from a report that measures stock, it gets read by a
 * different person for a different reason, and the two sets have no shared
 * machinery beyond the date range.
 *
 * Every one of them takes a range and honours it, including the two that are
 * really point-in-time questions: valuation is answered as at the end date
 * rather than as at now, and dead stock is measured against movement inside
 * the window. A date box that silently does nothing is worse than no date box.
 */
import { sql } from 'kysely';
import { db } from '../db/index.js';
import type { DateRange } from './reports.js';

// ── F. Purchase orders still out ────────────────────────────────────────────

export interface OpenPoRow {
    id: string;
    status: string;
    supplierName: string | null;
    raisedBy: string;
    raisedAt: string;
    neededBy: string | null;
    lineCount: number;
    /** Days since it was raised. The number that makes a stalled order obvious. */
    daysOpen: number;
    /** Days past the date somebody said they needed it. Zero if not yet due. */
    daysLate: number;
    estimatedValue: number;
    /** Value of what has still not turned up. */
    outstandingValue: number;
}

/**
 * Orders that have not been delivered, closed or rejected.
 *
 * The hole this fills: an order can sit at `requested` for a fortnight because
 * nobody told management it was waiting, and nothing anywhere surfaces it. The
 * status tells you where it is stuck; `daysOpen` tells you how long it has
 * been stuck there, which is the column that actually gets it moved.
 */
export async function openPurchaseOrders(
    locationId: number,
    range: DateRange
): Promise<OpenPoRow[]> {
    const { rows } = await sql<OpenPoRow>`
        select
          po.id::text                                    as id,
          po.status,
          s.name                                         as "supplierName",
          u.name                                         as "raisedBy",
          po.raised_at::text                             as "raisedAt",
          po.needed_by::text                             as "neededBy",
          count(l.id)::int                               as "lineCount",
          (current_date - po.raised_at::date)::int       as "daysOpen",
          greatest(
            0,
            coalesce(current_date - po.needed_by, 0)
          )::int                                         as "daysLate",
          round(coalesce(sum(
            coalesce(l.qty_packs, 0) * coalesce(l.est_price, 0)
          ), 0)::numeric, 2)                             as "estimatedValue",
          -- What is still to come, priced at the estimate. Converted back out
          -- of stock units through the pack, because est_price is per pack.
          round(coalesce(sum(
            greatest(l.qty_base - l.qty_received_base, 0)
              / nullif(p.qty_in_stock_unit, 0)
              * coalesce(l.est_price, 0)
          ), 0)::numeric, 2)                             as "outstandingValue"
        from purchase_orders po
        join users u on u.id = po.raised_by
        left join suppliers s on s.id = po.supplier_id
        left join purchase_order_lines l on l.po_id = po.id
        left join item_packs p on p.id = l.item_pack_id
        where po.location_id = ${locationId}
          and po.status in ('requested', 'approved', 'ordered')
          and po.raised_at::date between ${range.from}::date and ${range.to}::date
        group by po.id, po.status, s.name, u.name, po.raised_at, po.needed_by
        order by (current_date - po.raised_at::date) desc
    `.execute(db);

    return rows.map(numeric);
}

// ── G. Did the store deliver for the sections? ──────────────────────────────

export interface ServiceLevelRow {
    sectionId: number;
    sectionName: string;
    requests: number;
    /** Asks still sitting at "requested" - nobody has released them at all. */
    stillWaiting: number;
    lines: number;
    linesInFull: number;
    linesShort: number;
    /** Share of lines handed over in full. Null when nothing was asked for. */
    fillRatePct: number | null;
    /** Share of the quantity asked for that was actually handed over. */
    qtyFillPct: number | null;
    /** Hours from asking to the store releasing it. Null if none released. */
    avgHoursToRelease: number | null;
}

/**
 * How well the store served each section.
 *
 * Two fill rates, because they answer different arguments. Line fill is the
 * one the kitchen feels - "half the things I asked for came up short". Quantity
 * fill is the one the store defends itself with - "you got 94% of what you
 * asked for". Both are true at once and putting them side by side is the point.
 *
 * Cancelled asks are left out. A request nobody wanted any more is not a
 * failure to serve.
 */
export async function requestServiceLevel(
    locationId: number,
    range: DateRange
): Promise<ServiceLevelRow[]> {
    const { rows } = await sql<ServiceLevelRow>`
        select
          sec.id                                       as "sectionId",
          sec.name                                     as "sectionName",
          count(distinct i.id)::int                    as requests,
          count(distinct i.id) filter (
            where i.status = 'requested'
          )::int                                       as "stillWaiting",
          count(l.id)::int                             as lines,
          count(l.id) filter (
            where coalesce(l.qty_issued, 0) >= l.qty_requested
          )::int                                       as "linesInFull",
          count(l.id) filter (
            where coalesce(l.qty_issued, 0) < l.qty_requested
          )::int                                       as "linesShort",
          round(
            100.0 * count(l.id) filter (
              where coalesce(l.qty_issued, 0) >= l.qty_requested
            ) / nullif(count(l.id), 0)
          , 1)                                         as "fillRatePct",
          round(
            100.0 * sum(coalesce(l.qty_issued, 0)) / nullif(sum(l.qty_requested), 0)
          , 1)                                         as "qtyFillPct",
          round(
            avg(
              extract(epoch from (i.issued_at - i.requested_at)) / 3600.0
            ) filter (where i.issued_at is not null)::numeric
          , 1)                                         as "avgHoursToRelease"
        from issues i
        join sections sec on sec.id = i.to_section_id
        join issue_lines l on l.issue_id = i.id
        where i.location_id = ${locationId}
          and i.status <> 'cancelled'
          and i.requested_at::date between ${range.from}::date and ${range.to}::date
        group by sec.id, sec.name
        order by sec.name
    `.execute(db);

    return rows.map(numeric);
}

// ── H. Suppliers ────────────────────────────────────────────────────────────

export interface SupplierPerformanceRow {
    supplierId: number;
    supplierName: string;
    orders: number;
    deliveries: number;
    /** Share of the ordered quantity that actually arrived. */
    fillRatePct: number | null;
    /** Orders closed after the date they were needed by. */
    lateOrders: number;
    /** Days from raising the order to it closing. Null while none have closed. */
    avgDaysToClose: number | null;
    /** What was actually invoiced in the period. */
    spend: number;
    /** Returns raised against this supplier's deliveries, excluding rejected. */
    returns: number;
    /** What those returns were worth at the price paid. */
    returnedValue: number;
    /** The part of it a credit note has actually been received for. */
    creditedValue: number;
    /** Spend less credits actually allowed. What the supplier really cost. */
    netSpend: number;
    /** Returned value as a share of spend. The number worth sorting on. */
    returnRatePct: number | null;
}

/**
 * Who is worth ordering from.
 *
 * Fill rate comes from the order (ordered against received); spend comes from
 * the deliveries, because that is what was actually invoiced. They are counted
 * separately on purpose - a delivery can arrive with no order behind it, and an
 * order can be placed and never filled, and averaging the two together would
 * hide both.
 *
 * A supplier appears if they were ordered from, delivered, or was returned to
 * in the window.
 *
 * Returns are counted twice over, and the difference between the two numbers is
 * the point: `returnedValue` is what was sent back at the price paid, and
 * `creditedValue` is what a credit note has since been received for. A supplier
 * who agrees to everything and credits nothing shows up as a wide gap between
 * them, which no other report in this system would reveal.
 */
export async function supplierPerformance(
    locationId: number,
    range: DateRange
): Promise<SupplierPerformanceRow[]> {
    const { rows } = await sql<SupplierPerformanceRow>`
        with po_agg as (
          select
            po.supplier_id,
            count(distinct po.id)                       as orders,
            sum(l.qty_base)                             as ordered_base,
            sum(l.qty_received_base)                    as received_base,
            count(distinct po.id) filter (
              where po.closed_at is not null
                and po.needed_by is not null
                and po.closed_at::date > po.needed_by
            )                                           as late_orders,
            avg(po.closed_at::date - po.raised_at::date) filter (
              where po.closed_at is not null
            )                                           as avg_days
          from purchase_orders po
          join purchase_order_lines l on l.po_id = po.id
          where po.location_id = ${locationId}
            and po.supplier_id is not null
            and po.raised_at::date between ${range.from}::date and ${range.to}::date
          group by po.supplier_id
        ),
        grn_agg as (
          select
            g.supplier_id,
            count(distinct g.id)                        as deliveries,
            sum(gl.qty_packs * gl.pack_price)           as spend
          from grn g
          join grn_lines gl on gl.grn_id = g.id
          where g.location_id = ${locationId}
            and g.received_at::date between ${range.from}::date and ${range.to}::date
          group by g.supplier_id
        ),
        -- What went back, and what it was worth. Spend that came back is not
        -- spend, and a supplier whose deliveries keep returning is exactly what
        -- this report exists to make visible. Rejected returns are excluded:
        -- the goods never left.
        return_agg as (
          select
            sr.supplier_id,
            count(*)                                    as returns,
            sum(rl.asked)                               as returned_value,
            -- What the supplier ALLOWED, off the return header -- not the sum
            -- of the lines, which is what was asked for. They differ whenever a
            -- supplier settles short, and that difference is the whole reason
            -- this column exists.
            sum(sr.credit_value) filter (
              where sr.status = 'settled' and sr.outcome = 'credit'
            )                                           as credited_value
          from supplier_returns sr
          -- One row per return, so the header value is not multiplied by the
          -- number of lines under it.
          join lateral (
            select coalesce(sum(l.line_credit), 0) as asked
            from supplier_return_lines l
            where l.return_id = sr.id
          ) rl on true
          where sr.location_id = ${locationId}
            and sr.status <> 'rejected'
            and sr.raised_at::date between ${range.from}::date and ${range.to}::date
          group by sr.supplier_id
        )
        select
          s.id                                          as "supplierId",
          s.name                                        as "supplierName",
          coalesce(p.orders, 0)::int                    as orders,
          coalesce(gr.deliveries, 0)::int               as deliveries,
          round(
            100.0 * p.received_base / nullif(p.ordered_base, 0)
          , 1)                                          as "fillRatePct",
          coalesce(p.late_orders, 0)::int               as "lateOrders",
          round(p.avg_days::numeric, 1)                 as "avgDaysToClose",
          round(coalesce(gr.spend, 0)::numeric, 2)      as spend,
          coalesce(rt.returns, 0)::int                   as returns,
          round(coalesce(rt.returned_value, 0)::numeric, 2) as "returnedValue",
          round(coalesce(rt.credited_value, 0)::numeric, 2) as "creditedValue",
          round(
            (coalesce(gr.spend, 0) - coalesce(rt.credited_value, 0))::numeric
          , 2)                                          as "netSpend",
          round(
            100.0 * rt.returned_value / nullif(gr.spend, 0)
          , 1)                                          as "returnRatePct"
        from suppliers s
        left join po_agg p on p.supplier_id = s.id
        left join grn_agg gr on gr.supplier_id = s.id
        left join return_agg rt on rt.supplier_id = s.id
        where coalesce(p.orders, 0) > 0
           or coalesce(gr.deliveries, 0) > 0
           or coalesce(rt.returns, 0) > 0
        order by coalesce(gr.spend, 0) desc, s.name
    `.execute(db);

    return rows.map(numeric);
}

// ── I. What the stock is worth ──────────────────────────────────────────────

export interface ValuationRow {
    sectionId: number;
    sectionName: string;
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    qtyBase: number;
    avgCost: number;
    value: number;
}

/**
 * Value on hand, as at the end of the range.
 *
 * The balance is rebuilt from the ledger up to the end date, which is the only
 * way to answer "what was it worth on the 31st" after the fact. The cost is not
 * - `item_cost_state` holds one current average per item, so a valuation of a
 * past date prices yesterday's quantity at today's cost. For month-end on a
 * range that ends today, which is what this is for, the two agree. Backdate it
 * far and the number drifts, and the screen says so rather than pretending.
 *
 * Sections with a zero balance are dropped: a list of everything the branch has
 * ever held, mostly reading 0.00, is not a valuation.
 */
export async function stockValuation(
    locationId: number,
    range: DateRange
): Promise<ValuationRow[]> {
    const { rows } = await sql<ValuationRow>`
        with balances as (
          select
            l.section_id,
            l.item_id,
            sum(l.qty_base) as qty_base
          from stock_ledger l
          where l.location_id = ${locationId}
            and l.business_date <= ${range.to}::date
          group by l.section_id, l.item_id
        )
        select
          sec.id                                        as "sectionId",
          sec.name                                      as "sectionName",
          i.id                                          as "itemId",
          i.code,
          i.name,
          i.stock_unit                                  as "stockUnit",
          round(b.qty_base::numeric, 3)                 as "qtyBase",
          -- Four places, not two: a cost per gram or per ml is a fraction of
          -- a rupee, and rounding it to 0.00 next to a value of 1,500.00 reads
          -- as a broken report rather than as a small unit.
          round(coalesce(ics.avg_cost, 0)::numeric, 4)  as "avgCost",
          round((b.qty_base * coalesce(ics.avg_cost, 0))::numeric, 2) as value
        from balances b
        join sections sec on sec.id = b.section_id
        join items i on i.id = b.item_id
        left join item_cost_state ics
          on ics.item_id = b.item_id and ics.location_id = ${locationId}
        where b.qty_base <> 0
        order by sec.name, (b.qty_base * coalesce(ics.avg_cost, 0)) desc
    `.execute(db);

    return rows.map(numeric);
}

// ── J. Money asleep on a shelf ──────────────────────────────────────────────

export interface DeadStockRow {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    sectionName: string;
    qtyBase: number;
    value: number;
    /** Last time anything moved, in or out. Null if it has never moved. */
    lastMovedOn: string | null;
    daysSinceMoved: number | null;
}

/**
 * Stock that is sitting there and nobody is using.
 *
 * Nothing issued out of it in the window, and a balance still on the shelf.
 * Two things at once: cash tied up, and - for anything perishable - a spoilage
 * bill that has not been written yet. The last movement date is what separates
 * "slow" from "forgotten".
 */
export async function deadStock(
    locationId: number,
    range: DateRange
): Promise<DeadStockRow[]> {
    const { rows } = await sql<DeadStockRow>`
        with moved as (
          select distinct l.item_id, l.section_id
          from stock_ledger l
          where l.location_id = ${locationId}
            and l.doc = 'issue'
            and l.qty_base < 0
            and l.business_date between ${range.from}::date and ${range.to}::date
        ),
        last_move as (
          select l.item_id, l.section_id, max(l.business_date) as last_date
          from stock_ledger l
          where l.location_id = ${locationId}
          group by l.item_id, l.section_id
        )
        select
          i.id                                          as "itemId",
          i.code,
          i.name,
          i.stock_unit                                  as "stockUnit",
          sec.name                                      as "sectionName",
          round(cs.qty_base::numeric, 3)                as "qtyBase",
          round((cs.qty_base * coalesce(ics.avg_cost, 0))::numeric, 2) as value,
          lm.last_date::text                            as "lastMovedOn",
          (current_date - lm.last_date)::int            as "daysSinceMoved"
        from current_stock cs
        join sections sec on sec.id = cs.section_id
        join items i on i.id = cs.item_id
        left join item_cost_state ics
          on ics.item_id = cs.item_id and ics.location_id = ${locationId}
        left join last_move lm
          on lm.item_id = cs.item_id and lm.section_id = cs.section_id
        where cs.location_id = ${locationId}
          and cs.qty_base > 0
          and i.is_active
          and not exists (
            select 1 from moved m
            where m.item_id = cs.item_id and m.section_id = cs.section_id
          )
        order by (cs.qty_base * coalesce(ics.avg_cost, 0)) desc
    `.execute(db);

    return rows.map(numeric);
}

// ── K. What each section actually got through ───────────────────────────────

export interface ConsumptionRow {
    sectionId: number;
    sectionName: string;
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    qtyBase: number;
    value: number;
}

/**
 * What each section drew from the store, at what it cost.
 *
 * The positive half of every issue: the store's side is a matching negative and
 * counting both would net to nothing. Valued at the ledger's own `unit_cost`,
 * which is the cost at the moment it moved - not today's average - so a period
 * total does not shift under you when the next delivery lands at a new price.
 *
 * This is the base for section-level food cost. What it is not, yet, is food
 * cost: there is no sales figure in this system to divide it by.
 */
export async function consumptionBySection(
    locationId: number,
    range: DateRange
): Promise<ConsumptionRow[]> {
    const { rows } = await sql<ConsumptionRow>`
        select
          sec.id                                        as "sectionId",
          sec.name                                      as "sectionName",
          i.id                                          as "itemId",
          i.code,
          i.name,
          i.stock_unit                                  as "stockUnit",
          round(sum(l.qty_base)::numeric, 3)            as "qtyBase",
          round(sum(l.qty_base * l.unit_cost)::numeric, 2) as value
        from stock_ledger l
        join sections sec on sec.id = l.section_id
        join items i on i.id = l.item_id
        where l.location_id = ${locationId}
          -- Issued in, less anything handed straight back. A kitchen sent 40 kg
          -- of fish that returned 12 kg consumed 28, and a consumption report
          -- that says 40 is the one the chef stops believing.
          -- Quarantine is not a room anybody cooks in, so both legs of a return
          -- through it are excluded outright.
          and sec.kind <> 'QUARANTINE'
          and (   (l.doc = 'issue'  and l.qty_base > 0)
               or (l.doc = 'return' and l.qty_base < 0))
          and l.business_date between ${range.from}::date and ${range.to}::date
        group by sec.id, sec.name, i.id, i.code, i.name, i.stock_unit
        having sum(l.qty_base) > 0
        order by sec.name, sum(l.qty_base * l.unit_cost) desc
    `.execute(db);

    return rows.map(numeric);
}

// ── L. Are the counts any good? ─────────────────────────────────────────────

export interface CountAccuracyRow {
    countedBy: string;
    sectionName: string;
    counts: number;
    lines: number;
    /** Lines where what was counted did not match what was expected. */
    linesOff: number;
    accuracyPct: number | null;
    /** Total value of the discrepancies, ignoring direction. */
    absVarianceValue: number;
}

/**
 * Whose counts can be trusted.
 *
 * Every report above this one rests on the stock figure being true, and the
 * count is where that gets checked. A counter whose lines are never off is
 * either very good or not really counting; a counter who is off on a third of
 * their lines makes every variance report downstream unreadable. Either way it
 * is worth knowing before you act on a shrinkage number.
 *
 * Uncounted lines are excluded - a count left half done is not an inaccuracy.
 */
export async function countAccuracy(
    locationId: number,
    range: DateRange
): Promise<CountAccuracyRow[]> {
    const { rows } = await sql<CountAccuracyRow>`
        select
          u.name                                        as "countedBy",
          sec.name                                      as "sectionName",
          count(distinct c.id)::int                     as counts,
          count(l.id)::int                              as lines,
          count(l.id) filter (
            where abs(l.qty_counted - l.qty_expected) > 0.001
          )::int                                        as "linesOff",
          round(
            100.0 * count(l.id) filter (
              where abs(l.qty_counted - l.qty_expected) <= 0.001
            ) / nullif(count(l.id), 0)
          , 1)                                          as "accuracyPct",
          round(coalesce(sum(abs(l.variance_value)), 0)::numeric, 2) as "absVarianceValue"
        from stock_counts c
        join stock_count_lines l on l.count_id = c.id
        join users u on u.id = c.counted_by
        join sections sec on sec.id = c.section_id
        where c.location_id = ${locationId}
          and l.qty_counted is not null
          and c.business_date between ${range.from}::date and ${range.to}::date
        group by u.id, u.name, sec.name
        order by u.name, sec.name
    `.execute(db);

    return rows.map(numeric);
}

/**
 * Same trick as reports.ts: pg hands `round()` over an aggregate back as a
 * string. Converted by an explicit key list, so an item code like "0012" is
 * never quietly turned into the number 12.
 */
// ── K. Returns ──────────────────────────────────────────────────────────────

export interface ReturnsSummaryRow {
    reasonCode: string;
    reasonLabel: string;
    /** Handed back by a section into quarantine. */
    sectionReturns: number;
    sectionQtyValue: number;
    /** Raised against a supplier, excluding rejected ones. */
    supplierReturns: number;
    supplierValue: number;
    /** Of that, what a credit note has actually been received for. */
    creditedValue: number;
}

/**
 * Why stock is coming back, and whether anybody is getting the money.
 *
 * Grouped by reason rather than by supplier because the first question is which
 * of these is a supplier problem and which is ours. `RET_DAMAGED` against one
 * vendor is a delivery problem; `RET_EXPIRED` across all of them is an ordering
 * problem, and no amount of arguing with suppliers fixes it.
 *
 * The gap between `supplierValue` and `creditedValue` is money that was agreed
 * to be owed and has not arrived. It is the only place in the system that
 * number appears.
 */
export async function returnsByReason(
    locationId: number,
    range: DateRange
): Promise<ReturnsSummaryRow[]> {
    const { rows } = await sql<ReturnsSummaryRow>`
        with section_side as (
          select
            sr.reason_code,
            count(*)                                          as returns,
            sum(sr.qty_base * coalesce(cs.avg_cost, 0))       as value
          from section_returns sr
          left join item_cost_state cs
            on cs.item_id = sr.item_id and cs.location_id = sr.location_id
          where sr.location_id = ${locationId}
            and sr.returned_at::date between ${range.from}::date and ${range.to}::date
          group by sr.reason_code
        ),
        supplier_side as (
          select
            sr.reason_code,
            count(*)                                          as returns,
            sum(rl.asked)                                     as value,
            -- Off the header, so this is what was allowed rather than what was
            -- asked for. A supplier who settles short shows up as a gap.
            sum(sr.credit_value) filter (
              where sr.status = 'settled' and sr.outcome = 'credit'
            )                                                 as credited
          from supplier_returns sr
          join lateral (
            select coalesce(sum(l.line_credit), 0) as asked
            from supplier_return_lines l
            where l.return_id = sr.id
          ) rl on true
          where sr.location_id = ${locationId}
            and sr.status <> 'rejected'
            and sr.raised_at::date between ${range.from}::date and ${range.to}::date
          group by sr.reason_code
        )
        select
          rc.code                                             as "reasonCode",
          rc.label                                            as "reasonLabel",
          coalesce(ss.returns, 0)::int                        as "sectionReturns",
          round(coalesce(ss.value, 0)::numeric, 2)            as "sectionQtyValue",
          coalesce(sp.returns, 0)::int                        as "supplierReturns",
          round(coalesce(sp.value, 0)::numeric, 2)            as "supplierValue",
          round(coalesce(sp.credited, 0)::numeric, 2)         as "creditedValue"
        from reason_codes rc
        left join section_side ss  on ss.reason_code = rc.code
        left join supplier_side sp on sp.reason_code = rc.code
        where rc.doc = 'return'
          and (coalesce(ss.returns, 0) > 0 or coalesce(sp.returns, 0) > 0)
        order by coalesce(sp.value, 0) + coalesce(ss.value, 0) desc
    `.execute(db);

    return rows.map(numeric);
}

export interface OpenReturnRow {
    id: string;
    status: string;
    supplierName: string;
    invoiceNo: string | null;
    reasonLabel: string;
    raisedBy: string;
    raisedAt: string;
    sentAt: string | null;
    /** Days since it was raised, or since it was sent once it has gone. */
    daysWaiting: number;
    expectedCredit: number;
    lines: number;
}

/**
 * Returns that have not finished.
 *
 * Anything raised and undecided, approved and not yet gone, or sent and not yet
 * settled. This is the chase list: a return nobody follows up is a delivery the
 * restaurant paid for twice.
 *
 * Rejected and settled returns are done and are deliberately absent.
 */
export async function openReturns(
    locationId: number,
    range: DateRange
): Promise<OpenReturnRow[]> {
    const { rows } = await sql<OpenReturnRow>`
        select
          sr.id::text                                       as id,
          sr.status::text                                   as status,
          s.name                                            as "supplierName",
          g.invoice_no                                      as "invoiceNo",
          rc.label                                          as "reasonLabel",
          u.name                                            as "raisedBy",
          to_char(sr.raised_at, 'YYYY-MM-DD')               as "raisedAt",
          to_char(sr.sent_at, 'YYYY-MM-DD')                 as "sentAt",
          (current_date - coalesce(sr.sent_at, sr.raised_at)::date)::int
                                                            as "daysWaiting",
          round(sum(srl.line_credit)::numeric, 2)           as "expectedCredit",
          count(srl.id)::int                                as lines
        from supplier_returns sr
        join suppliers s on s.id = sr.supplier_id
        join grn g on g.id = sr.grn_id
        join users u on u.id = sr.raised_by
        join reason_codes rc on rc.code = sr.reason_code
        join supplier_return_lines srl on srl.return_id = sr.id
        where sr.location_id = ${locationId}
          and sr.status in ('raised', 'approved', 'sent')
          and sr.raised_at::date between ${range.from}::date and ${range.to}::date
        group by sr.id, sr.status, s.name, g.invoice_no, rc.label, u.name,
                 sr.raised_at, sr.sent_at
        order by (current_date - coalesce(sr.sent_at, sr.raised_at)::date) desc
    `.execute(db);

    return rows.map(numeric);
}

const NUMERIC_KEYS = new Set([
    'lineCount',
    'daysOpen',
    'daysLate',
    'estimatedValue',
    'outstandingValue',
    'requests',
    'stillWaiting',
    'lines',
    'linesInFull',
    'linesShort',
    'fillRatePct',
    'qtyFillPct',
    'avgHoursToRelease',
    'orders',
    'deliveries',
    'lateOrders',
    'avgDaysToClose',
    'spend',
    'qtyBase',
    'avgCost',
    'value',
    'daysSinceMoved',
    'counts',
    'linesOff',
    'accuracyPct',
    'absVarianceValue',
    'sectionReturns',
    'sectionQtyValue',
    'supplierReturns',
    'supplierValue',
    'creditedValue',
    'returnedValue',
    'netSpend',
    'returnRatePct',
    'returns',
    'daysWaiting',
    'expectedCredit'
]);

function numeric<T extends object>(row: T): T {
    const out = { ...row } as Record<string, unknown>;
    for (const [key, value] of Object.entries(out)) {
        if (NUMERIC_KEYS.has(key) && typeof value === 'string') {
            out[key] = Number(value);
        }
    }
    return out as T;
}
