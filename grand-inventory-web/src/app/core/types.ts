/**
 * The Grand - shared types. Mirrors the API's Zod schemas in api/src/routes.
 *
 * Deliberately NOT derived from the POS template's types. Two differences make
 * reuse actively dangerous:
 *
 *  - There is no `stockQty` on an item. Stock is the sum of ledger movements
 *    per section, computed on read. A cached scalar is exactly the thing this
 *    system is designed not to have.
 *  - Ids are integers, not UUID strings. The database uses serial/bigserial.
 */

// ── Roles ───────────────────────────────────────────────────────────────────
// Five, matching how the business is organised. Chef, baker and bar all became
// "kitchen": they do the same thing here, which is ask the store for stock.
export type Role = 'admin' | 'management' | 'storekeeper' | 'kitchen' | 'cleaning';

export const ROLE_LABELS: Record<Role, string> = {
    admin: 'Admin',
    management: 'Management',
    storekeeper: 'Storekeeper',
    kitchen: 'Kitchen',
    cleaning: 'Cleaning'
};

export type RouteKey =
    // Everyday screens
    | 'home'
    | 'ask'
    | 'requests'
    | 'mystock'
    | 'purchases'
    // Administration - the admin's own corner, where the system is built
    | 'admin'
    | 'users'
    // Setup - the admin's own corner, where the system is built from nothing
    | 'setupItems'
    | 'setupSuppliers'
    | 'setupBranches'
    // Advanced - management and admin only
    | 'grn'
    | 'stock'
    | 'wastage'
    | 'counts'
    | 'reports'
    | 'opening'
    // Returns - a section hands stock back, the store hands it to the vendor
    | 'returns'
    | 'supplierReturns'
    // The record of what has arrived. A delivery is a document the business
    // keeps, so it has a page of its own rather than living only inside the
    // form that created it.
    | 'deliveries';

/** What this person can do. Answered by the server so the UI never guesses. */
export interface MyContext {
    role: Role;
    locationId: number;
    mySectionIds: number[];
    homeSectionId: number | null;
    canRelease: boolean;
    canDecidePurchases: boolean;
    canManageUsers: boolean;
    seesAdvanced: boolean;
}

// ── Requests ────────────────────────────────────────────────────────────────
export interface RequestRow {
    id: string;
    sectionId: number;
    sectionCode: string;
    sectionName: string;
    /** requested | released | received | cancelled */
    status: string;
    requestedBy: string;
    requestedAt: string;
    neededBy: string | null;
    note: string | null;
    lineCount: number;
    /** What was asked for, so the list can say more than "1 item(s)". */
    lines: {
        itemId: number;
        name: string;
        stockUnit: string;
        qtyRequested: number;
        qtyIssued: number | null;
        /** Handed back against this request. */
        qtyReturned: number;
    }[];
    releasedBy: string | null;
    isMine: boolean;
    /** Waiting on this user to do something. */
    needsMe: boolean;
    /**
     * Total handed back. A request does not shrink when stock comes back, so
     * the row needs this to say anything happened at all.
     */
    qtyReturnedTotal: number;
    /** Days since the stock was released. Null while nothing has been. */
    daysSinceReleased: number | null;
    /**
     * False once nothing on this request could still go back - fully returned,
     * the section no longer holds it, or the return window has closed.
     */
    canReturn: boolean;
}

export interface Shortage {
    itemId: number;
    name: string;
    stockUnit: string;
    requested: number;
    inStore: number;
    short: number;
    /** The pack it would be bought in, and how many cover the gap. */
    itemPackId: number | null;
    packName: string | null;
    qtyInStockUnit: number | null;
    shortPacks: number;
}

export interface ReleaseResult {
    id: string;
    linesReleased: number;
    shortfalls: { itemName: string; requested: number; released: number; available: number }[];
}

// ── Purchase orders ─────────────────────────────────────────────────────────
export type PoDecision = 'approved' | 'rejected' | 'ordered' | 'done';

export interface PurchaseOrderLine {
    itemId: number;
    name: string;
    stockUnit: string;
    qtyBase: number;
    /** What the store had when it was raised. */
    qtyInStore: number;
    itemPackId: number | null;
    packName: string | null;
    qtyPacks: number | null;
    /** Estimated price for one pack. */
    estPrice: number | null;
    qtyReceivedBase: number;
    qtyOutstandingBase: number;
}

export interface PurchaseOrder {
    id: string;
    status: string;
    raisedBy: string;
    raisedAt: string;
    supplierId: number | null;
    supplierName: string | null;
    neededBy: string | null;
    reason: string | null;
    decidedBy: string | null;
    decisionNote: string | null;
    closedAt: string | null;
    /** Something has arrived, but not everything. */
    partReceived: boolean;
    estimatedTotal: number | null;
    lines: PurchaseOrderLine[];
}

/** A line the store should be ordering, off its own reorder points. */
export interface SuggestedOrderLine {
    itemId: number;
    name: string;
    stockUnit: string;
    inStore: number;
    reorderPoint: number;
    parLevel: number;
    itemPackId: number | null;
    packName: string | null;
    qtyInStockUnit: number | null;
    suggestedPacks: number;
    lastPrice: number | null;
}

// ── Admin ───────────────────────────────────────────────────────────────────
export interface ManagedUser {
    id: number;
    name: string;
    role: Role;
    locationId: number | null;
    locationCode: string | null;
    phone: string | null;
    isActive: boolean;
    isLocked: boolean;
}

export interface Branch {
    id: number;
    code: string;
    name: string;
}

// ── Session ─────────────────────────────────────────────────────────────────
export interface SessionUser {
    id: number;
    name: string;
    role: Role;
    /** Null for group-wide roles (owner). */
    homeLocationId: number | null;
}

export interface LocationRef {
    id: number;
    code: string;
    name: string;
}

export interface ActiveLocation extends LocationRef {
    /** Business-day cut-off, e.g. '06:00' - '04:00' at the 24-hour site. */
    dayStart: string;
}

export interface Section {
    id: number;
    code: string;
    name: string;
    /**
     * What kind of room it is - STORE, KITCHEN, CLEAN, QUARANTINE. `code`
     * is a short label the admin picks; the kind is what carries the meaning.
     */
    kind: string;
    isStore: boolean;
    /**
     * False once a section has been switched off in setup. Retired sections
     * are still sent so old documents keep their section name; anything that
     * files new work has to leave them out.
     */
    isActive: boolean;
}

export interface SessionResponse {
    accessToken: string;
    refreshToken: string;
    user: SessionUser;
    location: ActiveLocation;
    locations: LocationRef[];
    sections: Section[];
}

export interface BootstrapResponse {
    locations: LocationRef[];
    users: { id: number; name: string; role: Role; locationId: number | null }[];
}

// ── Items and stock ─────────────────────────────────────────────────────────
export interface ItemPack {
    id: number;
    packName: string;
    /** How many stock units one pack holds. The only conversion factor. */
    qtyInStockUnit: number;
    isDefaultPurchase: boolean;
}

export interface Item {
    id: number;
    code: string;
    name: string;
    /** g, ml, ea - always the small unit. */
    stockUnit: string;
    categoryName: string;
    parLevel: number;
    reorderPoint: number;
    isCritical: boolean;
    packs: ItemPack[];
}

export interface Supplier {
    id: number;
    name: string;
    phone: string | null;
}

export interface StockRow {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    sectionId: number;
    sectionCode: string;
    qtyBase: number;
    avgCost: number;
    value: number;
    reorderPoint: number;
    parLevel: number;
    isCritical: boolean;
    belowReorder: boolean;
}

/**
 * What every paginated list endpoint answers with.
 *
 * `total` is the size of the whole filtered set, not of `items` - that is the
 * whole point of it, and it is what lets a pager know there is a page 9.
 */
export interface Page<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    pageCount: number;
}

/** Query half of the same contract. One-based page, as the API expects. */
export interface PageRequest {
    page?: number;
    limit?: number;
}

export const DEFAULT_PAGE_SIZE = 25;

/** An empty page, for a list that has not loaded yet. */
export function emptyPage<T>(limit = DEFAULT_PAGE_SIZE): Page<T> {
    return { items: [], total: 0, page: 1, limit, pageCount: 1 };
}

/** Stock carries the value of everything matched, not just the page shown. */
export type StockResponse = Page<StockRow> & { totalValue: number };

// ── GRN ─────────────────────────────────────────────────────────────────────
export interface GrnLineInput {
    itemPackId: number;
    /** Packs, never stock units. The conversion happens server-side, once. */
    qtyPacks: number;
    packPrice: number;
    expiryDate?: string | null;
}

export interface GrnInput {
    supplierId: number;
    /** Set when this delivery is against a purchase order. */
    poId?: string | null;
    invoiceNo?: string | null;
    invoiceDate?: string | null;
    photoUrl?: string | null;
    lines: GrnLineInput[];
}

export interface PriceWarning {
    itemPackId: number;
    itemName: string;
    packName: string;
    previousPrice: number;
    newPrice: number;
    changePct: number;
}

export interface GrnResult {
    id: string;
    total: number;
    businessDate: string;
    lineCount: number;
    priceWarnings: PriceWarning[];
}

export interface GrnListRow {
    id: string;
    supplierName: string;
    invoiceNo: string | null;
    invoiceDate: string | null;
    receivedAt: string;
    receivedBy: string;
    /** Set when this delivery filled a purchase order. */
    poId: string | null;
    total: number | null;
    lineCount: number;
}

/** One line of a delivery, read back after the fact. */
export interface GrnDetailLine {
    id: string;
    itemId: number;
    itemCode: string;
    itemName: string;
    stockUnit: string;
    packName: string;
    qtyInStockUnit: number;
    qtyPacks: number;
    packPrice: number;
    /** What it put on the shelf, in stock units. */
    qtyBase: number;
    lineTotal: number;
    /** Packs already sent back to the supplier against this line. */
    qtyPacksReturned: number;
}

export interface GrnDetail {
    id: string;
    supplierId: number;
    supplierName: string;
    invoiceNo: string | null;
    invoiceDate: string | null;
    receivedAt: string;
    receivedBy: string;
    poId: string | null;
    photoUrl: string | null;
    total: number;
    lines: GrnDetailLine[];
}

// ── Issues ──────────────────────────────────────────────────────────────────
export interface IssueListRow {
    id: string;
    sectionCode: string;
    sectionName: string;
    status: string;
    requestedBy: string;
    requestedAt: string;
    lineCount: number;
}

export interface IssueLine {
    lineId: string;
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    qtyRequested: number;
    qtyIssued: number | null;
    availableInStore: number;
}

export interface IssueDetail {
    id: string;
    status: string;
    toSectionId: number;
    lines: IssueLine[];
}

export interface FulfilResult {
    id: string;
    businessDate: string;
    linesIssued: number;
    /** Advisory. An off-window issue is recorded, never refused. */
    windowWarning: string | null;
    shortfalls: { itemName: string; requested: number; issued: number; available: number }[];
}

export interface IssueWindow {
    at: string;
    label: string;
}

// ── Returns ─────────────────────────────────────────────────────────────────
// Two documents. A section hands stock back into quarantine and the ledger
// moves at once; the store hands it to the vendor and the ledger moves only
// when it is sent.

export interface SectionReturnRow {
    id: string;
    itemId: number;
    itemName: string;
    stockUnit: string;
    qtyBase: number;
    fromSection: string;
    reasonCode: string;
    reasonLabel: string;
    note: string | null;
    photoUrl: string | null;
    returnedBy: string;
    returnedAt: string;
    approvedBy: string | null;
    /** Already on a supplier return, so it is not waiting for one. */
    onSupplierReturn: boolean;
}

/**
 * One line of a request, with how much of it can still be handed back.
 *
 * `qtyReturnable` is already the min of what was released, what has not gone
 * back yet, and what the section still holds - so a screen can cap an input on
 * it without doing the arithmetic itself.
 */
export interface IssueReturnableLine {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    qtyIssued: number;
    qtyReturned: number;
    qtyReturnable: number;
    qtyHeld: number;
}

export interface IssueReturnable {
    sectionId: number;
    status: string;
    daysSinceReleased: number | null;
    /** False once the return window has closed. Nothing is returnable then. */
    withinWindow: boolean;
    lines: IssueReturnableLine[];
}

/**
 * How long a release stays returnable, mirrored from the API so a screen can
 * explain a withheld button rather than just withholding it.
 */
export const RETURN_WINDOW_DAYS = 7;

/** One line of a delivery, with how much of it can still go back. */
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
    /** What quarantine actually holds, which caps what can be sent. */
    qtyInQuarantine: number;
}

/**
 * A supplier return the system has already worked out, from what is sitting in
 * quarantine. The delivery is a best guess and stays editable - nothing in the
 * ledger links a crate to the invoice it arrived on.
 */
/**
 * One line of the quarantine shelf, with how much of it is already spoken for.
 *
 * Plain stock says what is physically there and nothing about whether anybody
 * is already dealing with it, which is how the Returns screen came to offer
 * "ask management" for a crate that was already sitting on an ask.
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

export interface SuggestedReturnLine {
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

export type SupplierReturnStatus = 'raised' | 'approved' | 'rejected' | 'sent' | 'settled';
export type SupplierReturnOutcome = 'credit' | 'replacement' | 'written_off';

export const SUPPLIER_RETURN_STATUS_LABELS: Record<SupplierReturnStatus, string> = {
    raised: 'Waiting for a decision',
    approved: 'Approved, not yet sent',
    rejected: 'Rejected',
    sent: 'Sent, waiting on the supplier',
    settled: 'Settled'
};

export const SUPPLIER_RETURN_OUTCOME_LABELS: Record<SupplierReturnOutcome, string> = {
    credit: 'Credit note',
    replacement: 'Replaced',
    written_off: 'Written off'
};

/** What management answered for one line of an ask: claim it, or bin it. */
export type DisposalDecision = 'vendor' | 'waste';

export const DISPOSAL_LABELS: Record<DisposalDecision, string> = {
    vendor: 'Back to the supplier',
    waste: 'Into the bin'
};

export interface SupplierReturnLine {
    id: string;
    grnLineId: string;
    itemId: number;
    itemName: string;
    stockUnit: string;
    packName: string;
    qtyPacks: number;
    qtyBase: number;
    packPrice: number;
    lineCredit: number;
    /** Null until management has answered. */
    decision: DisposalDecision | null;
    /** A waste line the store has actually binned. */
    binned: boolean;
}

export interface SupplierReturnRow {
    id: string;
    status: SupplierReturnStatus;
    supplierId: number;
    supplierName: string;
    grnId: string;
    invoiceNo: string | null;
    reasonCode: string;
    reasonLabel: string;
    note: string | null;
    raisedBy: string;
    raisedAt: string;
    decidedBy: string | null;
    decisionNote: string | null;
    sentAt: string | null;
    outcome: SupplierReturnOutcome | null;
    creditNoteNo: string | null;
    creditValue: number | null;
    settledAt: string | null;
    /**
     * What is being claimed from the supplier. Before a decision that is every
     * line; afterwards only the lines management said to claim.
     */
    expectedCredit: number;
    /** The other half: what was decided into the bin, at invoice value. */
    writtenOffValue: number;
    lines: SupplierReturnLine[];
}

// ── Returns reports ─────────────────────────────────────────────────────────

export interface ReturnsSummaryRow {
    reasonCode: string;
    reasonLabel: string;
    sectionReturns: number;
    sectionQtyValue: number;
    supplierReturns: number;
    supplierValue: number;
    creditedValue: number;
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
    daysWaiting: number;
    expectedCredit: number;
    lines: number;
}

// ── Wastage ─────────────────────────────────────────────────────────────────
export interface ReasonCode {
    code: string;
    doc: string;
    label: string;
}

export interface WastageRow {
    id: string;
    itemName: string;
    sectionCode: string;
    qtyBase: number;
    stockUnit: string;
    reasonCode: string;
    reasonLabel: string;
    loggedBy: string;
    loggedAt: string;
    approved: boolean;
}

// ── Counts ──────────────────────────────────────────────────────────────────
export type CountType = 'daily_critical' | 'weekly_full' | 'monthly_full';

export interface CountLine {
    lineId: string;
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    /** Frozen when the count opened, never re-read. */
    qtyExpected: number;
    qtyCounted: number | null;
}

export interface CountDetail {
    id: string;
    countType: string;
    sectionId: number;
    businessDate: string;
    closed: boolean;
    verified: boolean;
    lines: CountLine[];
}

export interface CountListRow {
    id: string;
    countType: string;
    sectionCode: string;
    businessDate: string;
    countedBy: string;
    closed: boolean;
    verified: boolean;
}

export interface CloseCountResult {
    id: string;
    adjustments: number;
    varianceValue: number;
    /** Lines somebody entered a figure for. */
    counted: number;
    /** Lines left blank, and therefore left untouched. */
    skipped: number;
    biggest: { name: string; varianceQty: number; varianceValue: number }[];
}

// ── Uploads ─────────────────────────────────────────────────────────────────
// Wastage photos and delivery slips.
export interface UploadResult {
    url: string;
    filename: string;
}

// ── Reports ─────────────────────────────────────────────────────────────────
export interface DateRange {
    from: string;
    to: string;
}

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

export interface ShrinkageRow {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    sectionCode: string;
    businessDate: string;
    varianceQty: number;
    varianceValue: number;
    variancePct: number | null;
    /** A gap with a document behind it is explained; it is not shrinkage. */
    hasWastageDoc: boolean;
}

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

export interface WastageReportRow {
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

export interface WastageReport extends DateRange {
    rows: WastageReportRow[];
    byReason: { reasonCode: string; reasonLabel: string; events: number; value: number }[];
    totalValue: number;
}

export interface StockOutRow {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    sectionCode: string;
    businessDate: string;
    balance: number;
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

export interface UsageTrendPoint {
    businessDate: string;
    theoreticalQty: number;
    actualQty: number;
}

// ── Setup: the master data the owner builds the system out of ───────────────

export type StorageType =
    | 'dry'
    | 'chiller'
    | 'freezer'
    | 'bar'
    | 'chemical'
    | 'packaging'
    | 'gas';

export const STORAGE_LABELS: Record<StorageType, string> = {
    dry: 'Dry store',
    chiller: 'Chiller',
    freezer: 'Freezer',
    bar: 'Bar',
    chemical: 'Chemicals',
    packaging: 'Packaging',
    gas: 'Gas'
};

export interface SetupCategory {
    id: number;
    name: string;
    storage: StorageType;
    isActive: boolean;
    itemCount: number;
}

export interface SetupPack {
    id: number;
    packName: string;
    qtyInStockUnit: number;
    isDefaultPurchase: boolean;
    isActive: boolean;
    /** On a delivery or an order already: its size is now history. */
    inUse: boolean;
}

export interface SetupItem {
    id: number;
    code: string;
    name: string;
    categoryId: number;
    categoryName: string;
    stockUnit: string;
    parLevel: number;
    reorderPoint: number;
    shelfLifeDays: number | null;
    isCritical: boolean;
    isActive: boolean;
    /** Has moved, so the stock unit is frozen. */
    hasMoved: boolean;
    packs: SetupPack[];
}

export interface SetupSupplier {
    id: number;
    name: string;
    phone: string | null;
    vatNo: string | null;
    paymentTerms: string | null;
    isActive: boolean;
    deliveries: number;
}

/**
 * The last price a supplier charged for one pack.
 *
 * Read while a delivery is being typed, so a jump is questioned at the door
 * rather than found in a report. Same table the server warns from.
 */
export interface LastPrice {
    itemPackId: number;
    price: number;
    effectiveFrom: string;
}

export interface SupplierPrice {
    id: number;
    itemPackId: number;
    itemName: string;
    packName: string;
    price: number;
    effectiveFrom: string;
}

export interface SectionKind {
    kind: string;
    label: string;
    isStore: boolean;
    /**
     * The roles that stand at this kind of shelf. Sent by the server so a
     * screen can tell whether a person has anywhere to work at a branch
     * without keeping its own copy of the rule.
     */
    ownedBy: Role[];
}

export interface SetupSection {
    id: number;
    code: string;
    name: string;
    kind: string;
    kindLabel: string;
    isStore: boolean;
    isActive: boolean;
}

export interface SetupBranch {
    id: number;
    code: string;
    name: string;
    /** Business-day cut-off, e.g. '06:00'. */
    dayStart: string;
    isActive: boolean;
    sections: SetupSection[];
}


// ── Opening stock ───────────────────────────────────────────────────────────

export interface OpeningSection {
    sectionId: number;
    name: string;
    code: string;
    isStore: boolean;
    /** False once anything has moved: the opening balance is already set. */
    canOpen: boolean;
    /** A previous opening balance was entered here and then reversed. */
    previouslyReversed: boolean;
    openedOn: string | null;
}

export interface OpeningResult {
    id: string;
    businessDate: string;
    lineCount: number;
    totalValue: number;
}

// ── The operating reports ───────────────────────────────────────────────────
//
// Mirrors api/src/services/reports-ops.ts. All seven answer in the same
// `{ from, to, rows }` envelope so one runner on the Reports screen can drive
// every one of them.

/** A purchase order that has not been delivered, closed or rejected. */
export interface OpenPoRow {
    id: string;
    status: string;
    supplierName: string | null;
    raisedBy: string;
    raisedAt: string;
    neededBy: string | null;
    lineCount: number;
    daysOpen: number;
    daysLate: number;
    estimatedValue: number;
    outstandingValue: number;
}

/** How well the store served one section. */
export interface ServiceLevelRow {
    sectionId: number;
    sectionName: string;
    requests: number;
    stillWaiting: number;
    lines: number;
    linesInFull: number;
    linesShort: number;
    fillRatePct: number | null;
    qtyFillPct: number | null;
    avgHoursToRelease: number | null;
}

export interface SupplierPerformanceRow {
    supplierId: number;
    supplierName: string;
    orders: number;
    deliveries: number;
    fillRatePct: number | null;
    lateOrders: number;
    avgDaysToClose: number | null;
    spend: number;
    returns: number;
    returnedValue: number;
    creditedValue: number;
    netSpend: number;
    returnRatePct: number | null;
}

/** Value on hand for one item in one section, as at the end of the range. */
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

/** Stock on the shelf that nothing was issued from during the range. */
export interface DeadStockRow {
    itemId: number;
    code: string;
    name: string;
    stockUnit: string;
    sectionName: string;
    qtyBase: number;
    value: number;
    lastMovedOn: string | null;
    daysSinceMoved: number | null;
}

/** What one section drew from the store, at what it cost. */
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

export interface CountAccuracyRow {
    countedBy: string;
    sectionName: string;
    counts: number;
    lines: number;
    linesOff: number;
    accuracyPct: number | null;
    absVarianceValue: number;
}
