/**
 * The five reports.
 *
 *   "Test data with no faults in it teaches you nothing. Five faults are
 *    planted, and each maps to a report that must catch it. If a report can't
 *    find its fault, the report is wrong."
 *
 * Each function below is paired with a test in test/anomalies.test.ts that
 * asserts it finds its planted fault in the 60-day seed. One of those tests
 * asserts the opposite: that honest lettuce spoilage does NOT surface as
 * shrinkage. That is the failure mode the README is most worried about, and it
 * is the one nobody writes a test for.
 */
import { sql } from 'kysely';
import { db } from '../db/index.js';

export interface DateRange {
    from: string;
    to: string;
}

// ── A. Theoretical vs actual usage ──────────────────────────────────────────

export interface UsageVarianceRow {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    sectionCode: string;
    theoreticalQty: number;
    actualQty: number;
    varianceQty: number;
    variancePct: number;
    varianceValue: number;
}

/**
 * What the recipes say should have been used, against what was actually issued.
 *
 * The driver is production_log, not sales - there is no POS. A section declares
 * "42 chocolate cakes", the recipe explodes that into ingredients, and the
 * difference against what left the store is the variance.
 *
 * Only meaningful where a theoretical figure exists: an item nobody declared
 * production for has no expectation to deviate from, and reporting it as
 * "infinite variance" would bury the real signal.
 */
export async function usageVariance(
    locationId: number,
    range: DateRange,
    minPct = 8
): Promise<UsageVarianceRow[]> {
    const { rows } = await sql<UsageVarianceRow>`
        select
          uv.item_id                                     as "itemId",
          i.code,
          i.name,
          i.stock_unit                                   as "stockUnit",
          s.code                                         as "sectionCode",
          round(sum(uv.theoretical_qty)::numeric, 3)     as "theoreticalQty",
          round(sum(uv.actual_qty)::numeric, 3)          as "actualQty",
          round(sum(uv.variance_qty)::numeric, 3)        as "varianceQty",
          round(
            100.0 * sum(uv.variance_qty) / nullif(sum(uv.theoretical_qty), 0), 1
          )                                              as "variancePct",
          round(
            (sum(uv.variance_qty) * coalesce(max(ics.avg_cost), 0))::numeric, 2
          )                                              as "varianceValue"
        from usage_variance uv
        join items i on i.id = uv.item_id
        join sections s on s.id = uv.section_id
        left join item_cost_state ics
          on ics.item_id = uv.item_id and ics.location_id = uv.location_id
        where uv.location_id = ${locationId}
          and uv.business_date between ${range.from}::date and ${range.to}::date
        group by uv.item_id, i.code, i.name, i.stock_unit, s.code
        having sum(uv.theoretical_qty) > 0
           and abs(100.0 * sum(uv.variance_qty) / nullif(sum(uv.theoretical_qty), 0)) >= ${minPct}
        order by abs(sum(uv.variance_qty) * coalesce(max(ics.avg_cost), 0)) desc
    `.execute(db);

    return rows.map(numeric);
}

/** Daily issued quantity for one item - the detail behind a variance row. */
export async function usageTrend(
    locationId: number,
    itemId: number,
    range: DateRange
): Promise<{ businessDate: string; theoreticalQty: number; actualQty: number }[]> {
    const { rows } = await sql<{
        businessDate: string;
        theoreticalQty: number;
        actualQty: number;
    }>`
        select
          uv.business_date::text                    as "businessDate",
          round(sum(uv.theoretical_qty)::numeric, 3) as "theoreticalQty",
          round(sum(uv.actual_qty)::numeric, 3)      as "actualQty"
        from usage_variance uv
        where uv.location_id = ${locationId}
          and uv.item_id = ${itemId}
          and uv.business_date between ${range.from}::date and ${range.to}::date
        group by uv.business_date
        order by uv.business_date
    `.execute(db);

    return rows.map(numeric);
}

// ── B. Shrinkage ────────────────────────────────────────────────────────────

export interface ShrinkageRow {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    sectionCode: string;
    businessDate: string;
    varianceQty: number;
    varianceValue: number;
    /** The gap as a share of what the count expected to find. */
    variancePct: number | null;
    /** True when wastage was logged for the same item and section that day. */
    hasWastageDoc: boolean;
}

/**
 * Counting is never exact. Somebody eyeballs a half-full sack and writes a
 * round number, and the ledger picks up a few units of difference. Without a
 * floor this report lists every one of those.
 *
 * Two thresholds, because one is not enough:
 *
 *  - Money, so a trivial loss never reaches a manager. Without it the seed
 *    produces Rs 0.44 "losses" of one gram of lettuce.
 *
 *  - Proportion, because a money floor alone does not scale. Gin is expensive:
 *    ordinary 0.5% counting noise in the store is worth Rs 100-175 a day and
 *    produced fifteen false positives that buried the two real bottles. Noise
 *    is proportional to what is on the shelf; theft is not.
 *
 * Both numbers are guesses for a Negombo gastrobar and belong on the Phase 0
 * list to confirm with the owner.
 */
export const DEFAULT_SHRINKAGE_FLOOR_LKR = 100;
export const DEFAULT_SHRINKAGE_FLOOR_PCT = 2;

/**
 * Stock that went missing with no document behind it.
 *
 * A count adjustment is the system admitting the shelf disagrees with the
 * ledger. If wastage was logged for that item on that day, the gap is
 * explained and this is not shrinkage - it is paperwork catching up. What is
 * left is the interesting set: anomaly B, two gin bottles that left the bar
 * with no document at all.
 *
 * Negative adjustments only. A positive one means someone found stock, which is
 * a counting error rather than a loss.
 */
export async function shrinkage(
    locationId: number,
    range: DateRange,
    minValue = DEFAULT_SHRINKAGE_FLOOR_LKR,
    minPct = DEFAULT_SHRINKAGE_FLOOR_PCT
): Promise<ShrinkageRow[]> {
    const { rows } = await sql<ShrinkageRow>`
        select
          l.item_id                                        as "itemId",
          i.code,
          i.name,
          i.stock_unit                                     as "stockUnit",
          s.code                                           as "sectionCode",
          l.business_date::text                            as "businessDate",
          round(sum(l.qty_base)::numeric, 3)               as "varianceQty",
          round((sum(l.qty_base) * coalesce(max(ics.avg_cost), 0))::numeric, 2)
                                                           as "varianceValue",
          round(
            100.0 * abs(sum(l.qty_base)) / nullif(max(scl.qty_expected), 0), 2
          )                                                as "variancePct",
          exists (
            select 1 from wastage w
            where w.item_id = l.item_id
              and w.section_id = l.section_id
              and w.logged_at::date = l.business_date
          )                                                as "hasWastageDoc"
        from stock_ledger l
        join items i on i.id = l.item_id
        join sections s on s.id = l.section_id
        left join item_cost_state ics
          on ics.item_id = l.item_id and ics.location_id = l.location_id
        -- What the count expected to find, so a gap can be judged against the
        -- size of the shelf rather than in isolation.
        left join stock_count_lines scl
          on scl.count_id = l.doc_id and scl.item_id = l.item_id
        where l.location_id = ${locationId}
          and l.doc = 'count'
          and l.reason_code = 'COUNTADJ'
          and l.business_date between ${range.from}::date and ${range.to}::date
        group by l.item_id, i.code, i.name, i.stock_unit, s.code,
                 l.business_date, l.section_id
        having sum(l.qty_base) < 0
           and abs(sum(l.qty_base) * coalesce(max(ics.avg_cost), 0)) >= ${minValue}
           and (
             -- Material as a proportion of the shelf, or material enough in
             -- money that the proportion stops mattering.
             coalesce(
               100.0 * abs(sum(l.qty_base)) / nullif(max(scl.qty_expected), 0),
               100
             ) >= ${minPct}
             or abs(sum(l.qty_base) * coalesce(max(ics.avg_cost), 0)) >= ${minValue} * 20
           )
        order by sum(l.qty_base) * coalesce(max(ics.avg_cost), 0) asc
    `.execute(db);

    return rows.map(numeric);
}

// ── C. Supplier price movement ──────────────────────────────────────────────

export interface PriceMovementRow {
    itemPackId: number;
    itemName: string;
    packName: string;
    supplierName: string;
    effectiveFrom: string;
    previousPrice: number;
    newPrice: number;
    changePct: number;
}

/**
 * Every price change a supplier has made, largest first.
 *
 * Reads supplier_prices rather than reconstructing history from GRN lines,
 * which is why that table is populated on every receipt where the price moved.
 */
export async function priceMovement(
    range: DateRange,
    minPct = 5
): Promise<PriceMovementRow[]> {
    const { rows } = await sql<PriceMovementRow>`
        with history as (
          select
            sp.item_pack_id,
            sp.supplier_id,
            sp.price,
            sp.effective_from,
            lag(sp.price) over (
              partition by sp.supplier_id, sp.item_pack_id
              order by sp.effective_from, sp.id
            ) as previous_price
          from supplier_prices sp
        )
        select
          h.item_pack_id                as "itemPackId",
          i.name                        as "itemName",
          ip.pack_name                  as "packName",
          sup.name                      as "supplierName",
          h.effective_from::text        as "effectiveFrom",
          round(h.previous_price, 2)    as "previousPrice",
          round(h.price, 2)             as "newPrice",
          round(100.0 * (h.price - h.previous_price) / nullif(h.previous_price, 0), 1)
                                        as "changePct"
        from history h
        join item_packs ip on ip.id = h.item_pack_id
        join items i on i.id = ip.item_id
        join suppliers sup on sup.id = h.supplier_id
        where h.previous_price is not null
          and h.previous_price > 0
          and h.effective_from between ${range.from}::date and ${range.to}::date
          and abs(100.0 * (h.price - h.previous_price) / h.previous_price) >= ${minPct}
        order by abs(100.0 * (h.price - h.previous_price) / h.previous_price) desc
    `.execute(db);

    return rows.map(numeric);
}

// ── D. Wastage by reason ────────────────────────────────────────────────────

export interface WastageByReasonRow {
    reasonCode: string;
    reasonLabel: string;
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    sectionCode: string;
    events: number;
    qtyBase: number;
    value: number;
}

/**
 * Declared waste, grouped by why.
 *
 * This is deliberately a *separate* report from shrinkage, and the separation
 * is the whole point. Lettuce that spoiled in week six was logged honestly by
 * the kitchen; it belongs here, under spoilage. A variance report that drags it
 * into a theft conversation is a report the owner stops opening by week three.
 */
export async function wastageByReason(
    locationId: number,
    range: DateRange
): Promise<WastageByReasonRow[]> {
    const { rows } = await sql<WastageByReasonRow>`
        select
          w.reason_code                                    as "reasonCode",
          rc.label                                         as "reasonLabel",
          w.item_id                                        as "itemId",
          i.code,
          i.name,
          i.stock_unit                                     as "stockUnit",
          s.code                                           as "sectionCode",
          count(*)::int                                    as events,
          round(sum(w.qty_base)::numeric, 3)               as "qtyBase",
          round((sum(w.qty_base) * coalesce(max(ics.avg_cost), 0))::numeric, 2) as value
        from wastage w
        join reason_codes rc on rc.code = w.reason_code
        join items i on i.id = w.item_id
        join sections s on s.id = w.section_id
        left join item_cost_state ics
          on ics.item_id = w.item_id and ics.location_id = w.location_id
        where w.location_id = ${locationId}
          and w.logged_at::date between ${range.from}::date and ${range.to}::date
        group by w.reason_code, rc.label, w.item_id, i.code, i.name,
                 i.stock_unit, s.code
        order by sum(w.qty_base) * coalesce(max(ics.avg_cost), 0) desc
    `.execute(db);

    return rows.map(numeric);
}

/** Daily wastage for one item, so a spike is visible as a spike. */
export async function wastageTrend(
    locationId: number,
    itemId: number,
    range: DateRange
): Promise<{ businessDate: string; qtyBase: number }[]> {
    const { rows } = await sql<{ businessDate: string; qtyBase: number }>`
        select
          w.logged_at::date::text            as "businessDate",
          round(sum(w.qty_base)::numeric, 3) as "qtyBase"
        from wastage w
        where w.location_id = ${locationId}
          and w.item_id = ${itemId}
          and w.logged_at::date between ${range.from}::date and ${range.to}::date
        group by w.logged_at::date
        order by 1
    `.execute(db);

    return rows.map(numeric);
}

// ── E. Stock-outs and low stock ─────────────────────────────────────────────

export interface StockOutRow {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    sectionCode: string;
    businessDate: string;
    balance: number;
}

/**
 * Days an item ran out.
 *
 * Reconstructs the running balance per item and section from the ledger, which
 * is the only way to answer "when did this hit zero" after the fact - there is
 * no historical stock table, by design.
 */
export async function stockOuts(
    locationId: number,
    range: DateRange
): Promise<StockOutRow[]> {
    const { rows } = await sql<StockOutRow>`
        with daily as (
          select item_id, section_id, business_date, sum(qty_base) as delta
          from stock_ledger
          where location_id = ${locationId}
          group by item_id, section_id, business_date
        ),
        running as (
          select
            item_id, section_id, business_date,
            sum(delta) over (
              partition by item_id, section_id order by business_date
            ) as balance
          from daily
        )
        select
          r.item_id              as "itemId",
          i.code,
          i.name,
          i.stock_unit           as "stockUnit",
          s.code                 as "sectionCode",
          r.business_date::text  as "businessDate",
          round(r.balance::numeric, 3) as balance
        from running r
        join items i on i.id = r.item_id
        join sections s on s.id = r.section_id
        where r.balance <= 0
          and s.is_store
          and r.business_date between ${range.from}::date and ${range.to}::date
        order by r.business_date, i.name
    `.execute(db);

    return rows.map(numeric);
}

export interface BelowReorderRow {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    qtyBase: number;
    reorderPoint: number;
    parLevel: number;
    shortfall: number;
    isCritical: boolean;
}

/** What needs ordering now. */
export async function belowReorder(locationId: number): Promise<BelowReorderRow[]> {
    const { rows } = await sql<BelowReorderRow>`
        select
          i.id                                as "itemId",
          i.code,
          i.name,
          i.stock_unit                        as "stockUnit",
          round(coalesce(cs.qty_base, 0), 3)  as "qtyBase",
          round(i.reorder_point, 3)           as "reorderPoint",
          round(i.par_level, 3)               as "parLevel",
          round(i.par_level - coalesce(cs.qty_base, 0), 3) as shortfall,
          i.is_critical                       as "isCritical"
        from items i
        join sections s on s.location_id = ${locationId} and s.is_store
        left join current_stock cs
          on cs.item_id = i.id and cs.section_id = s.id
        where i.is_active
          and coalesce(cs.qty_base, 0) < i.reorder_point
        order by (coalesce(cs.qty_base, 0) / nullif(i.reorder_point, 0)) asc
    `.execute(db);

    return rows.map(numeric);
}

/**
 * pg hands most numerics back as JS numbers (see db/index.ts), but `round()`
 * over an aggregate can still arrive as a string. Convert by an explicit key
 * list rather than by sniffing the value: an item code like "0012" or a name
 * that happens to be numeric must not be silently turned into a number.
 */
const NUMERIC_KEYS = new Set([
    'theoreticalQty',
    'actualQty',
    'varianceQty',
    'variancePct',
    'varianceValue',
    'previousPrice',
    'newPrice',
    'changePct',
    'qtyBase',
    'value',
    'events',
    'balance',
    'reorderPoint',
    'parLevel',
    'shortfall'
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
