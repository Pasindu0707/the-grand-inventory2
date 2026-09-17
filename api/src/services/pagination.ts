/**
 * Numbered-page helpers for the list endpoints.
 *
 * Every list route used to take a bare `limit` and return a naked array, which
 * meant the client could ask for fewer rows but never for the *next* ones, and
 * had no idea how many it was missing. A screen showing "50 wastage entries"
 * was really showing "the 50 most recent, and no way to know there were 900".
 *
 * The shape here is deliberately boring: one-based `page`, a `limit`, and a
 * response carrying the rows plus enough counting for a pager to draw itself
 * without a second request.
 *
 * `total` costs a second query. That is the price of numbered pages - a cursor
 * would avoid it, but then there is no last page to jump to, which is the thing
 * people actually want when they are looking for a delivery from last month.
 */
import { z } from 'zod';

/** Query string every paginated list route accepts. */
export const pageQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(25)
});

export type PageQuery = z.infer<typeof pageQuery>;

/** Wraps an item schema in the standard envelope. */
export function pageOf<T extends z.ZodTypeAny>(item: T) {
    return z.object({
        items: z.array(item),
        total: z.number().int(),
        page: z.number().int(),
        limit: z.number().int(),
        pageCount: z.number().int()
    });
}

export interface Page<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    pageCount: number;
}

/** Rows to skip for the requested page. */
export function offsetOf(q: PageQuery): number {
    return (q.page - 1) * q.limit;
}

/**
 * Assembles the envelope. `total` arrives from a count query and may be a
 * string or bigint depending on the driver, so it is normalised here rather
 * than at each of the ten call sites.
 */
export function toPage<T>(items: T[], total: unknown, q: PageQuery): Page<T> {
    const count = Number(total ?? 0);
    return {
        items,
        total: count,
        page: q.page,
        limit: q.limit,
        pageCount: Math.max(1, Math.ceil(count / q.limit))
    };
}
