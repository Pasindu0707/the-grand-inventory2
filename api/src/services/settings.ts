/**
 * Per-location process rules.
 *
 * Defaults live in code so a new outlet works before anyone configures it;
 * a row in `settings` overrides them.
 */
import { db } from '../db/index.js';

export interface IssueWindow {
    /** 'HH:MM' local to the location. */
    at: string;
    label: string;
}

export const DEFAULT_ISSUE_WINDOWS: IssueWindow[] = [
    { at: '06:00', label: 'Morning' },
    { at: '11:00', label: 'Midday' },
    { at: '17:00', label: 'Evening' }
];

/** How far either side of a window still counts as "on time". */
export const DEFAULT_WINDOW_TOLERANCE_MINUTES = 45;

export async function issueWindowsFor(locationId: number): Promise<IssueWindow[]> {
    const row = await db
        .selectFrom('settings')
        .select('value')
        .where('location_id', '=', locationId)
        .where('key', '=', 'issue_windows')
        .executeTakeFirst();

    if (!row?.value) return DEFAULT_ISSUE_WINDOWS;
    const parsed = row.value as IssueWindow[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_ISSUE_WINDOWS;
}

/**
 * Is this issue happening inside one of the agreed windows?
 *
 *   "Issue windows, not an always-open store. 06:00, 11:00, 17:00. This is a
 *    process rule the software should enforce by warning, not blocking."
 *
 * So this returns a message, never an error. An off-window issue is a real
 * event that really happened; refusing to record it would only mean the stock
 * figure is wrong as well as the process.
 */
export function windowWarning(
    windows: IssueWindow[],
    now: Date,
    toleranceMinutes = DEFAULT_WINDOW_TOLERANCE_MINUTES
): string | null {
    const minutesNow = now.getHours() * 60 + now.getMinutes();

    const nearest = windows
        .map((w) => {
            const [h, m] = w.at.split(':').map(Number);
            const mins = (h ?? 0) * 60 + (m ?? 0);
            return { ...w, mins, delta: Math.abs(minutesNow - mins) };
        })
        .sort((a, b) => a.delta - b.delta)[0];

    if (!nearest || nearest.delta <= toleranceMinutes) return null;

    return `Outside the issue windows (${windows.map((w) => w.at).join(', ')}). Nearest is ${nearest.label} at ${nearest.at}. Add a note explaining why.`;
}
