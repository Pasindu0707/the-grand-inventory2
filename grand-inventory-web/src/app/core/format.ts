/**
 * Formatting helpers.
 *
 * The POS template's money.ts was cart arithmetic - line tax, bill discount
 * apportionment - none of which exists here. What survives is currency
 * formatting, fixed to LKR, plus the one thing this system genuinely needs:
 * turning stock units into something a human reads.
 */

export function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMoney(amount: number | null | undefined): string {
    const value = amount ?? 0;
    try {
        return new Intl.NumberFormat('en-LK', {
            style: 'currency',
            currency: 'LKR',
            maximumFractionDigits: 2
        }).format(value);
    } catch {
        return `Rs ${value.toFixed(2)}`;
    }
}

/**
 * Stock is stored in the small unit (g, ml, ea) because that is the only way
 * the arithmetic stays exact. Nobody wants to read "47500 g", so display
 * scales up - display only. Nothing round-trips through this.
 */
export function formatQty(qtyBase: number, stockUnit: string): string {
    const qty = qtyBase ?? 0;

    if (stockUnit === 'g' && Math.abs(qty) >= 1000) {
        return `${trim(qty / 1000)} kg`;
    }
    if (stockUnit === 'ml' && Math.abs(qty) >= 1000) {
        return `${trim(qty / 1000)} L`;
    }
    return `${trim(qty)} ${stockUnit}`;
}

function trim(n: number): string {
    return n.toLocaleString('en-LK', { maximumFractionDigits: 2 });
}

/** "2 x 20 L can" - how a delivery is actually described. */
export function describePacks(qtyPacks: number, packName: string): string {
    return `${trim(qtyPacks)} × ${packName}`;
}
