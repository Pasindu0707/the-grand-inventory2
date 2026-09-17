/**
 * Client-generated ids, used only as Idempotency-Keys.
 *
 * A key is minted once when a form is opened, not on each submit - that is the
 * whole point. Tapping Save twice on a hanging request must send the same key,
 * so the server recognises the second attempt as a replay of the first rather
 * than as a second delivery.
 */
export function uuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    // Older WebViews on cheap Android tablets, which this will run on.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
