/**
 * Stock counts.
 *
 * Two decisions matter here, and both are about making the count tell the
 * truth rather than making it easy.
 *
 * 1. THE COUNT IS BLIND. The expected quantity is never shown while counting.
 *    If you show someone that the system expects 4,500 g, a tired storekeeper
 *    at the end of a shift types 4,500 and moves on - and anomaly B, two gin
 *    bottles that left with no document, is confirmed rather than found. The
 *    variance is revealed after the count closes, which is when it is useful.
 *
 * 2. YOU COUNT WHAT YOU COUNTED. A line left blank is not zero - it is
 *    untouched, and closing leaves it alone. This used to be impossible: every
 *    line was created as 0 and close read it straight out, so the screen had to
 *    march you through all hundred items to stop it writing off the ones you
 *    had not reached. Blank-means-untouched is what lets the sheet exist.
 */
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { TagModule } from 'primeng/tag';
import { AuthStore } from '@/core/auth.store';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import { formatMoney, formatQty } from '@/core/format';
import type { CloseCountResult, CountLine, CountListRow, CountType, MyContext } from '@/core/types';
import { DEFAULT_PAGE_SIZE, emptyPage, type Page, type PageRequest } from '@/core/types';
import { AppPaginator, type PageChange } from '@/shared/paginator.component';
import { AppFilterBar, type FilterOption } from '@/shared/filter-bar.component';
import { InputTextModule } from 'primeng/inputtext';

@Component({
    selector: 'app-counts',
    standalone: true,
    imports: [CommonModule, FormsModule, ButtonModule, InputNumberModule, TagModule, InputTextModule, AppPaginator, AppFilterBar],
    template: `
        <div class="space-y-8">
            <div>
                <h1 class="text-2xl font-bold">Stock count</h1>
                <p class="text-surface-500 text-sm">{{ auth.location()?.name }}</p>
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <!-- Counting.
                 One item per screen used to be the only way through: a hundred
                 items meant a hundred screens and no way to stop, which is what
                 made a daily count something people put off. This is a sheet -
                 fill in what you actually counted, leave the rest blank, finish
                 whenever. Blank means untouched, and close leaves those lines
                 exactly as they were.

                 What has NOT changed: the expected quantity is still nowhere on
                 this screen. Showing it would turn counting into confirming. -->
            @if (lines().length > 0 && !result()) {
                <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                    <div class="px-5 py-4 border-b border-surface flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div class="font-semibold text-lg">Counting {{ sectionName() }}</div>
                            <div class="text-sm text-surface-500">
                                {{ countedSoFar() }} of {{ lines().length }} counted
                                @if (changedCount() > 0) {
                                    · <span class="font-semibold">{{ changedCount() }} changed</span>
                                }
                            </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <button
                                pButton
                                outlined
                                icon="pi pi-arrow-left"
                                label="Leave for now"
                                [disabled]="busy()"
                                (click)="leaveCount()"></button>
                            <button
                                pButton
                                icon="pi pi-check"
                                severity="success"
                                [label]="finishLabel()"
                                [disabled]="countedSoFar() === 0 || busy()"
                                [loading]="busy()"
                                (click)="finish()"></button>
                        </div>
                    </div>

                    <div class="px-5 py-4 border-b border-surface flex flex-wrap items-center gap-3">
                        <input
                            pInputText
                            type="search"
                            placeholder="Find an item"
                            class="w-full sm:w-72"
                            [ngModel]="sheetSearch()"
                            (ngModelChange)="sheetSearch.set($event)" />
                        <app-filter-bar
                            label="Show"
                            [options]="sheetFilters"
                            [value]="sheetFilter()"
                            (valueChange)="sheetFilter.set($event)" />
                    </div>

                    @if (sheetLines().length === 0) {
                        <p class="p-10 text-center text-surface-500">Nothing matches.</p>
                    } @else {
                        <ul class="divide-y divide-surface">
                            @for (line of sheetLines(); track line.lineId) {
                                <li
                                    class="px-5 py-4 flex flex-wrap items-center justify-between gap-4"
                                    [class.bg-surface-50]="entryFor(line.lineId) !== null"
                                    [class.dark:bg-surface-800]="entryFor(line.lineId) !== null">
                                    <div class="min-w-0">
                                        <div class="font-medium text-lg">{{ line.name }}</div>
                                        <div class="text-xs text-surface-500 font-mono">{{ line.code }}</div>
                                    </div>
                                    <div class="flex flex-col items-end gap-1">
                                        <div class="flex items-center gap-2">
                                            <span class="text-sm text-surface-500">{{ line.stockUnit }}</span>
                                            <p-inputNumber
                                                styleClass="w-32"
                                                inputStyleClass="w-full text-center text-xl py-3"
                                                [ngModel]="entryFor(line.lineId)"
                                                (ngModelChange)="setEntry(line.lineId, $event)"
                                                [min]="0"
                                                [maxFractionDigits]="3"
                                                placeholder="-"></p-inputNumber>
                                            <button
                                                pButton
                                                text
                                                icon="pi pi-times"
                                                [disabled]="entryFor(line.lineId) === null"
                                                [attr.aria-label]="'Clear ' + line.name"
                                                (click)="setEntry(line.lineId, null)"></button>
                                        </div>

                                        <!-- Only after a figure is entered. The
                                             field starts empty on purpose: a
                                             pre-filled expected quantity is the
                                             difference between a count that
                                             finds two missing gin bottles and
                                             one that signs them off. -->
                                        @if (entryFor(line.lineId) !== null) {
                                            <div class="text-sm pr-12">
                                                <span class="text-surface-500">
                                                    system {{ qty(line.qtyExpected, line.stockUnit) }}
                                                </span>
                                                <span
                                                    class="font-semibold ml-2"
                                                    [class.text-green-600]="difference(line) === 0"
                                                    [class.dark:text-green-400]="difference(line) === 0"
                                                    [class.text-red-600]="difference(line) < 0"
                                                    [class.dark:text-red-400]="difference(line) < 0"
                                                    [class.text-amber-600]="difference(line) > 0"
                                                    [class.dark:text-amber-400]="difference(line) > 0">
                                                    {{ differenceLabel(line) }}
                                                </span>
                                            </div>
                                        }
                                    </div>
                                </li>
                            }
                        </ul>
                    }
                </div>
            }

            <!-- Result -->
            @if (result(); as res) {
                <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-6 space-y-4">
                    <h2 class="text-xl font-bold">Count closed</h2>

                    @if (res.skipped > 0) {
                        <p class="text-surface-500">
                            {{ res.counted }} item(s) counted. The {{ res.skipped }} left blank were
                            not changed.
                        </p>
                    }

                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div class="rounded-xl border border-surface p-4">
                            <div class="text-sm text-surface-500">Counted</div>
                            <div class="text-2xl font-bold">{{ res.counted }}</div>
                        </div>
                        <div class="rounded-xl border border-surface p-4">
                            <div class="text-sm text-surface-500">Lines adjusted</div>
                            <div class="text-2xl font-bold">{{ res.adjustments }}</div>
                        </div>
                        <div class="rounded-xl border border-surface p-4">
                            <div class="text-sm text-surface-500">Variance value</div>
                            <div class="text-2xl font-bold" [class.text-red-600]="res.varianceValue < 0">
                                {{ money(res.varianceValue) }}
                            </div>
                        </div>
                    </div>

                    @if (res.biggest.length > 0) {
                        <div>
                            <div class="font-semibold mb-2">Biggest gaps</div>
                            <ul class="divide-y divide-surface">
                                @for (b of res.biggest; track b.name) {
                                    <li class="py-2 flex items-center justify-between">
                                        <span>{{ b.name }}</span>
                                        <span
                                            class="font-medium"
                                            [class.text-red-600]="b.varianceValue < 0"
                                            [class.text-green-600]="b.varianceValue > 0">
                                            {{ b.varianceQty > 0 ? '+' : '' }}{{ b.varianceQty }} ·
                                            {{ money(b.varianceValue) }}
                                        </span>
                                    </li>
                                }
                            </ul>
                            <p class="text-xs text-surface-500 mt-3">
                                A shortfall with no wastage document behind it is what the shrinkage
                                report looks for. Nothing here has been edited - the adjustment is a
                                new ledger entry.
                            </p>
                        </div>
                    } @else {
                        <p class="text-surface-500">Everything matched. No adjustments needed.</p>
                    }

                    <div class="flex justify-end">
                        <button pButton label="Done" (click)="reset()"></button>
                    </div>
                </div>
            }

            <!-- Start / history -->
            @if (lines().length === 0 && !result()) {
                <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-4 md:p-6 space-y-4">
                    <h2 class="font-semibold">Start a count</h2>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm font-medium mb-1 app-req">Section</label>
                            <select
                                class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                                [ngModel]="sectionId()"
                                (ngModelChange)="sectionId.set(+$event)">
                                @for (s of mySections(); track s.id) {
                                    <option [ngValue]="s.id">{{ s.name }}</option>
                                }
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium mb-1">Type</label>
                            <select
                                class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                                [ngModel]="countType()"
                                (ngModelChange)="countType.set($event)">
                                <option value="daily_critical">Daily - critical items</option>
                                <option value="weekly_full">Weekly - full</option>
                                <option value="monthly_full">Monthly - full</option>
                            </select>
                        </div>
                        <div class="flex items-end">
                            <button pButton class="w-full" label="Start counting" [disabled]="busy()" (click)="start()"></button>
                        </div>
                    </div>
                </div>

                <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                    <div class="px-5 py-4 border-b border-surface font-semibold">Recent counts</div>
                    @if (history().length === 0) {
                        <p class="p-8 text-center text-surface-500">No counts yet.</p>
                    } @else {
                        <ul class="divide-y divide-surface">
                            @for (c of history(); track c.id) {
                                <li class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <div class="font-medium">{{ label(c.countType) }} · {{ c.sectionCode }}</div>
                                        <div class="text-xs text-surface-500">
                                            {{ c.businessDate }} · {{ c.countedBy }}
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        @if (!c.closed) {
                                            <button pButton size="small" label="Resume" (click)="resume(c.id)"></button>
                                        } @else if (c.verified) {
                                            <p-tag severity="success" value="Verified"></p-tag>
                                        } @else {
                                            <p-tag severity="warn" value="Closed"></p-tag>
                                            @if (canVerify()) {
                                                <button pButton size="small" label="Verify" (click)="verify(c.id)"></button>
                                            }
                                        }
                                    </div>
                                </li>
                            }
                        </ul>
                        <app-paginator [page]="pageInfo()" (pageChange)="onPageChange($event)" />
                    }
                </div>
            }
        </div>
    `
})
export class CountsComponent implements OnInit {
    readonly auth = inject(AuthStore);
    private api = inject(GrandService);
    private notify = inject(NotifyService);

    readonly history = signal<CountListRow[]>([]);
    readonly pageInfo = signal<Page<CountListRow>>(emptyPage<CountListRow>());
    readonly pageReq = signal<PageRequest>({ page: 1, limit: DEFAULT_PAGE_SIZE });
    readonly lines = signal<CountLine[]>([]);
    readonly index = signal(0);
    readonly entries = signal<Record<string, number>>({});
    readonly result = signal<CloseCountResult | null>(null);
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);

    readonly sectionId = signal<number | null>(null);
    readonly ctx = signal<MyContext | null>(null);

    /**
     * Sections this login may count, minus any that have been switched off.
     * The rest are refused by the server either way.
     */
    readonly mySections = computed(() => {
        const allowed = this.ctx()?.mySectionIds;
        const open = this.auth.sections().filter((s) => s.isActive);
        return allowed ? open.filter((s) => allowed.includes(s.id)) : open;
    });
    readonly countType = signal<CountType>('daily_critical');
    private countId: string | null = null;

    readonly current = computed(() => this.lines()[this.index()] ?? null);
    readonly countedSoFar = computed(() => Object.keys(this.entries()).length);

    /** Entered figures that do not match what the system held. */
    readonly changedCount = computed(() => {
        const entered = this.entries();
        return this.lines().filter(
            (l) => entered[l.lineId] !== undefined && entered[l.lineId] !== l.qtyExpected
        ).length;
    });

    readonly sectionName = computed(
        () => this.auth.sections().find((x) => x.id === this.sectionId())?.name ?? ''
    );

    readonly finishLabel = computed(() => {
        const done = this.countedSoFar();
        const total = this.lines().length;
        return done === total ? 'Finish count' : `Finish with ${done} counted`;
    });

    /** The rows on the sheet: search and the show-filter applied. */
    readonly sheetLines = computed(() => {
        const term = this.sheetSearch().toLowerCase().trim();
        const show = this.sheetFilter();
        const entered = this.entries();
        return this.lines().filter((line) => {
            if (term && !line.name.toLowerCase().includes(term) && !line.code.toLowerCase().includes(term)) {
                return false;
            }
            if (show === 'all') return true;
            const value = entered[line.lineId];
            if (show === 'blank') return value === undefined;
            return value !== undefined && value !== line.qtyExpected;
        });
    });
    readonly canVerify = computed(() => this.auth.role() === 'management');

    readonly sheetSearch = signal('');
    readonly sheetFilter = signal<'all' | 'changed' | 'blank'>('all');

    // With every box pre-filled, "counted" is everything and tells you nothing.
    // What is worth finding is what somebody actually altered, and what they
    // cleared out and therefore left uncounted.
    readonly sheetFilters: FilterOption<'all' | 'changed' | 'blank'>[] = [
        { value: 'all', label: 'All' },
        { value: 'changed', label: 'Changed' },
        { value: 'blank', label: 'Left blank' }
    ];

    async ngOnInit(): Promise<void> {
        try {
            this.ctx.set(await this.api.myContext());
        } catch {
            /* the screen still works, just unfiltered */
        }
        // The store if this login has it, otherwise whatever section it does.
        const mine = this.mySections();
        const store = mine.find((s) => s.isStore);
        this.sectionId.set(store?.id ?? mine[0]?.id ?? null);
        await this.loadHistory();
    }

    onPageChange(e: PageChange): void {
        this.pageReq.set(e);
        void this.loadHistory();
    }

    private async loadHistory(): Promise<void> {
        try {
            const page = await this.api.listCounts({ ...this.pageReq() });
            this.pageInfo.set(page);
            this.history.set(page.items);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        }
    }

    label(type: string): string {
        return (
            {
                daily_critical: 'Daily critical',
                weekly_full: 'Weekly full',
                monthly_full: 'Monthly full'
            }[type] ?? type
        );
    }

    async start(): Promise<void> {
        if (this.sectionId() === null) return;
        this.busy.set(true);
        this.error.set(null);
        try {
            const res = await this.api.openCount(this.sectionId()!, this.countType());
            this.countId = res.id;
            this.lines.set(res.lines);
            this.resetSheet(this.seedFromSystem(res.lines));
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    /**
     * Every box starts on the system's own figure, so counting a shelf that has
     * not moved is a glance rather than a keystroke.
     *
     * The cost is real and worth stating: a line nobody changes closes as
     * "counted, and it matched". Shrinkage - stock that leaves with no document
     * behind it - is only ever found by somebody noticing the number in front of
     * them is wrong, so the "changed" count in the header and the Changed filter
     * are there to make how much was actually examined visible afterwards.
     */
    private seedFromSystem(lines: CountLine[]): Record<string, number> {
        const seeded: Record<string, number> = {};
        for (const line of lines) seeded[line.lineId] = line.qtyExpected;
        return seeded;
    }

    /** Sheet back to a clean slate, seeded with whatever is already counted. */
    private resetSheet(entries: Record<string, number>): void {
        this.entries.set(entries);
        this.index.set(0);
        this.sheetSearch.set('');
        this.sheetFilter.set('all');
    }

    async resume(id: string): Promise<void> {
        this.busy.set(true);
        try {
            const detail = await this.api.getCount(id);
            this.countId = detail.id;
            this.lines.set(detail.lines);
            // Seed with what was already entered, so resuming shows the work
            // rather than asking for it again.
            // Whatever was already saved wins; anything not yet touched falls
            // back to the system figure, same as a fresh start.
            const already = this.seedFromSystem(detail.lines);
            for (const line of detail.lines) {
                if (line.qtyCounted !== null) already[line.lineId] = line.qtyCounted;
            }
            this.resetSheet(already);
            this.sectionId.set(detail.sectionId ?? this.sectionId());
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }


    /** Counted minus expected, once a figure has been entered. */
    difference(line: CountLine): number {
        const entered = this.entryFor(line.lineId);
        return entered === null ? 0 : entered - line.qtyExpected;
    }

    /** Plain words, not a signed number - "2 kg short" reads faster than "-2". */
    differenceLabel(line: CountLine): string {
        const diff = this.difference(line);
        if (diff === 0) return 'matches';
        const size = this.qty(Math.abs(diff), line.stockUnit);
        return diff < 0 ? `${size} short` : `${size} more`;
    }

    entryFor(lineId: string): number | null {
        const value = this.entries()[lineId];
        return value === undefined ? null : value;
    }

    /** Null clears the line back to uncounted, so a figure typed against the
        wrong item can be taken back rather than posted as a variance. */
    setEntry(lineId: string, value: number | null): void {
        this.entries.update((all) => {
            const next = { ...all };
            if (value === null || Number.isNaN(value)) delete next[lineId];
            else next[lineId] = value;
            return next;
        });
    }

    async finish(): Promise<void> {
        if (!this.countId) return;

        const done = this.countedSoFar();
        const total = this.lines().length;
        if (done < total) {
            const ok = await this.notify.confirm(
                `${total - done} item(s) were left blank. Those are not changed by this count - ` +
                    'only the ' + done + ' you counted are checked against the shelf.',
                `Finish with ${done} of ${total} counted?`
            );
            if (!ok) return;
        }

        this.busy.set(true);
        this.error.set(null);
        try {
            const entered = this.entries();
            const payload = this.lines()
                .filter((l) => entered[l.lineId] !== undefined)
                .map((l) => ({ lineId: l.lineId, qtyCounted: entered[l.lineId]! }));

            await this.api.saveCountLines(this.countId, payload);
            const res = await this.api.closeCount(this.countId);
            this.result.set(res);
            this.lines.set([]);
            await this.loadHistory();
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    async verify(id: string): Promise<void> {
        try {
            await this.api.verifyCount(id);
            this.notify.success('Count verified');
            await this.loadHistory();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    reset(): void {
        this.result.set(null);
        this.countId = null;
        this.resetSheet({});
        void this.loadHistory();
    }

    /**
     * Step out of a count without closing it.
     *
     * Whatever has been keyed in is written first, so the count you come back to
     * through Resume is the one you left. It is deliberately not closed: closing
     * posts the adjustment, and a half-counted shelf must not adjust anything.
     */
    async leaveCount(): Promise<void> {
        const ok = await this.notify.confirm(
            'What you have counted so far is kept, and the count stays open - you can pick it up again from Recent counts.',
            'Leave this count?'
        );
        if (!ok) return;

        this.busy.set(true);
        try {
            const entered = this.entries();
            const payload = this.lines()
                .filter((l) => entered[l.lineId] !== undefined)
                .map((l) => ({ lineId: l.lineId, qtyCounted: entered[l.lineId]! }));
            if (this.countId && payload.length > 0) {
                await this.api.saveCountLines(this.countId, payload);
            }
            this.lines.set([]);
            this.index.set(0);
            this.reset();
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    money(n: number): string {
        return formatMoney(n);
    }

    qty(n: number, unit: string): string {
        return formatQty(n, unit);
    }
}
