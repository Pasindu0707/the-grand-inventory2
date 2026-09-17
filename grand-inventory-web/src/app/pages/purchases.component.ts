/**
 * Purchases - the whole cycle, not just the decision.
 *
 * What was here showed a list and two buttons. Everything it could show had to
 * have come from somebody asking the store for something it did not have, so
 * the storekeeper - the one person who watches the shelf empty - could not
 * order anything until a cook had already gone short. And an order, once
 * approved, simply vanished: no supplier, no record of whether the goods ever
 * arrived.
 *
 * Now it has the three things a purchase actually needs:
 *
 *   Raise      the storekeeper and management, in packs, with what to order
 *              suggested from the reorder points nobody could act on before.
 *              This screen is theirs alone. A section asks for stock; the
 *              storekeeper - who can see the shelf - raises the purchase for
 *              whatever the store cannot cover, arriving here from that short
 *              release with those very items already on the order.
 *   Decide     management only, because this is the action that spends money.
 *   Receive    the delivery is a GRN against the order, so a part delivery
 *              leaves the order open on the balance rather than closing it
 *              and losing the four sacks that never came.
 */
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { DrawerModule } from 'primeng/drawer';
import { AuthStore } from '@/core/auth.store';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import { formatMoney, formatQty } from '@/core/format';
import {
    DEFAULT_PAGE_SIZE,
    emptyPage,
    type Item,
    type MyContext,
    type Page,
    type PageRequest,
    type PoDecision,
    type PurchaseOrder,
    type PurchaseOrderLine,
    type SuggestedOrderLine,
    type Supplier
} from '@/core/types';
import { AppPaginator, type PageChange } from '@/shared/paginator.component';
import { AppFilterBar, type FilterOption } from '@/shared/filter-bar.component';
import { AppItemPicker } from '@/shared/item-picker.component';
import { AppSteps, type Step } from '@/shared/steps.component';

interface DraftLine {
    itemId: number;
    itemPackId: number;
    name: string;
    stockUnit: string;
    packName: string;
    qtyInStockUnit: number;
    qtyPacks: number;
    estPrice: number | null;
}

@Component({
    selector: 'app-purchases',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        InputTextModule,
        TagModule,
        DrawerModule,
        AppPaginator,
        AppFilterBar,
        AppItemPicker,
        AppSteps
    ],
    template: `
        <div class="space-y-8">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold">Purchases</h1>
                    <p class="text-surface-500 text-sm">
                        {{
                            canDecide()
                                ? 'Things to be bought, and what has arrived'
                                : mine()
                                  ? 'What you asked to be bought'
                                  : 'What this branch asked to be bought'
                        }}
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    @if (canSuggest()) {
                        <button
                            pButton
                            outlined
                            icon="pi pi-list"
                            label="What to order"
                            (click)="openSuggested()"></button>
                    }
                    <button
                        pButton
                        icon="pi pi-plus"
                        label="Raise a purchase"
                        (click)="openRaise()"></button>
                </div>
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
                <!-- Only offered to people who raise purchases rather than
                     decide them. Management's job is the whole branch, so a
                     "mine" filter would only ever hide work from them. -->
                @if (!canDecide()) {
                    <app-filter-bar
                        label="Whose purchases"
                        [options]="ownerOptions"
                        [value]="mine()"
                        (valueChange)="setMine($event)" />
                }
                <app-filter-bar
                    label="Filter purchases"
                    [options]="filterOptions"
                    [value]="filter()"
                    (valueChange)="setFilter($event)" />
            </div>

            @if (visible().length === 0) {
                <div
                    class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-10 text-center text-surface-500">
                    {{ loading() ? 'Loading…' : 'Nothing to buy.' }}
                </div>
            } @else {
                @for (po of visible(); track po.id) {
                    <div
                        class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                        <div
                            class="px-5 py-4 border-b border-surface flex flex-wrap items-center justify-between gap-3">
                            <div class="min-w-0">
                                <div class="font-semibold">
                                    Asked by {{ po.raisedBy }}
                                    @if (po.neededBy) {
                                        <span class="text-surface-500 font-normal">
                                            · needed by {{ po.neededBy }}
                                        </span>
                                    }
                                </div>
                                @if (po.reason) {
                                    <div class="text-sm text-surface-500 italic">
                                        “{{ po.reason }}”
                                    </div>
                                }
                                <div class="text-xs text-surface-500 mt-1">
                                    @if (po.supplierName) {
                                        From {{ po.supplierName }}
                                    } @else {
                                        No supplier chosen yet
                                    }
                                    @if (po.estimatedTotal !== null) {
                                        · about {{ money(po.estimatedTotal) }}
                                    }
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                @if (po.partReceived) {
                                    <p-tag severity="warn" value="Part delivered"></p-tag>
                                }
                                <p-tag [severity]="tone(po.status)" [value]="label(po.status)"></p-tag>
                            </div>
                        </div>

                        <ul class="divide-y divide-surface">
                            @for (line of po.lines; track line.itemId) {
                                <li class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                                    <div class="min-w-0">
                                        <div class="font-medium">{{ line.name }}</div>
                                        <div class="text-xs text-surface-500">
                                            store had {{ q(line.qtyInStore, line.stockUnit) }}
                                            @if (line.estPrice !== null) {
                                                · {{ money(line.estPrice) }} a pack
                                            }
                                        </div>
                                    </div>
                                    <div class="text-right text-sm">
                                        <div class="font-semibold">{{ ordered(line) }}</div>
                                        <div
                                            class="text-xs"
                                            [class.text-surface-500]="line.qtyOutstandingBase === 0"
                                            [class.text-orange-600]="line.qtyOutstandingBase > 0 && line.qtyReceivedBase > 0">
                                            @if (line.qtyReceivedBase === 0) {
                                                {{ q(line.qtyBase, line.stockUnit) }} · nothing in yet
                                            } @else if (line.qtyOutstandingBase > 0) {
                                                {{ q(line.qtyReceivedBase, line.stockUnit) }} in ·
                                                {{ q(line.qtyOutstandingBase, line.stockUnit) }} still to
                                                come
                                            } @else {
                                                all delivered
                                            }
                                        </div>
                                    </div>
                                </li>
                            }
                        </ul>

                        @if (po.decidedBy) {
                            <div
                                class="px-4 py-3 bg-surface-50 dark:bg-surface-800 text-sm text-surface-600 dark:text-surface-300">
                                {{ label(po.status) }} by {{ po.decidedBy }}
                                @if (po.decisionNote) {
                                    - “{{ po.decisionNote }}”
                                }
                            </div>
                        }

                        <div class="p-4 flex flex-wrap justify-end gap-2 border-t border-surface">
                            @if (canDecide() && po.status === 'requested') {
                                <button
                                    pButton
                                    outlined
                                    severity="danger"
                                    label="Not now"
                                    [disabled]="busy()"
                                    (click)="decide(po, 'rejected')"></button>
                                <button
                                    pButton
                                    label="Approve"
                                    icon="pi pi-check"
                                    [disabled]="busy()"
                                    (click)="decide(po, 'approved')"></button>
                            } @else if (canDecide() && po.status === 'approved') {
                                <button
                                    pButton
                                    outlined
                                    label="Close it short"
                                    [disabled]="busy()"
                                    (click)="closeShort(po)"></button>
                                <button
                                    pButton
                                    label="Mark as ordered"
                                    icon="pi pi-send"
                                    [disabled]="busy()"
                                    (click)="markOrdered(po)"></button>
                            } @else if (po.status === 'ordered') {
                                @if (canDecide()) {
                                    <button
                                        pButton
                                        outlined
                                        label="Close it short"
                                        [disabled]="busy()"
                                        (click)="closeShort(po)"></button>
                                }
                                @if (canReceive()) {
                                    <button
                                        pButton
                                        icon="pi pi-truck"
                                        label="Receive this delivery"
                                        (click)="receive(po)"></button>
                                }
                            }
                        </div>
                    </div>
                }
            }

            <app-paginator [page]="pageInfo()" (pageChange)="onPageChange($event)" />
        </div>

        <!-- Raise a purchase ----------------------------------------------
             Three questions, in the order somebody asks them: what do we need,
             how much of it, and why now. It used to be one column with the
             suggestions, a search box, a line table, two dates and a reason all
             live at once, and the two fields that decide whether management
             says yes -- the reason and the date -- were at the very bottom
             where they read as optional extras. -->
        <p-drawer
            [visible]="raising()"
            (visibleChange)="onRaiseVisible($event)"
            position="right"
            header="Raise a purchase"
            styleClass="!w-full sm:!w-[42rem]">
            <div class="space-y-5">
                <app-steps
                    [steps]="raiseSteps"
                    [index]="raiseStep()"
                    label="Raising a purchase"
                    (indexChange)="raiseStep.set($event)" />

                @if (formError()) {
                    <div class="app-note app-note--error">{{ formError() }}</div>
                }

                <!-- ── 1. What needs buying ──────────────────────────────── -->
                @if (raiseStep() === 0) {
                    @if (canSuggest()) {
                        <div class="rounded-xl border border-surface overflow-hidden">
                            <button
                                type="button"
                                class="w-full px-4 py-3 flex items-center justify-between text-left"
                                (click)="toggleSuggestions()">
                                <span>
                                    <span class="font-medium text-sm">What the shelf says</span>
                                    <span class="block text-xs text-surface-500">
                                        @if (suggested().length === 0 && suggestionsLoaded()) {
                                            Nothing is below its reorder point
                                        } @else if (suggested().length > 0) {
                                            {{ suggested().length }} below their reorder point
                                        } @else {
                                            From the store's own reorder points
                                        }
                                    </span>
                                </span>
                                <i
                                    class="pi"
                                    [class.pi-chevron-down]="!showSuggestions()"
                                    [class.pi-chevron-up]="showSuggestions()"
                                    aria-hidden="true"></i>
                            </button>

                            @if (showSuggestions()) {
                                <div class="border-t border-surface">
                                    @if (suggested().length === 0) {
                                        <p class="px-4 py-4 text-sm text-surface-500">
                                            {{
                                                suggestionsLoaded()
                                                    ? 'Nothing is below its reorder point. The store is in good shape.'
                                                    : 'Loading…'
                                            }}
                                        </p>
                                    } @else {
                                        <ul class="max-h-72 overflow-auto divide-y divide-surface">
                                            @for (row of suggested(); track row.itemId) {
                                                <li
                                                    class="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                                                    <div class="min-w-0">
                                                        <div class="text-sm font-medium">
                                                            {{ row.name }}
                                                        </div>
                                                        <div class="text-xs text-surface-500">
                                                            {{ q(row.inStore, row.stockUnit) }} left
                                                            · reorder at
                                                            {{ q(row.reorderPoint, row.stockUnit) }}
                                                            @if (row.lastPrice !== null) {
                                                                · last
                                                                {{ money(row.lastPrice) }} a pack
                                                            }
                                                        </div>
                                                    </div>
                                                    @if (!row.itemPackId) {
                                                        <span class="text-xs text-surface-500">
                                                            No pack set up
                                                        </span>
                                                    } @else if (onOrder(row)) {
                                                        <span
                                                            class="text-xs text-primary font-medium">
                                                            <i
                                                                class="pi pi-check"
                                                                aria-hidden="true"></i>
                                                            added
                                                        </span>
                                                    } @else {
                                                        <button
                                                            pButton
                                                            size="small"
                                                            outlined
                                                            [label]="
                                                                'Add ' +
                                                                row.suggestedPacks +
                                                                ' × ' +
                                                                row.packName
                                                            "
                                                            (click)="addSuggested(row)"></button>
                                                    }
                                                </li>
                                            }
                                        </ul>
                                        <div class="px-4 py-3 border-t border-surface">
                                            <button
                                                pButton
                                                class="w-full"
                                                size="small"
                                                outlined
                                                label="Add everything below its reorder point"
                                                (click)="addAllSuggested()"></button>
                                        </div>
                                    }
                                </div>
                            }
                        </div>
                    }

                    <!-- Anything else, by name. The same picker as every other
                         screen that names a product. -->
                    <app-item-picker
                        label="Anything else?"
                        placeholder="Type a product name or code"
                        [items]="items()"
                        [priority]="suggestedIds()"
                        priorityLabel="Below its reorder point"
                        [value]="null"
                        (valueChange)="addById($event)" />

                    @if (draft().length === 0) {
                        <p class="text-sm text-surface-500">Nothing on this order yet.</p>
                    } @else {
                        <div class="rounded-xl border border-surface overflow-hidden">
                            <div
                                class="px-4 py-2 border-b border-surface text-xs font-semibold text-surface-500">
                                On this order
                            </div>
                            <ul class="divide-y divide-surface">
                                @for (line of draft(); track line.itemPackId) {
                                    <li
                                        class="px-4 py-2.5 flex items-center justify-between gap-3">
                                        <span class="text-sm min-w-0">
                                            {{ line.name }}
                                            <span class="text-xs text-surface-500">
                                                · {{ line.packName }}
                                            </span>
                                        </span>
                                        <button
                                            pButton
                                            size="small"
                                            text
                                            severity="danger"
                                            icon="pi pi-times"
                                            [attr.aria-label]="'Take ' + line.name + ' off'"
                                            (click)="removeDraft(line.itemPackId)"></button>
                                    </li>
                                }
                            </ul>
                        </div>
                    }
                }

                <!-- ── 2. How much, and roughly what it costs ────────────── -->
                @if (raiseStep() === 1) {
                    <ul class="divide-y divide-surface border-y border-surface">
                        @for (line of draft(); track line.itemPackId) {
                            <li class="py-3 space-y-2">
                                <div class="text-sm font-medium">{{ line.name }}</div>
                                <div class="flex flex-wrap items-end gap-3">
                                    <div>
                                        <label class="block text-xs text-surface-500 mb-1">
                                            How many {{ line.packName }}?
                                        </label>
                                        <input
                                            pInputText
                                            class="w-24 text-right"
                                            inputmode="decimal"
                                            [ngModel]="line.qtyPacks"
                                            (ngModelChange)="setPacks(line.itemPackId, $event)" />
                                    </div>
                                    <div>
                                        <label class="block text-xs text-surface-500 mb-1">
                                            Price a pack, near enough
                                        </label>
                                        <input
                                            pInputText
                                            class="w-28 text-right"
                                            inputmode="decimal"
                                            placeholder="-"
                                            [ngModel]="line.estPrice"
                                            (ngModelChange)="setPrice(line.itemPackId, $event)" />
                                    </div>
                                    <div class="text-sm text-surface-500 pb-2">
                                        = {{ q(line.qtyPacks * line.qtyInStockUnit, line.stockUnit) }}
                                        @if (line.estPrice) {
                                            · {{ money(line.qtyPacks * line.estPrice) }}
                                        }
                                    </div>
                                </div>
                            </li>
                        }
                    </ul>

                    <div class="flex items-center justify-between text-sm">
                        <span class="text-surface-500">
                            Estimated - management sees this figure
                        </span>
                        <span class="font-bold">{{ money(draftTotal()) }}</span>
                    </div>

                    <p class="text-xs text-surface-500">
                        A price you are unsure of is still worth putting in. It is what management
                        weighs the order against, and the delivery records what was really
                        charged.
                    </p>
                }

                <!-- ── 3. Why, and by when ──────────────────────────────── -->
                @if (raiseStep() === 2) {
                    <div>
                        <label class="block text-sm font-medium mb-1 app-req" for="po-reason">
                            Why does this need buying?
                        </label>
                        <input
                            id="po-reason"
                            pInputText
                            class="w-full"
                            placeholder="e.g. down to two sacks, Saturday is busy"
                            [ngModel]="reason()"
                            (ngModelChange)="reason.set($event)" />
                        <p class="text-xs text-surface-500 mt-1">
                            Management decides on this sentence, so it is worth writing.
                        </p>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-sm font-medium mb-1" for="po-needed">
                                When do you need it?
                            </label>
                            <input
                                id="po-needed"
                                pInputText
                                class="w-full"
                                type="date"
                                [ngModel]="neededBy()"
                                (ngModelChange)="neededBy.set($event)" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium mb-1" for="po-supplier">
                                Who from?
                                <span class="text-surface-500 font-normal">- if you know</span>
                            </label>
                            <select
                                id="po-supplier"
                                class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                                [ngModel]="supplierId()"
                                (ngModelChange)="supplierId.set(+$event)">
                                <option [ngValue]="0">Not decided yet</option>
                                @for (s of suppliers(); track s.id) {
                                    <option [ngValue]="s.id">{{ s.name }}</option>
                                }
                            </select>
                        </div>
                    </div>

                    <div class="rounded-xl border border-surface overflow-hidden">
                        <div
                            class="px-4 py-2 border-b border-surface text-xs font-semibold text-surface-500">
                            Going to management
                        </div>
                        <ul class="divide-y divide-surface">
                            @for (line of draft(); track line.itemPackId) {
                                <li
                                    class="px-4 py-2 flex items-center justify-between gap-3 text-sm">
                                    <span class="min-w-0">
                                        {{ line.name }}
                                        <span class="text-xs text-surface-500">
                                            · {{ line.qtyPacks }} × {{ line.packName }}
                                        </span>
                                    </span>
                                    <span class="text-surface-500">
                                        {{ line.estPrice ? money(line.qtyPacks * line.estPrice) : '-' }}
                                    </span>
                                </li>
                            }
                        </ul>
                        <div
                            class="px-4 py-2 border-t border-surface flex items-center justify-between">
                            <span class="text-sm text-surface-500">Estimated</span>
                            <span class="font-bold">{{ money(draftTotal()) }}</span>
                        </div>
                    </div>
                }

                <!-- ── Moving between steps ─────────────────────────────── -->
                <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <button
                        pButton
                        text
                        [label]="raiseStep() === 0 ? 'Cancel' : 'Back'"
                        [icon]="raiseStep() === 0 ? '' : 'pi pi-arrow-left'"
                        (click)="raiseBack()"></button>

                    <div class="flex items-center gap-3">
                        @if (raiseBlocker(); as why) {
                            <span class="text-sm text-surface-500">{{ why }}</span>
                        }
                        @if (raiseStep() === 2) {
                            <button
                                pButton
                                icon="pi pi-check"
                                label="Send to management"
                                [disabled]="raiseBlocker() !== null || busy()"
                                [loading]="busy()"
                                (click)="submitRaise()"></button>
                        } @else {
                            <button
                                pButton
                                label="Next"
                                icon="pi pi-arrow-right"
                                iconPos="right"
                                [disabled]="raiseBlocker() !== null"
                                (click)="raiseNext()"></button>
                        }
                    </div>
                </div>
            </div>
        </p-drawer>
    `
})
export class PurchasesComponent implements OnInit {
    readonly auth = inject(AuthStore);
    private api = inject(GrandService);
    private notify = inject(NotifyService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    readonly orders = signal<PurchaseOrder[]>([]);
    readonly pageInfo = signal<Page<PurchaseOrder>>(emptyPage<PurchaseOrder>());
    readonly pageReq = signal<PageRequest>({ page: 1, limit: DEFAULT_PAGE_SIZE });
    readonly ctx = signal<MyContext | null>(null);
    readonly loading = signal(true);
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);
    readonly formError = signal<string | null>(null);
    readonly filter = signal<string>('requested');

    /** Section logins start on their own; management sees the branch. */
    readonly mine = signal(true);

    readonly raising = signal(false);

    /** Which of the three questions is on screen. */
    readonly raiseStep = signal(0);

    readonly raiseSteps: Step[] = [
        {
            key: 'what',
            label: 'What',
            hint: 'Start from what the shelf says, then add anything else by name.'
        },
        {
            key: 'howmuch',
            label: 'How much',
            hint: 'In packs, and roughly what a pack costs. An estimate is fine.'
        },
        {
            key: 'why',
            label: 'Why',
            hint: 'Management reads this and decides. It is the part that matters.'
        }
    ];
    /** Set when this order was opened from a request the store fell short on. */
    private readonly fromIssue = signal<string | null>(null);
    readonly showSuggestions = signal(false);
    readonly suggestionsLoaded = signal(false);
    readonly items = signal<Item[]>([]);
    readonly suppliers = signal<Supplier[]>([]);
    readonly suggested = signal<SuggestedOrderLine[]>([]);
    readonly draft = signal<DraftLine[]>([]);
    readonly neededBy = signal('');
    readonly reason = signal('');
    readonly supplierId = signal(0);

    readonly ownerOptions: FilterOption<boolean>[] = [
        { value: true, label: 'Mine' },
        { value: false, label: "Everyone's" }
    ];

    readonly filterOptions: FilterOption<string>[] = [
        { value: 'requested', label: 'Waiting' },
        { value: 'approved', label: 'Approved' },
        { value: 'ordered', label: 'On order' },
        { value: '', label: 'All' }
    ];

    readonly canDecide = computed(() => this.ctx()?.canDecidePurchases ?? false);

    /**
     * The storekeeper and management: the people who watch the store's shelf,
     * and the only two the route lets in here at all. Kept as a check rather
     * than assumed, because the suggestions call and the raise call are both
     * refused by the server for anybody else.
     */
    readonly canRaise = computed(() => {
        const role = this.auth.role();
        return role === 'management' || role === 'storekeeper';
    });

    readonly canSuggest = computed(() => this.canRaise());

    readonly canReceive = computed(() => this.canRaise());

    /** Filtered by the server, so the pager under the list counts the same set. */
    readonly visible = computed(() => this.orders());

    /** Ids below their reorder point, so the picker floats them to the top. */
    readonly suggestedIds = computed(() => this.suggested().map((r) => r.itemId));

    /**
     * Why the next button is not available, in the words of what is missing.
     *
     * The reason is required here though the API allows it to be null: a
     * purchase with no reason gives management nothing to decide on, and they
     * are the only ones who can approve it.
     */
    readonly raiseBlocker = computed<string | null>(() => {
        if (this.draft().length === 0) return 'Add something to the order';
        if (this.raiseStep() === 1) {
            const bad = this.draft().find((l) => !(l.qtyPacks > 0));
            if (bad) return `How many ${bad.packName} of ${bad.name}?`;
        }
        if (this.raiseStep() === 2 && this.reason().trim().length === 0) {
            return 'Say why it needs buying';
        }
        return null;
    });

    readonly draftTotal = computed(() =>
        this.draft().reduce((sum, l) => sum + (l.estPrice ?? 0) * l.qtyPacks, 0)
    );

    async ngOnInit(): Promise<void> {
        try {
            this.ctx.set(await this.api.myContext());
        } catch {
            /* the list still renders */
        }
        if (this.canDecide()) this.mine.set(false);
        await this.load();
        // Land on something rather than an empty "Waiting" that reads as broken.
        if (this.orders().length === 0 && this.filter() !== '') this.setFilter('');

        // Sent here from a release the store could not cover.
        const issueId = this.route.snapshot.queryParamMap.get('issue');
        if (issueId && this.canRaise()) await this.openForShortfall(issueId);
    }

    onPageChange(e: PageChange): void {
        this.pageReq.set(e);
        void this.load();
    }

    async load(): Promise<void> {
        this.loading.set(true);
        try {
            const page = await this.api.listPurchaseOrders({
                ...this.pageReq(),
                status: this.filter() || undefined,
                mine: this.mine() && !this.canDecide() ? true : undefined
            });
            this.pageInfo.set(page);
            this.orders.set(page.items);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    setMine(on: boolean): void {
        if (this.mine() === on) return;
        this.mine.set(on);
        this.pageReq.update((q) => ({ ...q, page: 1 }));
        void this.load();
    }

    setFilter(f: string): void {
        if (this.filter() === f) return;
        this.filter.set(f);
        // Filtering moved to the server when the list was paged, so the click
        // has to refetch. Without this it only moved the highlight and left the
        // same rows on screen.
        this.pageReq.update((q) => ({ ...q, page: 1 }));
        void this.load();
    }

    // ── Raising ─────────────────────────────────────────────────────────────

    async openRaise(): Promise<void> {
        this.formError.set(null);
        // A prefill the storekeeper opened and then closed must not quietly tie
        // the next, unrelated order to that request.
        this.fromIssue.set(null);
        this.raising.set(true);
        await this.loadCatalogue();
    }

    /**
     * The same panel, prefilled from a request the store could not cover.
     *
     * This is the storekeeper's path in: they release what is on the shelf,
     * see what was short, and land here with those items already on the order
     * rather than keying them a second time from a toast they have to
     * remember. The order carries the request's id, so the purchase and the
     * request it came from stay tied together.
     */
    private async openForShortfall(issueId: string): Promise<void> {
        this.formError.set(null);
        this.raising.set(true);
        await this.loadCatalogue();

        // Drop the parameter. Otherwise a refresh - or the tab strip restoring
        // this tab tomorrow - reopens a drawer about a request long dealt with.
        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {},
            replaceUrl: true
        });

        try {
            const detail = await this.api.getRequest(issueId);
            const short = detail.lines
                .map((line) => ({ line, shortBase: line.qtyRequested - (line.qtyIssued ?? 0) }))
                .filter((s) => s.shortBase > 0);

            if (short.length === 0) {
                this.formError.set('Nothing was short on that request.');
                return;
            }

            for (const { line, shortBase } of short) {
                const item = this.items().find((i) => i.id === line.itemId);
                const pack = item ? this.defaultPack(item) : null;
                if (!item || !pack) {
                    this.notify.warning(
                        `${line.name} has no pack size set up, so there is no way to say how much to buy.`
                    );
                    continue;
                }
                if (this.draft().some((l) => l.itemPackId === pack.id)) continue;
                this.draft.set([
                    ...this.draft(),
                    {
                        itemId: item.id,
                        itemPackId: pack.id,
                        name: item.name,
                        stockUnit: item.stockUnit,
                        packName: pack.packName,
                        qtyInStockUnit: pack.qtyInStockUnit,
                        // Rounded up: you buy whole packs, and buying one short
                        // leaves the section short again tomorrow.
                        qtyPacks: Math.max(1, Math.ceil(shortBase / pack.qtyInStockUnit)),
                        estPrice: null
                    }
                ]);
            }

            this.fromIssue.set(issueId);
            if (!this.reason().trim()) {
                this.reason.set('The store could not cover a request');
            }
        } catch (err) {
            this.formError.set(apiErrorMessage(err));
        }
    }

    /** Same panel, with the suggestions block already open. */
    async openSuggested(): Promise<void> {
        this.formError.set(null);
        this.fromIssue.set(null);
        this.showSuggestions.set(true);
        this.raising.set(true);
        await Promise.all([this.loadCatalogue(), this.loadSuggestions()]);
    }

    toggleSuggestions(): void {
        const next = !this.showSuggestions();
        this.showSuggestions.set(next);
        if (next && !this.suggestionsLoaded()) void this.loadSuggestions();
    }

    private async loadCatalogue(): Promise<void> {
        if (this.items().length > 0) return;
        try {
            const [items, suppliers] = await Promise.all([
                this.api.listItems(),
                this.api.listSuppliers()
            ]);
            this.items.set(items);
            this.suppliers.set(suppliers);
        } catch (err) {
            this.formError.set(apiErrorMessage(err));
        }
    }

    private async loadSuggestions(): Promise<void> {
        if (!this.canSuggest()) return;
        try {
            this.suggested.set(await this.api.suggestedOrder());
            this.suggestionsLoaded.set(true);
        } catch (err) {
            this.formError.set(apiErrorMessage(err));
        }
    }

    /** What this item is normally bought in - the pack an order is placed in. */
    defaultPack(item: Item) {
        return item.packs.find((p) => p.isDefaultPurchase) ?? item.packs[0] ?? null;
    }

    raiseNext(): void {
        if (this.raiseBlocker() !== null) return;
        this.raiseStep.update((i) => Math.min(i + 1, this.raiseSteps.length - 1));
    }

    raiseBack(): void {
        if (this.raiseStep() === 0) {
            this.raising.set(false);
            return;
        }
        this.raiseStep.update((i) => i - 1);
    }

    /** Closing the drawer by any route puts it back to the first question. */
    onRaiseVisible(visible: boolean): void {
        this.raising.set(visible);
        if (!visible) this.raiseStep.set(0);
    }

    /** The picker hands back an id; the order wants the item behind it. */
    addById(itemId: number | null): void {
        if (itemId === null) return;
        const item = this.items().find((i) => i.id === itemId);
        if (!item) return;
        if (this.draft().some((l) => l.itemId === itemId)) {
            this.notify.warning(`${item.name} is already on this order.`);
            return;
        }
        this.addDraft(item);
    }

    addDraft(item: Item): void {
        const pack = this.defaultPack(item);
        if (!pack) {
            this.notify.warning(
                `${item.name} has no pack size set up, so there is no way to say how much to buy.`
            );
            return;
        }
        this.draft.set([
            ...this.draft(),
            {
                itemId: item.id,
                itemPackId: pack.id,
                name: item.name,
                stockUnit: item.stockUnit,
                packName: pack.packName,
                qtyInStockUnit: pack.qtyInStockUnit,
                qtyPacks: 1,
                estPrice: null
            }
        ]);
    }

    removeDraft(itemPackId: number): void {
        this.draft.set(this.draft().filter((l) => l.itemPackId !== itemPackId));
    }

    setPacks(itemPackId: number, value: string): void {
        const parsed = Number(value);
        this.draft.set(
            this.draft().map((l) =>
                l.itemPackId === itemPackId
                    ? { ...l, qtyPacks: isNaN(parsed) ? l.qtyPacks : parsed }
                    : l
            )
        );
    }

    setPrice(itemPackId: number, value: string): void {
        const parsed = value === '' ? null : Number(value);
        this.draft.set(
            this.draft().map((l) =>
                l.itemPackId === itemPackId
                    ? { ...l, estPrice: parsed !== null && isNaN(parsed) ? null : parsed }
                    : l
            )
        );
    }

    /** Already picked, so the row offers nothing rather than offering it twice. */
    onOrder(row: SuggestedOrderLine): boolean {
        return this.draft().some((l) => l.itemPackId === row.itemPackId);
    }

    addSuggested(row: SuggestedOrderLine): void {
        if (!row.itemPackId || !row.qtyInStockUnit) return;
        if (this.onOrder(row)) return;
        this.draft.set([
            ...this.draft(),
            {
                itemId: row.itemId,
                itemPackId: row.itemPackId,
                name: row.name,
                stockUnit: row.stockUnit,
                packName: row.packName ?? 'pack',
                qtyInStockUnit: row.qtyInStockUnit,
                qtyPacks: row.suggestedPacks,
                estPrice: row.lastPrice
            }
        ]);
    }

    addAllSuggested(): void {
        for (const row of this.suggested()) this.addSuggested(row);
        // Collapse it: the order below is now the thing worth looking at.
        this.showSuggestions.set(false);
    }

    async submitRaise(): Promise<void> {
        if (this.draft().length === 0) return;
        this.busy.set(true);
        this.formError.set(null);
        try {
            await this.api.raisePurchaseOrder({
                issueId: this.fromIssue(),
                supplierId: this.supplierId() || null,
                neededBy: this.neededBy() || null,
                reason: this.reason().trim() || null,
                lines: this.draft().map((l) => ({
                    itemPackId: l.itemPackId,
                    qtyPacks: l.qtyPacks,
                    estPrice: l.estPrice
                }))
            });
            this.notify.success('Sent to management');
            this.raising.set(false);
            this.showSuggestions.set(false);
            this.suggestionsLoaded.set(false);
            this.draft.set([]);
            this.reason.set('');
            this.neededBy.set('');
            this.supplierId.set(0);
            this.fromIssue.set(null);
            await this.load();
        } catch (err) {
            this.formError.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    // ── Deciding ────────────────────────────────────────────────────────────

    async decide(po: PurchaseOrder, decision: PoDecision): Promise<void> {
        this.busy.set(true);
        try {
            await this.api.decidePurchaseOrder(po.id, decision);
            this.notify.success(
                decision === 'rejected' ? 'Marked as not now' : `Marked ${decision}`
            );
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    /**
     * Ordered means placed with somebody. The server refuses it without a
     * supplier, because a delivery that arrives against an order placed with
     * nobody cannot be matched to anything.
     */
    async markOrdered(po: PurchaseOrder): Promise<void> {
        let supplierId = po.supplierId;

        if (!supplierId) {
            if (this.suppliers().length === 0) {
                try {
                    this.suppliers.set(await this.api.listSuppliers());
                } catch (err) {
                    this.notify.error(apiErrorMessage(err));
                    return;
                }
            }
            const names = this.suppliers()
                .map((s, i) => `${i + 1}. ${s.name}`)
                .join('\n');
            const answer = await this.notify.prompt(
                `Type the number of the supplier:\n${names}`,
                'Who is it being ordered from?',
                '',
                'Mark as ordered'
            );
            if (!answer) return;
            const picked = this.suppliers()[Number(answer.trim()) - 1];
            if (!picked) {
                this.notify.error('That was not one of the numbers on the list');
                return;
            }
            supplierId = picked.id;
        }

        this.busy.set(true);
        try {
            await this.api.decidePurchaseOrder(po.id, 'ordered', null, supplierId);
            this.notify.success('Marked as ordered - receive it when it arrives');
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    async closeShort(po: PurchaseOrder): Promise<void> {
        const note = await this.notify.prompt(
            'The rest is not coming. Say why, because in six weeks somebody will ask.',
            'Close this order short',
            '',
            'Close it'
        );
        if (!note || note.trim().length < 3) return;
        this.busy.set(true);
        try {
            await this.api.closePurchaseOrder(po.id, note.trim());
            this.notify.success('Closed');
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    /** Receiving is a delivery, so it happens on the delivery screen. */
    receive(po: PurchaseOrder): void {
        void this.router.navigate(['/grn'], { queryParams: { po: po.id } });
    }

    // ── Display ─────────────────────────────────────────────────────────────

    ordered(line: PurchaseOrderLine): string {
        if (line.qtyPacks === null || !line.packName) {
            return formatQty(line.qtyBase, line.stockUnit);
        }
        return `${line.qtyPacks} × ${line.packName}`;
    }

    label(status: string): string {
        return (
            {
                requested: 'Waiting',
                approved: 'Approved',
                rejected: 'Not now',
                ordered: 'On order',
                done: 'Delivered'
            }[status] ?? status
        );
    }

    tone(status: string): 'success' | 'warn' | 'info' | 'danger' | 'secondary' {
        return status === 'approved' || status === 'done'
            ? 'success'
            : status === 'rejected'
              ? 'danger'
              : status === 'ordered'
                ? 'info'
                : 'warn';
    }

    q(qty: number, unit: string): string {
        return formatQty(qty, unit);
    }

    money(value: number): string {
        return formatMoney(value);
    }
}
