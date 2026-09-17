/**
 * What is in the store right now.
 *
 * Every number here is derived from the ledger on read. There is no cached
 * quantity to drift, which is the point of the whole design - so "refresh"
 * genuinely re-derives rather than re-fetching a stale scalar.
 */
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { AuthStore } from '@/core/auth.store';
import { GrandService } from '@/core/grand.service';
import { apiErrorMessage } from '@/core/api';
import { formatMoney, formatQty } from '@/core/format';
import type { StockRow } from '@/core/types';
import { DEFAULT_PAGE_SIZE, emptyPage, type Page, type PageRequest } from '@/core/types';
import { AppPaginator, type PageChange } from '@/shared/paginator.component';

@Component({
    selector: 'app-stock',
    standalone: true,
    imports: [CommonModule, FormsModule, ButtonModule, TableModule, TagModule, InputTextModule, AppPaginator],
    template: `
        <div class="space-y-8">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold">Stock</h1>
                    <p class="text-surface-500 text-sm">{{ auth.location()?.name }}</p>
                </div>
                <div class="flex items-center gap-2">
                    <input
                        pInputText
                        type="search"
                        placeholder="Search item or code"
                        class="w-56"
                        [ngModel]="search()"
                        (ngModelChange)="onSearch($event)" />
                    <button
                        pButton
                        [outlined]="!belowReorder()"
                        label="Below reorder"
                        icon="pi pi-exclamation-triangle"
                        (click)="toggleBelowReorder()"></button>
                    <button pButton text icon="pi pi-refresh" (click)="load()" [disabled]="loading()"></button>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-4">
                    <div class="text-sm text-surface-500">Stock value</div>
                    <div class="text-2xl font-bold">{{ money(totalValue()) }}</div>
                </div>
                <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-4">
                    <div class="text-sm text-surface-500">Lines</div>
                    <div class="text-2xl font-bold">{{ rows().length }}</div>
                </div>
                <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-4">
                    <div class="text-sm text-surface-500">Below reorder</div>
                    <div class="text-2xl font-bold" [class.text-red-600]="lowCount() > 0">{{ lowCount() }}</div>
                </div>
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                <p-table [value]="rows()" [loading]="loading()" [scrollable]="true" scrollHeight="60vh" [rows]="50">
                    <ng-template pTemplate="header">
                        <tr>
                            <th class="font-semibold text-sm">Item</th>
                            <th class="font-semibold text-sm">Section</th>
                            <th class="font-semibold text-sm text-right">On hand</th>
                            <th class="font-semibold text-sm text-right">Avg cost</th>
                            <th class="font-semibold text-sm text-right">Value</th>
                            <th class="font-semibold text-sm"></th>
                        </tr>
                    </ng-template>
                    <ng-template pTemplate="body" let-row>
                        <tr>
                            <td class="px-4 py-2">
                                <div class="font-medium">{{ row.name }}</div>
                                <div class="text-xs text-surface-500 font-mono">{{ row.code }}</div>
                            </td>
                            <td class="px-4 py-2 text-sm">{{ row.sectionCode }}</td>
                            <td class="px-4 py-2 text-right font-medium">{{ qty(row) }}</td>
                            <td class="px-4 py-2 text-right text-sm">{{ money(row.avgCost) }}</td>
                            <td class="px-4 py-2 text-right">{{ money(row.value) }}</td>
                            <td class="px-4 py-2">
                                @if (row.belowReorder) {
                                    <p-tag severity="danger" value="Below reorder"></p-tag>
                                } @else if (row.isCritical) {
                                    <p-tag severity="info" value="Counted daily"></p-tag>
                                }
                            </td>
                        </tr>
                    </ng-template>
                    <ng-template pTemplate="emptymessage">
                        <tr>
                            <td colspan="6" class="p-8 text-center text-surface-500">
                                {{ loading() ? 'Loading…' : 'Nothing to show.' }}
                            </td>
                        </tr>
                    </ng-template>
                </p-table>
            </div>

            <app-paginator [page]="pageInfo()" (pageChange)="onPageChange($event)" />
        </div>
    `
})
export class StockComponent implements OnInit {
    readonly auth = inject(AuthStore);
    private api = inject(GrandService);

    readonly rows = signal<StockRow[]>([]);
    readonly pageInfo = signal<Page<StockRow>>(emptyPage<StockRow>());
    readonly pageReq = signal<PageRequest>({ page: 1, limit: DEFAULT_PAGE_SIZE });
    readonly totalValue = signal(0);
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly search = signal('');
    readonly belowReorder = signal(false);

    readonly lowCount = computed(() => this.rows().filter((r) => r.belowReorder).length);

    private searchTimer: ReturnType<typeof setTimeout> | null = null;

    ngOnInit(): void {
        void this.load();
    }

    onPageChange(e: PageChange): void {
        this.pageReq.set(e);
        void this.load();
    }

    async load(): Promise<void> {
        this.loading.set(true);
        this.error.set(null);
        try {
            const res = await this.api.getStock({
                ...this.pageReq(),
                search: this.search() || undefined,
                belowReorder: this.belowReorder() || undefined
            });
            this.pageInfo.set(res);
            this.rows.set(res.items);
            this.totalValue.set(res.totalValue);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    onSearch(value: string): void {
        this.search.set(value);
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => void this.load(), 300);
    }

    toggleBelowReorder(): void {
        this.belowReorder.update((v) => !v);
        void this.load();
    }

    qty(row: StockRow): string {
        return formatQty(row.qtyBase, row.stockUnit);
    }

    money(n: number): string {
        return formatMoney(n);
    }
}
