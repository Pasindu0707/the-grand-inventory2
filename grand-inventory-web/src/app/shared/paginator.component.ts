/**
 * The pager that sits under every list.
 *
 * One component rather than the same eight lines of markup on eight screens,
 * because the wording ("Showing 1-25 of 217") and the page-size choices are the
 * kind of thing that drifts apart the moment it is copied.
 *
 * It renders nothing at all when there is only one page. A pager under a list
 * of four requests is noise, and the people using this app on a tablet in a
 * store room have limited screen to spare.
 */
import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PaginatorModule, type PaginatorState } from 'primeng/paginator';
import type { Page } from '@/core/types';

export interface PageChange {
    page: number;
    limit: number;
}

@Component({
    selector: 'app-paginator',
    standalone: true,
    imports: [CommonModule, PaginatorModule],
    template: `
        @if (showing()) {
            <div
                class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-surface">
                <span class="text-sm text-surface-500">
                    Showing {{ first() }}-{{ last() }} of {{ page().total }}
                </span>
                <p-paginator
                    [first]="(page().page - 1) * page().limit"
                    [rows]="page().limit"
                    [totalRecords]="page().total"
                    [rowsPerPageOptions]="[10, 25, 50, 100]"
                    (onPageChange)="emit($event)" />
            </div>
        }
    `
})
export class AppPaginator {
    readonly page = input.required<Page<unknown>>();
    readonly pageChange = output<PageChange>();

    readonly showing = computed(() => this.page().total > this.page().limit);
    readonly first = computed(() => (this.page().page - 1) * this.page().limit + 1);
    readonly last = computed(() =>
        Math.min(this.page().page * this.page().limit, this.page().total)
    );

    /** PrimeNG reports a zero-based page; the API is one-based. */
    emit(e: PaginatorState): void {
        this.pageChange.emit({ page: (e.page ?? 0) + 1, limit: e.rows ?? this.page().limit });
    }
}
