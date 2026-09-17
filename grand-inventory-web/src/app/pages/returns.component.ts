/**
 * Returns, from the store's side of the counter.
 *
 * The screen answers the questions in the order they are actually asked, and
 * each panel is one of them:
 *
 *   1. What is sitting in quarantine?  - and what happens to it next
 *   2. What has come back, overall?    - the record, with where each lot got to
 *
 * and, for the storekeeper, a drawer for the one case a request cannot
 * describe: bad stock on the store's own shelf, which arrived on a delivery
 * and so has no release to measure against.
 *
 * **What changed and why.** The three panels used to run in the other order
 * with a four-field form sitting permanently at the bottom of the page. The
 * form was the largest thing on the screen and the rarest thing done on it, so
 * the screen read as "fill this in" when what it is mostly for is "look at
 * this and decide". Pending approvals were a toggle button on a list header,
 * which is a strange place to keep the only thing on the page with a deadline.
 *
 * It is *not* where a section returns things. Kitchen and cleaning hand stock
 * back from **Requests**, against the release that delivered it, which is both
 * where the question comes up and what caps the quantity.
 *
 * **There is no approval on this screen any more (CR-006).** Approving a
 * hand-back stamped a movement that had already happened and blocked nothing
 * while it sat unapproved. The decision that matters -- claim it from the
 * supplier, or bin it -- is asked once, on Supplier returns, and answered by
 * management line by line. So this screen is now what came back and where it
 * got to, which is what people were reading it for anyway.
 *
 * **Management see a different screen.** They decide; they do not put stock in
 * quarantine and they do not send it anywhere. So the shelf drawer and the
 * "ask management" button are not theirs - the server refuses both - and the
 * quarantine panel is information: money sitting still, which is the part of
 * it they care about.
 */
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { AuthStore } from '@/core/auth.store';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import { formatMoney, formatQty } from '@/core/format';
import type {
    Item,
    MyContext,
    QuarantineRow,
    ReasonCode,
    SectionReturnRow,
    StockRow,
    SuggestedReturn
} from '@/core/types';
import { DEFAULT_PAGE_SIZE, emptyPage, type Page, type PageRequest } from '@/core/types';
import { AppPaginator, type PageChange } from '@/shared/paginator.component';
import { AppItemPicker } from '@/shared/item-picker.component';

/** The server's ceiling on a page of stock. Asking for more is a 400. */
const PAGE_MAX = 200;

@Component({
    selector: 'app-returns',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterLink,
        ButtonModule,
        DrawerModule,
        InputNumberModule,
        InputTextModule,
        TagModule,
        AppPaginator,
        AppItemPicker
    ],
    template: `
        <div class="space-y-8">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold">Returns</h1>
                    <p class="text-surface-500 text-sm">
                        {{
                            canPutInQuarantine()
                                ? 'What came back off the floor, and what is waiting to go to the supplier'
                                : 'What came back off the floor, and what it is costing while it waits'
                        }}
                    </p>
                </div>
                @if (canPutInQuarantine()) {
                    <button
                        pButton
                        outlined
                        icon="pi pi-reply"
                        label="Something on our own shelf is bad"
                        (click)="shelfOpen.set(true)"></button>
                }
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <!-- Which half of this screen is yours. Both roles see most of the
                 same panels, so each needs telling what they are here to do --
                 a missing button reads as broken until you know it is somebody
                 else's job. -->
            <div class="app-note">
                <div class="app-note__title">Your part in this</div>
                @if (canPutInQuarantine()) {
                    <p class="mt-1">
                        Bad stock a section hands back lands on your
                        <strong>quarantine</strong> shelf straight away - it does not wait for
                        anybody, and there is nothing here for you to approve. Your job is to
                        get it off that shelf: <strong>ask management what to do with it</strong>
                        - send it back to the supplier, or bin it - and then carry out whichever
                        they say.
                    </p>
                } @else {
                    <p class="mt-1">
                        A section has already handed this stock back - it moved when they did
                        it, and it is sitting in quarantine now. <strong>There is nothing to
                        approve here.</strong> The one decision that is yours - send it back to
                        the supplier, or bin it - reaches you on
                        <strong>Supplier returns</strong> when the store asks for it.
                    </p>
                }
            </div>

            <!-- ── 1. What is in quarantine ─────────────────────────────────
                 Stock sitting here is money the restaurant has already paid for
                 and is not using, and every day it sits is a day closer to the
                 supplier saying it is too late to argue. -->
            <div
                class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                <div
                    class="px-5 py-4 border-b border-surface flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div class="font-semibold">Waiting to go back</div>
                        <p class="text-sm text-surface-500 mt-1">
                            In quarantine now. Nothing is ever issued out of here - it either goes
                            to the supplier or it is written off.
                        </p>
                    </div>
                    <div class="text-right">
                        <div class="text-2xl font-bold">{{ money(quarantineValue()) }}</div>
                        <div class="text-xs text-surface-500">
                            {{ quarantine().length }}
                            {{ quarantine().length === 1 ? 'item' : 'items' }}
                        </div>
                    </div>
                </div>

                @if (quarantine().length === 0) {
                    <p class="p-8 text-center text-surface-500">
                        {{ loadingQuarantine() ? 'Loading…' : 'Nothing is waiting to go back.' }}
                    </p>
                } @else {
                    <ul class="divide-y divide-surface">
                        @for (row of quarantine(); track row.itemId) {
                            <li class="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                                <div class="min-w-0">
                                    <div class="font-medium">{{ row.name }}</div>
                                    <div class="text-xs text-surface-500 font-mono">
                                        {{ row.code }}
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div class="font-semibold">
                                        {{ q(row.qtyBase, row.stockUnit) }}
                                    </div>
                                    <div class="text-xs text-surface-500">
                                        {{ money(row.value) }}
                                    </div>
                                    <!-- Physically here is not the same as
                                         nobody dealing with it. Without this the
                                         panel invited the storekeeper to ask
                                         about a crate already sitting on an
                                         ask, and the next screen then offered
                                         them nothing. -->
                                    @if (row.qtyOnOpenAsk > 0) {
                                        <div class="text-xs mt-1">
                                            <span class="app-chip app-chip--wait">
                                                @if (row.qtyFree > 0) {
                                                    {{ q(row.qtyOnOpenAsk, row.stockUnit) }} already
                                                    asked about
                                                } @else {
                                                    already asked about
                                                }
                                            </span>
                                        </div>
                                    }
                                </div>
                            </li>
                        }
                    </ul>

                    <!-- The next step, said out loud and linked. Before this the
                         chain simply stopped here and the storekeeper had to
                         already know that Supplier returns was the answer. -->
                    <div class="px-5 py-4 border-t border-surface">
                        @if (canPutInQuarantine() && nothingLeftToAsk()) {
                            <!-- Everything here is already somebody's job. The
                                 old screen still showed "ask management what to
                                 do", which led to a screen with nothing on it. -->
                            <div class="app-note app-note--ok">
                                <div class="app-note__title">All of this has been asked about</div>
                                <p class="mt-1">
                                    Every item on this shelf is already on an ask. It is either
                                    waiting for management to answer, or answered and waiting for
                                    you to send or bin it.
                                </p>
                            </div>
                            <a
                                pButton
                                outlined
                                class="mt-3 inline-flex"
                                icon="pi pi-arrow-right"
                                iconPos="right"
                                label="See what is waiting on Supplier returns"
                                routerLink="/supplier-returns"></a>
                        } @else if (canPutInQuarantine()) {
                            <div class="app-note">
                                <div class="app-note__title">What happens next</div>
                                <p class="mt-1">
                                    You ask management <strong>one question</strong>: send this
                                    back to the supplier, or bin it? The delivery, the packs and
                                    the money are worked out for you. Management answers line by
                                    line, and then you either mark it gone when the lorry takes
                                    it, or bin it - one button either way.
                                </p>
                                <p class="mt-1">
                                    Nothing leaves this shelf until you do that.
                                </p>
                            </div>
                            <!-- Carries the delivery, so the next screen opens
                                 on a filled-in form rather than an empty one.
                                 With more than one delivery in quarantine it
                                 goes to the list and lets the storekeeper
                                 pick. -->
                            <a
                                pButton
                                class="mt-3 inline-flex"
                                icon="pi pi-undo"
                                [label]="
                                    suggestions().length === 1
                                        ? 'Ask about the ' + suggestions()[0].supplierName + ' lot'
                                        : 'Ask management what to do'
                                "
                                routerLink="/supplier-returns"
                                [queryParams]="
                                    suggestions().length === 1
                                        ? { grnId: suggestions()[0].grnId }
                                        : {}
                                "></a>
                        } @else {
                            <!-- Management's version of the same panel. The
                                 doing belongs to the store; what is theirs is
                                 the decision, and it reaches them on Supplier
                                 returns when the storekeeper raises one. -->
                            <div class="app-note">
                                <div class="app-note__title">What happens next</div>
                                <p class="mt-1">
                                    The storekeeper asks you one question about this:
                                    <strong>send it back to the supplier, or bin it?</strong> You
                                    answer line by line on <strong>Supplier returns</strong>.
                                    Until you do, this is stock that has been paid for and cannot
                                    be used.
                                </p>
                            </div>
                            <a
                                pButton
                                outlined
                                class="mt-3 inline-flex"
                                icon="pi pi-arrow-right"
                                iconPos="right"
                                label="Decisions waiting on you"
                                routerLink="/supplier-returns"></a>
                        }
                    </div>
                }
            </div>

            <!-- ── 2. The record ───────────────────────────────────────────── -->
            <div
                class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                <div class="p-4 border-b border-surface">
                    <span class="font-semibold">Came back off the floor</span>
                    <p class="text-sm text-surface-500 mt-0.5">
                        Handed back by a section, against the release that delivered it.
                    </p>
                </div>

                @if (rows().length === 0) {
                    <p class="p-8 text-center text-surface-500">
                        {{ loading() ? 'Loading…' : 'Nothing has come back.' }}
                    </p>
                } @else {
                    <ul class="divide-y divide-surface">
                        @for (row of rows(); track row.id) {
                            <li class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                                <div class="min-w-0">
                                    <div class="font-medium">
                                        {{ row.itemName }} · {{ q(row.qtyBase, row.stockUnit) }}
                                    </div>
                                    <div class="text-xs text-surface-500">
                                        from {{ row.fromSection }} · {{ row.returnedBy }} ·
                                        {{ when(row.returnedAt) }}
                                    </div>
                                    @if (row.note) {
                                        <div class="text-xs text-surface-500 mt-1">
                                            “{{ row.note }}”
                                        </div>
                                    }
                                </div>
                                <div class="flex items-center gap-2 flex-wrap">
                                    <p-tag severity="info" [value]="row.reasonLabel"></p-tag>
                                    <!-- Where this lot got to, rather than whether
                                         somebody stamped it. The stamp is gone
                                         (CR-006); the question people ask of this
                                         list is "what happened to it". -->
                                    @if (row.onSupplierReturn) {
                                        <p-tag severity="success" value="Decided"></p-tag>
                                    } @else {
                                        <p-tag
                                            severity="warn"
                                            value="In quarantine - no decision yet"></p-tag>
                                    }
                                </div>
                            </li>
                        }
                    </ul>
                }
            </div>

            <app-paginator [page]="pageInfo()" (pageChange)="onPageChange($event)" />

            <!-- ── The store's own shelf, in a drawer ───────────────────────
                 Out of the way, because it is the rarest thing done on this
                 screen and it used to be the biggest. -->
            <p-drawer
                [visible]="shelfOpen()"
                (visibleChange)="shelfOpen.set($event)"
                position="right"
                header="Something on our own shelf is bad"
                styleClass="!w-full sm:!w-[34rem]">
                <div class="space-y-5">
                    <div class="app-note">
                        This is for bad stock that never went to a section. It arrived on a
                        delivery, so there is no release to measure it against. Anything a
                        <strong>section</strong> is handing back goes through
                        <strong>Requests</strong> instead, and food already thrown away is
                        <strong>Wastage</strong>.
                    </div>

                    @if (mySections().length > 1) {
                        <div>
                            <label class="block text-sm font-medium mb-1 app-req" for="ret-section">
                                Which shelf is it on?
                            </label>
                            <select
                                id="ret-section"
                                class="w-full px-3 py-2.5 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                                [ngModel]="sectionId()"
                                (ngModelChange)="sectionId.set(+$event)">
                                @for (s of mySections(); track s.id) {
                                    <option [ngValue]="s.id">{{ s.name }}</option>
                                }
                            </select>
                        </div>
                    }

                    <app-item-picker
                        label="What is it?"
                        [required]="true"
                        [items]="items()"
                        [priority]="inStoreIds()"
                        priorityLabel="On the store's shelf now"
                        [value]="itemId()"
                        (valueChange)="itemId.set($event)" />

                    <div>
                        <label class="block text-sm font-medium mb-1 app-req">
                            How much of it? <span class="text-surface-500">{{ unit() }}</span>
                        </label>
                        <p-inputNumber
                            styleClass="w-full"
                            inputStyleClass="w-full"
                            [ngModel]="qty()"
                            (ngModelChange)="qty.set($event)"
                            [min]="0"
                            [maxFractionDigits]="3"></p-inputNumber>
                        @if (heldNow() !== null) {
                            <p class="text-xs text-surface-500 mt-1">
                                The store holds {{ q(heldNow()!, unitRaw()) }} of this.
                            </p>
                        }
                    </div>

                    <div>
                        <label class="block text-sm font-medium mb-1 app-req" for="ret-reason">
                            What is wrong with it?
                        </label>
                        <select
                            id="ret-reason"
                            class="w-full px-3 py-2.5 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                            [ngModel]="reasonCode()"
                            (ngModelChange)="reasonCode.set($event)">
                            <option [ngValue]="null">Choose…</option>
                            @for (r of reasons(); track r.code) {
                                <option [ngValue]="r.code">{{ r.label }}</option>
                            }
                        </select>
                    </div>

                    <div>
                        <label class="block text-sm font-medium mb-1" for="ret-note">
                            Note - you will be reading this back to the supplier
                        </label>
                        <input
                            id="ret-note"
                            pInputText
                            class="w-full"
                            placeholder="e.g. Bottom of the sack soft and weeping"
                            [ngModel]="note()"
                            (ngModelChange)="note.set($event)" />
                    </div>

                    <div class="flex items-center justify-end gap-3 pt-2">
                        @if (shelfBlocker(); as why) {
                            <span class="text-sm text-surface-500">{{ why }}</span>
                        }
                        <button
                            pButton
                            label="Move to quarantine"
                            icon="pi pi-reply"
                            [disabled]="!canSubmit() || busy()"
                            [loading]="busy()"
                            (click)="submit()"></button>
                    </div>
                </div>
            </p-drawer>
        </div>
    `
})
export class ReturnsComponent implements OnInit {
    readonly auth = inject(AuthStore);
    private api = inject(GrandService);
    private notify = inject(NotifyService);

    readonly rows = signal<SectionReturnRow[]>([]);
    readonly pageInfo = signal<Page<SectionReturnRow>>(emptyPage<SectionReturnRow>());
    readonly pageReq = signal<PageRequest>({ page: 1, limit: DEFAULT_PAGE_SIZE });
    readonly items = signal<Item[]>([]);
    readonly reasons = signal<ReasonCode[]>([]);
    readonly quarantine = signal<QuarantineRow[]>([]);
    /** What the store itself holds, to sort the picker and cap the quantity. */
    readonly storeStock = signal<StockRow[]>([]);
    /** The same quarantine stock, already worked out into returns. */
    readonly suggestions = signal<SuggestedReturn[]>([]);
    readonly loading = signal(false);
    readonly loadingQuarantine = signal(false);
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);
    readonly shelfOpen = signal(false);

    readonly sectionId = signal<number | null>(null);
    readonly ctx = signal<MyContext | null>(null);
    readonly itemId = signal<number | null>(null);
    readonly qty = signal<number | null>(null);
    readonly reasonCode = signal<string | null>(null);
    readonly note = signal('');

    /**
     * Nothing on the shelf is still free to ask about.
     *
     * Not the same as an empty shelf: the goods are here, they are just already
     * somebody's job.
     */
    readonly nothingLeftToAsk = computed(
        () => this.quarantine().length > 0 && this.quarantine().every((r) => r.qtyFree <= 0)
    );

    /** What is waiting to go back, at what the ledger says it cost. */
    readonly quarantineValue = computed(() =>
        this.quarantine().reduce((n, r) => n + r.value, 0)
    );

    /**
     * The store, and nothing else.
     *
     * Every other section returns against a release, from Requests. Offering
     * them here would be the unconstrained path again through a side door --
     * and quarantine is never offered anywhere, since handing stock back to
     * itself is the one return the server refuses outright.
     */
    readonly mySections = computed(() => {
        const allowed = this.ctx()?.mySectionIds;
        const open = this.auth.sections().filter((s) => s.isActive && s.isStore);
        return allowed ? open.filter((s) => allowed.includes(s.id)) : open;
    });

    private readonly quarantineSection = computed(
        () => this.auth.sections().find((s) => s.kind === 'QUARANTINE') ?? null
    );

    /**
     * Who may put stock into quarantine, and therefore who sees the shelf
     * drawer and the "send it back" button.
     *
     * The storekeeper. Management approves returns and settles the credit; the
     * server refuses both of these to them, so offering the buttons would only
     * produce a 403 at the end of a filled-in form.
     */
    readonly canPutInQuarantine = computed(() => this.auth.role() === 'storekeeper');

    /** Ids the store actually holds, so the picker offers those first. */
    readonly inStoreIds = computed(() =>
        this.storeStock()
            .filter((r) => r.qtyBase > 0)
            .map((r) => r.itemId)
    );

    readonly unitRaw = computed(
        () => this.items().find((i) => i.id === this.itemId())?.stockUnit ?? ''
    );

    readonly unit = computed(() => (this.unitRaw() ? `(${this.unitRaw()})` : ''));

    /** What the store holds of the chosen item, or null if it holds none. */
    readonly heldNow = computed(() => {
        const id = this.itemId();
        if (id === null) return null;
        const row = this.storeStock().find((r) => r.itemId === id);
        return row ? row.qtyBase : null;
    });

    readonly canSubmit = computed(
        () =>
            this.sectionId() !== null &&
            this.itemId() !== null &&
            (this.qty() ?? 0) > 0 &&
            !!this.reasonCode()
    );

    /** Says what is missing rather than leaving the button greyed and mute. */
    readonly shelfBlocker = computed<string | null>(() => {
        if (this.itemId() === null) return 'Choose what it is';
        if ((this.qty() ?? 0) <= 0) return 'Say how much';
        if (!this.reasonCode()) return 'Say what is wrong with it';
        return null;
    });

    async ngOnInit(): Promise<void> {
        try {
            this.ctx.set(await this.api.myContext());
        } catch {
            /* the screen still works, just unfiltered */
        }
        this.sectionId.set(this.mySections()[0]?.id ?? null);
        try {
            const [items, reasons] = await Promise.all([
                this.api.listItems({}),
                this.api.reasonCodes('return')
            ]);
            this.items.set(items);
            this.reasons.set(reasons);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        }
        await Promise.all([this.load(), this.loadQuarantine()]);
    }

    /** What quarantine holds right now, derived from the ledger like everything. */
    async loadQuarantine(): Promise<void> {
        const section = this.quarantineSection();
        if (!section) {
            this.quarantine.set([]);
            return;
        }
        this.loadingQuarantine.set(true);
        try {
            // Its own read rather than plain stock: this panel has to tell
            // "waiting for somebody to deal with it" apart from "already with
            // management", and a stock balance cannot answer that.
            this.quarantine.set(await this.api.quarantineContents());
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loadingQuarantine.set(false);
        }

        // Deliberately not in the same try as the panel above, and not in the
        // same Promise.all. Both of these only improve the drawer -- one sorts
        // the picker, the other labels a button -- and neither is worth taking
        // the quarantine panel down with it. Sending them together is how a
        // rejected limit on the store's stock left the page reading "nothing is
        // waiting to go back" over a quarantine holding 2.6 tonnes.
        const store = this.storeSectionId();
        if (store !== null) {
            try {
                const held = await this.api.getStock({ sectionId: store, limit: PAGE_MAX });
                this.storeStock.set(held.items);
            } catch {
                /* the picker simply offers everything in master order */
            }
        }

        // Only the storekeeper may read the suggestions -- they are the inputs
        // to a form only they can submit -- so management would get a 403 that
        // means nothing to them.
        if (this.canPutInQuarantine()) {
            try {
                this.suggestions.set(await this.api.suggestedSupplierReturns());
            } catch {
                /* the button falls back to "Send it back to the supplier" */
            }
        }
    }

    private storeSectionId(): number | null {
        return this.mySections()[0]?.id ?? null;
    }

    onPageChange(e: PageChange): void {
        this.pageReq.set(e);
        void this.load();
    }

    async load(): Promise<void> {
        this.loading.set(true);
        try {
            const page = await this.api.listSectionReturns({ ...this.pageReq() });
            this.pageInfo.set(page);
            this.rows.set(page.items);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    async submit(): Promise<void> {
        if (!this.canSubmit()) return;
        this.busy.set(true);
        this.error.set(null);
        try {
            await this.api.returnToStore({
                sectionId: this.sectionId()!,
                itemId: this.itemId()!,
                qtyBase: this.qty()!,
                reasonCode: this.reasonCode()!,
                note: this.note() || null
            });
            this.notify.success('Moved to quarantine - it can now go back to the supplier');
            this.itemId.set(null);
            this.qty.set(null);
            this.reasonCode.set(null);
            this.note.set('');
            this.shelfOpen.set(false);
            await Promise.all([this.load(), this.loadQuarantine()]);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    money(v: number): string {
        return formatMoney(v);
    }

    q(qty: number, unit: string): string {
        return formatQty(qty, unit);
    }

    when(iso: string): string {
        return new Date(iso).toLocaleString('en-LK', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}
