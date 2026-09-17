/**
 * Opening stock - what was on the shelf before the system existed.
 *
 * This is step 7 of the go-live runbook, and until now it had no screen at
 * all: the only way to get real stock into a fresh system was to type it in as
 * a delivery from a supplier who never delivered it, which puts a fictional
 * invoice into the price history and makes the first month's supplier report
 * nonsense.
 *
 * A section can be opened exactly once, and only while it has never held
 * anything. After that the honest instrument is a stock count, and the server
 * says so rather than letting this screen quietly double the shelf.
 *
 * The cost per unit is asked for, not assumed. It becomes the section's
 * starting weighted average, and stock opened at zero reports every issue out
 * of it as free.
 */
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import { formatMoney, formatQty } from '@/core/format';
import type { Item, ItemPack, OpeningSection } from '@/core/types';

/**
 * One shelf, as the person counting it thinks about it.
 *
 * They are looking at three sacks and a part-used one, and they know the sack
 * cost 10,500 -- not that a gram costs 0.42. So the line is captured in packs
 * and converted here, the same way the delivery screen does it, and the two
 * grams-per-unit figures the API wants are derived rather than typed.
 */
interface OpeningLine {
    itemId: number;
    name: string;
    stockUnit: string;
    packs: ItemPack[];
    /** The pack being counted in. Null means the stock unit itself. */
    packId: number | null;
    /** How many of those: packs, or stock units when packId is null. */
    qtyEntered: number | null;
    /** What one of those costs. Per pack, or per stock unit when loose. */
    costEntered: number | null;
}

@Component({
    selector: 'app-opening',
    standalone: true,
    imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, TagModule],
    template: `
        <div class="space-y-6">
            <div>
                <h1 class="text-2xl font-bold">Opening stock</h1>
                <p class="text-surface-500 text-sm">
                    What is on the shelf on day one, before anything moves
                </p>
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            @if (done(); as result) {
                <div class="app-note app-note--ok app-note--strong">
                    <div class="app-note__title">Opening balance recorded</div>
                    <p class="text-sm mt-1">
                        {{ result.lineCount }} item{{ result.lineCount === 1 ? '' : 's' }},
                        {{ money(result.totalValue) }}, dated {{ result.businessDate }}. This
                        section is now live.
                    </p>
                    <button
                        pButton
                        text
                        size="small"
                        label="Open another section"
                        class="mt-2"
                        (click)="done.set(null)"></button>
                </div>
            }

            <!-- Which section ---------------------------------------------->
            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                <div class="px-5 py-4 border-b border-surface font-semibold">
                    Which section are you opening?
                </div>
                <ul class="divide-y divide-surface">
                    @for (s of sections(); track s.sectionId) {
                        <li
                            class="px-5 py-3 flex flex-wrap items-center justify-between gap-2"
                            [class.opacity-60]="!s.canOpen">
                            <div>
                                <div class="font-medium text-sm">
                                    {{ s.name }}
                                    @if (s.isStore && !nameSaysStore(s)) {
                                        <span class="text-xs text-surface-500">· main store</span>
                                    }
                                </div>
                                <div class="text-xs text-surface-500">
                                    @if (s.previouslyReversed) {
                                        Previous opening balance was reversed - enter it again
                                    } @else if (s.canOpen) {
                                        Never used - ready for an opening balance
                                    } @else if (s.openedOn) {
                                        Opened on {{ s.openedOn }} · to change it, reverse that
                                        document; after any other movement, use a stock count
                                    } @else {
                                        Already in use. Correct it with a stock count.
                                    }
                                </div>
                            </div>
                            @if (s.canOpen) {
                                <button
                                    pButton
                                    size="small"
                                    [outlined]="sectionId() !== s.sectionId"
                                    [label]="sectionId() === s.sectionId ? 'Selected' : 'Open this one'"
                                    (click)="pickSection(s)"></button>
                            } @else {
                                <p-tag severity="secondary" value="Done"></p-tag>
                            }
                        </li>
                    }
                    @if (sections().length === 0) {
                        <li class="px-5 py-10 text-center text-surface-500">
                            {{ loading() ? 'Loading…' : 'No sections at this branch yet.' }}
                        </li>
                    }
                </ul>
            </div>

            @if (sectionId()) {
                <!-- What is on the shelf ------------------------------------>
                <div
                    class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                    <div class="px-5 py-4 border-b border-surface">
                        <div class="font-semibold">What is on the shelf?</div>
                        <p class="text-xs text-surface-500 mt-1">
                            Count it in whatever it sits in - sacks, cans, bottles - and say what
                            one of those cost. Anything you leave off simply starts at nothing.
                        </p>
                    </div>

                    <div class="px-5 py-4 border-b border-surface">
                        <label class="block text-sm font-medium mb-1">
                            Add a product - tap one to put it on the list
                        </label>
                        <div class="flex flex-wrap gap-2">
                            <input
                                pInputText
                                class="flex-1 min-w-[14rem]"
                                placeholder="Search by name or code"
                                [ngModel]="search()"
                                (ngModelChange)="search.set($event)" />
                        </div>

                        <!-- The list is shown up front. It used to stay hidden
                             until two characters had been typed, which on the
                             one screen whose job is "work down the shelf" left a
                             storekeeper with an empty box and no way to find out
                             what the item master even contains. Search narrows
                             it; it is not the way in. -->
                        @if (matches().length > 0) {
                            <ul class="mt-2 max-h-56 overflow-auto rounded-xl border border-surface divide-y divide-surface">
                                @for (item of matches(); track item.id) {
                                    <li>
                                        <button
                                            type="button"
                                            class="w-full text-left px-3 py-2 hover:bg-surface-100 dark:hover:bg-surface-800"
                                            (click)="addLine(item)">
                                            <span class="text-sm font-medium">{{ item.name }}</span>
                                            <span class="text-xs text-surface-500">
                                                · {{ item.code }} · counted in {{ item.stockUnit }}
                                            </span>
                                        </button>
                                    </li>
                                }
                            </ul>
                            @if (hiddenCount() > 0) {
                                <p class="text-xs text-surface-500 mt-2">
                                    {{ hiddenCount() }} more - type to narrow the list.
                                </p>
                            }
                        } @else {
                            <p class="text-xs text-surface-500 mt-2">
                                @if (items().length === 0) {
                                    There are no products yet. Add them under
                                    <strong>Products</strong> first.
                                } @else if (search().trim()) {
                                    Nothing matches “{{ search() }}”.
                                } @else {
                                    Everything in the item master is already on the list below.
                                }
                            </p>
                        }
                    </div>

                    @if (lines().length === 0) {
                        <div class="px-5 py-10 text-center text-surface-500 text-sm">
                            Nothing added yet.
                        </div>
                    } @else {
                        <div
                            class="hidden md:grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_9rem_7rem_10rem_8rem_2.5rem] items-center gap-2 px-5 py-2 border-b border-surface text-xs uppercase tracking-wide text-surface-500">
                            <span>Product</span>
                            <span>Counted in</span>
                            <span class="text-right app-req">How many</span>
                            <span class="text-right app-req">Cost each</span>
                            <span class="text-right">Value</span>
                            <span></span>
                        </div>

                        <ul class="divide-y divide-surface">
                            @for (line of lines(); track line.itemId) {
                                <li class="px-5 py-3">
                                    <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_9rem_7rem_10rem_8rem_2.5rem] items-center gap-2">
                                        <span class="text-sm font-medium truncate" [title]="line.name">{{
                                            line.name
                                        }}</span>

                                        <!-- Count in whatever is actually on the
                                             shelf. "Loose" is there for the
                                             half-used sack, and for anything
                                             nobody set a pack up for. -->
                                        <select
                                            class="w-full px-2 py-2 text-sm rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                                            [ngModel]="line.packId"
                                            (ngModelChange)="setPack(line.itemId, $event)">
                                            @for (p of line.packs; track p.id) {
                                                <option [ngValue]="p.id">{{ p.packName }}</option>
                                            }
                                            <option [ngValue]="null">
                                                Loose ({{ line.stockUnit }})
                                            </option>
                                        </select>

                                        <input
                                            pInputText
                                            class="w-full text-right"
                                            inputmode="decimal"
                                            placeholder="How many"
                                            [ngModel]="line.qtyEntered"
                                            (ngModelChange)="setQty(line.itemId, $event)" />

                                        <input
                                            pInputText
                                            class="w-full text-right"
                                            inputmode="decimal"
                                            [attr.placeholder]="costPlaceholder(line)"
                                            [ngModel]="line.costEntered"
                                            (ngModelChange)="setCost(line.itemId, $event)" />

                                        <span class="text-sm text-right tabular-nums">{{
                                            money(lineValue(line))
                                        }}</span>
                                        <button
                                            pButton
                                            size="small"
                                            text
                                            severity="danger"
                                            icon="pi pi-times"
                                            (click)="removeLine(line.itemId)"></button>
                                    </div>

                                    <!-- The conversion, shown and never typed
                                         into: the rule the delivery screen
                                         already follows, and the storekeeper's
                                         check that they picked the right pack. -->
                                    @if (qtyBaseOf(line) > 0) {
                                        <p class="text-xs text-surface-500 mt-1">
                                            = {{ qty(qtyBaseOf(line), line.stockUnit) }} on the shelf
                                            @if (line.costEntered) {
                                                · {{ money(unitCostOf(line)) }} per
                                                {{ line.stockUnit }}
                                            }
                                        </p>
                                    }
                                </li>
                            }
                        </ul>

                        <div
                            class="px-5 py-4 border-t border-surface flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <div class="text-sm text-surface-500">Opening value</div>
                                <div class="text-xl font-bold">{{ money(totalValue()) }}</div>
                            </div>
                            <div class="flex items-center gap-2">
                                <input
                                    pInputText
                                    class="w-64"
                                    placeholder="Note (optional)"
                                    [ngModel]="note()"
                                    (ngModelChange)="note.set($event)" />
                                <button
                                    pButton
                                    icon="pi pi-check"
                                    label="Record opening balance"
                                    [disabled]="!canSubmit() || busy()"
                                    [loading]="busy()"
                                    (click)="submit()"></button>
                            </div>
                        </div>
                    }
                </div>

                <p class="text-xs text-surface-500">
                    This can only be done once for a section. After it, corrections are stock
                    counts - which is right, because after day one a difference is a
                    discrepancy, not a starting point.
                </p>
            }
        </div>
    `
})
export class OpeningComponent implements OnInit {
    private api = inject(GrandService);
    private notify = inject(NotifyService);

    readonly sections = signal<OpeningSection[]>([]);
    readonly items = signal<Item[]>([]);
    readonly lines = signal<OpeningLine[]>([]);
    readonly sectionId = signal<number>(0);
    readonly search = signal('');
    readonly note = signal('');
    readonly loading = signal(false);
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);
    readonly done = signal<{ lineCount: number; totalValue: number; businessDate: string } | null>(
        null
    );

    /**
     * A fresh key per section being opened, so a double-tap on a slow
     * connection replays the same document instead of opening twice.
     */
    private idempotencyKey = crypto.randomUUID();

    /** Everything not already on the list, narrowed by whatever was typed. */
    private readonly candidates = computed(() => {
        const term = this.search().trim().toLowerCase();
        const already = new Set(this.lines().map((l) => l.itemId));
        const pool = this.items().filter((i) => !already.has(i.id));
        if (!term) return pool;
        return pool.filter(
            (i) => i.name.toLowerCase().includes(term) || i.code.toLowerCase().includes(term)
        );
    });

    readonly matches = computed(() => this.candidates().slice(0, MAX_SUGGESTIONS));

    /** How many the cap is holding back, so the list never looks like the lot. */
    readonly hiddenCount = computed(() =>
        Math.max(0, this.candidates().length - MAX_SUGGESTIONS)
    );

    readonly totalValue = computed(() =>
        this.lines().reduce((sum, l) => sum + this.lineValue(l), 0)
    );

    readonly canSubmit = computed(
        () =>
            !!this.sectionId() &&
            this.lines().length > 0 &&
            this.lines().every((l) => this.qtyBaseOf(l) > 0 && (l.costEntered ?? -1) >= 0)
    );

    async ngOnInit(): Promise<void> {
        this.loading.set(true);
        try {
            const [sections, items] = await Promise.all([
                this.api.openingState(),
                this.api.listItems()
            ]);
            this.sections.set(sections);
            this.items.set(items);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    money(value: number): string {
        return formatMoney(value);
    }

    qty(value: number, unit: string): string {
        return formatQty(value, unit);
    }

    /** Stock units one of the chosen packs holds. 1 when counting loose. */
    private packSize(line: OpeningLine): number {
        if (line.packId === null) return 1;
        return line.packs.find((p) => p.id === line.packId)?.qtyInStockUnit ?? 1;
    }

    /**
     * What the API is actually sent. Rounded to the precision the columns hold
     * -- qty_base is numeric(14,3), unit_cost numeric(14,4) -- so the total on
     * screen is the total that gets stored, rather than one that drifts by a
     * few cents once Postgres has rounded it.
     */
    qtyBaseOf(line: OpeningLine): number {
        return round((line.qtyEntered ?? 0) * this.packSize(line), 3);
    }

    unitCostOf(line: OpeningLine): number {
        return round((line.costEntered ?? 0) / this.packSize(line), 4);
    }

    lineValue(line: OpeningLine): number {
        return this.qtyBaseOf(line) * this.unitCostOf(line);
    }

    costPlaceholder(line: OpeningLine): string {
        if (line.packId === null) return `Cost per ${line.stockUnit}`;
        const pack = line.packs.find((p) => p.id === line.packId);
        return pack ? `Cost per ${pack.packName}` : 'Cost each';
    }

    /** "Main store · main store" reads as a stutter. */
    nameSaysStore(section: OpeningSection): boolean {
        return section.name.toLowerCase().includes('store');
    }

    pickSection(section: OpeningSection): void {
        this.sectionId.set(section.sectionId);
        this.lines.set([]);
        this.note.set('');
        this.idempotencyKey = crypto.randomUUID();
    }

    addLine(item: Item): void {
        // Start on the pack it is normally bought in: on a shelf, that is
        // usually what is standing there.
        const preferred =
            item.packs.find((p) => p.isDefaultPurchase) ?? item.packs[0] ?? null;

        this.lines.set([
            ...this.lines(),
            {
                itemId: item.id,
                name: item.name,
                stockUnit: item.stockUnit,
                packs: item.packs,
                packId: preferred?.id ?? null,
                qtyEntered: null,
                costEntered: null
            }
        ]);
        this.search.set('');
    }

    removeLine(itemId: number): void {
        this.lines.set(this.lines().filter((l) => l.itemId !== itemId));
    }

    setQty(itemId: number, value: string): void {
        this.lines.set(
            this.lines().map((l) => (l.itemId === itemId ? { ...l, qtyEntered: num(value) } : l))
        );
    }

    setCost(itemId: number, value: string): void {
        this.lines.set(
            this.lines().map((l) => (l.itemId === itemId ? { ...l, costEntered: num(value) } : l))
        );
    }

    /**
     * Changing the pack clears the cost rather than converting it. 10,500 meant
     * "per sack"; carrying that number over to "per kg" would be a plausible
     * figure that is wrong by a factor of twenty-five, and nothing on screen
     * would say so.
     */
    setPack(itemId: number, packId: number | null): void {
        this.lines.set(
            this.lines().map((l) =>
                l.itemId === itemId ? { ...l, packId, costEntered: null } : l
            )
        );
    }

    async submit(): Promise<void> {
        if (!this.canSubmit()) return;

        const ok = await this.notify.confirm(
            `${this.lines().length} item${
                this.lines().length === 1 ? '' : 's'
            }, ${formatMoney(this.totalValue())}. This can only be done once for this section.`,
            'Record the opening balance?',
            'Record it'
        );
        if (!ok) return;

        this.busy.set(true);
        this.error.set(null);
        try {
            const result = await this.api.createOpeningStock(
                {
                    sectionId: this.sectionId(),
                    note: this.note().trim() || null,
                    lines: this.lines().map((l) => ({
                        itemId: l.itemId,
                        qtyBase: this.qtyBaseOf(l),
                        unitCost: this.unitCostOf(l)
                    }))
                },
                this.idempotencyKey
            );
            this.done.set(result);
            this.lines.set([]);
            this.sectionId.set(0);
            this.sections.set(await this.api.openingState());
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }
}

/**
 * Enough to scroll through on a phone without turning the picker into the whole
 * item master. Past this, typing is genuinely the faster way.
 */
const MAX_SUGGESTIONS = 12;

function round(value: number, places: number): number {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}

function num(value: string): number | null {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return isNaN(parsed) ? null : parsed;
}
