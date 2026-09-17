/**
 * Ask for stock.
 *
 * The screen a cleaner or a cook uses, so it asks three things and nothing
 * more: what, how much, and when you need it. No section picker - it is
 * theirs. No units to choose - the item decides.
 *
 * If the store is short, it says so before you send. Finding out two days
 * later that there was never any lettuce is the thing that makes people stop
 * using a system and start shouting down a corridor instead.
 *
 * Turning that shortfall into a purchase is a separate job, and only the two
 * roles the server lets buy are offered it. A cook asking for 11 kg of
 * something was raising a purchase order in the same click, and the server --
 * rightly -- refused it: the request went in, the purchase 403'd, and the form
 * showed a red "this action needs one of: management, storekeeper" over a
 * request that had in fact been sent. People pressed Send again. Three
 * identical requests later the storekeeper had a mess to sort out. Kitchen and
 * cleaning now send a request and nothing else; the storekeeper sees the
 * shortfall when they come to release it, and buys from there.
 */
import { Component, computed, inject, input, output, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { AuthStore } from '@/core/auth.store';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import { formatQty } from '@/core/format';
import type { Item, Shortage } from '@/core/types';
import { AppItemPicker } from '@/shared/item-picker.component';

interface Line {
    itemId: number | null;
    qty: number | null;
}

@Component({
    selector: 'app-ask',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        InputNumberModule,
        InputTextModule,
        AppItemPicker
    ],
    template: `
        <div class="space-y-6">
            <!-- In the drawer the panel header already says "Ask for stock". -->
            @if (!embedded()) {
                <div>
                    <h1 class="text-2xl font-bold">Ask for stock</h1>
                    <p class="text-surface-500 text-sm">
                        The store will see this and hand it over
                    </p>
                </div>
            }

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-4 md:p-6 space-y-4">
                <!-- Every item, every time, with the ones this section
                     actually uses at the top.

                     This used to be a filter with a "Show all items" button
                     beside it, and a kitchen whose opening balance held one
                     product could see exactly that one product. Everything else
                     existed, was askable, and was behind a button nobody had a
                     reason to press. Ordering solves what hiding was trying to
                     solve, and nothing goes missing. -->
                <div class="pb-1">
                    <span class="text-sm text-surface-500">
                        {{ items().length }} item(s) to choose from
                        @if (mineItems().length > 0) {
                            · {{ mineItems().length }} your section already uses
                        }
                    </span>
                </div>

                @if (items().length === 0) {
                    <p class="text-sm text-surface-500">
                        There are no products yet. An admin adds them under
                        <strong>Products</strong>.
                    </p>
                }

                @for (line of lines(); track $index; let i = $index) {
                    <!-- A grid, not wrapping flex. As flex, the quantity field
                         would not shrink below the intrinsic width of its input
                         (min-width:auto on a flex item), so with a single line
                         it pushed out past the edge of the drawer instead of
                         wrapping. Fixed tracks make the width deterministic. -->
                    <div
                        class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_9rem_2.5rem] items-end gap-3 pb-3 border-b border-surface last:border-0">
                        <div class="min-w-0">
                            <!-- Type a few letters rather than scroll a hundred
                                 lines. The items this section actually uses
                                 still sort to the top, which is what the
                                 optgroup was for; nothing is hidden. -->
                            <app-item-picker
                                label="What do you need?"
                                [required]="true"
                                [items]="items()"
                                [priority]="mineIdList()"
                                [value]="line.itemId"
                                (valueChange)="setItem(i, $event)" />
                        </div>

                        <div class="min-w-0">
                            <label class="block text-sm font-medium mb-1 app-req">
                                How much? <span class="text-surface-500">{{ unitFor(line.itemId) }}</span>
                            </label>
                            <p-inputNumber
                                styleClass="w-full"
                                inputStyleClass="w-full py-3 text-base"
                                [ngModel]="line.qty"
                                (ngModelChange)="setQty(i, $event)"
                                [min]="0"
                                [maxFractionDigits]="3"></p-inputNumber>
                        </div>

                        <!-- The column is held open even on a single line, so the
                             two fields do not resize the moment a second line
                             appears. -->
                        <div class="min-w-0">
                            @if (lines().length > 1) {
                                <button
                                    pButton
                                    text
                                    severity="danger"
                                    icon="pi pi-trash"
                                    [attr.aria-label]="'Remove line ' + (i + 1)"
                                    (click)="removeLine(i)"></button>
                            }
                        </div>
                    </div>
                }

                <button pButton outlined icon="pi pi-plus" label="Add another item" (click)="addLine()"></button>
            </div>

            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 p-4 md:p-6 space-y-4">
                <div>
                    <label class="block text-sm font-medium mb-1">When do you need it?</label>
                    <input
                        type="date"
                        class="w-full md:w-64 px-3 py-3 text-base rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                        [ngModel]="neededBy()"
                        (ngModelChange)="neededBy.set($event)" />
                </div>
                <div>
                    <label class="block text-sm font-medium mb-1">Anything to add? (optional)</label>
                    <input
                        pInputText
                        class="w-full"
                        placeholder="e.g. for Saturday function"
                        [ngModel]="note()"
                        (ngModelChange)="note.set($event)" />
                </div>
            </div>

            @if (shortages().length > 0) {
                <div class="app-note app-note--warn space-y-3">
                    <div class="app-note__title">
                        The store does not have enough
                    </div>
                    <ul class="text-sm space-y-1">
                        @for (s of shortages(); track s.itemId) {
                            <li>
                                <strong>{{ s.name }}</strong> - you asked for
                                {{ q(s.requested, s.stockUnit) }}, the store has
                                {{ q(s.inStore, s.stockUnit) }}.
                                Short by {{ q(s.short, s.stockUnit) }}.
                                @if (s.packName && s.shortPacks > 0) {
                                    <span class="text-surface-500">
                                        Buying {{ s.shortPacks }} × {{ s.packName }} covers it.
                                    </span>
                                } @else {
                                    <span class="text-surface-500">
                                        No pack size is set up for this, so it cannot be ordered
                                        yet.
                                    </span>
                                }
                            </li>
                        }
                    </ul>
                    @if (canRaisePurchase()) {
                        <p class="text-sm">
                            You can still send the request - the store will give you what they have.
                            Ask management to buy the rest as well?
                        </p>
                        <div class="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="raisePo"
                                class="w-5 h-5"
                                [checked]="raisePo()"
                                (change)="raisePo.set(!raisePo())" />
                            <label for="raisePo" class="text-sm font-medium">
                                Yes, ask management to buy the shortfall
                            </label>
                        </div>
                    } @else {
                        <!-- Buying is not this person's job and the server will
                             not let them do it. Saying what happens next is the
                             useful part: the request still goes in, and the
                             shortfall is somebody's to act on. -->
                        <p class="text-sm">
                            Send it anyway - the store will give you what they have, and the
                            storekeeper sees what was short and orders the rest.
                        </p>
                    }
                </div>
            }

            <div class="flex flex-wrap justify-end gap-3">
                <button pButton outlined label="Check the store" [disabled]="!canSubmit() || busy()" (click)="check()"></button>
                <button
                    pButton
                    label="Send request"
                    icon="pi pi-send"
                    size="large"
                    [disabled]="!canSubmit() || busy()"
                    [loading]="busy()"
                    (click)="submit()"></button>
            </div>
        </div>
    `
})
export class AskComponent implements OnInit {
    /**
     * Set when Requests hosts this form in its right-hand drawer. The screen is
     * then a panel inside a page rather than a page of its own: it drops its own
     * heading, and on success it reports back instead of navigating, so the
     * request list the person was already reading stays where it was.
     */
    readonly embedded = input(false);
    readonly sent = output<void>();

    private auth = inject(AuthStore);
    private api = inject(GrandService);
    private notify = inject(NotifyService);
    private router = inject(Router);

/**
     * The two roles the server lets raise a purchase. Kept in step with
     * `assertCanRaise` on the API: offering a button that is going to come back
     * 403 is worse than not offering it, because the action it was attached to
     * has already happened by then.
     */
    readonly canRaisePurchase = computed(() => {
        const role = this.auth.role();
        return role === 'management' || role === 'storekeeper';
    });

    readonly items = signal<Item[]>([]);
    /**
     * Ids this section has handled before, used to sort the picker rather than
     * to filter it. A section that has only ever been issued one thing must
     * still be able to ask for the other ninety-nine.
     */
    readonly mineIds = signal<ReadonlySet<number>>(new Set());
    readonly lines = signal<Line[]>([{ itemId: null, qty: null }]);
    readonly neededBy = signal(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
    readonly note = signal('');
    readonly shortages = signal<Shortage[]>([]);
    readonly raisePo = signal(this.canRaisePurchase());
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);

    /** Things this section has had before - offered first. */
    readonly mineItems = computed(() => {
        const mine = this.mineIds();
        return this.items().filter((i) => mine.has(i.id));
    });

    /** The same set, as the id list the picker sorts on. */
    readonly mineIdList = computed(() => [...this.mineIds()]);

    readonly canSubmit = computed(() =>
        this.lines().some((l) => l.itemId !== null && (l.qty ?? 0) > 0)
    );


    async ngOnInit(): Promise<void> {
        try {
            // Both lists: the whole master to choose from, and this section's
            // own history to order it by. The second is allowed to fail quietly
            // -- an unsorted picker is a small loss, an empty one is not.
            const [all, mine] = await Promise.all([
                this.api.listItems(),
                this.api.listItems({ mySection: true }).catch(() => [])
            ]);
            this.items.set(all);
            this.mineIds.set(new Set(mine.map((i) => i.id)));
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        }
    }

    resetForm(): void {
        this.lines.set([{ itemId: null, qty: null }]);
        this.neededBy.set(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
        this.note.set('');
        this.shortages.set([]);
        this.raisePo.set(this.canRaisePurchase());
        this.error.set(null);
    }

    addLine(): void {
        this.lines.update((ls) => [...ls, { itemId: null, qty: null }]);
    }

    removeLine(i: number): void {
        this.lines.update((ls) => ls.filter((_, idx) => idx !== i));
    }

    setItem(i: number, itemId: number | null): void {
        this.lines.update((ls) => ls.map((l, idx) => (idx === i ? { ...l, itemId } : l)));
        this.shortages.set([]);
    }

    setQty(i: number, qty: number | null): void {
        this.lines.update((ls) => ls.map((l, idx) => (idx === i ? { ...l, qty } : l)));
        this.shortages.set([]);
    }

    unitFor(itemId: number | null): string {
        if (itemId === null) return '';
        const item = this.items().find((i) => i.id === itemId);
        return item ? `(${item.stockUnit})` : '';
    }

    q(qty: number, unit: string): string {
        return formatQty(qty, unit);
    }

    private payloadLines() {
        return this.lines()
            .filter((l) => l.itemId !== null && (l.qty ?? 0) > 0)
            .map((l) => ({ itemId: l.itemId!, qtyRequested: l.qty! }));
    }

    async check(): Promise<void> {
        this.busy.set(true);
        try {
            const res = await this.api.checkStore(this.payloadLines());
            this.shortages.set(res.shortages);
            if (res.shortages.length === 0) {
                this.notify.success('The store has everything you asked for');
            }
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    async submit(): Promise<void> {
        if (!this.canSubmit()) return;
        this.busy.set(true);
        this.error.set(null);

        try {
            const lines = this.payloadLines();
            const result = await this.api.ask({
                neededBy: this.neededBy() || null,
                note: this.note() || null,
                lines
            });

            // Raise the purchase in the same action, so a storekeeper does not
            // have to know that "the store is short" and "somebody must buy
            // some" are two different screens. Only for the roles allowed to
            // buy -- for everyone else the request is the whole job.
            const alsoBuying =
                result.shortages.length > 0 && this.raisePo() && this.canRaisePurchase();

            if (alsoBuying) {
                // Deliberately not fatal. The request is already in the
                // database by this point, so a purchase that fails must not be
                // reported as a request that failed: that is what had people
                // pressing Send three times and the storekeeper receiving three
                // copies of the same ask.
                try {
                    await this.api.raisePurchaseOrder({
                        issueId: result.id,
                        neededBy: this.neededBy() || null,
                        reason: this.note() || 'Store did not have enough',
                        // Ordered in packs. Anything with no pack set up is left
                        // off rather than silently rounded into something else --
                        // it cannot be bought until the admin gives it a pack.
                        lines: result.shortages
                            .filter((s) => s.itemPackId !== null && s.shortPacks > 0)
                            .map((s) => ({ itemPackId: s.itemPackId!, qtyPacks: s.shortPacks }))
                    });
                    this.notify.success('Request sent, and management asked to buy the rest');
                } catch (err) {
                    this.notify.warning(
                        `Request sent. The purchase could not be raised: ${apiErrorMessage(err)}`
                    );
                }
            } else {
                this.notify.success('Request sent to the store');
            }

            if (this.embedded()) {
                this.resetForm();
                this.sent.emit();
            } else {
                await this.router.navigate(['/requests']);
            }
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }
}
