/**
 * What has arrived, and what each delivery actually contained.
 *
 * A goods received note is a document the business keeps. Until this screen
 * existed you could enter one and then never see it again: the only route back
 * to last Tuesday's invoice was the delivery picker inside the supplier-return
 * form, which is a strange place to keep a record and is closed to anyone who
 * cannot raise one. "What did we pay for that sack" is a question management
 * asks constantly - the price-movement report raises it by design - and the
 * answer had nowhere to live.
 *
 * Read-only, deliberately. Nothing here edits anything: a delivery on the
 * ledger is corrected with a reversal, never an edit, and a screen with an edit
 * button on an immutable document is a promise it cannot keep.
 *
 * Each line carries what has already gone back to the supplier against it, so
 * the delivery answers "did we get a credit for the bad half of this" without
 * anybody cross-referencing two screens.
 */
import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { GrandService } from '@/core/grand.service';
import { apiErrorMessage } from '@/core/api';
import { formatMoney, formatQty } from '@/core/format';
import {
    DEFAULT_PAGE_SIZE,
    emptyPage,
    type GrnDetail,
    type GrnListRow,
    type Page,
    type PageRequest
} from '@/core/types';
import { AppPaginator, type PageChange } from '@/shared/paginator.component';

@Component({
    selector: 'app-deliveries',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterLink,
        ButtonModule,
        DrawerModule,
        InputTextModule,
        TagModule,
        AppPaginator
    ],
    template: `
        <div class="space-y-6">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold">Deliveries</h1>
                    <p class="text-surface-500 text-sm">
                        Everything that has arrived at this branch, newest first
                    </p>
                </div>
                <a pButton icon="pi pi-truck" label="Receive a delivery" routerLink="/grn"></a>
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <div class="max-w-md">
                <label class="block text-sm font-medium mb-1" for="grn-search">
                    Find a delivery
                </label>
                <input
                    id="grn-search"
                    pInputText
                    class="w-full"
                    placeholder="Supplier name or invoice number"
                    [ngModel]="search()"
                    (ngModelChange)="onSearch($event)" />
            </div>

            <div
                class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                @if (rows().length === 0) {
                    <p class="p-10 text-center text-surface-500">
                        @if (loading()) {
                            Loading…
                        } @else if (search()) {
                            Nothing matches “{{ search() }}”.
                        } @else {
                            Nothing has been received at this branch yet.
                        }
                    </p>
                } @else {
                    <ul class="divide-y divide-surface">
                        @for (row of rows(); track row.id) {
                            <li>
                                <button
                                    type="button"
                                    class="w-full text-left px-5 py-4 flex flex-wrap items-center justify-between gap-3 hover:bg-surface-50 dark:hover:bg-surface-800"
                                    (click)="open(row)">
                                    <div class="min-w-0">
                                        <div class="font-medium">
                                            {{ row.supplierName }}
                                            <span class="text-surface-500 font-normal">
                                                ·
                                                {{ row.invoiceNo || 'no invoice number' }}
                                            </span>
                                        </div>
                                        <div class="text-xs text-surface-500 mt-0.5">
                                            delivery no.
                                            <span class="font-mono">{{ row.id }}</span>
                                            · {{ when(row.receivedAt) }} · booked in by
                                            {{ row.receivedBy }}
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-3 shrink-0">
                                        @if (row.poId) {
                                            <p-tag severity="info" value="Against an order"></p-tag>
                                        }
                                        <div class="text-right">
                                            <div class="font-semibold">
                                                {{ money(row.total ?? 0) }}
                                            </div>
                                            <div class="text-xs text-surface-500">
                                                {{ row.lineCount }}
                                                {{ row.lineCount === 1 ? 'item' : 'items' }}
                                            </div>
                                        </div>
                                        <i class="pi pi-chevron-right text-surface-400" aria-hidden="true"></i>
                                    </div>
                                </button>
                            </li>
                        }
                    </ul>
                }
            </div>

            <app-paginator [page]="pageInfo()" (pageChange)="onPageChange($event)" />

            <!-- One delivery, read back -->
            <p-drawer
                [visible]="detailOpen()"
                (visibleChange)="detailOpen.set($event)"
                position="right"
                header="Delivery"
                styleClass="!w-full sm:!w-[40rem]">
                @if (detailLoading()) {
                    <p class="text-surface-500">Loading…</p>
                }
                <!-- The "as" binding is only allowed on a primary @if, so this
                     is its own block rather than an @else-if on the loading
                     check above. -->
                @if (!detailLoading() && detail(); as d) {
                    <div class="space-y-5">
                        <div>
                            <div class="text-lg font-semibold">{{ d.supplierName }}</div>
                            <div class="text-sm text-surface-500 mt-1">
                                delivery no. <span class="font-mono">{{ d.id }}</span>
                                @if (d.invoiceNo) {
                                    · invoice {{ d.invoiceNo }}
                                }
                                @if (d.invoiceDate) {
                                    · dated {{ d.invoiceDate }}
                                }
                            </div>
                            <div class="text-sm text-surface-500">
                                received {{ when(d.receivedAt) }} by {{ d.receivedBy }}
                                @if (d.poId) {
                                    · against a purchase order
                                }
                            </div>
                        </div>

                        <div class="rounded-xl border border-surface overflow-hidden">
                            <ul class="divide-y divide-surface">
                                @for (line of d.lines; track line.id) {
                                    <li class="px-4 py-3">
                                        <div class="flex flex-wrap items-start justify-between gap-3">
                                            <div class="min-w-0">
                                                <div class="font-medium">{{ line.itemName }}</div>
                                                <div class="text-xs text-surface-500 font-mono mt-0.5">
                                                    {{ line.itemCode }}
                                                </div>
                                            </div>
                                            <div class="text-right">
                                                <div class="font-semibold">
                                                    {{ money(line.lineTotal) }}
                                                </div>
                                                <div class="text-xs text-surface-500">
                                                    {{ money(line.packPrice) }} a pack
                                                </div>
                                            </div>
                                        </div>
                                        <div class="text-sm text-surface-500 mt-1">
                                            {{ line.qtyPacks }} × {{ line.packName }} =
                                            {{ q(line.qtyBase, line.stockUnit) }}
                                        </div>
                                        @if (line.qtyPacksReturned > 0) {
                                            <div class="app-note app-note--warn mt-2">
                                                {{ line.qtyPacksReturned }} ×
                                                {{ line.packName }} went back to the supplier
                                                against this line.
                                            </div>
                                        }
                                    </li>
                                }
                            </ul>
                            <div
                                class="px-4 py-3 border-t border-surface flex items-center justify-between">
                                <span class="font-semibold">Total</span>
                                <span class="text-lg font-bold">{{ money(d.total) }}</span>
                            </div>
                        </div>

                        @if (d.photoUrl) {
                            <div>
                                <div class="text-sm font-medium mb-1">Photograph taken at the door</div>
                                <img [src]="d.photoUrl" alt="The delivery" class="rounded-xl border border-surface" />
                            </div>
                        }

                        <div class="app-note">
                            This is a record, not a form. A delivery on the ledger is corrected
                            with a <strong>reversal</strong> - a second entry that cancels it and
                            stays on the record beside it - never by editing this. Ask management.
                        </div>
                    </div>
                }
            </p-drawer>
        </div>
    `
})
export class DeliveriesComponent implements OnInit {
    private api = inject(GrandService);

    readonly rows = signal<GrnListRow[]>([]);
    readonly pageInfo = signal<Page<GrnListRow>>(emptyPage<GrnListRow>());
    readonly pageReq = signal<PageRequest>({ page: 1, limit: DEFAULT_PAGE_SIZE });
    readonly search = signal('');
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);

    readonly detail = signal<GrnDetail | null>(null);
    readonly detailOpen = signal(false);
    readonly detailLoading = signal(false);

    /** Cancels a search that is already in flight when another key is pressed. */
    private searchTimer: ReturnType<typeof setTimeout> | null = null;

    async ngOnInit(): Promise<void> {
        await this.load();
    }

    async load(): Promise<void> {
        this.loading.set(true);
        try {
            const page = await this.api.listGrn({
                ...this.pageReq(),
                search: this.search().trim() || undefined
            });
            this.pageInfo.set(page);
            this.rows.set(page.items);
            this.error.set(null);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    /**
     * Searching goes back to page one.
     *
     * Staying on page four of the old result set and asking for page four of a
     * three-page one is how a search comes back empty when it matched.
     */
    onSearch(term: string): void {
        this.search.set(term);
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            this.pageReq.update((q) => ({ ...q, page: 1 }));
            void this.load();
        }, 250);
    }

    onPageChange(e: PageChange): void {
        this.pageReq.set(e);
        void this.load();
    }

    async open(row: GrnListRow): Promise<void> {
        this.detail.set(null);
        this.detailOpen.set(true);
        this.detailLoading.set(true);
        try {
            this.detail.set(await this.api.getGrn(row.id));
        } catch (err) {
            this.error.set(apiErrorMessage(err));
            this.detailOpen.set(false);
        } finally {
            this.detailLoading.set(false);
        }
    }

    money(n: number): string {
        return formatMoney(n);
    }

    q(qty: number, unit: string): string {
        return formatQty(qty, unit);
    }

    when(iso: string): string {
        return new Date(iso).toLocaleString('en-LK', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}
