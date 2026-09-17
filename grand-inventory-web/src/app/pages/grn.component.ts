/**
 * Goods received note - one question at a time.
 *
 * Three rules from the build notes are load-bearing in this form:
 *
 *  - The user enters **packs**. "2 × 20 L can", never "40000". The stock-unit
 *    equivalent is shown read-only beside it so the storekeeper can sanity
 *    check the conversion, but it is never an input.
 *  - A price jump warns inline, before the lorry leaves, not in a report a
 *    fortnight later. The last price this supplier charged is read when the
 *    supplier is chosen, so the warning appears under the price as it is
 *    typed - the save response still carries the authoritative list, but by
 *    then the driver has gone.
 *  - The Idempotency-Key is minted once when the form opens. Tapping Save twice
 *    on a stalled connection replays the first request instead of receiving the
 *    same delivery twice.
 *
 * **Why it is a sequence.** This screen used to show everything at once: an
 * order list, a supplier block, a line grid and a save button, all live
 * together, with a blank line already sitting under a list the storekeeper had
 * not answered yet. Two panels both looked like the place to start, the
 * supplier could be filled in before anyone had said what the delivery was
 * against, and nothing said how far through you were. It is four questions in
 * a fixed order and now reads as four questions in a fixed order:
 *
 *   1. Which order?   2. Who delivered it?   3. What came off the lorry?
 *   4. Check it and save.
 *
 * Going back is a button on the step header, because changing an answer is
 * ordinary. Going forward needs the current answer to be complete, and the
 * button says what is missing rather than sitting there greyed and silent.
 *
 * Orders management has not approved yet are listed but greyed and inert. The
 * server refuses a delivery against them, so a row that looked pickable would
 * only ever be a dead end; showing them anyway answers the question the
 * storekeeper actually has, which is "where is my order" and not "why is this
 * list short".
 *
 * **What happens after Save.** Either the whole delivery is written or none of
 * it is - the document rows and the ledger rows go in one transaction, so there
 * is no state where a delivery half-exists. On success the screen stays put and
 * shows what was recorded: the document number, the total, and what each line
 * left on the shelf, read back out of the ledger. It used to navigate away to
 * the stock list, which is alphabetical and shows every product in the branch -
 * so the one question the storekeeper has at that moment ("did that go in?")
 * was answered by making them search for it.
 *
 * On failure nothing is written, the reason is shown next to the button that
 * was pressed, and the form is left exactly as it was so it can be corrected
 * and sent again. The Idempotency-Key is the same on that retry, so a failure
 * that was actually a lost response - the server wrote it, the reply never
 * arrived - replays the first result instead of receiving the goods twice.
 *
 * Manual entry stays. Plenty arrives that nobody raised an order for.
 *
 * There is deliberately no separate "receive" screen -- one way for stock to
 * arrive means one place that converts packs into stock units, and that
 * conversion is the thing that must never have a second implementation.
 */
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TagModule } from 'primeng/tag';
import { AuthStore } from '@/core/auth.store';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import { formatMoney, formatQty } from '@/core/format';
import { uuid } from '@/core/uuid';
import type {
    GrnResult,
    Item,
    ItemPack,
    LastPrice,
    PriceWarning,
    PurchaseOrder,
    Supplier
} from '@/core/types';
import { AppItemPicker } from '@/shared/item-picker.component';
import { AppSteps, type Step } from '@/shared/steps.component';

interface Draft {
    itemId: number | null;
    packId: number | null;
    qtyPacks: number | null;
    packPrice: number | null;
}

/** A price move beyond this is worth interrupting someone about. Mirrors PRICE_WARN_PCT in api/src/services/grn.ts. */
const PRICE_WARN_PCT = 10;

@Component({
    selector: 'app-grn',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        InputTextModule,
        InputNumberModule,
        TagModule,
        RouterLink,
        AppItemPicker,
        AppSteps
    ],
    template: `
        <div class="space-y-6">
            <div>
                <h1 class="text-2xl font-bold">Receive delivery</h1>
                <p class="text-surface-500 text-sm">
                    Something has arrived at the door. Four questions and it is on the shelf.
                </p>
            </div>

            @if (!saved()) {
                <app-steps
                    [steps]="steps"
                    [index]="stepIndex()"
                    label="Receiving a delivery"
                    (indexChange)="goBackTo($event)" />
            }

            @if (error()) {
                <div class="app-note app-note--error">
                    <div class="app-note__title">That did not save</div>
                    <p class="mt-1">{{ error() }}</p>
                    <p class="mt-1">
                        <strong>Nothing was recorded.</strong> The delivery is exactly as you
                        left it - fix what the message says and press Save again.
                    </p>
                </div>
            }

            <!-- ── Saved ───────────────────────────────────────────────────
                 The answer to "did that go in?", on the screen where it was
                 asked. -->
            @if (saved(); as done) {
                <div
                    class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                    <div class="px-5 py-4 border-b border-surface flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div class="font-semibold text-lg">Delivery recorded</div>
                            <p class="text-sm text-surface-500 mt-0.5">
                                {{ supplierName() }}
                                @if (invoiceNo()) {
                                    · invoice {{ invoiceNo() }}
                                }
                                · delivery no.
                                <span class="font-mono">{{ done.id }}</span>
                                · business day {{ done.businessDate }}
                            </p>
                        </div>
                        <div class="text-right">
                            <div class="text-2xl font-bold">{{ money(done.total) }}</div>
                            <div class="text-xs text-surface-500">
                                {{ done.lineCount }} line(s)
                            </div>
                        </div>
                    </div>

                    <ul class="divide-y divide-surface">
                        @for (line of savedLines(); track line.itemId) {
                            <li class="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                                <div class="min-w-0">
                                    <div class="font-medium">{{ line.name }}</div>
                                    <div class="text-xs text-surface-500 mt-0.5">
                                        {{ line.qtyPacks }} × {{ line.packName }} = {{ line.added }}
                                        in
                                    </div>
                                </div>
                                @if (line.onShelf !== null) {
                                    <div class="text-right">
                                        <div class="font-semibold">{{ line.onShelf }}</div>
                                        <div class="text-xs text-surface-500">
                                            on the shelf now
                                        </div>
                                    </div>
                                }
                            </li>
                        }
                    </ul>

                    @if (done.priceWarnings.length > 0) {
                        <div class="px-5 py-4 border-t border-surface">
                            <div class="app-note app-note--warn">
                                <div class="app-note__title mb-1">
                                    {{ done.priceWarnings.length }} price change(s) went on the
                                    record
                                </div>
                                <ul class="text-sm space-y-1">
                                    @for (w of done.priceWarnings; track w.itemPackId) {
                                        <li>
                                            {{ w.itemName }} ({{ w.packName }}):
                                            {{ money(w.previousPrice) }} →
                                            {{ money(w.newPrice) }}
                                            <strong>
                                                ({{ w.changePct > 0 ? '+' : '' }}{{ w.changePct }}%)
                                            </strong>
                                        </li>
                                    }
                                </ul>
                                <p class="text-sm mt-2">
                                    These show up under <strong>Reports → Price movement</strong>.
                                </p>
                            </div>
                        </div>
                    }

                    <div
                        class="px-5 py-4 border-t border-surface flex flex-wrap items-center gap-3">
                        <button
                            pButton
                            icon="pi pi-plus"
                            label="Receive another delivery"
                            (click)="startAnother()"></button>
                        <a pButton outlined icon="pi pi-database" label="Stock on hand" routerLink="/stock"></a>
                        @if (po()) {
                            <a
                                pButton
                                outlined
                                icon="pi pi-file-edit"
                                label="Back to the order"
                                routerLink="/purchases"></a>
                        }
                        <span class="text-sm text-surface-500">
                            It is on the ledger now. A mistake is corrected with a reversal, not
                            an edit - ask management.
                        </span>
                    </div>
                </div>
            }

            <!-- ── 1. Which order? ─────────────────────────────────────────── -->
            @if (!saved() && step() === 'order') {
                <div
                    class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                    @if (loadingOrders()) {
                        <p class="p-8 text-center text-surface-500">Loading orders…</p>
                    } @else if (openOrders().length === 0) {
                        <div class="p-8 text-center space-y-3">
                            <p class="text-surface-500">
                                Nothing is on order. That is normal - plenty arrives that nobody
                                raised an order for.
                            </p>
                            <button
                                pButton
                                icon="pi pi-arrow-right"
                                iconPos="right"
                                label="Enter this delivery"
                                (click)="enterManually()"></button>
                        </div>
                    } @else {
                        <ul class="divide-y divide-surface">
                            @for (order of openOrders(); track order.id) {
                                <li
                                    class="px-5 py-4 flex flex-wrap items-center justify-between gap-3"
                                    [class.cursor-pointer]="receivable(order)"
                                    [class.opacity-60]="!receivable(order)"
                                    [class.cursor-not-allowed]="!receivable(order)"
                                    [class.select-none]="!receivable(order)"
                                    [attr.aria-disabled]="!receivable(order)"
                                    (click)="choose(order)">
                                    <div class="min-w-0">
                                        <div
                                            class="font-medium"
                                            [class.text-surface-400]="!receivable(order)">
                                            {{ order.supplierName || 'No supplier yet' }}
                                        </div>
                                        <div
                                            class="text-sm mt-0.5"
                                            [class.text-surface-400]="!receivable(order)">
                                            {{ orderSummary(order) }}
                                        </div>
                                        <div
                                            class="text-xs mt-0.5"
                                            [class.text-surface-400]="!receivable(order)"
                                            [class.text-surface-500]="receivable(order)">
                                            raised by {{ order.raisedBy }} · {{ day(order.raisedAt) }}
                                            @if (order.neededBy) {
                                                · needed by {{ order.neededBy }}
                                            }
                                            @if (order.estimatedTotal !== null) {
                                                · about {{ money(order.estimatedTotal) }}
                                            }
                                        </div>
                                    </div>

                                    <div class="flex items-center gap-2 shrink-0">
                                        @if (order.partReceived) {
                                            <p-tag severity="warn" value="Part delivered"></p-tag>
                                        }
                                        @if (receivable(order)) {
                                            <p-tag
                                                [severity]="order.status === 'ordered' ? 'info' : 'success'"
                                                [value]="order.status === 'ordered' ? 'On order' : 'Approved'"></p-tag>
                                            <button
                                                pButton
                                                size="small"
                                                icon="pi pi-download"
                                                label="This one"
                                                (click)="choose(order); $event.stopPropagation()"></button>
                                        } @else {
                                            <!-- Greyed and inert on purpose: the
                                                 server will not book a delivery
                                                 against an order nobody has
                                                 approved yet. -->
                                            <p-tag severity="secondary" value="Waiting for approval"></p-tag>
                                        }
                                    </div>
                                </li>
                            }
                        </ul>

                        <div
                            class="px-5 py-4 border-t border-surface flex flex-wrap items-center justify-between gap-3">
                            <span class="text-sm text-surface-500">
                                None of these? Nobody ordered it, or it is a top-up.
                            </span>
                            <button
                                pButton
                                outlined
                                size="small"
                                icon="pi pi-pencil"
                                label="Nothing was ordered"
                                (click)="enterManually()"></button>
                        </div>
                    }
                </div>
            }

            <!-- ── 2. Who delivered it? ────────────────────────────────────── -->
            @if (!saved() && step() === 'supplier') {
                @if (po(); as order) {
                    <div class="app-note">
                        <div class="app-note__title">
                            Against the purchase raised by {{ order.raisedBy }}
                        </div>
                        <p class="text-sm mt-1">
                            The supplier comes from the order. A delivery from anybody else is its
                            own delivery - go back a step and choose "nothing was ordered".
                        </p>
                    </div>
                }

                <div
                    class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-4 md:p-6 space-y-5">
                    <div>
                        <label class="block text-sm font-medium mb-1 app-req" for="grn-supplier">
                            Who delivered it?
                        </label>
                        <select
                            id="grn-supplier"
                            class="w-full md:w-96 px-3 py-2.5 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                            [disabled]="supplierLocked()"
                            [ngModel]="supplierId()"
                            (ngModelChange)="setSupplier(+$event)">
                            <option [ngValue]="null">Choose a supplier…</option>
                            @for (s of suppliers(); track s.id) {
                                <option [ngValue]="s.id">{{ s.name }}</option>
                            }
                        </select>
                        @if (suppliers().length === 0) {
                            <p class="text-xs text-surface-500 mt-1">
                                No suppliers are set up yet. An admin adds them under
                                <strong>Suppliers</strong>.
                            </p>
                        }
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
                        <div>
                            <label class="block text-sm font-medium mb-1" for="grn-invoice">
                                Invoice number
                                <span class="text-surface-500 font-normal">- if there is one</span>
                            </label>
                            <input
                                id="grn-invoice"
                                pInputText
                                class="w-full"
                                placeholder="e.g. INV-10423"
                                [ngModel]="invoiceNo()"
                                (ngModelChange)="invoiceNo.set($event)" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium mb-1" for="grn-invoice-date">
                                Date on the invoice
                            </label>
                            <input
                                id="grn-invoice-date"
                                type="date"
                                class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                                [ngModel]="invoiceDate()"
                                (ngModelChange)="invoiceDate.set($event)" />
                        </div>
                    </div>

                    <p class="text-sm text-surface-500">
                        The invoice is what the price on the next step is checked against later.
                        Leave it blank if the paperwork is coming separately.
                    </p>
                </div>
            }

            <!-- ── 3. What came off the lorry? ─────────────────────────────── -->
            @if (!saved() && step() === 'lines') {
                <div class="space-y-4">
                    @if (po()) {
                        <div class="app-note">
                            These are what is still outstanding on the order. Change them to what
                            actually arrived - anything short stays on the order.
                        </div>
                    }

                    @for (line of lines(); track $index; let i = $index) {
                        <div
                            class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-4 md:p-5">
                            <div class="flex items-start justify-between gap-3 mb-3">
                                <span class="text-xs font-semibold text-surface-500">
                                    Item {{ i + 1 }} of {{ lines().length }}
                                </span>
                                @if (lines().length > 1) {
                                    <button
                                        pButton
                                        text
                                        size="small"
                                        severity="danger"
                                        icon="pi pi-trash"
                                        [attr.aria-label]="'Remove item ' + (i + 1)"
                                        (click)="removeLine(i)"></button>
                                }
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                                <div class="md:col-span-5">
                                    <app-item-picker
                                        label="What is it?"
                                        [required]="true"
                                        [items]="items()"
                                        [value]="line.itemId"
                                        (valueChange)="setItem(i, $event)" />
                                </div>

                                <div class="md:col-span-3">
                                    <label class="block text-sm font-medium mb-1 app-req">
                                        In what pack?
                                    </label>
                                    <select
                                        class="w-full px-3 py-2.5 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                                        [ngModel]="line.packId"
                                        (ngModelChange)="setPack(i, +$event)"
                                        [disabled]="!line.itemId">
                                        <option [ngValue]="null">Choose…</option>
                                        @for (p of packsFor(line.itemId); track p.id) {
                                            <option [ngValue]="p.id">{{ p.packName }}</option>
                                        }
                                    </select>
                                    @if (line.itemId && packsFor(line.itemId).length === 0) {
                                        <p class="text-xs text-surface-500 mt-1">
                                            This product has no pack set up, so it cannot be
                                            received. An admin adds one under Products.
                                        </p>
                                    }
                                </div>

                                <div class="md:col-span-2">
                                    <label class="block text-sm font-medium mb-1 app-req">
                                        How many packs?
                                    </label>
                                    <p-inputNumber
                                        styleClass="w-full"
                                        inputStyleClass="w-full"
                                        [ngModel]="line.qtyPacks"
                                        (ngModelChange)="setQty(i, $event)"
                                        [min]="0"
                                        [maxFractionDigits]="3"></p-inputNumber>
                                </div>

                                <div class="md:col-span-2">
                                    <label class="block text-sm font-medium mb-1 app-req">
                                        Price per pack
                                    </label>
                                    <p-inputNumber
                                        styleClass="w-full"
                                        inputStyleClass="w-full"
                                        [ngModel]="line.packPrice"
                                        (ngModelChange)="setPrice(i, $event)"
                                        [min]="0"
                                        [maxFractionDigits]="2"></p-inputNumber>
                                </div>
                            </div>

                            <!-- What the line means, in one sentence: the
                                 conversion the storekeeper must never type, and
                                 the money it comes to. -->
                            <div
                                class="mt-3 pt-3 border-t border-surface flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                                @if (conversionFor(line); as conv) {
                                    <span class="text-surface-500">
                                        That is <strong class="text-surface-700 dark:text-surface-200">{{ conv }}</strong>
                                        onto the shelf
                                    </span>
                                }
                                @if (lineTotal(line) > 0) {
                                    <span class="text-surface-500">
                                        Line comes to <strong class="text-surface-700 dark:text-surface-200">{{ money(lineTotal(line)) }}</strong>
                                    </span>
                                }
                            </div>

                            <!-- The price question, asked at the door. -->
                            @if (livePriceCheck(line); as check) {
                                <div
                                    class="mt-3"
                                    [class]="check.warn ? 'app-note app-note--warn' : 'app-note'">
                                    @if (check.warn) {
                                        <div class="app-note__title">
                                            That is {{ check.changePct > 0 ? 'up' : 'down' }}
                                            {{ abs(check.changePct) }}% on last time
                                        </div>
                                    }
                                    <p class="text-sm" [class.mt-1]="check.warn">
                                        Last from this supplier: {{ money(check.previousPrice) }} a
                                        pack{{ check.warn ? '. Record it anyway - the lorry has gone - and it will show on the price report.' : '.' }}
                                    </p>
                                </div>
                            }
                        </div>
                    }

                    <button
                        pButton
                        outlined
                        icon="pi pi-plus"
                        label="Something else came too"
                        (click)="addLine()"></button>
                </div>
            }

            <!-- ── 4. Check it and save ────────────────────────────────────── -->
            @if (!saved() && step() === 'check') {
                <div
                    class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                    <div class="px-5 py-4 border-b border-surface">
                        <div class="font-semibold">{{ supplierName() }}</div>
                        <div class="text-sm text-surface-500 mt-0.5">
                            @if (invoiceNo()) {
                                invoice {{ invoiceNo() }}
                            } @else {
                                no invoice number
                            }
                            @if (invoiceDate()) {
                                · dated {{ invoiceDate() }}
                            }
                            @if (po(); as order) {
                                · against {{ order.raisedBy }}'s order
                            }
                        </div>
                    </div>

                    <ul class="divide-y divide-surface">
                        @for (line of lines(); track $index) {
                            <li class="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                                <div class="min-w-0">
                                    <div class="font-medium">{{ nameOf(line.itemId) }}</div>
                                    <div class="text-xs text-surface-500 mt-0.5">
                                        {{ line.qtyPacks }} × {{ packNameOf(line) }}
                                        @if (conversionFor(line); as conv) {
                                            = {{ conv }}
                                        }
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div class="font-semibold">{{ money(lineTotal(line)) }}</div>
                                    <div class="text-xs text-surface-500">
                                        {{ money(line.packPrice ?? 0) }} a pack
                                    </div>
                                </div>
                            </li>
                        }
                    </ul>

                    <div
                        class="px-5 py-4 border-t border-surface flex items-center justify-between">
                        <span class="font-semibold">Total</span>
                        <span class="text-xl font-bold">{{ money(total()) }}</span>
                    </div>
                </div>

                @if (liveWarnings().length > 0) {
                    <div class="app-note app-note--warn">
                        <div class="app-note__title mb-2">Prices that have moved</div>
                        <ul class="text-sm space-y-1">
                            @for (w of liveWarnings(); track w.itemPackId) {
                                <li>
                                    {{ w.itemName }} ({{ w.packName }}):
                                    {{ money(w.previousPrice) }} → {{ money(w.newPrice) }}
                                    <strong>({{ w.changePct > 0 ? '+' : '' }}{{ w.changePct }}%)</strong>
                                </li>
                            }
                        </ul>
                        <p class="text-sm mt-2">
                            This does not stop the delivery. It is recorded and the price report
                            picks it up.
                        </p>
                    </div>
                }

                @if (warnings().length > 0) {
                    <div class="app-note app-note--ok">
                        <div class="app-note__title">Recorded</div>
                        <p class="text-sm mt-1">
                            The delivery is in and the stock is on the shelf. The price changes
                            above are on the record for the report.
                        </p>
                    </div>
                }
            }

            <!-- ── Moving between steps ────────────────────────────────────── -->
            @if (!saved()) {
            <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                    pButton
                    text
                    [label]="stepIndex() === 0 ? 'Cancel' : 'Back'"
                    [icon]="stepIndex() === 0 ? '' : 'pi pi-arrow-left'"
                    (click)="back()"></button>

                <div class="flex items-center gap-3">
                    @if (blocker(); as why) {
                        <span class="text-sm text-surface-500">{{ why }}</span>
                    }
                    @if (step() === 'check') {
                        <button
                            pButton
                            label="Save delivery"
                            icon="pi pi-check"
                            [disabled]="!canSubmit() || saving()"
                            [loading]="saving()"
                            (click)="submit()"></button>
                    } @else if (step() !== 'order') {
                        <button
                            pButton
                            label="Next"
                            icon="pi pi-arrow-right"
                            iconPos="right"
                            [disabled]="blocker() !== null"
                            (click)="next()"></button>
                    }
                </div>
            </div>
            }
        </div>
    `
})
export class GrnComponent implements OnInit {
    private auth = inject(AuthStore);
    private api = inject(GrandService);
    private notify = inject(NotifyService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    readonly steps: Step[] = [
        {
            key: 'order',
            label: 'Which order',
            hint: 'Pick the order this delivery is against, and it fills itself in.'
        },
        {
            key: 'supplier',
            label: 'Who delivered',
            hint: 'The supplier, and the invoice if one came with it.'
        },
        {
            key: 'lines',
            label: 'What came',
            hint: 'In packs, as they are written on the delivery note. Never in grams.'
        },
        {
            key: 'check',
            label: 'Check and save',
            hint: 'Read it back before it goes on the ledger. After this it can only be reversed.'
        }
    ];

    readonly stepIndex = signal(0);
    readonly step = computed(() => this.steps[this.stepIndex()]!.key);

    /** Set when this delivery is being received against a purchase order. */
    readonly po = signal<PurchaseOrder | null>(null);

    /**
     * Everything still out: awaiting approval, approved, or placed with a
     * supplier. Delivered and rejected orders are not on the list because
     * nothing can arrive against them.
     */
    readonly openOrders = signal<PurchaseOrder[]>([]);
    readonly loadingOrders = signal(false);

    readonly items = signal<Item[]>([]);
    readonly suppliers = signal<Supplier[]>([]);
    readonly lines = signal<Draft[]>([]);
    readonly supplierId = signal<number | null>(null);
    readonly invoiceNo = signal('');
    readonly invoiceDate = signal('');
    readonly saving = signal(false);
    readonly error = signal<string | null>(null);
    readonly warnings = signal<PriceWarning[]>([]);

    /**
     * The delivery that was just written, or null while one is being entered.
     *
     * Its presence is what puts the screen into its "done" state: the form and
     * the step header go away, because the document exists now and nothing on
     * it can be edited - only reversed.
     */
    readonly saved = signal<GrnResult | null>(null);

    /** What each line put on the shelf, and what is there now. */
    readonly savedLines = signal<
        {
            itemId: number;
            name: string;
            packName: string;
            qtyPacks: number;
            added: string;
            onShelf: string | null;
        }[]
    >([]);

    /** What this supplier charged last time, per pack. Empty until one is chosen. */
    private readonly lastPrices = signal<Map<number, LastPrice>>(new Map());

    /**
     * Minted once, per form. Not per submit - that would defeat the purpose.
     */
    private idempotencyKey = uuid();

    readonly total = computed(() =>
        this.lines().reduce((sum, l) => sum + this.lineTotal(l), 0)
    );

    readonly supplierLocked = computed(() => !!this.po()?.supplierId);

    readonly supplierName = computed(
        () => this.suppliers().find((s) => s.id === this.supplierId())?.name ?? 'Unknown supplier'
    );

    readonly completeLines = computed(() =>
        this.lines().filter(
            (l) => l.packId !== null && (l.qtyPacks ?? 0) > 0 && (l.packPrice ?? 0) >= 0
        )
    );

    readonly canSubmit = computed(
        () =>
            this.supplierId() !== null &&
            this.lines().length > 0 &&
            this.completeLines().length === this.lines().length
    );

    /**
     * Why Next is not available, in the words of the thing that is missing.
     *
     * A disabled button with no explanation is the commonest way a form wastes
     * somebody's afternoon: they can see it is not working and cannot see why.
     */
    readonly blocker = computed<string | null>(() => {
        switch (this.step()) {
            case 'supplier':
                return this.supplierId() === null ? 'Choose who delivered it' : null;
            case 'lines': {
                if (this.lines().length === 0) return 'Add what arrived';
                // Name the one thing that is missing, not the whole list of
                // things a line needs. An order pre-fills three of the four and
                // leaves the price blank, so "needs a product, a pack, a
                // quantity and a price" reads as though nothing had been done.
                for (const [i, line] of this.lines().entries()) {
                    const missing =
                        line.itemId === null
                            ? 'a product'
                            : line.packId === null
                              ? 'a pack'
                              : (line.qtyPacks ?? 0) <= 0
                                ? 'how many packs came'
                                : line.packPrice === null
                                  ? 'the price per pack'
                                  : null;
                    if (missing) return `Item ${i + 1} still needs ${missing}`;
                }
                return null;
            }
            case 'check':
                return this.canSubmit() ? null : 'Something above is incomplete';
            default:
                return null;
        }
    });

    /**
     * The price warnings this delivery would raise, worked out here rather than
     * waited for.
     *
     * The server's list, returned on save, stays the authority - it reads the
     * same table and it is what the price report will show. This is the same
     * arithmetic run early so the question gets asked while the driver is still
     * in the yard.
     */
    readonly liveWarnings = computed<PriceWarning[]>(() => {
        const out: PriceWarning[] = [];
        for (const line of this.lines()) {
            const check = this.livePriceCheck(line);
            if (!check?.warn) continue;
            const item = this.items().find((i) => i.id === line.itemId);
            const pack = item?.packs.find((p) => p.id === line.packId);
            out.push({
                itemPackId: line.packId!,
                itemName: item?.name ?? 'Item',
                packName: pack?.packName ?? 'pack',
                previousPrice: check.previousPrice,
                newPrice: line.packPrice!,
                changePct: check.changePct
            });
        }
        return out;
    });

    async ngOnInit(): Promise<void> {
        try {
            const [items, suppliers] = await Promise.all([
                this.api.listItems(),
                this.api.listSuppliers()
            ]);
            this.items.set(items);
            this.suppliers.set(suppliers);

            const poId = this.route.snapshot.queryParamMap.get('po');
            if (poId) {
                // Purchases has already answered question one.
                await this.loadPurchaseOrder(poId);
            } else {
                this.stepIndex.set(0);
                void this.loadOpenOrders();
            }
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        }
    }

    /** The orders that could plausibly be what is standing at the door. */
    private async loadOpenOrders(): Promise<void> {
        this.loadingOrders.set(true);
        try {
            const page = await this.api.listPurchaseOrders({ open: true, limit: 100 });
            this.openOrders.set(page.items);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loadingOrders.set(false);
        }
    }

    /**
     * Can a delivery be booked against this order?
     *
     * The same two statuses the server accepts. `requested` means management
     * has not approved it, and `applyReceiptToPo` refuses those outright --
     * so the row is shown, greyed, and does nothing when pressed.
     */
    receivable(order: PurchaseOrder): boolean {
        return order.status === 'approved' || order.status === 'ordered';
    }

    /** Pick an order: fill the form from it and move on. */
    choose(order: PurchaseOrder): void {
        if (!this.receivable(order)) return;
        this.error.set(null);
        this.applyOrder(order);
        this.stepIndex.set(1);
    }

    /** No order behind this delivery. Blank form, nothing pre-filled. */
    enterManually(): void {
        this.po.set(null);
        this.supplierId.set(null);
        if (this.lines().length === 0) this.addLine();
        this.stepIndex.set(1);
    }

    next(): void {
        if (this.blocker() !== null) return;
        if (this.step() === 'supplier' && this.lines().length === 0) this.addLine();
        this.stepIndex.update((i) => Math.min(i + 1, this.steps.length - 1));
    }

    back(): void {
        if (this.stepIndex() === 0) {
            void this.router.navigate(['/home']);
            return;
        }
        this.goBackTo(this.stepIndex() - 1);
    }

    /**
     * Going back to question one throws the order away with it.
     *
     * Half of one order and half of another is the one delivery this form must
     * never be able to produce.
     */
    goBackTo(index: number): void {
        this.error.set(null);
        this.warnings.set([]);
        if (index === 0) {
            this.po.set(null);
            this.supplierId.set(null);
            this.lastPrices.set(new Map());
            this.lines.set([]);
            // A different document deserves a different key.
            this.idempotencyKey = uuid();
            void this.loadOpenOrders();
        }
        this.stepIndex.set(index);
    }

    /** "3 items · 12 × 25 kg sack outstanding" - enough to recognise it by. */
    orderSummary(order: PurchaseOrder): string {
        const outstanding = order.lines.filter((l) => l.qtyOutstandingBase > 0);
        const shown = outstanding
            .slice(0, 3)
            .map((l) => `${l.name} ${this.qty(l.qtyOutstandingBase, l.stockUnit)}`);
        const rest = outstanding.length - shown.length;
        if (rest > 0) shown.push(`and ${rest} more`);
        return shown.join(' · ') || `${order.lines.length} item(s)`;
    }

    day(iso: string): string {
        return new Date(iso).toLocaleDateString('en-LK', {
            day: 'numeric',
            month: 'short'
        });
    }

    qty(n: number, unit: string): string {
        return formatQty(n, unit);
    }

    /**
     * Pre-fills from the order's outstanding balance.
     *
     * Only the outstanding part: on a second delivery against the same order,
     * offering the full original quantity again is how an order for ten sacks
     * ends up receiving sixteen.
     */
    private async loadPurchaseOrder(poId: string): Promise<void> {
        const page = await this.api.listPurchaseOrders({ limit: 200 });
        const order = page.items.find((p) => p.id === poId) ?? null;

        if (!order) {
            // Not a dead end: fall back to question one so the storekeeper can
            // find the right order rather than re-reading a stale link.
            this.error.set('That purchase order is not on this branch. Pick it from the list.');
            this.stepIndex.set(0);
            await this.loadOpenOrders();
            return;
        }

        this.applyOrder(order);
        this.stepIndex.set(1);
    }

    /** Order in, form filled. Shared by `?po=` and by picking from the list. */
    private applyOrder(order: PurchaseOrder): void {
        this.po.set(order);
        if (order.supplierId) this.setSupplier(order.supplierId);

        const drafts: Draft[] = [];
        for (const line of order.lines) {
            if (line.qtyOutstandingBase <= 0) continue;

            const item = this.items().find((i) => i.id === line.itemId);
            const pack =
                item?.packs.find((p) => p.id === line.itemPackId) ??
                item?.packs.find((p) => p.isDefaultPurchase) ??
                item?.packs[0];
            if (!item || !pack) continue;

            drafts.push({
                itemId: item.id,
                packId: pack.id,
                qtyPacks: round3(line.qtyOutstandingBase / pack.qtyInStockUnit),
                packPrice: line.estPrice
            });
        }

        this.lines.set(drafts);
        if (drafts.length === 0) this.addLine();
    }

    /** Choosing the supplier is what makes last time's prices knowable. */
    setSupplier(supplierId: number | null): void {
        this.supplierId.set(supplierId);
        this.lastPrices.set(new Map());
        if (supplierId === null) return;
        void this.api
            .lastPrices(supplierId)
            .then((rows) => this.lastPrices.set(new Map(rows.map((r) => [r.itemPackId, r]))))
            // A missing price history is not an error worth stopping a
            // delivery for; it just means nothing is known to compare against.
            .catch(() => this.lastPrices.set(new Map()));
    }

    addLine(): void {
        this.lines.update((ls) => [
            ...ls,
            { itemId: null, packId: null, qtyPacks: null, packPrice: null }
        ]);
    }

    removeLine(index: number): void {
        this.lines.update((ls) => ls.filter((_, i) => i !== index));
    }

    private patch(index: number, patch: Partial<Draft>): void {
        this.lines.update((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    }

    setItem(index: number, itemId: number | null): void {
        const item = this.items().find((i) => i.id === itemId);
        const defaultPack = item?.packs.find((p) => p.isDefaultPurchase) ?? item?.packs[0];
        this.patch(index, { itemId, packId: defaultPack?.id ?? null });
    }

    setPack(index: number, packId: number): void {
        this.patch(index, { packId });
    }

    setQty(index: number, qtyPacks: number | null): void {
        this.patch(index, { qtyPacks });
    }

    setPrice(index: number, packPrice: number | null): void {
        this.patch(index, { packPrice });
    }

    packsFor(itemId: number | null): ItemPack[] {
        if (itemId === null) return [];
        return this.items().find((i) => i.id === itemId)?.packs ?? [];
    }

    /**
     * What this pack cost last time, and whether the change is worth a word.
     *
     * Null when there is nothing to compare against - a first delivery of
     * something is not a price change, and saying "no previous price" under
     * every line of a new supplier's first invoice is noise.
     */
    livePriceCheck(
        line: Draft
    ): { previousPrice: number; changePct: number; warn: boolean } | null {
        if (line.packId === null || line.packPrice === null || line.packPrice <= 0) return null;
        const previous = this.lastPrices().get(line.packId);
        if (!previous || previous.price <= 0) return null;

        const changePct =
            Math.round(((line.packPrice - previous.price) / previous.price) * 1000) / 10;
        return {
            previousPrice: previous.price,
            changePct,
            warn: Math.abs(changePct) >= PRICE_WARN_PCT
        };
    }

    abs(n: number): number {
        return Math.abs(n);
    }

    nameOf(itemId: number | null): string {
        return this.items().find((i) => i.id === itemId)?.name ?? 'Item';
    }

    packNameOf(line: Draft): string {
        return this.packsFor(line.itemId).find((p) => p.id === line.packId)?.packName ?? 'pack';
    }

    /** "= 40 L" - the conversion made visible so a wrong pack is obvious. */
    conversionFor(line: Draft): string | null {
        if (line.itemId === null || line.packId === null || !line.qtyPacks) return null;
        const item = this.items().find((i) => i.id === line.itemId);
        const pack = item?.packs.find((p) => p.id === line.packId);
        if (!item || !pack) return null;
        return formatQty(line.qtyPacks * pack.qtyInStockUnit, item.stockUnit);
    }

    lineTotal(line: Draft): number {
        return (line.qtyPacks ?? 0) * (line.packPrice ?? 0);
    }

    money(n: number): string {
        return formatMoney(n);
    }

    async submit(): Promise<void> {
        if (!this.canSubmit()) return;

        this.saving.set(true);
        this.error.set(null);
        try {
            const result = await this.api.createGrn(
                {
                    supplierId: this.supplierId()!,
                    poId: this.po()?.id ?? null,
                    invoiceNo: this.invoiceNo() || null,
                    invoiceDate: this.invoiceDate() || null,
                    lines: this.lines().map((l) => ({
                        itemPackId: l.packId!,
                        qtyPacks: l.qtyPacks!,
                        packPrice: l.packPrice!
                    }))
                },
                this.idempotencyKey
            );

            this.warnings.set(result.priceWarnings);

            if (result.priceWarnings.length > 0) {
                // Recorded, not blocked. The delivery is already in the store;
                // refusing it would only mean the stock figure is wrong instead.
                // The storekeeper saw this coming on the previous step, so this
                // is a confirmation rather than news.
                this.notify.warning(
                    `Delivery recorded. ${result.priceWarnings.length} price change(s) went on the record.`
                );
            } else {
                this.notify.success(`Delivery recorded. ${this.money(result.total)}`);
            }

            await this.describeSaved(result);
        } catch (err) {
            // Nothing was written -- the document and its ledger rows go in one
            // transaction. The form is left alone so it can be corrected and
            // sent again, and the idempotency key is deliberately NOT renewed:
            // if this was a lost response rather than a real refusal, the retry
            // replays the first result instead of receiving the goods twice.
            this.error.set(apiErrorMessage(err));
        } finally {
            this.saving.set(false);
        }
    }

    /**
     * Read the delivery back, including what is on the shelf now.
     *
     * The shelf figure is the one that answers "did that actually go in", and
     * it is read from the ledger rather than calculated here - if the two ever
     * disagreed, the ledger would be right and this screen would be lying.
     */
    private async describeSaved(result: GrnResult): Promise<void> {
        const lines = this.lines().map((l) => {
            const item = this.items().find((i) => i.id === l.itemId);
            const pack = item?.packs.find((p) => p.id === l.packId);
            return {
                itemId: l.itemId!,
                name: item?.name ?? 'Item',
                packName: pack?.packName ?? 'pack',
                qtyPacks: l.qtyPacks ?? 0,
                added:
                    item && pack
                        ? formatQty((l.qtyPacks ?? 0) * pack.qtyInStockUnit, item.stockUnit)
                        : '',
                onShelf: null as string | null
            };
        });
        this.savedLines.set(lines);
        this.saved.set(result);

        const store = this.auth.storeSection();
        if (!store) return;
        try {
            const stock = await this.api.getStock({ sectionId: store.id, limit: 200 });
            this.savedLines.set(
                lines.map((l) => {
                    const row = stock.items.find((r) => r.itemId === l.itemId);
                    return {
                        ...l,
                        onShelf: row ? formatQty(row.qtyBase, row.stockUnit) : null
                    };
                })
            );
        } catch {
            /* the delivery is recorded either way; the shelf figure is a bonus */
        }
    }

    /** A second lorry. A new document, so a new key and a clean form. */
    startAnother(): void {
        this.saved.set(null);
        this.savedLines.set([]);
        this.warnings.set([]);
        this.error.set(null);
        this.po.set(null);
        this.supplierId.set(null);
        this.lastPrices.set(new Map());
        this.invoiceNo.set('');
        this.invoiceDate.set('');
        this.lines.set([]);
        this.idempotencyKey = uuid();
        this.stepIndex.set(0);
        void this.loadOpenOrders();
    }
}

/** Packs can be fractional -- half a sack gets delivered -- but not endlessly. */
function round3(n: number): number {
    return Math.round(n * 1000) / 1000;
}
