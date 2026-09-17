/**
 * Reports.
 *
 * Twelve of them now, which changed the shape of the screen. Five fitted on a
 * row of tabs and all five could be fetched at once on open; twelve cannot.
 * Loading them together would mean a dozen queries - several of them full
 * ledger scans - every time somebody opened the page to read one number.
 *
 * So: a list of names first, and one report at a time. Pick one, it runs, and
 * Back returns to the list. Nothing is fetched until it is asked for, and
 * changing the dates re-runs only what is on screen.
 *
 * The list is in two groups, and the split is the argument the old file made
 * about wastage and shrinkage generalised. The first five ask whether the stock
 * figure is true. The other seven ask whether the operation is working. They
 * are read by the same person at different moments and for different reasons,
 * and mixing them into one alphabetical list of twelve makes both harder to
 * find.
 *
 * Each report still says what it is *not* telling you. A number without its
 * caveat gets acted on wrongly.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { GrandService } from '@/core/grand.service';
import { apiErrorMessage } from '@/core/api';
import { formatMoney, formatQty } from '@/core/format';
import type {
    BelowReorderRow,
    ConsumptionRow,
    CountAccuracyRow,
    OpenReturnRow,
    ReturnsSummaryRow,
    DateRange,
    DeadStockRow,
    OpenPoRow,
    PriceMovementRow,
    ServiceLevelRow,
    ShrinkageRow,
    StockOutRow,
    SupplierPerformanceRow,
    UsageVarianceRow,
    ValuationRow,
    WastageReport
} from '@/core/types';

type ReportKey =
    | 'usage'
    | 'shrinkage'
    | 'wastage'
    | 'prices'
    | 'stockouts'
    | 'openPos'
    | 'serviceLevel'
    | 'suppliers'
    | 'valuation'
    | 'deadStock'
    | 'consumption'
    | 'countAccuracy'
    | 'returns';

interface ReportCard {
    key: ReportKey;
    title: string;
    /** One line, on the card. What question it answers, not how. */
    blurb: string;
    icon: string;
}

/**
 * The catalogue.
 *
 * Order within each group is deliberate: the ones most likely to be opened on
 * an ordinary Monday come first, not the ones that were built first.
 */
const STOCK_REPORTS: ReportCard[] = [
    {
        key: 'stockouts',
        title: 'Stock-outs and reorder',
        blurb: 'What ran out, and what is about to.',
        icon: 'pi-exclamation-circle'
    },
    {
        key: 'shrinkage',
        title: 'Unexplained loss',
        blurb: 'Count gaps with no wastage document behind them.',
        icon: 'pi-eye-slash'
    },
    {
        key: 'wastage',
        title: 'Declared waste',
        blurb: 'What was thrown away, and the reason given.',
        icon: 'pi-trash'
    },
    {
        key: 'usage',
        title: 'Usage variance',
        blurb: 'What the recipes say should have been used, against what was.',
        icon: 'pi-chart-line'
    },
    {
        key: 'prices',
        title: 'Price movement',
        blurb: 'Where suppliers have quietly put their prices up.',
        icon: 'pi-tag'
    }
];

const OPS_REPORTS: ReportCard[] = [
    {
        key: 'openPos',
        title: 'Orders still out',
        blurb: 'Purchases raised and not yet delivered, oldest first.',
        icon: 'pi-clock'
    },
    {
        key: 'serviceLevel',
        title: 'Request service level',
        blurb: 'How often the store filled each section in full, and how fast.',
        icon: 'pi-send'
    },
    {
        key: 'suppliers',
        title: 'Supplier performance',
        blurb: 'Who delivers what they promised, and what you spent with them.',
        icon: 'pi-truck'
    },
    {
        key: 'valuation',
        title: 'Stock valuation',
        blurb: 'What is on the shelves, and what it is worth.',
        icon: 'pi-wallet'
    },
    {
        key: 'deadStock',
        title: 'Dead and slow stock',
        blurb: 'Money sitting on a shelf that nobody has touched.',
        icon: 'pi-inbox'
    },
    {
        key: 'consumption',
        title: 'Consumption by section',
        blurb: 'What each section got through, at what it cost.',
        icon: 'pi-chart-bar'
    },
    {
        key: 'returns',
        title: 'Returns and credits',
        blurb: 'What went back, why, and whether the money ever came.',
        icon: 'pi-undo'
    },
    {
        key: 'countAccuracy',
        title: 'Count accuracy',
        blurb: 'Whose stock counts can be trusted.',
        icon: 'pi-check-square'
    }
];

@Component({
    selector: 'app-reports',
    standalone: true,
    imports: [CommonModule, FormsModule, ButtonModule, TagModule],
    template: `
        <div class="space-y-6">
            <!-- ── The list ─────────────────────────────────────────────── -->
            @if (!selected()) {
                <div>
                    <h1 class="text-2xl font-bold">Reports</h1>
                    <p class="text-surface-500 text-sm">
                        Pick one. Each runs on its own dates.
                    </p>
                </div>

                <div class="space-y-3">
                    <h2 class="text-sm font-semibold uppercase tracking-wider text-surface-500">
                        Is the stock figure true?
                    </h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        @for (card of stockReports; track card.key) {
                            <button
                                type="button"
                                class="text-left rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-5 hover:border-primary transition-colors"
                                (click)="open(card.key)">
                                <div class="flex items-start gap-3">
                                    <i class="pi {{ card.icon }} text-xl text-primary mt-0.5"></i>
                                    <div class="min-w-0">
                                        <div class="font-semibold">{{ card.title }}</div>
                                        <p class="text-sm text-surface-500 mt-1">{{ card.blurb }}</p>
                                    </div>
                                </div>
                            </button>
                        }
                    </div>
                </div>

                <div class="space-y-3">
                    <h2 class="text-sm font-semibold uppercase tracking-wider text-surface-500">
                        Is the operation working?
                    </h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        @for (card of opsReports; track card.key) {
                            <button
                                type="button"
                                class="text-left rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-5 hover:border-primary transition-colors"
                                (click)="open(card.key)">
                                <div class="flex items-start gap-3">
                                    <i class="pi {{ card.icon }} text-xl text-primary mt-0.5"></i>
                                    <div class="min-w-0">
                                        <div class="font-semibold">{{ card.title }}</div>
                                        <p class="text-sm text-surface-500 mt-1">{{ card.blurb }}</p>
                                    </div>
                                </div>
                            </button>
                        }
                    </div>
                </div>
            }

            <!-- ── One report ───────────────────────────────────────────── -->
            @if (card(); as c) {
                <div class="space-y-6">
                    <button
                        pButton
                        text
                        size="small"
                        icon="pi pi-arrow-left"
                        label="All reports"
                        (click)="back()"></button>

                    <div class="flex flex-wrap items-end justify-between gap-3">
                        <div class="min-w-0">
                            <h1 class="text-2xl font-bold">{{ c.title }}</h1>
                            <p class="text-surface-500 text-sm">{{ c.blurb }}</p>
                        </div>
                        <div class="flex items-end gap-2">
                            <div>
                                <label class="block text-xs text-surface-500 mb-1">From</label>
                                <input
                                    type="date"
                                    class="px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                                    [ngModel]="range().from"
                                    (ngModelChange)="setFrom($event)" />
                            </div>
                            <div>
                                <label class="block text-xs text-surface-500 mb-1">To</label>
                                <input
                                    type="date"
                                    class="px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                                    [ngModel]="range().to"
                                    (ngModelChange)="setTo($event)" />
                            </div>
                            <button
                                pButton
                                icon="pi pi-refresh"
                                label="Run"
                                [loading]="loading()"
                                (click)="load()"></button>
                        </div>
                    </div>

                    @if (error()) {
                        <div class="app-note app-note--error">{{ error() }}</div>
                    }

                    <!-- A. Usage variance -->
                    @if (selected() === 'usage') {
                        <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                            <div class="px-5 py-4 border-b border-surface">
                                <div class="font-semibold">Theoretical vs actual usage</div>
                                <p class="text-sm text-surface-500 mt-1">
                                    What the recipes say should have been used, against what actually left
                                    the store. Driven by declared production, so it is strongest for bakery
                                    and prepped items and weakest for à-la-carte, where nobody logs every
                                    plate.
                                </p>
                            </div>
                            @if (usage().length === 0) {
                                <p class="p-8 text-center text-surface-500">
                                    {{ loading() ? 'Loading…' : 'Nothing outside tolerance.' }}
                                </p>
                            } @else {
                                <div class="overflow-x-auto">
                                    <table class="w-full text-sm">
                                        <thead class="text-left border-b border-surface">
                                            <tr>
                                                <th class="px-4 py-2 font-semibold">Item</th>
                                                <th class="px-4 py-2 font-semibold">Section</th>
                                                <th class="px-4 py-2 font-semibold text-right">Should have used</th>
                                                <th class="px-4 py-2 font-semibold text-right">Actually issued</th>
                                                <th class="px-4 py-2 font-semibold text-right">Variance</th>
                                                <th class="px-4 py-2 font-semibold text-right">Value</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (row of usage(); track row.itemId + row.sectionCode) {
                                                <tr class="border-b border-surface">
                                                    <td class="px-4 py-2">
                                                        <div class="font-medium">{{ row.name }}</div>
                                                        <div class="text-xs text-surface-500 font-mono">{{ row.code }}</div>
                                                    </td>
                                                    <td class="px-4 py-2">{{ row.sectionCode }}</td>
                                                    <td class="px-4 py-2 text-right">{{ q(row.theoreticalQty, row.stockUnit) }}</td>
                                                    <td class="px-4 py-2 text-right">{{ q(row.actualQty, row.stockUnit) }}</td>
                                                    <td
                                                        class="px-4 py-2 text-right font-medium"
                                                        [class.text-red-600]="row.varianceQty > 0">
                                                        {{ row.variancePct > 0 ? '+' : '' }}{{ row.variancePct }}%
                                                    </td>
                                                    <td class="px-4 py-2 text-right">{{ money(row.varianceValue) }}</td>
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            }
                        </div>
                    }

                    <!-- B. Shrinkage -->
                    @if (selected() === 'shrinkage') {
                        <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                            <div class="px-5 py-4 border-b border-surface">
                                <div class="font-semibold">Unexplained loss</div>
                                <p class="text-sm text-surface-500 mt-1">
                                    Count gaps with <strong>no wastage document</strong> behind them. Anything
                                    that was declared as waste is not here - it is under Declared waste, where
                                    it belongs. Small gaps are filtered out: counting is never exact, and a
                                    report that lists every rounding error stops being read.
                                </p>
                            </div>
                            @if (shrink().length === 0) {
                                <p class="p-8 text-center text-surface-500">
                                    {{ loading() ? 'Loading…' : 'Nothing unexplained in this period.' }}
                                </p>
                            } @else {
                                <div class="px-5 py-4 border-b border-surface">
                                    <span class="text-sm text-surface-500">Total unexplained</span>
                                    <div class="text-2xl font-bold text-red-600">{{ money(shrinkTotal()) }}</div>
                                </div>
                                <ul class="divide-y divide-surface">
                                    @for (row of shrink(); track row.itemId + row.businessDate + row.sectionCode) {
                                        <li class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <div class="font-medium">{{ row.name }}</div>
                                                <div class="text-xs text-surface-500">
                                                    {{ row.sectionCode }} · {{ row.businessDate }}
                                                    @if (row.variancePct !== null) {
                                                        · {{ row.variancePct }}% of what was expected
                                                    }
                                                </div>
                                            </div>
                                            <div class="text-right">
                                                <div class="font-medium">{{ q(row.varianceQty, row.stockUnit) }}</div>
                                                <div class="text-red-600 font-semibold">{{ money(row.varianceValue) }}</div>
                                            </div>
                                        </li>
                                    }
                                </ul>
                            }
                        </div>
                    }

                    <!-- D. Wastage -->
                    @if (selected() === 'wastage') {
                        <div class="space-y-4">
                            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-4">
                                <div class="font-semibold">Declared waste</div>
                                <p class="text-sm text-surface-500 mt-1">
                                    Waste someone logged, with a reason. This is a kitchen and ordering
                                    problem, not a loss-prevention one - a spoilage spike usually means
                                    over-ordering or a chiller fault. It is deliberately kept separate from
                                    unexplained loss.
                                </p>
                            </div>

                            @if (wastage(); as w) {
                                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                    @for (r of w.byReason; track r.reasonCode) {
                                        <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-4">
                                            <div class="text-sm text-surface-500">{{ r.reasonLabel }}</div>
                                            <div class="text-xl font-bold">{{ money(r.value) }}</div>
                                            <div class="text-xs text-surface-500">{{ r.events }} event(s)</div>
                                        </div>
                                    }
                                </div>

                                <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                                    <ul class="divide-y divide-surface">
                                        @for (row of w.rows; track row.itemId + row.reasonCode + row.sectionCode) {
                                            <li class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <div class="font-medium">{{ row.name }}</div>
                                                    <div class="text-xs text-surface-500">
                                                        {{ row.sectionCode }} · {{ row.events }} event(s)
                                                    </div>
                                                </div>
                                                <div class="flex items-center gap-3">
                                                    <p-tag severity="info" [value]="row.reasonLabel"></p-tag>
                                                    <div class="text-right">
                                                        <div class="font-medium">{{ q(row.qtyBase, row.stockUnit) }}</div>
                                                        <div class="text-sm text-surface-500">{{ money(row.value) }}</div>
                                                    </div>
                                                </div>
                                            </li>
                                        }
                                    </ul>
                                    @if (w.rows.length === 0) {
                                        <p class="p-8 text-center text-surface-500">No waste logged.</p>
                                    }
                                </div>
                            }
                        </div>
                    }

                    <!-- C. Price movement -->
                    @if (selected() === 'prices') {
                        <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                            <div class="px-5 py-4 border-b border-surface">
                                <div class="font-semibold">Supplier price movement</div>
                                <p class="text-sm text-surface-500 mt-1">
                                    Dated by the delivery that revealed the change, not the day the supplier
                                    decided it. You find out when the lorry arrives.
                                </p>
                            </div>
                            @if (prices().length === 0) {
                                <p class="p-8 text-center text-surface-500">
                                    {{ loading() ? 'Loading…' : 'No significant price changes.' }}
                                </p>
                            } @else {
                                <ul class="divide-y divide-surface">
                                    @for (row of prices(); track row.itemPackId + row.effectiveFrom) {
                                        <li class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <div class="font-medium">{{ row.itemName }}</div>
                                                <div class="text-xs text-surface-500">
                                                    {{ row.packName }} · {{ row.supplierName }} · {{ row.effectiveFrom }}
                                                </div>
                                            </div>
                                            <div class="text-right">
                                                <div class="text-sm text-surface-500">
                                                    {{ money(row.previousPrice) }} → {{ money(row.newPrice) }}
                                                </div>
                                                <div
                                                    class="font-semibold"
                                                    [class.text-red-600]="row.changePct > 0"
                                                    [class.text-green-600]="row.changePct < 0">
                                                    {{ row.changePct > 0 ? '+' : '' }}{{ row.changePct }}%
                                                </div>
                                            </div>
                                        </li>
                                    }
                                </ul>
                            }
                        </div>
                    }

                    <!-- E. Stock-outs -->
                    @if (selected() === 'stockouts') {
                        <div class="space-y-4">
                            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                                <div class="px-5 py-4 border-b border-surface font-semibold">Needs ordering now</div>
                                @if (low().length === 0) {
                                    <p class="p-8 text-center text-surface-500">Nothing below its reorder point.</p>
                                } @else {
                                    <ul class="divide-y divide-surface">
                                        @for (row of low(); track row.itemId) {
                                            <li class="px-5 py-4 flex items-center justify-between gap-3">
                                                <div>
                                                    <div class="font-medium">
                                                        {{ row.name }}
                                                        @if (row.isCritical) {
                                                            <p-tag severity="info" value="critical" styleClass="ml-2"></p-tag>
                                                        }
                                                    </div>
                                                    <div class="text-xs text-surface-500 font-mono">{{ row.code }}</div>
                                                </div>
                                                <div class="text-right">
                                                    <div class="font-medium" [class.text-red-600]="row.qtyBase <= 0">
                                                        {{ q(row.qtyBase, row.stockUnit) }}
                                                    </div>
                                                    <div class="text-xs text-surface-500">
                                                        order {{ q(row.shortfall, row.stockUnit) }} to reach par
                                                    </div>
                                                </div>
                                            </li>
                                        }
                                    </ul>
                                }
                            </div>

                            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                                <div class="px-5 py-4 border-b border-surface">
                                    <div class="font-semibold">Ran out during this period</div>
                                    <p class="text-sm text-surface-500 mt-1">
                                        Days the store held nothing. Each one is a dish that came off the menu
                                        mid-service.
                                    </p>
                                </div>
                                @if (outs().length === 0) {
                                    <p class="p-8 text-center text-surface-500">
                                        {{ loading() ? 'Loading…' : 'Nothing ran out.' }}
                                    </p>
                                } @else {
                                    <ul class="divide-y divide-surface">
                                        @for (row of outs(); track row.itemId + row.businessDate) {
                                            <li class="px-5 py-4 flex items-center justify-between gap-3">
                                                <div>
                                                    <div class="font-medium">{{ row.name }}</div>
                                                    <div class="text-xs text-surface-500 font-mono">{{ row.code }}</div>
                                                </div>
                                                <div class="text-right text-sm">
                                                    <div class="text-red-600 font-medium">{{ row.businessDate }}</div>
                                                    <div class="text-surface-500">{{ q(row.balance, row.stockUnit) }}</div>
                                                </div>
                                            </li>
                                        }
                                    </ul>
                                }
                            </div>
                        </div>
                    }

                    <!-- F. Orders still out -->
                    @if (selected() === 'openPos') {
                        <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                            <div class="px-5 py-4 border-b border-surface">
                                <div class="font-semibold">Purchases not yet delivered</div>
                                <p class="text-sm text-surface-500 mt-1">
                                    Raised in this period and still open. <strong>Days open</strong> is the
                                    column that matters: an order waiting on approval for a fortnight is not
                                    a purchasing problem, it is a nobody-was-told problem. Dated by when the
                                    order was raised, not by when it is due.
                                </p>
                            </div>
                            @if (openPos().length === 0) {
                                <p class="p-8 text-center text-surface-500">
                                    {{ loading() ? 'Loading…' : 'Nothing outstanding.' }}
                                </p>
                            } @else {
                                <div class="overflow-x-auto">
                                    <table class="w-full text-sm">
                                        <thead class="text-left border-b border-surface">
                                            <tr>
                                                <th class="px-4 py-2 font-semibold">Supplier</th>
                                                <th class="px-4 py-2 font-semibold">Raised by</th>
                                                <th class="px-4 py-2 font-semibold">Stage</th>
                                                <th class="px-4 py-2 font-semibold text-right">Days open</th>
                                                <th class="px-4 py-2 font-semibold text-right">Overdue</th>
                                                <th class="px-4 py-2 font-semibold text-right">Still to come</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (row of openPos(); track row.id) {
                                                <tr class="border-b border-surface">
                                                    <td class="px-4 py-2">
                                                        <div class="font-medium">{{ row.supplierName || 'Not chosen yet' }}</div>
                                                        <div class="text-xs text-surface-500">
                                                            {{ row.lineCount }} line(s)
                                                            @if (row.neededBy) {
                                                                · needed by {{ row.neededBy }}
                                                            }
                                                        </div>
                                                    </td>
                                                    <td class="px-4 py-2">{{ row.raisedBy }}</td>
                                                    <td class="px-4 py-2">
                                                        <p-tag [severity]="poTone(row.status)" [value]="poLabel(row.status)"></p-tag>
                                                    </td>
                                                    <td
                                                        class="px-4 py-2 text-right font-medium"
                                                        [class.text-red-600]="row.daysOpen >= 14">
                                                        {{ row.daysOpen }}
                                                    </td>
                                                    <td class="px-4 py-2 text-right" [class.text-red-600]="row.daysLate > 0">
                                                        {{ row.daysLate > 0 ? row.daysLate + ' d' : '-' }}
                                                    </td>
                                                    <td class="px-4 py-2 text-right">{{ money(row.outstandingValue) }}</td>
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            }
                        </div>
                    }

                    <!-- G. Service level -->
                    @if (selected() === 'serviceLevel') {
                        <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                            <div class="px-5 py-4 border-b border-surface">
                                <div class="font-semibold">How well the store served each section</div>
                                <p class="text-sm text-surface-500 mt-1">
                                    Two fill rates, because they settle different arguments.
                                    <strong>Lines in full</strong> is what the kitchen feels - half the things
                                    they asked for came up short. <strong>Quantity filled</strong> is what the
                                    store defends itself with - they got 94% of what they asked for. Both are
                                    true at once. Cancelled requests are left out.
                                </p>
                            </div>
                            @if (serviceLevel().length === 0) {
                                <p class="p-8 text-center text-surface-500">
                                    {{ loading() ? 'Loading…' : 'Nobody asked for anything in this period.' }}
                                </p>
                            } @else {
                                <div class="overflow-x-auto">
                                    <table class="w-full text-sm">
                                        <thead class="text-left border-b border-surface">
                                            <tr>
                                                <th class="px-4 py-2 font-semibold">Section</th>
                                                <th class="px-4 py-2 font-semibold text-right">Requests</th>
                                                <th class="px-4 py-2 font-semibold text-right">Still waiting</th>
                                                <th class="px-4 py-2 font-semibold text-right">Lines in full</th>
                                                <th class="px-4 py-2 font-semibold text-right">Quantity filled</th>
                                                <th class="px-4 py-2 font-semibold text-right">Avg wait</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (row of serviceLevel(); track row.sectionId) {
                                                <tr class="border-b border-surface">
                                                    <td class="px-4 py-2 font-medium">{{ row.sectionName }}</td>
                                                    <td class="px-4 py-2 text-right">{{ row.requests }}</td>
                                                    <td class="px-4 py-2 text-right" [class.text-red-600]="row.stillWaiting > 0">
                                                        {{ row.stillWaiting }}
                                                    </td>
                                                    <td class="px-4 py-2 text-right font-medium" [class.text-red-600]="poor(row.fillRatePct)">
                                                        {{ pct(row.fillRatePct) }}
                                                        <span class="text-xs text-surface-500">
                                                            ({{ row.linesInFull }}/{{ row.lines }})
                                                        </span>
                                                    </td>
                                                    <td class="px-4 py-2 text-right" [class.text-red-600]="poor(row.qtyFillPct)">
                                                        {{ pct(row.qtyFillPct) }}
                                                    </td>
                                                    <td class="px-4 py-2 text-right">{{ hours(row.avgHoursToRelease) }}</td>
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            }
                        </div>
                    }

                    <!-- H. Suppliers -->
                    @if (selected() === 'suppliers') {
                        <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                            <div class="px-5 py-4 border-b border-surface">
                                <div class="font-semibold">Who is worth ordering from</div>
                                <p class="text-sm text-surface-500 mt-1">
                                    Returned is what went back at the price paid; credited is what a credit
                                    note has since been received for. A supplier who agrees to everything and
                                    credits nothing shows as a wide gap between the two, and net spend is what
                                    they really cost.
                                    Fill rate comes from the orders, spend comes from the deliveries, and they
                                    are counted separately on purpose - a delivery can arrive with no order
                                    behind it, and an order can be placed and never filled. A supplier appears
                                    if they were ordered from <em>or</em> delivered in this period.
                                </p>
                            </div>
                            @if (suppliers().length === 0) {
                                <p class="p-8 text-center text-surface-500">
                                    {{ loading() ? 'Loading…' : 'No supplier activity in this period.' }}
                                </p>
                            } @else {
                                <div class="overflow-x-auto">
                                    <table class="w-full text-sm">
                                        <thead class="text-left border-b border-surface">
                                            <tr>
                                                <th class="px-4 py-2 font-semibold">Supplier</th>
                                                <th class="px-4 py-2 font-semibold text-right">Orders</th>
                                                <th class="px-4 py-2 font-semibold text-right">Deliveries</th>
                                                <th class="px-4 py-2 font-semibold text-right">Fill rate</th>
                                                <th class="px-4 py-2 font-semibold text-right">Late</th>
                                                <th class="px-4 py-2 font-semibold text-right">Avg days</th>
                                                <th class="px-4 py-2 font-semibold text-right">Spend</th>
                                                <th class="px-4 py-2 font-semibold text-right">Returned</th>
                                                <th class="px-4 py-2 font-semibold text-right">Credited</th>
                                                <th class="px-4 py-2 font-semibold text-right">Net spend</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (row of suppliers(); track row.supplierId) {
                                                <tr class="border-b border-surface">
                                                    <td class="px-4 py-2 font-medium">{{ row.supplierName }}</td>
                                                    <td class="px-4 py-2 text-right">{{ row.orders }}</td>
                                                    <td class="px-4 py-2 text-right">{{ row.deliveries }}</td>
                                                    <td class="px-4 py-2 text-right font-medium" [class.text-red-600]="poor(row.fillRatePct)">
                                                        {{ pct(row.fillRatePct) }}
                                                    </td>
                                                    <td class="px-4 py-2 text-right" [class.text-red-600]="row.lateOrders > 0">
                                                        {{ row.lateOrders }}
                                                    </td>
                                                    <td class="px-4 py-2 text-right">
                                                        {{ row.avgDaysToClose === null ? '-' : row.avgDaysToClose }}
                                                    </td>
                                                    <td class="px-4 py-2 text-right">{{ money(row.spend) }}</td>
                                                    <td class="px-4 py-2 text-right" [class.text-amber-600]="(row.returnRatePct ?? 0) > 2">
                                                        {{ money(row.returnedValue) }}
                                                        @if (row.returnRatePct !== null) {
                                                            <span class="text-xs text-surface-500 block">{{ row.returnRatePct }}%</span>
                                                        }
                                                    </td>
                                                    <td class="px-4 py-2 text-right">{{ money(row.creditedValue) }}</td>
                                                    <td class="px-4 py-2 text-right font-medium">{{ money(row.netSpend) }}</td>
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            }
                        </div>
                    }

                    <!-- I. Valuation -->
                    @if (selected() === 'valuation') {
                        <div class="space-y-4">
                            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-5">
                                <div class="text-sm text-surface-500">Total on hand at {{ range().to }}</div>
                                <div class="text-3xl font-bold">{{ money(valuationTotal()) }}</div>
                                <p class="text-sm text-surface-500 mt-2">
                                    The quantity is rebuilt from the ledger up to the end date. The cost is
                                    <strong>today's</strong> average - the system keeps one current cost per
                                    item, not a history of them. For a period ending today the two agree, which
                                    is what this is for; backdate it a long way and the value drifts.
                                </p>
                            </div>

                            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                                @if (valuation().length === 0) {
                                    <p class="p-8 text-center text-surface-500">
                                        {{ loading() ? 'Loading…' : 'Nothing on hand.' }}
                                    </p>
                                } @else {
                                    <div class="overflow-x-auto">
                                        <table class="w-full text-sm">
                                            <thead class="text-left border-b border-surface">
                                                <tr>
                                                    <th class="px-4 py-2 font-semibold">Section</th>
                                                    <th class="px-4 py-2 font-semibold">Item</th>
                                                    <th class="px-4 py-2 font-semibold text-right">On hand</th>
                                                    <th class="px-4 py-2 font-semibold text-right">Unit cost</th>
                                                    <th class="px-4 py-2 font-semibold text-right">Value</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                @for (row of valuation(); track row.sectionId + '-' + row.itemId) {
                                                    <tr class="border-b border-surface">
                                                        <td class="px-4 py-2">{{ row.sectionName }}</td>
                                                        <td class="px-4 py-2">
                                                            <div class="font-medium">{{ row.name }}</div>
                                                            <div class="text-xs text-surface-500 font-mono">{{ row.code }}</div>
                                                        </td>
                                                        <td class="px-4 py-2 text-right">{{ q(row.qtyBase, row.stockUnit) }}</td>
                                                        <td class="px-4 py-2 text-right text-surface-500">{{ row.avgCost }}</td>
                                                        <td class="px-4 py-2 text-right font-medium">{{ money(row.value) }}</td>
                                                    </tr>
                                                }
                                            </tbody>
                                        </table>
                                    </div>
                                }
                            </div>
                        </div>
                    }

                    <!-- J. Dead stock -->
                    @if (selected() === 'deadStock') {
                        <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                            <div class="px-5 py-4 border-b border-surface">
                                <div class="font-semibold">Nothing issued from it in this period</div>
                                <p class="text-sm text-surface-500 mt-1">
                                    Cash tied up, and for anything perishable a spoilage bill that has not been
                                    written yet. <strong>Last moved</strong> is what separates slow from
                                    forgotten. A short date range will flag things that are simply seasonal -
                                    widen it before you act on a row.
                                </p>
                            </div>
                            @if (deadStock().length === 0) {
                                <p class="p-8 text-center text-surface-500">
                                    {{ loading() ? 'Loading…' : 'Everything on the shelves moved.' }}
                                </p>
                            } @else {
                                <div class="overflow-x-auto">
                                    <table class="w-full text-sm">
                                        <thead class="text-left border-b border-surface">
                                            <tr>
                                                <th class="px-4 py-2 font-semibold">Item</th>
                                                <th class="px-4 py-2 font-semibold">Section</th>
                                                <th class="px-4 py-2 font-semibold text-right">On hand</th>
                                                <th class="px-4 py-2 font-semibold text-right">Value</th>
                                                <th class="px-4 py-2 font-semibold text-right">Last moved</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (row of deadStock(); track row.itemId + '-' + row.sectionName) {
                                                <tr class="border-b border-surface">
                                                    <td class="px-4 py-2">
                                                        <div class="font-medium">{{ row.name }}</div>
                                                        <div class="text-xs text-surface-500 font-mono">{{ row.code }}</div>
                                                    </td>
                                                    <td class="px-4 py-2">{{ row.sectionName }}</td>
                                                    <td class="px-4 py-2 text-right">{{ q(row.qtyBase, row.stockUnit) }}</td>
                                                    <td class="px-4 py-2 text-right font-medium">{{ money(row.value) }}</td>
                                                    <td class="px-4 py-2 text-right">
                                                        @if (row.lastMovedOn) {
                                                            <div>{{ row.lastMovedOn }}</div>
                                                            <div
                                                                class="text-xs"
                                                                [class.text-red-600]="(row.daysSinceMoved ?? 0) >= 30"
                                                                [class.text-surface-500]="(row.daysSinceMoved ?? 0) < 30">
                                                                {{ row.daysSinceMoved }} days ago
                                                            </div>
                                                        } @else {
                                                            <span class="text-surface-500">never</span>
                                                        }
                                                    </td>
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            }
                        </div>
                    }

                    <!-- K. Consumption -->
                    @if (selected() === 'consumption') {
                        <div class="space-y-4">
                            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-5">
                                <div class="text-sm text-surface-500">Total drawn from the store</div>
                                <div class="text-3xl font-bold">{{ money(consumptionTotal()) }}</div>
                                <p class="text-sm text-surface-500 mt-2">
                                    Valued at what each movement cost at the time, not at today's price, so a
                                    period total does not shift under you when the next delivery lands. This is
                                    the base for section-level food cost. What it is <em>not</em>, yet, is food
                                    cost - there is no sales figure in this system to divide it by.
                                </p>
                            </div>

                            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                                @if (consumption().length === 0) {
                                    <p class="p-8 text-center text-surface-500">
                                        {{ loading() ? 'Loading…' : 'Nothing was issued in this period.' }}
                                    </p>
                                } @else {
                                    <div class="overflow-x-auto">
                                        <table class="w-full text-sm">
                                            <thead class="text-left border-b border-surface">
                                                <tr>
                                                    <th class="px-4 py-2 font-semibold">Section</th>
                                                    <th class="px-4 py-2 font-semibold">Item</th>
                                                    <th class="px-4 py-2 font-semibold text-right">Quantity</th>
                                                    <th class="px-4 py-2 font-semibold text-right">Cost</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                @for (row of consumption(); track row.sectionId + '-' + row.itemId) {
                                                    <tr class="border-b border-surface">
                                                        <td class="px-4 py-2">{{ row.sectionName }}</td>
                                                        <td class="px-4 py-2">
                                                            <div class="font-medium">{{ row.name }}</div>
                                                            <div class="text-xs text-surface-500 font-mono">{{ row.code }}</div>
                                                        </td>
                                                        <td class="px-4 py-2 text-right">{{ q(row.qtyBase, row.stockUnit) }}</td>
                                                        <td class="px-4 py-2 text-right font-medium">{{ money(row.value) }}</td>
                                                    </tr>
                                                }
                                            </tbody>
                                        </table>
                                    </div>
                                }
                            </div>
                        </div>
                    }

                    <!-- L. Count accuracy -->
                    @if (selected() === 'countAccuracy') {
                        <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                            <div class="px-5 py-4 border-b border-surface">
                                <div class="font-semibold">Whose counts can be trusted</div>
                                <p class="text-sm text-surface-500 mt-1">
                                    Every other report rests on the stock figure being true, and the count is
                                    where that gets checked. Read it both ways: someone who is off on a third
                                    of their lines makes shrinkage unreadable, and someone who is
                                    <em>never</em> off is either very good or not really counting. Lines left
                                    uncounted are excluded - a half-finished count is not an inaccuracy.
                                </p>
                            </div>
                            @if (countAccuracy().length === 0) {
                                <p class="p-8 text-center text-surface-500">
                                    {{ loading() ? 'Loading…' : 'No counts were closed in this period.' }}
                                </p>
                            } @else {
                                <div class="overflow-x-auto">
                                    <table class="w-full text-sm">
                                        <thead class="text-left border-b border-surface">
                                            <tr>
                                                <th class="px-4 py-2 font-semibold">Counted by</th>
                                                <th class="px-4 py-2 font-semibold">Section</th>
                                                <th class="px-4 py-2 font-semibold text-right">Counts</th>
                                                <th class="px-4 py-2 font-semibold text-right">Lines</th>
                                                <th class="px-4 py-2 font-semibold text-right">Off</th>
                                                <th class="px-4 py-2 font-semibold text-right">Accuracy</th>
                                                <th class="px-4 py-2 font-semibold text-right">Value of gaps</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (row of countAccuracy(); track row.countedBy + '-' + row.sectionName) {
                                                <tr class="border-b border-surface">
                                                    <td class="px-4 py-2 font-medium">{{ row.countedBy }}</td>
                                                    <td class="px-4 py-2">{{ row.sectionName }}</td>
                                                    <td class="px-4 py-2 text-right">{{ row.counts }}</td>
                                                    <td class="px-4 py-2 text-right">{{ row.lines }}</td>
                                                    <td class="px-4 py-2 text-right">{{ row.linesOff }}</td>
                                                    <td class="px-4 py-2 text-right font-medium" [class.text-red-600]="poor(row.accuracyPct)">
                                                        {{ pct(row.accuracyPct) }}
                                                    </td>
                                                    <td class="px-4 py-2 text-right">{{ money(row.absVarianceValue) }}</td>
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            }
                        </div>
                    }

                    <!-- M. Returns -->
                    @if (selected() === 'returns') {
                        <div class="space-y-4">
                            <div
                                class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-5">
                                <div class="text-sm text-surface-500">
                                    Sent back to suppliers, and still owed
                                </div>
                                <div class="text-3xl font-bold">
                                    {{ money(returnsOutstanding()) }}
                                </div>
                                <p class="text-sm text-surface-500 mt-2">
                                    The gap between what was sent back and what a credit note has
                                    actually been received for. It is money that was agreed to be
                                    owed and has not arrived, and this is the only place it appears.
                                </p>
                            </div>

                            <div
                                class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                                <div class="px-5 py-4 border-b border-surface">
                                    <div class="font-semibold">Why stock is coming back</div>
                                    <p class="text-sm text-surface-500 mt-1">
                                        Grouped by reason, because the first question is which of
                                        these is the supplier problem and which is ours. Damage
                                        against one vendor is a delivery problem; expiry across all
                                        of them is an ordering problem, and no amount of arguing
                                        with suppliers fixes it.
                                    </p>
                                </div>
                                @if (returns().length === 0) {
                                    <p class="p-8 text-center text-surface-500">
                                        {{ loading() ? 'Loading…' : 'Nothing came back in this period.' }}
                                    </p>
                                } @else {
                                    <div class="overflow-x-auto">
                                        <table class="w-full text-sm">
                                            <thead class="text-left border-b border-surface">
                                                <tr>
                                                    <th class="px-4 py-2 font-semibold">Reason</th>
                                                    <th class="px-4 py-2 font-semibold text-right">
                                                        From sections
                                                    </th>
                                                    <th class="px-4 py-2 font-semibold text-right">
                                                        To suppliers
                                                    </th>
                                                    <th class="px-4 py-2 font-semibold text-right">
                                                        Value sent back
                                                    </th>
                                                    <th class="px-4 py-2 font-semibold text-right">
                                                        Credited
                                                    </th>
                                                    <th class="px-4 py-2 font-semibold text-right">
                                                        Still owed
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                @for (row of returns(); track row.reasonCode) {
                                                    <tr class="border-b border-surface">
                                                        <td class="px-4 py-2 font-medium">
                                                            {{ row.reasonLabel }}
                                                        </td>
                                                        <td class="px-4 py-2 text-right">
                                                            {{ row.sectionReturns }}
                                                        </td>
                                                        <td class="px-4 py-2 text-right">
                                                            {{ row.supplierReturns }}
                                                        </td>
                                                        <td class="px-4 py-2 text-right">
                                                            {{ money(row.supplierValue) }}
                                                        </td>
                                                        <td class="px-4 py-2 text-right">
                                                            {{ money(row.creditedValue) }}
                                                        </td>
                                                        <td
                                                            class="px-4 py-2 text-right font-medium"
                                                            [class.text-amber-600]="
                                                                row.supplierValue - row.creditedValue > 0
                                                            ">
                                                            {{ money(row.supplierValue - row.creditedValue) }}
                                                        </td>
                                                    </tr>
                                                }
                                            </tbody>
                                        </table>
                                    </div>
                                }
                            </div>

                            <div
                                class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                                <div class="px-5 py-4 border-b border-surface">
                                    <div class="font-semibold">Still to chase</div>
                                    <p class="text-sm text-surface-500 mt-1">
                                        Raised, approved or gone, and not settled. A return nobody
                                        follows up is a delivery this restaurant paid for twice.
                                    </p>
                                </div>
                                @if (openReturns().length === 0) {
                                    <p class="p-8 text-center text-surface-500">
                                        {{ loading() ? 'Loading…' : 'Nothing outstanding.' }}
                                    </p>
                                } @else {
                                    <div class="overflow-x-auto">
                                        <table class="w-full text-sm">
                                            <thead class="text-left border-b border-surface">
                                                <tr>
                                                    <th class="px-4 py-2 font-semibold">Supplier</th>
                                                    <th class="px-4 py-2 font-semibold">Invoice</th>
                                                    <th class="px-4 py-2 font-semibold">Reason</th>
                                                    <th class="px-4 py-2 font-semibold">Where it is</th>
                                                    <th class="px-4 py-2 font-semibold text-right">
                                                        Waiting
                                                    </th>
                                                    <th class="px-4 py-2 font-semibold text-right">
                                                        Credit due
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                @for (row of openReturns(); track row.id) {
                                                    <tr class="border-b border-surface">
                                                        <td class="px-4 py-2">{{ row.supplierName }}</td>
                                                        <td class="px-4 py-2 font-mono text-xs">
                                                            {{ row.invoiceNo || '-' }}
                                                        </td>
                                                        <td class="px-4 py-2">{{ row.reasonLabel }}</td>
                                                        <td class="px-4 py-2">{{ row.status }}</td>
                                                        <td
                                                            class="px-4 py-2 text-right"
                                                            [class.text-red-600]="row.daysWaiting > 30">
                                                            {{ row.daysWaiting }} days
                                                        </td>
                                                        <td class="px-4 py-2 text-right font-medium">
                                                            {{ money(row.expectedCredit) }}
                                                        </td>
                                                    </tr>
                                                }
                                            </tbody>
                                        </table>
                                    </div>
                                }
                            </div>
                        </div>
                    }
                </div>
            }
        </div>
    `
})
export class ReportsComponent {
    private api = inject(GrandService);

    readonly stockReports = STOCK_REPORTS;
    readonly opsReports = OPS_REPORTS;

    /** Null is the list. Everything else is one report. */
    readonly selected = signal<ReportKey | null>(null);
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);

    readonly card = computed(() => {
        const key = this.selected();
        if (!key) return null;
        return [...STOCK_REPORTS, ...OPS_REPORTS].find((c) => c.key === key) ?? null;
    });

    // The five
    readonly usage = signal<UsageVarianceRow[]>([]);
    readonly shrink = signal<ShrinkageRow[]>([]);
    readonly shrinkTotal = signal(0);
    readonly prices = signal<PriceMovementRow[]>([]);
    readonly wastage = signal<WastageReport | null>(null);
    readonly outs = signal<StockOutRow[]>([]);
    readonly low = signal<BelowReorderRow[]>([]);

    // The seven
    readonly openPos = signal<OpenPoRow[]>([]);
    readonly serviceLevel = signal<ServiceLevelRow[]>([]);
    readonly suppliers = signal<SupplierPerformanceRow[]>([]);
    readonly valuation = signal<ValuationRow[]>([]);
    readonly deadStock = signal<DeadStockRow[]>([]);
    readonly consumption = signal<ConsumptionRow[]>([]);
    readonly countAccuracy = signal<CountAccuracyRow[]>([]);
    readonly returns = signal<ReturnsSummaryRow[]>([]);
    readonly openReturns = signal<OpenReturnRow[]>([]);
    /**
     * Sent back and not yet credited. The number the owner should be chasing:
     * goods that left the building against an invoice that was already paid.
     */
    readonly returnsOutstanding = computed(() =>
        this.returns().reduce((n, r) => n + (r.supplierValue - r.creditedValue), 0)
    );


    readonly valuationTotal = computed(() =>
        this.valuation().reduce((sum, r) => sum + r.value, 0)
    );
    readonly consumptionTotal = computed(() =>
        this.consumption().reduce((sum, r) => sum + r.value, 0)
    );

    /**
     * Defaults to the last 60 days so the seeded demo period is visible without
     * anyone having to know the dates. Kept across reports on purpose: someone
     * looking at August wants August in the next one too.
     */
    readonly range = signal<DateRange>({
        from: iso(new Date(Date.now() - 59 * 86_400_000)),
        to: iso(new Date())
    });

    setFrom(from: string): void {
        this.range.update((r) => ({ ...r, from }));
    }

    setTo(to: string): void {
        this.range.update((r) => ({ ...r, to }));
    }

    /** Open one report and run it. Nothing else is fetched. */
    open(key: ReportKey): void {
        this.selected.set(key);
        this.error.set(null);
        void this.load();
    }

    back(): void {
        this.selected.set(null);
        this.error.set(null);
    }

    /**
     * Runs whatever is on screen, and only that.
     *
     * The old version fetched all five on open. At twelve - several of them
     * full ledger scans - that would be a dozen queries to read one number.
     */
    async load(): Promise<void> {
        const key = this.selected();
        if (!key) return;

        this.loading.set(true);
        this.error.set(null);
        const range = this.range();

        try {
            switch (key) {
                case 'usage':
                    this.usage.set((await this.api.usageVariance(range)).rows);
                    break;
                case 'shrinkage': {
                    const res = await this.api.shrinkage(range);
                    this.shrink.set(res.rows);
                    this.shrinkTotal.set(res.totalValue);
                    break;
                }
                case 'wastage':
                    this.wastage.set(await this.api.wastageReport(range));
                    break;
                case 'prices':
                    this.prices.set((await this.api.priceMovement(range)).rows);
                    break;
                case 'stockouts': {
                    const res = await this.api.stockOutReport(range);
                    this.outs.set(res.stockOuts);
                    this.low.set(res.belowReorder);
                    break;
                }
                case 'openPos':
                    this.openPos.set((await this.api.openPurchaseOrdersReport(range)).rows);
                    break;
                case 'serviceLevel':
                    this.serviceLevel.set((await this.api.serviceLevelReport(range)).rows);
                    break;
                case 'suppliers':
                    this.suppliers.set((await this.api.supplierPerformanceReport(range)).rows);
                    break;
                case 'valuation':
                    this.valuation.set((await this.api.valuationReport(range)).rows);
                    break;
                case 'deadStock':
                    this.deadStock.set((await this.api.deadStockReport(range)).rows);
                    break;
                case 'consumption':
                    this.consumption.set((await this.api.consumptionReport(range)).rows);
                    break;
                case 'countAccuracy':
                    this.countAccuracy.set((await this.api.countAccuracyReport(range)).rows);
                    break;
                case 'returns': {
                    // Two questions on one screen: why it is coming back, and
                    // what is still owed for it.
                    const [summary, open] = await Promise.all([
                        this.api.returnsReport(range),
                        this.api.openReturnsReport(range)
                    ]);
                    this.returns.set(summary.rows);
                    this.openReturns.set(open.rows);
                    break;
                }
            }
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    money(n: number): string {
        return formatMoney(n);
    }

    q(qty: number, unit: string): string {
        return formatQty(qty, unit);
    }

    /** Null means there was nothing to divide by, which is not zero percent. */
    pct(n: number | null): string {
        return n === null ? '-' : `${n}%`;
    }

    /** Below 90% is worth looking at. Null is not bad, it is unknown. */
    poor(n: number | null): boolean {
        return n !== null && n < 90;
    }

    /** Hours read badly past a day or so, and days read badly under one. */
    hours(n: number | null): string {
        if (n === null) return '-';
        return n < 24 ? `${n} h` : `${Math.round((n / 24) * 10) / 10} d`;
    }

    poLabel(status: string): string {
        return (
            { requested: 'Waiting for approval', approved: 'Approved', ordered: 'On order' }[
                status
            ] ?? status
        );
    }

    poTone(status: string): 'success' | 'warn' | 'info' | 'secondary' {
        return status === 'approved' ? 'success' : status === 'ordered' ? 'info' : 'warn';
    }
}

function iso(d: Date): string {
    return d.toISOString().slice(0, 10);
}
