/**
 * All API access. Components never call HttpClient directly - the template's
 * own guardrail ("keep API integration in services only"), and it keeps the
 * request shapes in one place when the contract moves.
 */
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './api';
import type {
    BootstrapResponse,
    Branch,
    ConsumptionRow,
    CountAccuracyRow,
    DeadStockRow,
    OpenPoRow,
    ServiceLevelRow,
    SupplierPerformanceRow,
    ValuationRow,
    CloseCountResult,
    CountDetail,
    CountLine,
    BelowReorderRow,
    CountListRow,
    DateRange,
    CountType,
    GrnInput,
    GrnDetail,
    GrnListRow,
    GrnResult,
    LastPrice,
    IssueDetail,
    IssueWindow,
    Item,
    ManagedUser,
    MyContext,
    PoDecision,
    PurchaseOrder,
    ReleaseResult,
    RequestRow,
    Role,
    Shortage,
    PriceMovementRow,
    OpeningResult,
    OpeningSection,
    ReasonCode,
    IssueReturnable,
    OpenReturnRow,
    ReturnableLine,
    ReturnsSummaryRow,
    SectionReturnRow,
    QuarantineRow,
    SuggestedReturn,
    SupplierReturnOutcome,
    SupplierReturnRow,
    DisposalDecision,
    SupplierReturnStatus,
    SectionKind,
    SessionResponse,
    SetupBranch,
    SetupCategory,
    SetupItem,
    SetupSupplier,
    SuggestedOrderLine,
    SupplierPrice,
    ShrinkageRow,
    StockOutRow,
    StockResponse,
    Supplier,
    UploadResult,
    UsageTrendPoint,
    UsageVarianceRow,
    WastageReport,
    WastageRow,
    Page,
    PageRequest
} from './types';

/** Query params common to every paginated list call. */
function pageParams(opts: PageRequest): Record<string, string> {
    const params: Record<string, string> = {};
    if (opts.page) params['page'] = String(opts.page);
    if (opts.limit) params['limit'] = String(opts.limit);
    return params;
}

@Injectable({ providedIn: 'root' })
export class GrandService {
    private http = inject(HttpClient);

    // ── Auth ────────────────────────────────────────────────────────────────

    bootstrap(): Promise<BootstrapResponse> {
        return firstValueFrom(this.http.get<BootstrapResponse>(`${API_BASE}/auth/bootstrap`));
    }

    login(userId: number, locationId: number, pin: string): Promise<SessionResponse> {
        return firstValueFrom(
            this.http.post<SessionResponse>(`${API_BASE}/auth/login`, { userId, locationId, pin })
        );
    }

    // ── Master data ─────────────────────────────────────────────────────────

    /**
     * `mySection` narrows the list to what the caller's own section actually
     * deals in - the kitchen's 22 rather than all 100. The server works that out
     * from the section's own history; there is no catalogue to maintain.
     */
    listItems(opts: { search?: string; mySection?: boolean } = {}): Promise<Item[]> {
        const params: Record<string, string> = {};
        if (opts.search) params['search'] = opts.search;
        if (opts.mySection) params['mySection'] = 'true';
        return firstValueFrom(this.http.get<Item[]>(`${API_BASE}/items`, { params }));
    }

    listSuppliers(): Promise<Supplier[]> {
        return firstValueFrom(this.http.get<Supplier[]>(`${API_BASE}/suppliers`));
    }

    // ── Stock ───────────────────────────────────────────────────────────────

    getStock(
        opts: { sectionId?: number; search?: string; belowReorder?: boolean } & PageRequest = {}
    ): Promise<StockResponse> {
        const params = pageParams(opts);
        if (opts.sectionId) params['sectionId'] = String(opts.sectionId);
        if (opts.search) params['search'] = opts.search;
        if (opts.belowReorder) params['belowReorder'] = 'true';
        return firstValueFrom(this.http.get<StockResponse>(`${API_BASE}/stock`, { params }));
    }

    // ── Documents ───────────────────────────────────────────────────────────

    /**
     * The idempotency key belongs to the *form*, not to this call. It is minted
     * when the user opens the GRN screen and passed in here, so a double-tap on
     * a slow connection replays rather than receiving the delivery twice.
     */
    createGrn(input: GrnInput, idempotencyKey: string): Promise<GrnResult> {
        return firstValueFrom(
            this.http.post<GrnResult>(`${API_BASE}/grn`, input, {
                headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey })
            })
        );
    }

    /**
     * What this supplier charged last time, per pack, so the price field can
     * say so while it is being typed rather than after the delivery is saved.
     */
    lastPrices(supplierId: number): Promise<LastPrice[]> {
        return firstValueFrom(
            this.http.get<LastPrice[]>(`${API_BASE}/suppliers/${supplierId}/last-prices`)
        );
    }

    listGrn(opts: { search?: string } & PageRequest = {}): Promise<Page<GrnListRow>> {
        const params = pageParams(opts);
        if (opts.search) params['search'] = opts.search;
        return firstValueFrom(this.http.get<Page<GrnListRow>>(`${API_BASE}/grn`, { params }));
    }

    /** One delivery, with its lines and what has gone back against them. */
    getGrn(id: string): Promise<GrnDetail> {
        return firstValueFrom(this.http.get<GrnDetail>(`${API_BASE}/grn/${id}`));
    }

    // ── Who am I ────────────────────────────────────────────────────────────

    myContext(): Promise<MyContext> {
        return firstValueFrom(this.http.get<MyContext>(`${API_BASE}/me/context`));
    }

    // ── Requests: ask → release → confirm ───────────────────────────────────

    listRequests(
        opts: {
            status?: string;
            mineOnly?: boolean;
            needsMe?: boolean;
            sectionId?: number;
        } & PageRequest = {}
    ): Promise<Page<RequestRow>> {
        const params = pageParams(opts);
        if (opts.status) params['status'] = opts.status;
        if (opts.mineOnly) params['mineOnly'] = 'true';
        if (opts.needsMe) params['needsMe'] = 'true';
        if (opts.sectionId) params['sectionId'] = String(opts.sectionId);
        return firstValueFrom(this.http.get<Page<RequestRow>>(`${API_BASE}/requests`, { params }));
    }

    /** Ask the store before submitting, so a shortage can be shown up front. */
    checkStore(lines: { itemId: number; qtyRequested: number }[]): Promise<{ shortages: Shortage[] }> {
        return firstValueFrom(
            this.http.post<{ shortages: Shortage[] }>(`${API_BASE}/requests/check`, { lines })
        );
    }

    ask(body: {
        sectionId?: number;
        neededBy?: string | null;
        note?: string | null;
        lines: { itemId: number; qtyRequested: number }[];
    }): Promise<{ id: string; shortages: Shortage[] }> {
        return firstValueFrom(
            this.http.post<{ id: string; shortages: Shortage[] }>(`${API_BASE}/requests`, body)
        );
    }

    releaseRequest(
        id: string,
        lines: { lineId: string; qtyIssued: number }[],
        idempotencyKey: string
    ): Promise<ReleaseResult> {
        return firstValueFrom(
            this.http.post<ReleaseResult>(
                `${API_BASE}/requests/${id}/release`,
                { lines },
                { headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }) }
            )
        );
    }

    confirmReceived(id: string): Promise<{ ok: true }> {
        return firstValueFrom(this.http.post<{ ok: true }>(`${API_BASE}/requests/${id}/confirm`, {}));
    }

    cancelRequest(id: string): Promise<{ ok: true }> {
        return firstValueFrom(this.http.post<{ ok: true }>(`${API_BASE}/requests/${id}/cancel`, {}));
    }

    /** The lines of one request, for the release screen. */
    getRequest(id: string): Promise<IssueDetail> {
        return firstValueFrom(this.http.get<IssueDetail>(`${API_BASE}/requests/${id}`));
    }

    issueWindows(): Promise<IssueWindow[]> {
        return firstValueFrom(this.http.get<IssueWindow[]>(`${API_BASE}/issue-windows`));
    }

    // ── Purchase orders ─────────────────────────────────────────────────────

    listPurchaseOrders(
        opts: { status?: string; open?: boolean; mine?: boolean } & PageRequest = {}
    ): Promise<Page<PurchaseOrder>> {
        const params = pageParams(opts);
        if (opts.status) params['status'] = opts.status;
        // Everything not yet delivered or rejected, in one filter -- what the
        // delivery screen needs to offer, including the ones still waiting on
        // management so the storekeeper can see why they cannot pick them.
        if (opts.open) params['open'] = 'true';
        if (opts.mine) params['mine'] = 'true';
        return firstValueFrom(
            this.http.get<Page<PurchaseOrder>>(`${API_BASE}/purchase-orders`, { params })
        );
    }

    /** Ordered in packs: what you say to a supplier, and what the invoice says. */
    raisePurchaseOrder(body: {
        issueId?: string | null;
        supplierId?: number | null;
        neededBy?: string | null;
        reason?: string | null;
        lines: { itemPackId: number; qtyPacks: number; estPrice?: number | null }[];
    }): Promise<{ id: string }> {
        return firstValueFrom(
            this.http.post<{ id: string }>(`${API_BASE}/purchase-orders`, body)
        );
    }

    decidePurchaseOrder(
        id: string,
        decision: PoDecision,
        note?: string | null,
        supplierId?: number | null
    ): Promise<{ ok: true }> {
        return firstValueFrom(
            this.http.post<{ ok: true }>(`${API_BASE}/purchase-orders/${id}/decide`, {
                decision,
                note: note ?? null,
                supplierId: supplierId ?? null
            })
        );
    }

    /** The rest is never coming. Takes a reason, because later somebody asks. */
    closePurchaseOrder(id: string, note: string): Promise<{ ok: true }> {
        return firstValueFrom(
            this.http.post<{ ok: true }>(`${API_BASE}/purchase-orders/${id}/close`, { note })
        );
    }

    suggestedOrder(): Promise<SuggestedOrderLine[]> {
        return firstValueFrom(
            this.http.get<SuggestedOrderLine[]>(`${API_BASE}/purchase-orders/suggested`)
        );
    }

    // -- Opening stock -------------------------------------------------------

    openingState(): Promise<OpeningSection[]> {
        return firstValueFrom(this.http.get<OpeningSection[]>(`${API_BASE}/opening-stock`));
    }

    createOpeningStock(
        body: {
            sectionId: number;
            note?: string | null;
            lines: { itemId: number; qtyBase: number; unitCost: number }[];
        },
        idempotencyKey: string
    ): Promise<OpeningResult> {
        return firstValueFrom(
            this.http.post<OpeningResult>(`${API_BASE}/opening-stock`, body, {
                headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey })
            })
        );
    }

    // -- Setup: master data --------------------------------------------------

    setupCategories(): Promise<SetupCategory[]> {
        return firstValueFrom(this.http.get<SetupCategory[]>(`${API_BASE}/setup/categories`));
    }

    createCategory(body: { name: string; storage: string }): Promise<{ id: number }> {
        return firstValueFrom(
            this.http.post<{ id: number }>(`${API_BASE}/setup/categories`, body)
        );
    }

    updateCategory(
        id: number,
        body: { name?: string; storage?: string; isActive?: boolean }
    ): Promise<{ ok: true }> {
        return firstValueFrom(
            this.http.patch<{ ok: true }>(`${API_BASE}/setup/categories/${id}`, body)
        );
    }

    setupItems(
        opts: { search?: string; categoryId?: number; includeRetired?: boolean } & PageRequest = {}
    ): Promise<Page<SetupItem>> {
        const params = pageParams(opts);
        if (opts.search) params['search'] = opts.search;
        if (opts.categoryId) params['categoryId'] = String(opts.categoryId);
        if (opts.includeRetired) params['includeRetired'] = 'true';
        return firstValueFrom(
            this.http.get<Page<SetupItem>>(`${API_BASE}/setup/items`, { params })
        );
    }

    createItem(body: {
        code: string;
        name: string;
        categoryId: number;
        stockUnit: string;
        parLevel?: number;
        reorderPoint?: number;
        shelfLifeDays?: number | null;
        isCritical?: boolean;
        packs: { packName: string; qtyInStockUnit: number; isDefaultPurchase?: boolean }[];
    }): Promise<{ id: number }> {
        return firstValueFrom(this.http.post<{ id: number }>(`${API_BASE}/setup/items`, body));
    }

    updateItem(
        id: number,
        body: {
            name?: string;
            categoryId?: number;
            stockUnit?: string;
            parLevel?: number;
            reorderPoint?: number;
            shelfLifeDays?: number | null;
            isCritical?: boolean;
            isActive?: boolean;
        }
    ): Promise<{ ok: true }> {
        return firstValueFrom(this.http.patch<{ ok: true }>(`${API_BASE}/setup/items/${id}`, body));
    }

    addPack(
        itemId: number,
        body: { packName: string; qtyInStockUnit: number; isDefaultPurchase?: boolean }
    ): Promise<{ id: number }> {
        return firstValueFrom(
            this.http.post<{ id: number }>(`${API_BASE}/setup/items/${itemId}/packs`, body)
        );
    }

    updatePack(
        id: number,
        body: {
            packName?: string;
            qtyInStockUnit?: number;
            isDefaultPurchase?: boolean;
            isActive?: boolean;
        }
    ): Promise<{ ok: true }> {
        return firstValueFrom(this.http.patch<{ ok: true }>(`${API_BASE}/setup/packs/${id}`, body));
    }

    setupSuppliers(
        opts: { search?: string; includeRetired?: boolean } & PageRequest = {}
    ): Promise<Page<SetupSupplier>> {
        const params = pageParams(opts);
        if (opts.search) params['search'] = opts.search;
        if (opts.includeRetired) params['includeRetired'] = 'true';
        return firstValueFrom(
            this.http.get<Page<SetupSupplier>>(`${API_BASE}/setup/suppliers`, { params })
        );
    }

    createSupplier(body: {
        name: string;
        phone?: string | null;
        vatNo?: string | null;
        paymentTerms?: string | null;
    }): Promise<{ id: number }> {
        return firstValueFrom(this.http.post<{ id: number }>(`${API_BASE}/setup/suppliers`, body));
    }

    updateSupplier(
        id: number,
        body: {
            name?: string;
            phone?: string | null;
                vatNo?: string | null;
            paymentTerms?: string | null;
            isActive?: boolean;
        }
    ): Promise<{ ok: true }> {
        return firstValueFrom(
            this.http.patch<{ ok: true }>(`${API_BASE}/setup/suppliers/${id}`, body)
        );
    }

    supplierPrices(id: number): Promise<SupplierPrice[]> {
        return firstValueFrom(
            this.http.get<SupplierPrice[]>(`${API_BASE}/setup/suppliers/${id}/prices`)
        );
    }

    addSupplierPrice(
        id: number,
        body: { itemPackId: number; price: number; effectiveFrom: string }
    ): Promise<{ id: number }> {
        return firstValueFrom(
            this.http.post<{ id: number }>(`${API_BASE}/setup/suppliers/${id}/prices`, body)
        );
    }

    setupBranches(): Promise<SetupBranch[]> {
        return firstValueFrom(this.http.get<SetupBranch[]>(`${API_BASE}/setup/branches`));
    }

    sectionKinds(): Promise<SectionKind[]> {
        return firstValueFrom(this.http.get<SectionKind[]>(`${API_BASE}/setup/section-kinds`));
    }

    createBranch(body: {
        code: string;
        name: string;
        dayStart?: string;
    }): Promise<{ id: number; storeSectionId: number }> {
        return firstValueFrom(
            this.http.post<{ id: number; storeSectionId: number }>(
                `${API_BASE}/setup/branches`,
                body
            )
        );
    }

    updateBranch(
        id: number,
        body: { name?: string; dayStart?: string; isActive?: boolean }
    ): Promise<{ ok: true }> {
        return firstValueFrom(
            this.http.patch<{ ok: true }>(`${API_BASE}/setup/branches/${id}`, body)
        );
    }

    createSection(body: {
        locationId: number;
        code: string;
        name: string;
        kind: string;
    }): Promise<{ id: number }> {
        return firstValueFrom(this.http.post<{ id: number }>(`${API_BASE}/setup/sections`, body));
    }

    updateSection(id: number, body: { name?: string; isActive?: boolean }): Promise<{ ok: true }> {
        return firstValueFrom(
            this.http.patch<{ ok: true }>(`${API_BASE}/setup/sections/${id}`, body)
        );
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    listUsers(opts: PageRequest = {}): Promise<Page<ManagedUser>> {
        return firstValueFrom(
            this.http.get<Page<ManagedUser>>(`${API_BASE}/admin/users`, { params: pageParams(opts) })
        );
    }

    listBranches(): Promise<Branch[]> {
        return firstValueFrom(this.http.get<Branch[]>(`${API_BASE}/admin/branches`));
    }

    createUser(body: {
        name: string;
        role: Role;
        locationId: number | null;
        pin: string;
        phone?: string | null;
    }): Promise<ManagedUser> {
        return firstValueFrom(this.http.post<ManagedUser>(`${API_BASE}/admin/users`, body));
    }

    updateUser(
        id: number,
        body: { role?: Role; locationId?: number | null; pin?: string; isActive?: boolean }
    ): Promise<{ ok: true }> {
        return firstValueFrom(this.http.patch<{ ok: true }>(`${API_BASE}/admin/users/${id}`, body));
    }

    unlockUser(id: number): Promise<{ ok: true }> {
        return firstValueFrom(
            this.http.post<{ ok: true }>(`${API_BASE}/admin/users/${id}/unlock`, {})
        );
    }

    // ── Wastage ─────────────────────────────────────────────────────────────

    reasonCodes(doc = 'wastage'): Promise<ReasonCode[]> {
        return firstValueFrom(
            this.http.get<ReasonCode[]>(`${API_BASE}/reason-codes`, { params: { doc } })
        );
    }

    listWastage(
        opts: { pendingOnly?: boolean } & PageRequest = {}
    ): Promise<Page<WastageRow>> {
        const params = pageParams(opts);
        if (opts.pendingOnly) params['pendingOnly'] = 'true';
        return firstValueFrom(this.http.get<Page<WastageRow>>(`${API_BASE}/wastage`, { params }));
    }

    logWastage(body: {
        sectionId: number;
        itemId: number;
        qtyBase: number;
        reasonCode: string;
        photoUrl?: string | null;
        note?: string | null;
    }): Promise<{ id: string; businessDate: string }> {
        return firstValueFrom(
            this.http.post<{ id: string; businessDate: string }>(`${API_BASE}/wastage`, body)
        );
    }

    approveWastage(id: string): Promise<{ ok: true }> {
        return firstValueFrom(this.http.post<{ ok: true }>(`${API_BASE}/wastage/${id}/approve`, {}));
    }

    // ── Counts ──────────────────────────────────────────────────────────────

    listCounts(opts: { openOnly?: boolean } & PageRequest = {}): Promise<Page<CountListRow>> {
        const params = pageParams(opts);
        if (opts.openOnly) params['openOnly'] = 'true';
        return firstValueFrom(this.http.get<Page<CountListRow>>(`${API_BASE}/counts`, { params }));
    }

    getCount(id: string): Promise<CountDetail> {
        return firstValueFrom(this.http.get<CountDetail>(`${API_BASE}/counts/${id}`));
    }

    openCount(sectionId: number, countType: CountType): Promise<{ id: string; lines: CountLine[] }> {
        return firstValueFrom(
            this.http.post<{ id: string; lines: CountLine[] }>(`${API_BASE}/counts/open`, {
                sectionId,
                countType
            })
        );
    }

    saveCountLines(
        id: string,
        lines: { lineId: string; qtyCounted: number | null }[]): Promise<{ ok: true }> {
        return firstValueFrom(
            this.http.put<{ ok: true }>(`${API_BASE}/counts/${id}/lines`, { lines })
        );
    }

    closeCount(id: string): Promise<CloseCountResult> {
        return firstValueFrom(this.http.post<CloseCountResult>(`${API_BASE}/counts/${id}/close`, {}));
    }

    verifyCount(id: string): Promise<{ ok: true }> {
        return firstValueFrom(this.http.post<{ ok: true }>(`${API_BASE}/counts/${id}/verify`, {}));
    }

    // ── Corrections ─────────────────────────────────────────────────────────

    /** The only way to undo a posted document. There is no edit and no delete. */
    reverseDocument(doc: string, id: string, reason: string): Promise<{ rowsReversed: number }> {
        return firstValueFrom(
            this.http.post<{ rowsReversed: number }>(`${API_BASE}/documents/${doc}/${id}/reverse`, {
                reason
            })
        );
    }

    // ── Uploads ─────────────────────────────────────────────────────────────

    /** Returns the URL to store on the document. */
    uploadPhoto(file: File): Promise<UploadResult> {
        const form = new FormData();
        form.append('file', file, file.name);
        // No Content-Type header on purpose: the browser has to set the
        // multipart boundary itself.
        return firstValueFrom(this.http.post<UploadResult>(`${API_BASE}/uploads`, form));
    }

    // ── Returns ─────────────────────────────────────────────────────────────

    /**
     * A section hands stock back. The ledger moves on this call.
     *
     * `issueId` is required for every section except the store: what can go back
     * is measured against the release that delivered it.
     */
    returnToStore(body: {
        sectionId: number;
        itemId: number;
        qtyBase: number;
        reasonCode: string;
        note?: string | null;
        photoUrl?: string | null;
        issueId?: string | null;
    }): Promise<{ id: string; businessDate: string; toSectionId: number }> {
        return firstValueFrom(
            this.http.post<{ id: string; businessDate: string; toSectionId: number }>(
                `${API_BASE}/returns`,
                body
            )
        );
    }

    listSectionReturns(
        opts: { pendingOnly?: boolean; awaitingSupplier?: boolean } & PageRequest = {}
    ): Promise<Page<SectionReturnRow>> {
        const params = pageParams(opts);
        if (opts.pendingOnly) params['pendingOnly'] = 'true';
        if (opts.awaitingSupplier) params['awaitingSupplier'] = 'true';
        return firstValueFrom(
            this.http.get<Page<SectionReturnRow>>(`${API_BASE}/returns`, { params })
        );
    }

    /** What can still be handed back off one request. */
    issueReturnable(issueId: string): Promise<IssueReturnable> {
        return firstValueFrom(
            this.http.get<IssueReturnable>(`${API_BASE}/requests/${issueId}/returnable`)
        );
    }

    /**
     * The quarantine shelf: what is there, and how much is already on an ask.
     *
     * Not plain stock. The Returns screen has to tell "waiting for somebody to
     * deal with it" apart from "already with management", and stock alone
     * cannot answer that.
     */
    quarantineContents(): Promise<QuarantineRow[]> {
        return firstValueFrom(this.http.get<QuarantineRow[]>(`${API_BASE}/quarantine`));
    }

    /** The lines of a delivery, with how much of each can still go back. */
    returnableLines(grnId: string): Promise<ReturnableLine[]> {
        return firstValueFrom(this.http.get<ReturnableLine[]>(`${API_BASE}/grn/${grnId}/returnable`));
    }

    /**
     * Everything in quarantine, already worked out into returns.
     *
     * What the Supplier returns screen opens on, so the storekeeper reads a
     * filled-in form instead of rebuilding it.
     */
    suggestedSupplierReturns(): Promise<SuggestedReturn[]> {
        return firstValueFrom(
            this.http.get<SuggestedReturn[]>(`${API_BASE}/supplier-returns/suggested`)
        );
    }

    raiseSupplierReturn(body: {
        grnId: string;
        reasonCode: string;
        note?: string | null;
        lines: { grnLineId: string; qtyPacks: number; sectionReturnId?: string | null }[];
    }): Promise<{ id: string; supplierId: number; lineCount: number; creditValue: number }> {
        return firstValueFrom(
            this.http.post<{
                id: string;
                supplierId: number;
                lineCount: number;
                creditValue: number;
            }>(`${API_BASE}/supplier-returns`, body)
        );
    }

    listSupplierReturns(
        opts: { status?: SupplierReturnStatus; openOnly?: boolean } & PageRequest = {}
    ): Promise<Page<SupplierReturnRow>> {
        const params = pageParams(opts);
        if (opts.status) params['status'] = opts.status;
        if (opts.openOnly) params['openOnly'] = 'true';
        return firstValueFrom(
            this.http.get<Page<SupplierReturnRow>>(`${API_BASE}/supplier-returns`, { params })
        );
    }

    /**
     * Management's answer, line by line: claim it, or bin it.
     *
     * Every line has to be answered - the server refuses a partial decision,
     * because a half-answered ask is how stock sits in quarantine for a month
     * with nobody refusing it and nobody claiming it.
     */
    decideDisposal(
        id: string,
        lines: { lineId: string; decision: DisposalDecision }[],
        note?: string | null
    ): Promise<{ id: string; toVendor: number; toWaste: number; creditValue: number }> {
        return firstValueFrom(
            this.http.post<{
                id: string;
                toVendor: number;
                toWaste: number;
                creditValue: number;
            }>(`${API_BASE}/supplier-returns/${id}/decide`, { lines, note: note ?? null })
        );
    }

    /** The store bins the lines management said to bin. One button. */
    binDecidedLines(
        id: string
    ): Promise<{ id: string; binned: number; alreadyBinned: number; qtyBase: number }> {
        return firstValueFrom(
            this.http.post<{
                id: string;
                binned: number;
                alreadyBinned: number;
                qtyBase: number;
            }>(`${API_BASE}/supplier-returns/${id}/bin`, {})
        );
    }

    /** The goods leave the building. This is when quarantine goes down. */
    sendSupplierReturn(
        id: string
    ): Promise<{ id: string; businessDate: string; rowsPosted: number }> {
        return firstValueFrom(
            this.http.post<{ id: string; businessDate: string; rowsPosted: number }>(
                `${API_BASE}/supplier-returns/${id}/send`,
                {}
            )
        );
    }

    settleSupplierReturn(
        id: string,
        body: {
            outcome: SupplierReturnOutcome;
            creditNoteNo?: string | null;
            creditValue?: number | null;
            note?: string | null;
        }
    ): Promise<{ ok: true }> {
        return firstValueFrom(
            this.http.post<{ ok: true }>(`${API_BASE}/supplier-returns/${id}/settle`, body)
        );
    }

    returnsReport(range: DateRange): Promise<DateRange & { rows: ReturnsSummaryRow[] }> {
        return firstValueFrom(
            this.http.get<DateRange & { rows: ReturnsSummaryRow[] }>(`${API_BASE}/reports/returns`, {
                params: { ...range }
            })
        );
    }

    openReturnsReport(range: DateRange): Promise<DateRange & { rows: OpenReturnRow[] }> {
        return firstValueFrom(
            this.http.get<DateRange & { rows: OpenReturnRow[] }>(
                `${API_BASE}/reports/open-returns`,
                { params: { ...range } }
            )
        );
    }

    // ── Reports ─────────────────────────────────────────────────────────────

    usageVariance(range: DateRange, minPct = 8): Promise<DateRange & { rows: UsageVarianceRow[] }> {
        return firstValueFrom(
            this.http.get<DateRange & { rows: UsageVarianceRow[] }>(
                `${API_BASE}/reports/usage-variance`,
                { params: { ...range, minPct: String(minPct) } }
            )
        );
    }

    usageTrend(itemId: number, range: DateRange): Promise<UsageTrendPoint[]> {
        return firstValueFrom(
            this.http.get<UsageTrendPoint[]>(`${API_BASE}/reports/usage-variance/${itemId}`, {
                params: { ...range }
            })
        );
    }

    shrinkage(range: DateRange): Promise<DateRange & { rows: ShrinkageRow[]; totalValue: number }> {
        return firstValueFrom(
            this.http.get<DateRange & { rows: ShrinkageRow[]; totalValue: number }>(
                `${API_BASE}/reports/shrinkage`,
                { params: { ...range } }
            )
        );
    }

    priceMovement(range: DateRange, minPct = 5): Promise<DateRange & { rows: PriceMovementRow[] }> {
        return firstValueFrom(
            this.http.get<DateRange & { rows: PriceMovementRow[] }>(
                `${API_BASE}/reports/price-movement`,
                { params: { ...range, minPct: String(minPct) } }
            )
        );
    }

    wastageReport(range: DateRange): Promise<WastageReport> {
        return firstValueFrom(
            this.http.get<WastageReport>(`${API_BASE}/reports/wastage`, { params: { ...range } })
        );
    }

    stockOutReport(
        range: DateRange
    ): Promise<DateRange & { stockOuts: StockOutRow[]; belowReorder: BelowReorderRow[] }> {
        return firstValueFrom(
            this.http.get<DateRange & { stockOuts: StockOutRow[]; belowReorder: BelowReorderRow[] }>(
                `${API_BASE}/reports/stock-outs`,
                { params: { ...range } }
            )
        );
    }

    /**
     * The operating reports.
     *
     * One method each rather than one generic `report(path)`, so the row type
     * is known at the call site and a screen cannot render an open-order table
     * against a valuation. The Reports screen picks between them by key.
     */
    openPurchaseOrdersReport(range: DateRange): Promise<DateRange & { rows: OpenPoRow[] }> {
        return this.rangeReport<OpenPoRow>('open-purchase-orders', range);
    }

    serviceLevelReport(range: DateRange): Promise<DateRange & { rows: ServiceLevelRow[] }> {
        return this.rangeReport<ServiceLevelRow>('service-level', range);
    }

    supplierPerformanceReport(
        range: DateRange
    ): Promise<DateRange & { rows: SupplierPerformanceRow[] }> {
        return this.rangeReport<SupplierPerformanceRow>('supplier-performance', range);
    }

    valuationReport(range: DateRange): Promise<DateRange & { rows: ValuationRow[] }> {
        return this.rangeReport<ValuationRow>('valuation', range);
    }

    deadStockReport(range: DateRange): Promise<DateRange & { rows: DeadStockRow[] }> {
        return this.rangeReport<DeadStockRow>('dead-stock', range);
    }

    consumptionReport(range: DateRange): Promise<DateRange & { rows: ConsumptionRow[] }> {
        return this.rangeReport<ConsumptionRow>('consumption', range);
    }

    countAccuracyReport(range: DateRange): Promise<DateRange & { rows: CountAccuracyRow[] }> {
        return this.rangeReport<CountAccuracyRow>('count-accuracy', range);
    }

    private rangeReport<T>(path: string, range: DateRange): Promise<DateRange & { rows: T[] }> {
        return firstValueFrom(
            this.http.get<DateRange & { rows: T[] }>(`${API_BASE}/reports/${path}`, {
                params: { ...range }
            })
        );
    }
}
