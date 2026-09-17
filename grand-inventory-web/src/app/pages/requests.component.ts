/**
 * Requests - one screen, three jobs, decided by who is looking.
 *
 * The storekeeper sees things to release. The kitchen sees things to confirm.
 * Management sees the record of both and acts on neither: they do not hand
 * stock over, so the screen is a history for them rather than a queue. Nobody
 * sees a tab they have no business in, and the thing that needs doing is
 * always at the top with a coloured button.
 */
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DrawerModule } from 'primeng/drawer';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { AuthStore } from '@/core/auth.store';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import { formatQty } from '@/core/format';
import { uuid } from '@/core/uuid';
import { DEFAULT_PAGE_SIZE, emptyPage, RETURN_WINDOW_DAYS, type IssueDetail, type IssueReturnable,
    type IssueReturnableLine, type MyContext, type Page, type PageRequest, type ReasonCode, type RequestRow } from '@/core/types';
import { AppPaginator, type PageChange } from '@/shared/paginator.component';
import { AppFilterBar, type FilterOption } from '@/shared/filter-bar.component';
import { AskComponent } from './ask.component';

@Component({
    selector: 'app-requests',
    standalone: true,
    imports: [CommonModule, FormsModule, ButtonModule, InputNumberModule, InputTextModule, TagModule, DrawerModule, AskComponent, AppPaginator, AppFilterBar],
    template: `
        <div class="space-y-8">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold">Requests</h1>
                    <p class="text-surface-500 text-sm">
                        {{ auth.location()?.name }} · {{ scopeLabel() }}
                    </p>
                </div>
                @if (canAsk()) {
                    <button pButton icon="pi pi-plus" label="Ask for stock" (click)="asking.set(true)"></button>
                }
            </div>

            <!-- Asking used to navigate to /ask, which threw away the list the
                 person was reading and made "Requests" and "Ask for stock" feel
                 like the same screen. It is the same form, opened beside the
                 list instead of on top of it. -->
            <p-drawer
                [visible]="asking()"
                (visibleChange)="asking.set($event)"
                position="right"
                header="Ask for stock"
                styleClass="!w-full md:!w-[42rem]">
                @if (asking()) {
                    <app-ask [embedded]="true" (sent)="onAsked()" />
                }
            </p-drawer>

            <!-- Returning.
                 This is here rather than on a screen of its own because it is
                 the same moment: the chef is looking at the release that just
                 arrived, and the thing they want to say about it is "this was
                 wrong". A separate screen asked them to pick the item again
                 from everything the section handles, which is how a return
                 became a way to hand back stock nobody had given them. -->
            <p-drawer
                [visible]="!!returning()"
                (visibleChange)="onReturnClosed($event)"
                position="right"
                header="Return to the store"
                styleClass="!w-full md:!w-[40rem]">
                @if (returning(); as row) {
                    <div class="space-y-4">
                        <p class="text-sm text-surface-500">
                            {{ row.sectionName }}@if (row.releasedBy) {
                                · released by {{ row.releasedBy }}
                            }. You can hand back what was given to you on this request, and no
                            more.
                        </p>

                        @if (returnLoading()) {
                            <p class="text-surface-500 text-sm">Loading the release…</p>
                        } @else if (returnWindowClosed()) {
                            <div class="app-note app-note--warn">
                                <div class="app-note__title">Too late to return this</div>
                                <p class="mt-1">
                                    This was released {{ returnDetail()?.daysSinceReleased }} days
                                    ago, and returns close after {{ returnWindowDays }}. After that
                                    nobody can say the stock on your shelf is what came in on this
                                    release. Log it as <strong>Wastage</strong> instead, or let the
                                    next stock count find it.
                                </p>
                            </div>
                        } @else if (returnLines().length === 0) {
                            <div class="app-note">
                                Nothing on this request can be handed back. Either none of it was
                                released, or it has all gone back already, or the section no longer
                                holds it.
                            </div>
                        } @else {
                            @for (line of returnLines(); track line.itemId) {
                                <div
                                    class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_9rem] items-end gap-3 pb-3 border-b border-surface last:border-0">
                                    <div class="min-w-0">
                                        <div class="font-medium text-lg">{{ line.name }}</div>
                                        <div class="text-sm text-surface-500">
                                            released {{ q(line.qtyIssued, line.stockUnit) }}
                                            @if (line.qtyReturned > 0) {
                                                · already back
                                                {{ q(line.qtyReturned, line.stockUnit) }}
                                            }
                                            · you hold {{ q(line.qtyHeld, line.stockUnit) }}
                                        </div>
                                        <div
                                            class="text-xs mt-0.5"
                                            [class.text-surface-400]="line.qtyReturnable === 0">
                                            at most
                                            <span class="font-semibold">
                                                {{ q(line.qtyReturnable, line.stockUnit) }}
                                            </span>
                                            can go back
                                        </div>
                                    </div>
                                    <div class="min-w-0">
                                        <label class="block text-xs text-surface-500 mb-1">
                                            Returning
                                            <span class="text-surface-400">{{ line.stockUnit }}</span>
                                        </label>
                                        <p-inputNumber
                                            styleClass="w-full"
                                            inputStyleClass="w-full py-3 text-base"
                                            [ngModel]="returnQty()[line.itemId]"
                                            (ngModelChange)="setReturnQty(line.itemId, $event)"
                                            [min]="0"
                                            [max]="line.qtyReturnable"
                                            [disabled]="line.qtyReturnable === 0"
                                            [maxFractionDigits]="3"></p-inputNumber>
                                    </div>
                                </div>
                            }

                            <div>
                                <label class="block text-sm font-medium mb-1 app-req">
                                    What is wrong with it
                                </label>
                                <select
                                    class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                                    [ngModel]="returnReason()"
                                    (ngModelChange)="returnReason.set($event)">
                                    <option [ngValue]="null">Choose…</option>
                                    @for (reason of returnReasons(); track reason.code) {
                                        <option [ngValue]="reason.code">{{ reason.label }}</option>
                                    }
                                </select>
                            </div>

                            <div>
                                <label class="block text-sm font-medium mb-1">
                                    Note - the storekeeper reads this before arguing with the
                                    supplier
                                </label>
                                <input
                                    pInputText
                                    class="w-full"
                                    placeholder="e.g. Grey and slimy on opening"
                                    [ngModel]="returnNote()"
                                    (ngModelChange)="returnNote.set($event)" />
                            </div>

                            <div class="app-note">
                                This is for stock you still have and are handing back. It goes to
                                the store, which decides whether it goes to the supplier. Food you
                                have already thrown away is <strong>Wastage</strong>, not this.
                            </div>

                            <button
                                pButton
                                class="w-full"
                                icon="pi pi-reply"
                                [label]="'Return ' + returnCount() + ' item(s)'"
                                [disabled]="!canReturn() || busy()"
                                (click)="submitReturn()"></button>
                        }
                    </div>
                }
            </p-drawer>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <!-- Releasing.
                 A panel at the top of the page pushed the whole list down and
                 left the storekeeper scrolling back up to find the next request.
                 Beside the list instead, same as asking. -->
            <p-drawer
                [visible]="!!open()"
                (visibleChange)="onReleaseClosed($event)"
                position="right"
                [header]="open() ? 'Release to ' + openSectionName() : 'Release'"
                styleClass="!w-full md:!w-[40rem]">
                @if (open(); as detail) {
                    <div class="space-y-4">
                        @for (line of detail.lines; track line.lineId) {
                            <!-- Grid, not wrapping flex: the number input will not
                                 shrink below its intrinsic width as a flex item,
                                 so it ran out past the edge of the panel. -->
                            <div
                                class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_9rem] items-end gap-3 pb-3 border-b border-surface last:border-0">
                                <div class="min-w-0">
                                    <div class="font-medium text-lg">{{ line.name }}</div>
                                    <div class="text-sm text-surface-500">
                                        asked for {{ q(line.qtyRequested, line.stockUnit) }} ·
                                        store has
                                        <span
                                            [class.text-red-600]="line.availableInStore < line.qtyRequested"
                                            [class.font-semibold]="line.availableInStore < line.qtyRequested">
                                            {{ q(line.availableInStore, line.stockUnit) }}
                                        </span>
                                    </div>
                                </div>
                                <div class="min-w-0">
                                    <label class="block text-xs text-surface-500 mb-1">
                                        Giving <span class="text-surface-400">{{ line.stockUnit }}</span>
                                    </label>
                                    <p-inputNumber
                                        styleClass="w-full"
                                        inputStyleClass="w-full py-3 text-base"
                                        [ngModel]="giving()[line.lineId]"
                                        (ngModelChange)="setGiving(line.lineId, $event)"
                                        [min]="0"
                                        [maxFractionDigits]="3"></p-inputNumber>
                                </div>
                            </div>
                        }

                        <!-- The store is short.

                             Before this, the storekeeper opened the drawer,
                             saw "store has 0 g" in red, pressed Release, and
                             got a flat BAD_REQUEST back - correct, and a dead
                             end. The shelf being empty is not an error, it is
                             the moment to order, so the drawer says so and
                             hands over the one button that does something
                             about it. -->
                        @if (openShort().length > 0) {
                            <div class="app-note app-note--warn space-y-3">
                                <div class="app-note__title">
                                    @if (nothingToGive()) {
                                        The store has none of this
                                    } @else {
                                        The store cannot cover all of this
                                    }
                                </div>
                                <ul class="text-sm space-y-1">
                                    @for (line of openShort(); track line.lineId) {
                                        <li>
                                            <strong>{{ line.name }}</strong> - asked for
                                            {{ q(line.qtyRequested, line.stockUnit) }}, store has
                                            {{ q(line.availableInStore, line.stockUnit) }}.
                                        </li>
                                    }
                                </ul>
                                @if (canRaisePurchase()) {
                                    <p class="text-sm">
                                        @if (nothingToGive()) {
                                            There is nothing to release. Put it on a purchase
                                            order instead.
                                        } @else {
                                            Release what is there first - you will be offered the
                                            rest to order straight after.
                                        }
                                    </p>
                                    <button
                                        pButton
                                        [outlined]="!nothingToGive()"
                                        icon="pi pi-shopping-cart"
                                        label="Order what is short"
                                        (click)="orderShortfall(detail)"></button>
                                } @else {
                                    <p class="text-sm">
                                        Ask the storekeeper or management to order the rest.
                                    </p>
                                }
                            </div>
                        }

                        <div class="flex justify-end pt-2">
                            <!-- Disabled at zero rather than left to fail on the
                                 server: releasing nothing is not a thing that
                                 can succeed, and the button offering to do it
                                 is what made the dead end feel like a fault. -->
                            <button
                                pButton
                                size="large"
                                icon="pi pi-check"
                                label="Release these"
                                [disabled]="busy() || nothingToGive()"
                                [loading]="busy()"
                                (click)="doRelease(detail)"></button>
                        </div>
                    </div>
                }
            </p-drawer>


            <!-- The list -->
            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                <div class="px-5 py-4 border-b border-surface flex flex-wrap items-center gap-x-6 gap-y-3">
                    <!-- Only for roles that own particular sections. The
                         storekeeper works the whole branch - releasing other
                         people's requests is the job - and management reads all
                         of it, so a "mine" filter would only hide work from
                         one and history from the other. -->
                    @if (sectionOptions().length > 2) {
                        <app-filter-bar
                            label="Which section"
                            [options]="sectionOptions()"
                            [value]="sectionId()"
                            (valueChange)="setSection($event)" />
                    }
                    <app-filter-bar
                        label="Filter requests"
                        [options]="filterOptions()"
                        [value]="filter()"
                        (valueChange)="setFilter($event)" />
                </div>

                @if (visible().length === 0) {
                    <p class="p-10 text-center text-surface-500">
                        {{ loading() ? 'Loading…' : 'Nothing here.' }}
                    </p>
                } @else {
                    <ul class="divide-y divide-surface">
                        @for (row of visible(); track row.id) {
                            <li class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                                <div class="min-w-0">
                                    <div class="font-medium">{{ row.sectionName }}</div>

                                    <!-- The names and amounts, not just a count.
                                         Three at most: the point is to recognise
                                         the request at a glance, not to read it
                                         in full. -->
                                    <div class="text-sm mt-0.5">
                                        {{ summary(row) }}
                                    </div>
                                    <div class="text-xs text-surface-500">
                                        {{ row.requestedBy }} · {{ when(row.requestedAt) }}
                                        @if (row.neededBy) {
                                            · <span class="font-semibold">needed by {{ row.neededBy }}</span>
                                        }
                                    </div>

                                    <!-- A request is a record of what was
                                         released and does not shrink when
                                         stock comes back. Without this line
                                         the row looks identical after a
                                         return, and the chef who just made
                                         one reasonably concludes it did
                                         nothing. -->
                                    @if (row.qtyReturnedTotal > 0) {
                                        <div class="text-xs mt-0.5 text-amber-700 dark:text-amber-400">
                                            {{ returnedSummary(row) }} went back to the store
                                        </div>
                                    }
                                    @if (row.note) {
                                        <div class="text-xs text-surface-500 italic mt-0.5">“{{ row.note }}”</div>
                                    }
                                </div>

                                <div class="flex items-center gap-2">
                                    <p-tag [severity]="tone(row.status)" [value]="label(row.status)"></p-tag>

                                    @if (row.status === 'requested' && ctx()?.canRelease) {
                                        <button pButton size="small" label="Release" (click)="startRelease(row)"></button>
                                    }
                                    @if (row.status === 'released' && row.isMine) {
                                        <button
                                            pButton
                                            size="small"
                                            severity="success"
                                            label="It came"
                                            (click)="confirm(row)"></button>
                                    }
                                    <!-- Only while something could still go
                                         back. Offering it on a request that is
                                         fully returned opens a drawer with
                                         every line capped at zero, which reads
                                         as the screen being broken. -->
                                    @if (row.canReturn && row.isMine) {
                                        <button
                                            pButton
                                            size="small"
                                            outlined
                                            icon="pi pi-reply"
                                            label="Return"
                                            (click)="startReturn(row)"></button>
                                    } @else if (row.qtyReturnedTotal > 0 && row.isMine) {
                                        <p-tag severity="warn" value="Returned"></p-tag>
                                    } @else if (returnClosed(row)) {
                                        <!-- Withholding the button silently
                                             reads as the screen being broken.
                                             It says why, and what to use
                                             instead. -->
                                        <span
                                            class="text-xs text-surface-500"
                                            [title]="
                                                'Returns close ' +
                                                returnWindowDays +
                                                ' days after the stock is released. After that, use Wastage.'
                                            ">
                                            Too old to return
                                        </span>
                                    }
                                    @if (row.status === 'requested' && row.isMine) {
                                        <button pButton size="small" text severity="danger" label="Cancel" (click)="cancel(row)"></button>
                                    }
                                </div>
                            </li>
                        }
                    </ul>
                    <app-paginator [page]="pageInfo()" (pageChange)="onPageChange($event)" />
                }
            </div>
        </div>
    `
})
export class RequestsComponent implements OnInit {
    readonly auth = inject(AuthStore);
    private api = inject(GrandService);
    private notify = inject(NotifyService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);

    readonly rows = signal<RequestRow[]>([]);
    readonly pageInfo = signal<Page<RequestRow>>(emptyPage<RequestRow>());
    readonly pageReq = signal<PageRequest>({ page: 1, limit: DEFAULT_PAGE_SIZE });
    readonly ctx = signal<MyContext | null>(null);
    readonly loading = signal(false);
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);
    readonly filter = signal<'needsMe' | 'requested' | 'released' | 'all'>('needsMe');
    readonly asking = signal(false);

    /**
     * Which section's requests to show. Null means every section this role is
     * entitled to - the kitchen's three, the cleaner's one, the storekeeper's
     * lot. Nobody sees past that: a cleaner was being handed all 796 requests at
     * the Gastrobar to find their own 18.
     */
    readonly sectionId = signal<number | null>(null);

    /**
     * "Needs me" is only offered to people who have a queue.
     *
     * Management has none: they do not release -- that is the storekeeper's
     * shelf and the storekeeper's job -- and they belong to no section, so
     * nothing is ever waiting for them to confirm it arrived. A tab that is
     * permanently empty reads as a broken screen rather than as an empty
     * queue, so it is not shown at all.
     */
    readonly hasQueue = computed(() => this.auth.role() !== 'management');

    readonly filterOptions = computed<FilterOption<'needsMe' | 'requested' | 'released' | 'all'>[]>(
        () => [
            ...(this.hasQueue()
                ? [{ value: 'needsMe' as const, label: 'Needs me' }]
                : []),
            { value: 'requested' as const, label: 'Waiting' },
            { value: 'released' as const, label: 'Released' },
            { value: 'all' as const, label: 'All' }
        ]
    );

    readonly open = signal<IssueDetail | null>(null);

    /** Lines the store cannot cover in full, for the note in the drawer. */
    readonly openShort = computed(
        () => this.open()?.lines.filter((l) => l.availableInStore < l.qtyRequested) ?? []
    );

    /**
     * Nothing on this request can actually be handed over. Either the shelf is
     * empty or the storekeeper has zeroed every line by hand; either way the
     * release would be refused, so it is not offered.
     */
    readonly nothingToGive = computed(() => {
        const detail = this.open();
        if (!detail) return false;
        const giving = this.giving();
        return detail.lines.every((l) => (giving[l.lineId] ?? 0) <= 0);
    });
    readonly openSectionName = signal('');
    readonly giving = signal<Record<string, number>>({});
    private releaseKey = uuid();

    /**
     * "All" plus one chip per section this role may look at.
     *
     * Switched-off sections are left out: a branch that has retired its bakery
     * should not be reading a Bakery chip every morning. Their old requests are
     * still there under "All", and `scopeLabel` can still name one, so a filter
     * held over from before the section closed does not break.
     */
    readonly sectionOptions = computed<FilterOption<number | null>[]>(() => {
        const allowed = this.ctx()?.mySectionIds ?? [];
        const named = this.auth
            .sections()
            .filter((s) => s.isActive && allowed.includes(s.id))
            .map((s) => ({ value: s.id as number | null, label: s.name }));
        return [{ value: null, label: 'All' }, ...named];
    });

    readonly scopeLabel = computed(() => {
        const id = this.sectionId();
        if (id === null) {
            return this.sectionOptions().length > 2 ? 'all your sections' : 'your section';
        }
        return this.auth.sections().find((s) => s.id === id)?.name ?? 'one section';
    });

    readonly canAsk = computed(() => {
        const role = this.auth.role();
        return role === 'kitchen' || role === 'cleaning' || role === 'management';
    });

    /** The two roles the server lets raise a purchase. */
    readonly canRaisePurchase = computed(() => {
        const role = this.auth.role();
        return role === 'management' || role === 'storekeeper';
    });

    /**
     * The filter is applied by the server now, so a page of results and the
     * count under it describe the same set. Filtering the fetched rows here
     * would have searched only whatever page happened to be open.
     */
    readonly visible = computed(() => this.rows());

    async ngOnInit(): Promise<void> {
        try {
            this.ctx.set(await this.api.myContext());
        } catch {
            /* the list still works without it */
        }

        // Management lands on the whole list, because they have no queue of
        // their own to land on.
        if (!this.hasQueue()) this.filter.set('all');

        // ?ask=1 opens the drawer straight away - how the Home tile and the old
        // /ask link both arrive here.
        if (this.route.snapshot.queryParamMap.get('ask') !== null) {
            this.asking.set(true);
        }

        await this.load();

        // Land on whatever actually has something in it, rather than an empty
        // "Needs me" that reads as broken. Goes through setFilter so the list is
        // refetched, not just relabelled.
        if (this.rows().length === 0 && this.filter() === 'needsMe') this.setFilter('all');
    }

    /** The drawer reported a request went through: close it and show the new row. */
    async onAsked(): Promise<void> {
        this.asking.set(false);
        await this.load();
    }

    async load(): Promise<void> {
        this.loading.set(true);
        try {
            const f = this.filter();
            const page = await this.api.listRequests({
                ...this.pageReq(),
                sectionId: this.sectionId() ?? undefined,
                // With no section chosen, still never reach past this role's own.
                mineOnly: this.sectionId() === null ? true : undefined,
                needsMe: f === 'needsMe' || undefined,
                status: f === 'requested' || f === 'released' ? f : undefined
            });
            this.pageInfo.set(page);
            this.rows.set(page.items);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    /** The drawer's own X, its mask and Escape all route through here. */
    onReleaseClosed(visible: boolean): void {
        if (!visible) this.open.set(null);
    }

    /**
     * "Bleach 2 L, Floor cleaner 1 L" rather than "2 item(s)".
     *
     * Once released, the amount that matters is what was actually handed over,
     * so a line that was short shows both - the person confirming needs to know
     * they are receiving less than they asked for.
     */
    summary(row: RequestRow): string {
        const shown = row.lines.slice(0, 3).map((line) => {
            const asked = formatQty(line.qtyRequested, line.stockUnit);
            const gave =
                line.qtyIssued !== null && line.qtyIssued !== line.qtyRequested
                    ? ` → gave ${formatQty(line.qtyIssued, line.stockUnit)}`
                    : '';
            return `${line.name} ${asked}${gave}`;
        });
        const rest = row.lines.length - shown.length;
        if (rest > 0) shown.push(`and ${rest} more`);
        return shown.join(' · ') || `${row.lineCount} item(s)`;
    }

    setSection(id: number | null): void {
        if (this.sectionId() === id) return;
        this.sectionId.set(id);
        this.pageReq.update((p) => ({ ...p, page: 1 }));
        void this.load();
    }

    setFilter(f: 'needsMe' | 'requested' | 'released' | 'all'): void {
        this.filter.set(f);
        // Back to page one: page 4 of the old filter is meaningless in the new.
        this.pageReq.update((p) => ({ ...p, page: 1 }));
        void this.load();
    }

    onPageChange(e: PageChange): void {
        this.pageReq.set(e);
        void this.load();
    }

    label(status: string): string {
        return (
            { requested: 'Waiting', released: 'Released', received: 'Done', cancelled: 'Cancelled' }[
                status
            ] ?? status
        );
    }

    tone(status: string): 'success' | 'warn' | 'info' | 'danger' | 'secondary' {
        return status === 'received'
            ? 'success'
            : status === 'released'
              ? 'info'
              : status === 'cancelled'
                ? 'danger'
                : 'warn';
    }

    async startRelease(row: RequestRow): Promise<void> {
        this.releaseKey = uuid();
        this.openSectionName.set(row.sectionName);
        try {
            const detail = await this.api.getRequest(row.id);
            this.open.set(detail);
            // Prefill with what they asked for, capped at what is actually
            // there - the sensible answer, still editable.
            const seed: Record<string, number> = {};
            for (const line of detail.lines) {
                seed[line.lineId] = Math.min(line.qtyRequested, Math.max(0, line.availableInStore));
            }
            this.giving.set(seed);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        }
    }

    setGiving(lineId: string, qty: number | null): void {
        this.giving.update((m) => ({ ...m, [lineId]: qty ?? 0 }));
    }

    async doRelease(detail: IssueDetail): Promise<void> {
        this.busy.set(true);
        try {
            const result = await this.api.releaseRequest(
                detail.id,
                detail.lines.map((l) => ({ lineId: l.lineId, qtyIssued: this.giving()[l.lineId] ?? 0 })),
                this.releaseKey
            );

            for (const s of result.shortfalls) {
                this.notify.warning(
                    `${s.itemName}: gave ${s.released} of ${s.requested} - only ${s.available} in the store.`
                );
            }
            if (result.shortfalls.length === 0) {
                this.notify.success('Released');
            }

            this.open.set(null);
            this.releaseKey = uuid();
            await this.load();

            // The kitchen cannot raise a purchase, and should not: they cannot
            // see the shelf. The person who just watched it come up short can,
            // so the offer is made here, once, while it is still in mind --
            // otherwise the shortfall is a toast that scrolls away and nobody
            // ever buys the thing.
            if (result.shortfalls.length > 0 && this.canRaisePurchase()) {
                const yes = await this.notify.confirm(
                    'The store could not cover all of this. Raise a purchase for what was short?',
                    'Buy the rest?',
                    'Raise a purchase'
                );
                if (yes) {
                    void this.router.navigate(['/purchases'], {
                        queryParams: { issue: detail.id }
                    });
                }
            }
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    /**
     * Take the shortfall to Purchases.
     *
     * Purchases reads `?issue=` and pre-fills the order with whatever is still
     * outstanding on that request, so nothing is keyed twice and the order
     * stays tied to the ask it came from. The drawer closes: the storekeeper is
     * going somewhere else, and leaving it open behind them is one more thing
     * to shut.
     */
    orderShortfall(detail: IssueDetail): void {
        this.open.set(null);
        void this.router.navigate(['/purchases'], { queryParams: { issue: detail.id } });
    }

    async confirm(row: RequestRow): Promise<void> {
        try {
            await this.api.confirmReceived(row.id);
            this.notify.success('Thanks - marked as arrived');
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    async cancel(row: RequestRow): Promise<void> {
        const ok = await this.notify.confirm('Cancel this request?', 'Cancel');
        if (!ok) return;
        try {
            await this.api.cancelRequest(row.id);
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
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

    // ── Returning ───────────────────────────────────────────────────────────
    //
    // Driven off the request, not off the item master. What can go back is what
    // was released on this request, less what has gone back already, capped by
    // what the section still holds -- and the server checks all three again.
    readonly returning = signal<RequestRow | null>(null);
    readonly returnLines = signal<IssueReturnableLine[]>([]);
    readonly returnDetail = signal<IssueReturnable | null>(null);
    readonly returnQty = signal<Record<number, number>>({});
    readonly returnReason = signal<string | null>(null);
    readonly returnNote = signal('');
    readonly returnReasons = signal<ReasonCode[]>([]);
    readonly returnLoading = signal(false);

    readonly returnCount = computed(
        () => Object.values(this.returnQty()).filter((v) => v > 0).length
    );

    readonly canReturn = computed(() => this.returnCount() > 0 && !!this.returnReason());

    readonly returnWindowClosed = computed(() => this.returnDetail()?.withinWindow === false);

    async startReturn(row: RequestRow): Promise<void> {
        this.returning.set(row);
        this.returnDetail.set(null);
        this.returnLines.set([]);
        this.returnQty.set({});
        this.returnReason.set(null);
        this.returnNote.set('');
        this.returnLoading.set(true);
        try {
            const [detail, reasons] = await Promise.all([
                this.api.issueReturnable(row.id),
                this.returnReasons().length
                    ? Promise.resolve(this.returnReasons())
                    : this.api.reasonCodes('return')
            ]);
            this.returnDetail.set(detail);
            this.returnLines.set(detail.lines);
            this.returnReasons.set(reasons);
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
            this.returning.set(null);
        } finally {
            this.returnLoading.set(false);
        }
    }

    readonly returnWindowDays = RETURN_WINDOW_DAYS;

    /**
     * The window has closed on a request that still holds returnable stock.
     *
     * Distinguished from "nothing left to return" so the row can say which it
     * is. A fully returned request reads Returned; an old one reads too old.
     */
    returnClosed(row: RequestRow): boolean {
        return (
            row.isMine &&
            (row.status === 'released' || row.status === 'received') &&
            row.qtyReturnedTotal === 0 &&
            !row.canReturn &&
            row.daysSinceReleased !== null &&
            row.daysSinceReleased > RETURN_WINDOW_DAYS
        );
    }

    /**
     * What went back, named rather than totalled.
     *
     * "200 g went back" is useful; "200 went back" across three different units
     * is not, so each line is formatted in its own unit and at most two are
     * named before it falls back to a count.
     */
    returnedSummary(row: RequestRow): string {
        const returned = row.lines.filter((l) => l.qtyReturned > 0);
        if (returned.length === 0) return '';
        if (returned.length <= 2) {
            return returned
                .map((l) => `${l.name} ${formatQty(l.qtyReturned, l.stockUnit)}`)
                .join(' and ');
        }
        return `${returned.length} items`;
    }

    onReturnClosed(visible: boolean): void {
        if (!visible) this.returning.set(null);
    }

    setReturnQty(itemId: number, value: number | null): void {
        this.returnQty.update((all) => {
            const next = { ...all };
            if (value === null || value <= 0) delete next[itemId];
            else next[itemId] = value;
            return next;
        });
    }

    /**
     * One call per line, because one return document is one item.
     *
     * A partial failure is reported rather than swallowed: if three lines go
     * back and the fourth is refused, the three that moved really did move, and
     * saying "returned" flatly would leave somebody hunting for a crate that is
     * still in the kitchen.
     */
    async submitReturn(): Promise<void> {
        const row = this.returning();
        if (!row || !this.canReturn()) return;
        this.busy.set(true);
        const entries = Object.entries(this.returnQty()).filter(([, v]) => v > 0);
        let sent = 0;
        const failed: string[] = [];

        for (const [itemId, qtyBase] of entries) {
            try {
                await this.api.returnToStore({
                    sectionId: this.returning()!.sectionId,
                    itemId: Number(itemId),
                    qtyBase,
                    reasonCode: this.returnReason()!,
                    note: this.returnNote() || null,
                    issueId: row.id
                });
                sent++;
            } catch (err) {
                const name =
                    this.returnLines().find((l) => l.itemId === Number(itemId))?.name ??
                    `item ${itemId}`;
                failed.push(`${name}: ${apiErrorMessage(err)}`);
            }
        }

        this.busy.set(false);

        if (sent > 0) {
            this.notify.success(
                sent === 1 ? 'Returned to the store' : `${sent} items returned to the store`
            );
        }
        if (failed.length > 0) {
            this.error.set(failed.join(' · '));
            // Re-read, so the drawer shows what actually went back.
            await this.startReturn(row);
        } else {
            this.returning.set(null);
        }
        await this.load();
    }
}
