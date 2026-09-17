/**
 * Kysely types for the schema in db/migrations/0001_init.sql.
 *
 * Hand-written rather than generated: it is the same size either way, and this
 * way the file reviews like the schema does. `npm test` includes a check that
 * fails if these definitions drift from the live database, which catches the
 * thing codegen would have caught without a build-time database dependency.
 *
 * Numeric columns are typed `number`. node-postgres hands back `numeric` as a
 * string to preserve precision; src/db/index.ts overrides that parser because
 * every magnitude in this schema is comfortably inside IEEE-754's exact integer
 * range. All money and quantity *arithmetic* is still done in Postgres, never
 * in JavaScript -- see services/ledger.ts.
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type DateOnly = ColumnType<string, string, string>;

/**
 * Five roles, matching how the business is actually organised.
 *
 * The earlier eight-role model split the kitchen into chef, baker and bar, all
 * of whom do exactly one thing here: ask the store for stock. That distinction
 * cost users a "which one am I?" decision and bought nothing.
 */
export type UserRole = 'admin' | 'management' | 'storekeeper' | 'kitchen' | 'cleaning';

export type PoStatus = 'requested' | 'approved' | 'rejected' | 'ordered' | 'done';

export type StorageType =
    | 'dry'
    | 'chiller'
    | 'freezer'
    | 'bar'
    | 'chemical'
    | 'packaging'
    | 'gas';

export type DocType =
    | 'grn'
    // 'market' has no writer left -- the cash-purchase document was removed in
    // migration 0006 -- but stays in the enum because stock_ledger rows that
    // recorded one cannot be deleted. See that migration for the reasoning.
    | 'market'
    | 'issue'
    | 'return'
    | 'wastage'
    | 'transfer'
    | 'count'
    | 'production'
    | 'opening';

export type SupplierReturnStatus =
    | 'raised'
    | 'approved'
    | 'rejected'
    | 'sent'
    | 'settled';

/** What the supplier did about it. Null until settled. */
export type SupplierReturnOutcome = 'credit' | 'replacement' | 'written_off';

export interface LocationsTable {
    id: Generated<number>;
    code: string;
    name: string;
    day_start: string;
    is_active: Generated<boolean>;
    is_demo: Generated<boolean>;
}

export interface SectionsTable {
    id: Generated<number>;
    location_id: number;
    code: string;
    name: string;
    /**
     * What kind of place this is, and therefore who may use it. Kept apart
     * from `code` so a branch can hold two kitchens -- a pastry room is of
     * kind KITCHEN without having to be called KITCHEN. The permitted values
     * live in plugins/auth.ts, SECTION_KINDS, and nowhere else.
     */
    kind: string;
    is_store: Generated<boolean>;
    is_active: Generated<boolean>;
    is_demo: Generated<boolean>;
}

export interface UsersTable {
    id: Generated<number>;
    location_id: number | null;
    name: string;
    phone: string | null;
    role: UserRole;
    pin_hash: string;
    is_active: Generated<boolean>;
    is_demo: Generated<boolean>;
}

export interface SuppliersTable {
    id: Generated<number>;
    name: string;
    phone: string | null;
    vat_no: string | null;
    payment_terms: string | null;
    is_active: Generated<boolean>;
    is_demo: Generated<boolean>;
}

export interface ItemCategoriesTable {
    id: Generated<number>;
    name: string;
    storage: StorageType;
    is_active: Generated<boolean>;
}

export interface ItemsTable {
    id: Generated<number>;
    code: string;
    name: string;
    name_si: string | null;
    category_id: number;
    stock_unit: string;
    par_level: Generated<number>;
    reorder_point: Generated<number>;
    shelf_life_days: number | null;
    is_critical: Generated<boolean>;
    is_active: Generated<boolean>;
    is_demo: Generated<boolean>;
}

export interface ItemPacksTable {
    id: Generated<number>;
    item_id: number;
    pack_name: string;
    qty_in_stock_unit: number;
    is_default_purchase: Generated<boolean>;
    is_active: Generated<boolean>;
    is_demo: Generated<boolean>;
}

export interface SupplierPricesTable {
    id: Generated<number>;
    supplier_id: number;
    item_pack_id: number;
    price: number;
    effective_from: DateOnly;
    is_demo: Generated<boolean>;
}

export interface ReasonCodesTable {
    code: string;
    doc: DocType;
    label: string;
}

export interface StockLedgerTable {
    id: Generated<string>;
    occurred_at: Generated<Ts>;
    business_date: DateOnly;
    location_id: number;
    section_id: number;
    item_id: number;
    qty_base: number;
    unit_cost: number;
    doc: DocType;
    doc_id: string | number;
    doc_line: number | null;
    reason_code: string | null;
    created_by: number;
    is_reversal: Generated<boolean>;
    reverses_id: string | null;
    note: string | null;
    is_demo: Generated<boolean>;
}

export interface ItemCostStateTable {
    item_id: number;
    location_id: number;
    qty_on_hand: Generated<number>;
    avg_cost: Generated<number>;
    updated_at: Generated<Ts>;
}

export interface GrnTable {
    id: Generated<string>;
    location_id: number;
    supplier_id: number;
    invoice_no: string | null;
    invoice_date: DateOnly | null;
    received_at: Generated<Ts>;
    received_by: number;
    photo_url: string | null;
    total: number | null;
    /** Set when this delivery was entered against a purchase order. */
    po_id: string | null;
    is_demo: Generated<boolean>;
}

export interface GrnLinesTable {
    id: Generated<string>;
    grn_id: string | number;
    item_pack_id: number;
    qty_packs: number;
    pack_price: number;
    expiry_date: DateOnly | null;
    is_demo: Generated<boolean>;
}

export interface IssuesTable {
    id: Generated<string>;
    location_id: number;
    to_section_id: number;
    requested_by: number;
    issued_by: number | null;
    requested_at: Generated<Ts>;
    issued_at: Ts | null;
    /** requested | released | received | cancelled */
    status: Generated<string>;
    /** When the section says they need it by. */
    needed_by: DateOnly | null;
    note: string | null;
    approved_by: number | null;
    approved_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
    /** The requester confirming it physically arrived. */
    received_by: number | null;
    received_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
    is_demo: Generated<boolean>;
}

export interface PurchaseOrdersTable {
    id: Generated<string>;
    location_id: number;
    issue_id: string | null;
    raised_by: number;
    raised_at: Generated<Ts>;
    /** Who it is being bought from. Often unknown when the order is raised. */
    supplier_id: number | null;
    needed_by: DateOnly | null;
    reason: string | null;
    status: Generated<PoStatus>;
    decided_by: number | null;
    decided_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
    decision_note: string | null;
    /** Every line received, or closed short by management. */
    closed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
    is_demo: Generated<boolean>;
}

export interface PurchaseOrderLinesTable {
    id: Generated<string>;
    po_id: string | number;
    item_id: number;
    qty_base: number;
    qty_in_store: Generated<number>;
    /**
     * The pack it is ordered in, and how many. Null only on orders raised
     * before packs existed on this table; the API requires both on new ones.
     */
    item_pack_id: number | null;
    qty_packs: number | null;
    /** Estimated price for ONE pack, matching grn_lines.pack_price. */
    est_price: number | null;
    /** Accumulated across deliveries, in stock units. */
    qty_received_base: Generated<number>;
    is_demo: Generated<boolean>;
}

export interface OpeningStockTable {
    id: Generated<string>;
    location_id: number;
    section_id: number;
    business_date: DateOnly;
    entered_by: number;
    entered_at: Generated<Ts>;
    note: string | null;
    is_demo: Generated<boolean>;
}

export interface OpeningStockLinesTable {
    id: Generated<string>;
    opening_id: string | number;
    item_id: number;
    qty_base: number;
    unit_cost: number;
    is_demo: Generated<boolean>;
}

export interface IssueLinesTable {
    id: Generated<string>;
    issue_id: string | number;
    item_id: number;
    qty_requested: number;
    qty_issued: number | null;
    is_demo: Generated<boolean>;
}

export interface WastageTable {
    id: Generated<string>;
    location_id: number;
    section_id: number;
    item_id: number;
    qty_base: number;
    reason_code: string;
    photo_url: string | null;
    logged_by: number;
    logged_at: Generated<Ts>;
    approved_by: number | null;
    is_demo: Generated<boolean>;
}

export interface TransfersTable {
    id: Generated<string>;
    from_section_id: number;
    to_section_id: number;
    item_id: number;
    qty_base: number;
    sent_by: number;
    received_by: number | null;
    sent_at: Generated<Ts>;
    received_at: Ts | null;
    is_demo: Generated<boolean>;
}

export interface StockCountsTable {
    id: Generated<string>;
    location_id: number;
    section_id: number;
    count_type: string;
    business_date: DateOnly;
    counted_by: number;
    verified_by: number | null;
    closed_at: Ts | null;
    is_demo: Generated<boolean>;
}

export interface StockCountLinesTable {
    id: Generated<string>;
    count_id: string | number;
    item_id: number;
    qty_expected: number;
    /** Null until counted - see migration 0004. Close skips null lines. */
    qty_counted: number | null;
    variance_value: number;
    is_demo: Generated<boolean>;
}

export interface ProductsTable {
    id: Generated<number>;
    location_id: number;
    code: string;
    name: string;
    section_id: number;
    yield_qty: Generated<number>;
    is_active: Generated<boolean>;
    is_demo: Generated<boolean>;
}

export interface RecipeLinesTable {
    id: Generated<string>;
    product_id: number;
    item_id: number;
    qty_base: number;
    is_demo: Generated<boolean>;
}

export interface ProductionLogTable {
    id: Generated<string>;
    location_id: number;
    section_id: number;
    business_date: DateOnly;
    product_id: number;
    qty_made: number;
    logged_by: number;
    is_demo: Generated<boolean>;
}

export interface LoginAttemptsTable {
    user_id: number;
    failed_count: Generated<number>;
    locked_until: ColumnType<Date | null, Date | null | undefined, Date | null>;
    // Not Generated<Ts>: nesting ColumnType inside Generated loses the insert
    // type. Plain ColumnType with `undefined` in the insert position already
    // makes the column optional, which is what the DB default needs.
    last_attempt_at: Ts;
}

export interface IdempotencyKeysTable {
    key: string;
    endpoint: string;
    request_hash: string;
    response: unknown | null;
    status_code: number | null;
    user_id: number | null;
    created_at: Generated<Ts>;
}

export interface SettingsTable {
    location_id: number;
    key: string;
    value: unknown;
    updated_at: Generated<Ts>;
}

export interface AuditLogTable {
    id: Generated<string>;
    at: Generated<Ts>;
    user_id: number | null;
    action: string;
    entity: string;
    entity_id: string | null;
    before: unknown | null;
    after: unknown | null;
}

// ── Views ───────────────────────────────────────────────────────────────────

export interface CurrentStockView {
    location_id: number;
    section_id: number;
    item_id: number;
    qty_base: number;
}

export interface CurrentStockValuedView {
    location_id: number;
    section_id: number;
    item_id: number;
    qty_base: number;
    avg_cost: number;
    value: number;
}

export interface UsageVarianceView {
    location_id: number;
    business_date: DateOnly;
    section_id: number;
    item_id: number;
    theoretical_qty: number;
    actual_qty: number;
    variance_qty: number;
    variance_pct: number | null;
}

export interface SectionReturnsTable {
    id: Generated<string>;
    location_id: number;
    from_section_id: number;
    to_section_id: number;
    item_id: number;
    qty_base: number;
    reason_code: string;
    note: string | null;
    photo_url: string | null;
    issue_id: string | number | null;
    returned_by: number;
    returned_at: Generated<Ts>;
    approved_by: number | null;
    approved_at: Ts | null;
    is_demo: Generated<boolean>;
}

export interface SupplierReturnsTable {
    id: Generated<string>;
    location_id: number;
    supplier_id: number;
    grn_id: string | number;
    status: Generated<SupplierReturnStatus>;
    reason_code: string;
    note: string | null;
    raised_by: number;
    raised_at: Generated<Ts>;
    decided_by: number | null;
    decided_at: Ts | null;
    decision_note: string | null;
    sent_by: number | null;
    sent_at: Ts | null;
    outcome: SupplierReturnOutcome | null;
    credit_note_no: string | null;
    credit_value: number | null;
    settled_by: number | null;
    settled_at: Ts | null;
    settle_note: string | null;
    is_demo: Generated<boolean>;
}

/** What management answered for one line: claim it, or bin it. */
export type DisposalDecision = 'vendor' | 'waste';

export interface SupplierReturnLinesTable {
    id: Generated<string>;
    return_id: string | number;
    grn_line_id: string | number;
    item_id: number;
    qty_packs: number;
    qty_base: number;
    pack_price: number;
    line_credit: number;
    section_return_id: string | number | null;
    /**
     * Null until management has answered. See migration 0008: the store asks
     * one question about bad stock and management answers it line by line.
     */
    decision: DisposalDecision | null;
    /** The wastage document this line was binned under, once it has been. */
    wastage_id: string | number | null;
    is_demo: Generated<boolean>;
}

export interface Database {
    locations: LocationsTable;
    sections: SectionsTable;
    users: UsersTable;
    suppliers: SuppliersTable;
    item_categories: ItemCategoriesTable;
    items: ItemsTable;
    item_packs: ItemPacksTable;
    supplier_prices: SupplierPricesTable;
    reason_codes: ReasonCodesTable;
    stock_ledger: StockLedgerTable;
    item_cost_state: ItemCostStateTable;
    grn: GrnTable;
    grn_lines: GrnLinesTable;
    issues: IssuesTable;
    issue_lines: IssueLinesTable;
    wastage: WastageTable;
    transfers: TransfersTable;
    stock_counts: StockCountsTable;
    stock_count_lines: StockCountLinesTable;
    products: ProductsTable;
    recipe_lines: RecipeLinesTable;
    production_log: ProductionLogTable;
    idempotency_keys: IdempotencyKeysTable;
    login_attempts: LoginAttemptsTable;
    purchase_orders: PurchaseOrdersTable;
    purchase_order_lines: PurchaseOrderLinesTable;
    section_returns: SectionReturnsTable;
    supplier_returns: SupplierReturnsTable;
    supplier_return_lines: SupplierReturnLinesTable;
    opening_stock: OpeningStockTable;
    opening_stock_lines: OpeningStockLinesTable;
    settings: SettingsTable;
    audit_log: AuditLogTable;
    current_stock: CurrentStockView;
    current_stock_valued: CurrentStockValuedView;
    usage_variance: UsageVarianceView;
}

export type Item = Selectable<ItemsTable>;
export type NewGrn = Insertable<GrnTable>;
export type UserRow = Selectable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
