/**
 * What we have.
 *
 * For a kitchen or cleaning login this is their own section and nothing else.
 * For the storekeeper it is every section at the branch, grouped, because
 * "what does the kitchen still have" is the question they get asked all day.
 */
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { AuthStore } from '@/core/auth.store';
import { GrandService } from '@/core/grand.service';
import { apiErrorMessage } from '@/core/api';
import { formatQty } from '@/core/format';
import type { MyContext, StockRow } from '@/core/types';
import { DEFAULT_PAGE_SIZE, emptyPage, type Page, type PageRequest } from '@/core/types';
import { AppPaginator, type PageChange } from '@/shared/paginator.component';
import { AppFilterBar, type FilterOption } from '@/shared/filter-bar.component';

@Component({
    selector: 'app-my-stock',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, ButtonModule, InputTextModule, AppPaginator, AppFilterBar],
    template: `
        <div class="space-y-8">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold">{{ title() }}</h1>
                    <p class="text-surface-500 text-sm">
                        {{ auth.location()?.name }}
                        @if (spansSections()) {
                            · every section, listed separately
                        }
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <input
                        pInputText
                        type="search"
                        placeholder="Search"
                        class="w-48"
                        [ngModel]="search()"
                        (ngModelChange)="onSearch($event)" />
                    <button pButton text icon="pi pi-refresh" (click)="load()" [disabled]="loading()"></button>
                </div>
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <app-filter-bar
                label="Filter stock"
                [options]="filterOptions"
                [value]="lowOnly()"
                (valueChange)="setLowOnly($event)">
                @if (lowOnly()) {
                    <span class="text-sm text-surface-500">
                        {{ pageInfo().total }} item(s) below their reorder point
                    </span>
                }
            </app-filter-bar>

            @if (spansSections() && emptySections().length > 0 && !search() && !lowOnly()) {
                <!-- Holding nothing produces no ledger rows and therefore no
                     group, so an empty store simply was not on the page. For
                     the person who has to answer "can I release this?", that
                     absence is the answer, and it needs saying out loud. -->
                <div class="rounded-2xl border border-dashed border-surface px-5 py-4 text-sm text-surface-500">
                    Nothing at all in
                    {{ emptySections().join(', ') }}.
                </div>
            }

            @for (group of groups(); track group.sectionCode) {
                <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                    @if (spansSections() || groups().length > 1) {
                        <div class="px-5 py-4 border-b border-surface font-semibold">
                            {{ sectionLabel(group.sectionCode) }}
                            <span class="text-surface-500 font-normal text-sm">
                                · {{ group.rows.length }} item(s)
                            </span>
                        </div>
                    }

                    @if (group.rows.length === 0) {
                        <p class="p-10 text-center text-surface-500">Nothing here.</p>
                    } @else {
                        <ul class="divide-y divide-surface">
                            @for (row of group.rows; track row.itemId) {
                                <li class="px-5 py-4 flex items-center justify-between gap-3">
                                    <div class="min-w-0">
                                        <div class="font-medium">{{ row.name }}</div>
                                        @if (row.belowReorder) {
                                            <div class="text-xs text-red-600 font-medium">Running low</div>
                                        }
                                    </div>
                                    <div class="text-lg font-semibold shrink-0" [class.text-red-600]="row.qtyBase <= 0">
                                        {{ q(row.qtyBase, row.stockUnit) }}
                                    </div>
                                </li>
                            }
                        </ul>
                    }
                </div>
            }

            @if (!loading() && rows().length === 0) {
                <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-10 text-center">
                    <p class="text-surface-500 mb-4">Nothing in here yet.</p>
                    <button pButton label="Ask the store for something" routerLink="/ask"></button>
                </div>
            }

            <app-paginator [page]="pageInfo()" (pageChange)="onPageChange($event)" />
        </div>
    `
})
export class MyStockComponent implements OnInit {
    readonly auth = inject(AuthStore);
    private api = inject(GrandService);

    readonly rows = signal<StockRow[]>([]);
    readonly pageInfo = signal<Page<StockRow>>(emptyPage<StockRow>());
    readonly pageReq = signal<PageRequest>({ page: 1, limit: DEFAULT_PAGE_SIZE });
    readonly ctx = signal<MyContext | null>(null);
    readonly loading = signal(true);
    readonly error = signal<string | null>(null);
    readonly search = signal('');
    readonly lowOnly = signal(false);

    readonly filterOptions: FilterOption<boolean>[] = [
        { value: false, label: 'Everything' },
        { value: true, label: 'Running low', icon: 'pi pi-exclamation-triangle' }
    ];
    private searchTimer: ReturnType<typeof setTimeout> | null = null;

    readonly title = computed(() =>
        this.auth.role() === 'storekeeper' || this.auth.role() === 'management'
            ? 'Stock everywhere'
            : 'What we have'
    );

    /**
     * True when the page is showing more than the viewer's own shelf - the
     * storekeeper and management, who see the whole branch. Everything that
     * needs to name a section keys off this rather than off how many sections
     * happen to be holding something today.
     */
    readonly spansSections = computed(() => {
        const role = this.auth.role();
        return role === 'storekeeper' || role === 'management';
    });

    /** Sections this branch has that are not on the page, because they hold nothing. */
    readonly emptySections = computed(() => {
        if (!this.spansSections()) return [];
        const withStock = new Set(this.groups().map((g) => g.sectionCode));
        return this.auth
            .sections()
            .filter((s) => s.isActive && !withStock.has(s.code))
            .map((s) => this.sectionLabel(s.code));
    });

    /** Store first - it is the one people ask about most. */
    readonly groups = computed(() => {
        // Searching and the low-stock filter are both applied by the server, so
        // the rows here are already the right ones - grouping is all that is
        // left to do. Filtering them again here would only ever search the page
        // you happen to be looking at.
        const filtered = this.rows();

        const bySection = new Map<string, StockRow[]>();
        for (const row of filtered) {
            const list = bySection.get(row.sectionCode) ?? [];
            list.push(row);
            bySection.set(row.sectionCode, list);
        }

        // Store first, then the rooms that draw from it. A branch may hold
        // more than one section of a kind -- a second kitchen called Pastry --
        // and those sort together under the same heading, then alphabetically.
        const order = ['STORE', 'KITCHEN', 'CLEAN', 'QUARANTINE'];
        return [...bySection.entries()]
            .map(([sectionCode, rows]) => ({ sectionCode, rows }))
            .sort((a, b) => order.indexOf(a.sectionCode) - order.indexOf(b.sectionCode));
    });

    async ngOnInit(): Promise<void> {
        try {
            this.ctx.set(await this.api.myContext());
        } catch {
            /* fall back to showing everything the API allows */
        }
        await this.load();
    }

    onPageChange(e: PageChange): void {
        this.pageReq.set(e);
        void this.load();
    }

    setLowOnly(on: boolean): void {
        if (this.lowOnly() === on) return;
        this.lowOnly.set(on);
        this.pageReq.update((p) => ({ ...p, page: 1 }));
        void this.load();
    }

    /** Debounced: one request per pause, not one per keystroke. */
    onSearch(value: string): void {
        this.search.set(value);
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            this.pageReq.update((p) => ({ ...p, page: 1 }));
            void this.load();
        }, 300);
    }

    async load(): Promise<void> {
        this.loading.set(true);
        this.error.set(null);
        try {
            const ctx = this.ctx();

            // A kitchen login sees the kitchen. Anyone who can release sees the
            // lot, because that is their job. The narrowing is asked of the
            // server rather than done here: filtering a page in the browser
            // would drop rows the pager has already counted.
            const mine = ctx && !ctx.canRelease ? ctx.mySectionIds : [];
            const res = await this.api.getStock({
                ...this.pageReq(),
                sectionId: mine.length > 0 ? mine[0] : undefined,
                search: this.search().trim() || undefined,
                belowReorder: this.lowOnly() || undefined
            });

            this.pageInfo.set(res);
            this.rows.set(res.items);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    sectionLabel(code: string): string {
        return (
            {
                STORE: 'Main store',
                KITCHEN: 'Kitchen',
                CLEAN: 'Cleaning',
                QUARANTINE: 'Quarantine'
            }[code] ?? code
        );
    }

    q(qty: number, unit: string): string {
        return formatQty(qty, unit);
    }
}
