/**
 * The rules that stand behind the setup screens.
 *
 * Handing master data to the owner is the point of these screens, but master
 * data is not free-form: the ledger has been referencing it for months and
 * cannot be re-read. Three edits in particular look harmless in a form and are
 * not, and each one is refused here rather than in the UI, because the UI is
 * not the only caller:
 *
 *   - changing an item's stock unit after it has moved. Every historic row is
 *     a number in the old unit with nothing recording which unit that was, so
 *     switching g to ml silently reinterprets a year of history.
 *   - changing a pack's conversion after it has been bought. The ledger keeps
 *     stock units, so history survives -- but the price-movement report
 *     compares price per pack across deliveries, and a pack that changed size
 *     mid-way makes that comparison meaningless.
 *   - retiring a section that still holds stock, which strands it: no screen
 *     offers the section any more, so nothing can issue, count or waste it
 *     back down to zero.
 *
 * In all three the honest answer is the same: keep the old thing, make a new
 * one. That is what an inventory system is for.
 */
import { db } from '../db/index.js';
import { badRequest, conflict } from '../errors.js';

/** Has this item ever moved? */
export async function itemHasMoved(itemId: number): Promise<boolean> {
    const row = await db
        .selectFrom('stock_ledger')
        .select('id')
        .where('item_id', '=', itemId)
        .limit(1)
        .executeTakeFirst();
    return !!row;
}

/** Has this pack ever been bought or ordered in? */
export async function packHasBeenUsed(packId: number): Promise<boolean> {
    const onGrn = await db
        .selectFrom('grn_lines')
        .select('id')
        .where('item_pack_id', '=', packId)
        .limit(1)
        .executeTakeFirst();
    if (onGrn) return true;

    const onPo = await db
        .selectFrom('purchase_order_lines')
        .select('id')
        .where('item_pack_id', '=', packId)
        .limit(1)
        .executeTakeFirst();
    return !!onPo;
}

/** What this section is holding right now, across every item. */
export async function sectionStockLines(sectionId: number): Promise<number> {
    const row = await db
        .selectFrom('current_stock')
        .select(({ fn }) => fn.countAll().as('n'))
        .where('section_id', '=', sectionId)
        .where('qty_base', '!=', 0)
        .executeTakeFirst();
    return Number(row?.n ?? 0);
}

/**
 * A branch has exactly one main store.
 *
 * Half the system asks for "the store at this branch" with a single-row query
 * -- issues, GRNs, the shortage calculation. A second active
 * store would not error anywhere; it would just start answering a different
 * one at random, and stock would appear to move to the wrong shelf.
 */
export async function assertOneStore(
    locationId: number,
    exceptSectionId?: number
): Promise<void> {
    let q = db
        .selectFrom('sections')
        .select(['id', 'name'])
        .where('location_id', '=', locationId)
        .where('is_store', '=', true)
        .where('is_active', '=', true);
    if (exceptSectionId) q = q.where('id', '!=', exceptSectionId);

    const existing = await q.executeTakeFirst();
    if (existing) {
        throw conflict(
            `This branch already has a main store ("${existing.name}"). A branch can only have one.`
        );
    }
}

/**
 * A stock unit is the smallest unit the item is ever counted in, and it is
 * never a pack. Catching "kg" at entry is worth more than any amount of
 * documentation: an item created in kg with a "1 kg pack" pack silently makes
 * every quantity in the system a thousand times too small.
 */
const PACKY_UNITS = new Set([
    'kg',
    'l',
    'litre',
    'liter',
    'pack',
    'packet',
    'box',
    'case',
    'bottle',
    'sack',
    'bag',
    'tin',
    'can',
    'carton',
    'dozen'
]);

export function assertStockUnit(unit: string): void {
    const u = unit.trim().toLowerCase();
    if (PACKY_UNITS.has(u)) {
        const suggestion = u === 'kg' ? 'g' : u === 'l' || u.startsWith('lit') ? 'ml' : 'ea';
        throw badRequest(
            `"${unit}" is a pack, not a stock unit. Use "${suggestion}" and add "${unit}" as a pack size instead.`
        );
    }
}

/**
 * Exactly one default purchase pack per item, or the GRN form has to guess.
 * Setting a new one clears the old, which is what the person ticking the box
 * meant.
 */
export async function clearOtherDefaultPacks(
    itemId: number,
    keepPackId?: number
): Promise<void> {
    let q = db
        .updateTable('item_packs')
        .set({ is_default_purchase: false })
        .where('item_id', '=', itemId)
        .where('is_default_purchase', '=', true);
    if (keepPackId) q = q.where('id', '!=', keepPackId);
    await q.execute();
}

/** Turns a unique-constraint collision into something a person can act on. */
export function uniqueViolation(err: unknown, message: string): never {
    const code = (err as { code?: string }).code;
    if (code === '23505') throw conflict(message);
    throw err as Error;
}
