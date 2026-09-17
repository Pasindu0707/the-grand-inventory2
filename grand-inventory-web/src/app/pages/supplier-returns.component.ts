/**
 * Sending stock back to the supplier.
 *
 * The screen is built around the delivery rather than around the item, and that
 * is the whole design. Pick the invoice it came in on, and the pack, the
 * conversion and the price paid all come with it - so the credit is priced from
 * what was actually invoiced rather than from today's price list, and nobody
 * has to remember what a sack cost six weeks ago.
 *
 * **One question, answered line by line (CR-006).** The store does not raise a
 * claim and hope; it asks management *what do we do with this?* and management
 * answers each line either "back to the supplier" or "into the bin". That
 * answer is the only approval in the chain - the separate hand-back approval
 * went with it - and it is what makes the common case, the supplier refusing
 * to take something back, a decision somebody signed rather than a wastage
 * entry made quietly against the quarantine shelf.
 *
 * The lifecycle is deliberately visible: asked, decided, gone, settled. Each of
 * those is a different person doing a different thing, and collapsing them
 * would lose the two facts worth having - what management said, and whether
 * the money ever came back.
 *
 * Stock leaves quarantine on **send** and at no other point. Raising a return
 * is paperwork; the crate is still in the building and the stock figure says
 * so.
 *
 * **Two people, two screens, one list.** The storekeeper writes the return up
 * and later says the lorry has taken it; management approves it and records
 * what the supplier allowed. The server enforces that split, so the screen
 * shows each of them only their own half: management gets no delivery form and
 * no "it has gone" button, and the storekeeper gets no approve and no credit
 * note. Both see the same list, because both need to know where a return has
 * got to - which is the question this screen exists to answer.
 *
 * The four states are spelled out at the top for the same reason. "Approved,
 * not yet sent" means nothing until you know that sending is a separate act by
 * a different person, and that the stock has not moved yet.
 */
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { DrawerModule } from 'primeng/drawer';
import { TagModule } from 'primeng/tag';
import { AuthStore } from '@/core/auth.store';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import { formatMoney, formatQty } from '@/core/format';
import {
    SUPPLIER_RETURN_OUTCOME_LABELS,
    SUPPLIER_RETURN_STATUS_LABELS,
    type GrnListRow,
    type ReasonCode,
    type ReturnableLine,
    type DisposalDecision,
    type SuggestedReturn,
    type SupplierReturnOutcome,
    type SupplierReturnRow
} from '@/core/types';
import { DEFAULT_PAGE_SIZE, emptyPage, type Page, type PageRequest } from '@/core/types';
import { AppPaginator, type PageChange } from '@/shared/paginator.component';

@Component({
    selector: 'app-supplier-returns',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        InputNumberModule,
        InputTextModule,
        TagModule,
        DrawerModule,
        AppPaginator
    ],
    template: `
        <div class="space-y-8">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold">Supplier returns</h1>
                    <p class="text-surface-500 text-sm">
                        Goods going back to whoever delivered them, and what came of it
                    </p>
                </div>
                @if (canRaiseReturn()) {
                    <button
                        pButton
                        outlined
                        icon="pi pi-plus"
                        label="Ask about something else"
                        (click)="openRaise()"></button>
                }
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <!-- How one of these works, for both roles, because the status
                 labels do not mean much on their own. Four steps, who does
                 each, and the one that moves stock. -->
            <ol class="app-flow">
                @for (stage of FLOW; track stage.key) {
                    <li class="app-flow__step">
                        <span class="app-flow__label">{{ stage.label }}</span>
                        <span class="app-flow__who">{{ stage.who }}</span>
                        <span class="app-flow__what">{{ stage.what }}</span>
                    </li>
                }
            </ol>

            @if (canRaiseReturn()) {
                <!-- The storekeeper's half, said as plainly as management's.
                     Both roles open this screen and see most of the same list,
                     so each needs telling which parts of it are theirs --
                     otherwise the buttons that are missing read as broken
                     rather than as somebody else's job. -->
                <div class="app-note">
                    <div class="app-note__title">Your part in this</div>
                    <p class="mt-1">
                        You ask the question and you carry out the answer. Write up what is in
                        quarantine against the delivery it came in on, then
                        <strong>management decides each line</strong> - back to the supplier, or
                        into the bin. After that it is one button: <strong>It has gone</strong>
                        when the lorry takes it, or <strong>Bin them</strong> for the lines they
                        said to throw away. Until then the goods stay on your quarantine shelf
                        and still count as ours.
                    </p>
                </div>
            }

            @if (!canRaiseReturn()) {
                <!-- Management's half, said plainly. They arrive here from
                     Returns or because something is waiting, and what they can
                     do is narrower than what the screen shows. -->
                <div class="app-note">
                    <div class="app-note__title">Your part in this</div>
                    <p class="mt-1">
                        The store asks, you answer: for each line,
                        <strong>back to the supplier</strong> or <strong>into the bin</strong>.
                        Both are money - one claims a credit, the other writes the value off -
                        which is why it waits for you. The store then carries it out, and you
                        record what the supplier actually allowed on anything that went back.
                        <strong>Until you answer, nothing leaves the building.</strong>
                    </p>
                </div>

                @if (awaitingDecision().length > 0) {
                    <div
                        class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                        <div class="px-5 py-4 border-b border-surface">
                            <div class="font-semibold">Waiting for your decision</div>
                            <p class="text-sm text-surface-500 mt-0.5">
                                {{ awaitingDecision().length }} ask(s), worth
                                {{ money(awaitingValue()) }} if it all goes back, sitting in
                                quarantine until you answer.
                            </p>
                        </div>
                        <ul class="divide-y divide-surface">
                            @for (row of awaitingDecision(); track row.id) {
                                <li class="px-5 py-4 space-y-3">
                                    <div class="flex flex-wrap items-start justify-between gap-3">
                                        <div class="min-w-0">
                                            <div class="font-medium">
                                                {{ row.supplierName }} ·
                                                {{ row.invoiceNo || 'no invoice' }}
                                            </div>
                                            <div class="text-xs text-surface-500">
                                                {{ row.reasonLabel }} · asked by
                                                {{ row.raisedBy }} · {{ when(row.raisedAt) }}
                                            </div>
                                            @if (row.note) {
                                                <div class="text-xs text-surface-500 mt-1">
                                                    “{{ row.note }}”
                                                </div>
                                            }
                                        </div>
                                        <div class="text-right">
                                            <div class="font-semibold">
                                                {{ money(row.expectedCredit) }}
                                            </div>
                                            <div class="text-xs text-surface-500">
                                                if it all goes back
                                            </div>
                                        </div>
                                    </div>

                                    <!-- One answer per line. Both buttons are
                                         money: one claims a credit, the other
                                         writes the value off, so neither is the
                                         safe default and neither is preselected. -->
                                    <ul class="rounded-xl border border-surface divide-y divide-surface">
                                        @for (line of row.lines; track line.id) {
                                            <li
                                                class="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                                                <div class="min-w-0">
                                                    <div class="text-sm font-medium">
                                                        {{ line.itemName }}
                                                    </div>
                                                    <div class="text-xs text-surface-500">
                                                        {{ line.qtyPacks }} × {{ line.packName }}
                                                        · worth {{ money(line.lineCredit) }}
                                                    </div>
                                                </div>
                                                <div class="app-choice" role="group">
                                                    <button
                                                        type="button"
                                                        class="app-choice__option"
                                                        [class.app-choice__option--on]="
                                                            answerFor(row.id, line.id) === 'vendor'
                                                        "
                                                        (click)="answer(row.id, line.id, 'vendor')">
                                                        <i class="pi pi-undo" aria-hidden="true"></i>
                                                        Send it back
                                                    </button>
                                                    <button
                                                        type="button"
                                                        class="app-choice__option app-choice__option--bin"
                                                        [class.app-choice__option--on]="
                                                            answerFor(row.id, line.id) === 'waste'
                                                        "
                                                        (click)="answer(row.id, line.id, 'waste')">
                                                        <i class="pi pi-trash" aria-hidden="true"></i>
                                                        Bin it
                                                    </button>
                                                </div>
                                            </li>
                                        }
                                    </ul>

                                    <div class="flex flex-wrap items-center justify-between gap-3">
                                        <span class="text-sm text-surface-500">
                                            @if (unanswered(row); as left) {
                                                {{ left }} line(s) still to answer
                                            } @else {
                                                Claiming {{ money(claimTotal(row)) }} ·
                                                binning {{ money(binTotal(row)) }}
                                            }
                                        </span>
                                        <button
                                            pButton
                                            size="small"
                                            icon="pi pi-check"
                                            label="Save the decision"
                                            [disabled]="unanswered(row) > 0 || busy()"
                                            (click)="saveDecision(row)"></button>
                                    </div>
                                </li>
                            }
                        </ul>
                    </div>
                }
            }

            <!-- Ready to send back.
                 The screen used to open on an empty form, so pressing "send it
                 back to the supplier" on the Returns screen landed the
                 storekeeper here with nothing filled in and asked them to
                 reconstruct from memory what is already in the database: which
                 delivery, which reason, how many packs. This panel is that
                 work already done. -->
            @if (canRaiseReturn() && suggestions().length > 0) {
                <div
                    class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                    <div class="px-5 py-4 border-b border-surface">
                        <div class="font-semibold">Ready to send back</div>
                        <p class="text-sm text-surface-500 mt-1">
                            Worked out from what is in quarantine. Check the delivery is the right
                            one - nothing in the ledger ties a crate to the invoice it arrived on,
                            so this is the most recent delivery of that item that still has packs
                            left to return.
                        </p>
                    </div>
                    <ul class="divide-y divide-surface">
                        @for (sug of suggestions(); track sug.grnId) {
                            <li class="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <div class="font-medium">
                                        {{ sug.supplierName }} ·
                                        {{ sug.invoiceNo || 'no invoice' }}
                                    </div>
                                    <div class="text-xs text-surface-500">
                                        delivered {{ onlyDate(sug.receivedAt) }}
                                        @if (sug.reasonLabel) {
                                            · {{ sug.reasonLabel }}
                                        }
                                    </div>
                                    <div class="text-sm mt-1">
                                        @for (l of sug.lines; track l.grnLineId) {
                                            <span class="mr-3">
                                                {{ l.itemName }} {{ l.suggestedPacks }} ×
                                                {{ l.packName }}
                                            </span>
                                        }
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div class="font-semibold">{{ money(sug.totalCredit) }}</div>
                                    <button
                                        pButton
                                        size="small"
                                        class="mt-2"
                                        icon="pi pi-check"
                                        label="Use this"
                                        [disabled]="busy()"
                                        (click)="useSuggestion(sug)"></button>
                                </div>
                            </li>
                        }
                    </ul>
                </div>
            }

            <!-- ── The ask ─────────────────────────────────────────────────
                 A drawer, not a panel on the page.

                 It used to sit permanently under the suggestions, so pressing
                 "Use this" filled in a form somewhere below the fold and the
                 screen gave no sign anything had happened. A form that is only
                 needed once you have decided to raise something has no business
                 being the tallest thing on a screen you mostly come to read.

                 The storekeeper's, and only theirs: the server refuses an ask
                 raised by anybody else, so showing the form to management would
                 be a 403 at the end of a filled-in table. -->
            <p-drawer
                [visible]="raising()"
                (visibleChange)="onRaiseVisible($event)"
                position="right"
                header="Ask management what to do"
                styleClass="!w-full sm:!w-[46rem]">
                <div class="space-y-5">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium mb-1 app-req">
                            Which delivery did it come in on?
                        </label>
                        <select
                            class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                            [ngModel]="grnId()"
                            (ngModelChange)="pickGrn($event)">
                            <option [ngValue]="null">Choose a delivery…</option>
                            @for (g of deliveries(); track g.id) {
                                <option [ngValue]="g.id">
                                    {{ g.supplierName }} · {{ g.invoiceNo || 'no invoice' }} ·
                                    {{ onlyDate(g.receivedAt) }}
                                </option>
                            }
                        </select>
                        <p class="text-xs text-surface-500 mt-1">
                            The price on that invoice is what the credit is worked out from.
                        </p>
                    </div>

                    <div>
                        <label class="block text-sm font-medium mb-1 app-req">
                            What is wrong with it
                        </label>
                        <select
                            class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                            [ngModel]="reasonCode()"
                            (ngModelChange)="reasonCode.set($event)">
                            <option [ngValue]="null">Choose…</option>
                            @for (r of reasons(); track r.code) {
                                <option [ngValue]="r.code">{{ r.label }}</option>
                            }
                        </select>
                    </div>
                </div>

                @if (grnId()) {
                    @if (linesLoading()) {
                        <p class="text-surface-500 text-sm">Loading the delivery…</p>
                    } @else if (lines().length === 0) {
                        <p class="text-surface-500 text-sm">That delivery has no lines.</p>
                    } @else if (quarantinedLines().length === 0) {
                        <!-- The delivery is real, but none of it is on the
                             quarantine shelf, so there is nothing to claim for.
                             Saying which is more use than an empty table. -->
                        <div class="app-note app-note--warn">
                            <div class="app-note__title">Nothing from this delivery is in quarantine</div>
                            <p class="mt-1">
                                You can only claim for goods that are physically on the quarantine
                                shelf. Stock the kitchen has not handed back yet, or that is still
                                on the store's own shelf, has to be returned to the store first -
                                then it appears here.
                            </p>
                        </div>
                    } @else {
                        <div class="overflow-x-auto">
                            <table class="w-full text-sm">
                                <thead class="text-left text-surface-500">
                                    <tr class="border-b border-surface">
                                        <th class="py-2 pr-3">Item</th>
                                        <th class="py-2 pr-3">Pack</th>
                                        <th class="py-2 pr-3 text-right">Delivered</th>
                                        <th class="py-2 pr-3 text-right">Already back</th>
                                        <th class="py-2 pr-3 text-right">In quarantine</th>
                                        <th class="py-2 pr-3 text-right">
                                            Send back
                                            <span class="block text-xs font-normal">
                                                in packs
                                            </span>
                                        </th>
                                        <th class="py-2 text-right">Credit</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    @for (l of quarantinedLines(); track l.grnLineId) {
                                        <tr
                                            class="border-b border-surface"
                                            [class.opacity-60]="fullyClaimed(l)">
                                            <td class="py-2 pr-3">{{ l.itemName }}</td>
                                            <td class="py-2 pr-3 text-surface-500">
                                                {{ l.packName }}
                                            </td>
                                            <td class="py-2 pr-3 text-right">
                                                {{ l.qtyPacksDelivered }}
                                            </td>
                                            <td class="py-2 pr-3 text-right">
                                                {{ l.qtyPacksReturned }}
                                            </td>
                                            <td
                                                class="py-2 pr-3 text-right"
                                                [class.text-surface-400]="l.qtyInQuarantine === 0">
                                                {{ q(l.qtyInQuarantine, l.stockUnit) }}
                                            </td>
                                            <td class="py-2 pr-3 text-right w-36">
                                                @if (fullyClaimed(l)) {
                                                    <span class="text-xs text-surface-500">
                                                        already claimed in full
                                                    </span>
                                                } @else {
                                                <p-inputNumber
                                                    styleClass="w-full"
                                                    [ngModel]="entryFor(l.grnLineId)"
                                                    (ngModelChange)="setEntry(l.grnLineId, $event)"
                                                    [min]="0"
                                                    [max]="maxFor(l)"
                                                    [maxFractionDigits]="3"
                                                    placeholder="-"></p-inputNumber>
                                                }
                                                <!-- What that number of packs
                                                     actually is, in the unit the
                                                     shelf is counted in. "0.2" of
                                                     a 5 L can is a litre, and
                                                     without this line it reads
                                                     like a bug. -->
                                                @if (entryFor(l.grnLineId); as packs) {
                                                    <div class="text-xs text-surface-500 mt-1">
                                                        = {{ q(packs * l.qtyInStockUnit, l.stockUnit) }}
                                                    </div>
                                                }
                                            </td>
                                            <td class="py-2 text-right font-medium">
                                                {{ money(creditFor(l)) }}
                                            </td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        </div>

                        <!-- The two things that catch people out, said before
                             they hit them rather than after. -->
                        <div class="app-note">
                            <p>
                                <strong>Send back is counted in packs</strong>, because that is what
                                a credit note is written in. A part pack is normal: half a litre out
                                of a 5 L can is 0.1 - the line underneath shows what it comes to on
                                the shelf.
                            </p>
                            <p class="mt-2">
                                Only what is <strong>in quarantine</strong> is listed. The rest of
                                this delivery is fine as far as the system knows, and could not be
                                claimed for anyway - if more of it turns out to be bad, hand it
                                back to the store and it will appear here.
                            </p>
                        </div>

                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <div class="text-sm">
                                Credit asked for:
                                <span class="font-semibold">{{ money(totalCredit()) }}</span>
                            </div>
                            <button
                                pButton
                                label="Send it to management"
                                icon="pi pi-send"
                                [disabled]="!canRaise() || busy()"
                                [loading]="busy()"
                                (click)="raise()"></button>
                        </div>
                    }
                }
                </div>
            </p-drawer>

            <!-- ── The list ─────────────────────────────────────────────── -->
            <div
                class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                <div class="p-4 flex items-center justify-between border-b border-surface">
                    <span class="font-semibold">Returns</span>
                    <button
                        pButton
                        size="small"
                        [outlined]="!openOnly()"
                        label="Waiting on the supplier"
                        (click)="toggleOpen()"></button>
                </div>

                @if (rows().length === 0) {
                    <p class="p-8 text-center text-surface-500">
                        {{ loading() ? 'Loading…' : 'Nothing has gone back.' }}
                    </p>
                } @else {
                    <ul class="divide-y divide-surface">
                        @for (row of rows(); track row.id) {
                            <li class="px-5 py-4 space-y-2">
                                <div class="flex flex-wrap items-start justify-between gap-3">
                                    <div class="min-w-0">
                                        <div class="font-medium">
                                            {{ row.supplierName }} ·
                                            {{ row.invoiceNo || 'no invoice' }}
                                        </div>
                                        <div class="text-xs text-surface-500">
                                            {{ row.reasonLabel }} · raised by {{ row.raisedBy }} ·
                                            {{ when(row.raisedAt) }}
                                        </div>
                                        @if (row.note) {
                                            <div class="text-xs text-surface-500 mt-1">
                                                “{{ row.note }}”
                                            </div>
                                        }
                                    </div>
                                    <div class="text-right">
                                        <div class="font-semibold">
                                            {{ money(row.expectedCredit) }}
                                        </div>
                                        <p-tag
                                            [severity]="severity(row.status)"
                                            [value]="statusLabel(row.status)"></p-tag>
                                    </div>
                                </div>

                                <div class="text-xs text-surface-500 space-y-0.5">
                                    @for (l of row.lines; track l.id) {
                                        <div>
                                            {{ l.itemName }} {{ l.qtyPacks }} × {{ l.packName }}
                                            @if (l.decision === 'waste') {
                                                · <strong>{{ l.binned ? 'binned' : 'to be binned' }}</strong>
                                            } @else if (l.decision === 'vendor') {
                                                · back to the supplier
                                            }
                                        </div>
                                    }
                                </div>
                                @if (row.writtenOffValue > 0) {
                                    <div class="text-xs text-surface-500">
                                        {{ money(row.writtenOffValue) }} of this was written off
                                        rather than claimed.
                                    </div>
                                }

                                @if (row.status === 'settled') {
                                    <div class="text-sm">
                                        {{ outcomeLabel(row.outcome) }}
                                        @if (row.creditNoteNo) {
                                            · note {{ row.creditNoteNo }}
                                        }
                                        @if (row.creditValue !== null) {
                                            · {{ money(row.creditValue) }} allowed
                                            @if (row.creditValue < row.expectedCredit) {
                                                <span class="text-amber-600 dark:text-amber-400">
                                                    ({{ money(row.expectedCredit - row.creditValue) }}
                                                    short of what was asked)
                                                </span>
                                            }
                                        }
                                    </div>
                                }
                                @if (row.status === 'rejected' && row.decisionNote) {
                                    <div class="text-sm text-surface-500">
                                        Rejected: {{ row.decisionNote }}
                                    </div>
                                }

                                <div class="flex flex-wrap gap-2">
                                    @if (row.status === 'raised' && canDecide()) {
                                        <span class="text-xs text-surface-500">
                                            Answer it in the panel above
                                        </span>
                                    }
                                    @if (row.status === 'approved') {
                                        @if (canRaiseReturn()) {
                                            @if (toBin(row) > 0) {
                                                <button
                                                    pButton
                                                    size="small"
                                                    severity="danger"
                                                    icon="pi pi-trash"
                                                    [label]="'Bin them (' + toBin(row) + ')'"
                                                    [disabled]="busy()"
                                                    (click)="bin(row)"></button>
                                            }
                                            @if (toSend(row) > 0) {
                                                <button
                                                    pButton
                                                    size="small"
                                                    icon="pi pi-truck"
                                                    label="It has gone"
                                                    [disabled]="busy()"
                                                    (click)="send(row)"></button>
                                            }
                                        } @else {
                                            <!-- Management decided; the store
                                                 carries it out. Saying so beats
                                                 a row that simply stops having
                                                 buttons. -->
                                            <span class="text-xs text-surface-500">
                                                Waiting for the store to
                                                {{ toSend(row) > 0 ? 'send it' : 'bin it' }}
                                            </span>
                                        }
                                    }
                                    @if (row.status === 'sent' && canDecide()) {
                                        <button
                                            pButton
                                            size="small"
                                            label="Credit note received"
                                            (click)="settle(row, 'credit')"></button>
                                        <button
                                            pButton
                                            size="small"
                                            outlined
                                            label="Replaced"
                                            (click)="settle(row, 'replacement')"></button>
                                        <button
                                            pButton
                                            size="small"
                                            outlined
                                            severity="danger"
                                            label="Nothing back"
                                            (click)="settle(row, 'written_off')"></button>
                                    }
                                </div>
                            </li>
                        }
                    </ul>
                }
            </div>

            <app-paginator [page]="pageInfo()" (pageChange)="onPageChange($event)" />
        </div>
    `
})
export class SupplierReturnsComponent implements OnInit {
    readonly auth = inject(AuthStore);
    private api = inject(GrandService);
    private notify = inject(NotifyService);
    private route = inject(ActivatedRoute);

    readonly rows = signal<SupplierReturnRow[]>([]);
    readonly pageInfo = signal<Page<SupplierReturnRow>>(emptyPage<SupplierReturnRow>());
    readonly pageReq = signal<PageRequest>({ page: 1, limit: DEFAULT_PAGE_SIZE });
    readonly deliveries = signal<GrnListRow[]>([]);
    readonly reasons = signal<ReasonCode[]>([]);
    readonly lines = signal<ReturnableLine[]>([]);
    readonly entries = signal<Record<string, number>>({});

    /** Whether the ask drawer is open. */
    readonly raising = signal(false);

    readonly grnId = signal<string | null>(null);
    readonly reasonCode = signal<string | null>(null);

    readonly loading = signal(false);
    readonly linesLoading = signal(false);
    readonly busy = signal(false);
    readonly openOnly = signal(false);
    readonly error = signal<string | null>(null);

    readonly suggestions = signal<SuggestedReturn[]>([]);

    /**
     * What management has clicked so far, keyed `returnId:lineId`.
     *
     * Held here rather than on the row because the row is refetched whenever
     * the list reloads, and a half-finished answer should not be thrown away
     * by a background refresh. It is cleared once the decision is saved.
     */
    readonly answers = signal<Record<string, DisposalDecision>>({});

    answerFor(returnId: string, lineId: string): DisposalDecision | null {
        return this.answers()[`${returnId}:${lineId}`] ?? null;
    }

    answer(returnId: string, lineId: string, decision: DisposalDecision): void {
        this.answers.update((all) => ({ ...all, [`${returnId}:${lineId}`]: decision }));
    }

    /** Lines still without an answer. The server refuses a partial decision. */
    unanswered(row: SupplierReturnRow): number {
        return row.lines.filter((l) => this.answerFor(row.id, l.id) === null).length;
    }

    claimTotal(row: SupplierReturnRow): number {
        return row.lines
            .filter((l) => this.answerFor(row.id, l.id) === 'vendor')
            .reduce((n, l) => n + l.lineCredit, 0);
    }

    binTotal(row: SupplierReturnRow): number {
        return row.lines
            .filter((l) => this.answerFor(row.id, l.id) === 'waste')
            .reduce((n, l) => n + l.lineCredit, 0);
    }

    /** Lines management said to bin that the store has not binned yet. */
    toBin(row: SupplierReturnRow): number {
        return row.lines.filter((l) => l.decision === 'waste' && !l.binned).length;
    }

    /** Lines management said to claim. They leave together, on the lorry. */
    toSend(row: SupplierReturnRow): number {
        return row.lines.filter((l) => l.decision === 'vendor').length;
    }

    /**
     * Load the form from a suggestion.
     *
     * Everything is filled and everything stays editable. The delivery in
     * particular is a guess -- see the service -- and a guess that could not be
     * corrected would be worse than an empty form.
     */
    async useSuggestion(sug: SuggestedReturn): Promise<void> {
        // Open first, so the screen visibly responds to the tap while the
        // delivery's lines are still being fetched. Filling a form the person
        // cannot see is how "Use this" came to look like it did nothing.
        this.raising.set(true);
        this.error.set(null);
        if (sug.reasonCode) this.reasonCode.set(sug.reasonCode);
        await this.pickGrn(sug.grnId);
        this.entries.set(
            Object.fromEntries(sug.lines.map((l) => [l.grnLineId, l.suggestedPacks]))
        );
    }

    /** The drawer, from the header button: nothing chosen, nothing filled in. */
    openRaise(): void {
        this.error.set(null);
        this.reasonCode.set(null);
        void this.pickGrn(null);
        this.raising.set(true);
    }

    /**
     * Closing throws the half-written ask away.
     *
     * Keeping it would mean the next "Use this" landed on top of somebody
     * else's delivery with its quantities still in the boxes, which is the one
     * mistake this form must not make easy.
     */
    onRaiseVisible(visible: boolean): void {
        this.raising.set(visible);
        if (!visible) {
            this.reasonCode.set(null);
            this.entries.set({});
            this.grnId.set(null);
            this.lines.set([]);
        }
    }

    /**
     * Arriving from the Returns screen, which names the delivery it wants.
     *
     * Falls back to the only suggestion when there is exactly one, because a
     * storekeeper with one crate in quarantine should not have to pick it out
     * of a list of one.
     */
    private async applyIncoming(): Promise<void> {
        const wanted = this.route.snapshot.queryParamMap.get('grnId');
        const all = this.suggestions();
        const match = wanted ? all.find((g) => g.grnId === wanted) : all.length === 1 ? all[0] : null;
        if (match) await this.useSuggestion(match);
    }

    readonly canDecide = computed(() => this.auth.role() === 'management');

    /**
     * Who writes a return up and marks it gone.
     *
     * The storekeeper: both are acts on the crate itself, done by the person
     * standing next to it. Management's part is the decision and the credit
     * note, and the server refuses them the rest.
     */
    readonly canRaiseReturn = computed(() => this.auth.role() === 'storekeeper');

    /** Raised and undecided - management's queue, pulled out of the list. */
    readonly awaitingDecision = computed(() =>
        this.rows().filter((r) => r.status === 'raised')
    );

    readonly awaitingValue = computed(() =>
        this.awaitingDecision().reduce((n, r) => n + r.expectedCredit, 0)
    );

    /**
     * The life of a supplier return, in the order it happens.
     *
     * On the screen because the status labels alone do not carry it: nothing
     * in "Approved, not yet sent" tells you that sending is a separate act, by
     * a different person, and that the stock has not moved yet.
     */
    readonly FLOW = [
        {
            key: 'raised',
            label: 'Asked',
            who: 'Storekeeper',
            what: 'What is in quarantine, priced off the delivery it came in on'
        },
        {
            key: 'approved',
            label: 'Decided',
            who: 'Management',
            what: 'Each line: back to the supplier, or into the bin'
        },
        {
            key: 'sent',
            label: 'Gone or binned',
            who: 'Storekeeper',
            what: 'Whichever management said - this is when stock leaves quarantine'
        },
        {
            key: 'settled',
            label: 'Settled',
            who: 'Management',
            what: 'Credit note, replacement, or nothing back'
        }
    ];

    /**
     * How much of a line can actually go back: the lesser of what is still
     * returnable on the invoice and what quarantine physically holds. The
     * server enforces both; the input just refuses to let anybody type a number
     * that is going to be rejected.
     */
    maxFor(line: ReturnableLine): number {
        // Floored to three decimals, so the cap the box enforces is a quantity
        // the service will actually accept. Handing somebody a maximum that is
        // then refused is worse than a smaller maximum.
        const inQuarantinePacks =
            line.qtyInStockUnit > 0
                ? Math.floor((line.qtyInQuarantine / line.qtyInStockUnit) * 1000) / 1000
                : 0;
        return Math.max(0, Math.min(line.qtyPacksReturnable, inQuarantinePacks));
    }

/**
     * The lines of this delivery that quarantine actually holds something of.
     *
     * The rest of the invoice is deliberately **not** shown. Those rows can
     * never be filled in: you may only claim for goods that are physically on
     * the quarantine shelf, so their boxes are disabled for the life of the
     * ask. A delivery of six things where one is bad was showing five dead rows
     * around the one that mattered.
     *
     * Nothing is lost by hiding them. If more of the same delivery turns out to
     * be bad, it has to be handed back into quarantine first - and at that
     * moment it appears here on its own, and on the suggestion list outside.
     * The whole invoice is readable any time under **Deliveries**.
     */
    readonly quarantinedLines = computed(() =>
        this.lines()
            .filter((l) => l.qtyInQuarantine > 0)
            .sort((a, b) => a.itemName.localeCompare(b.itemName))
    );

    /**
     * A line in quarantine that has already been claimed in full.
     *
     * Rare, and worth a word rather than a silently dead box: the goods are on
     * the shelf but the invoice has no packs left to claim against.
     */
    fullyClaimed(line: ReturnableLine): boolean {
        return line.qtyInQuarantine > 0 && this.maxFor(line) <= 0;
    }

    entryFor(grnLineId: string): number | null {
        return this.entries()[grnLineId] ?? null;
    }

    setEntry(grnLineId: string, value: number | null): void {
        this.entries.update((all) => {
            const next = { ...all };
            if (value === null || value <= 0) delete next[grnLineId];
            else next[grnLineId] = value;
            return next;
        });
    }

    creditFor(line: ReturnableLine): number {
        return (this.entries()[line.grnLineId] ?? 0) * line.packPrice;
    }

    readonly totalCredit = computed(() =>
        this.lines().reduce((n, l) => n + (this.entries()[l.grnLineId] ?? 0) * l.packPrice, 0)
    );

    readonly canRaise = computed(
        () => !!this.grnId() && !!this.reasonCode() && Object.keys(this.entries()).length > 0
    );

    async ngOnInit(): Promise<void> {
        // Management loads none of this. The deliveries, the reason codes and
        // the suggestions exist only to fill in a form they cannot submit, and
        // two of the three endpoints would refuse them anyway -- a 403 on a
        // screen they are entitled to be on reads as a broken system.
        if (this.canRaiseReturn()) {
            try {
                const [grns, reasons, suggestions] = await Promise.all([
                    this.api.listGrn({ page: 1, limit: 50 }),
                    this.api.reasonCodes('return'),
                    this.api.suggestedSupplierReturns()
                ]);
                this.deliveries.set(grns.items);
                this.reasons.set(reasons);
                this.suggestions.set(suggestions);
                await this.applyIncoming();
            } catch (err) {
                this.error.set(apiErrorMessage(err));
            }
        }
        await this.load();
    }

    async pickGrn(id: string | null): Promise<void> {
        this.grnId.set(id);
        this.entries.set({});
        this.lines.set([]);
        if (!id) return;
        this.linesLoading.set(true);
        try {
            this.lines.set(await this.api.returnableLines(id));
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.linesLoading.set(false);
        }
    }

    onPageChange(e: PageChange): void {
        this.pageReq.set(e);
        void this.load();
    }

    async load(): Promise<void> {
        this.loading.set(true);
        try {
            const page = await this.api.listSupplierReturns({
                ...this.pageReq(),
                openOnly: this.openOnly()
            });
            this.pageInfo.set(page);
            this.rows.set(page.items);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    toggleOpen(): void {
        this.openOnly.update((v) => !v);
        void this.load();
    }

    async raise(): Promise<void> {
        if (!this.canRaise()) return;
        this.busy.set(true);
        this.error.set(null);
        try {
            const result = await this.api.raiseSupplierReturn({
                grnId: this.grnId()!,
                reasonCode: this.reasonCode()!,
                lines: Object.entries(this.entries()).map(([grnLineId, qtyPacks]) => ({
                    grnLineId,
                    qtyPacks
                }))
            });
            this.notify.success(
                `Sent to management. ${this.money(result.creditValue)} to decide on.`
            );

            // The ask exists now, so the form that made it has no business
            // still being on screen -- it used to stay open over a delivery
            // whose quantities had just been cleared, which reads as though
            // nothing happened. Closing also resets it, so the next "Use this"
            // does not land on top of this one.
            this.onRaiseVisible(false);

            // Both lists move: the ask joins the record below, and the goods
            // leave the suggestions because they are now spoken for.
            await Promise.all([
                this.load(),
                this.api
                    .suggestedSupplierReturns()
                    .then((rows) => this.suggestions.set(rows))
                    .catch(() => {
                        /* the ask is raised either way */
                    })
            ]);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    /**
     * Send management's answers, all of them at once.
     *
     * The button is disabled until every line has one, so the server's refusal
     * of a partial decision is a backstop rather than something anybody meets.
     */
    async saveDecision(row: SupplierReturnRow): Promise<void> {
        if (this.unanswered(row) > 0) return;

        const lines = row.lines.map((l) => ({
            lineId: l.id,
            decision: this.answerFor(row.id, l.id)!
        }));

        this.busy.set(true);
        try {
            const result = await this.api.decideDisposal(row.id, lines);
            this.notify.success(
                result.toWaste === 0
                    ? `All of it goes back. ${this.money(result.creditValue)} to claim.`
                    : result.toVendor === 0
                      ? 'All of it is to be binned. The store will do it.'
                      : `${result.toVendor} line(s) back to the supplier, ${result.toWaste} to be binned.`
            );
            // Only this ask's answers are cleared -- another one half-filled in
            // a different panel is somebody's work in progress.
            this.answers.update((all) => {
                const next = { ...all };
                for (const l of row.lines) delete next[`${row.id}:${l.id}`];
                return next;
            });
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    /** The store bins what management said to bin. One button. */
    async bin(row: SupplierReturnRow): Promise<void> {
        this.busy.set(true);
        try {
            const result = await this.api.binDecidedLines(row.id);
            this.notify.success(
                result.binned === 0
                    ? 'Already binned.'
                    : `${result.binned} line(s) binned. Quarantine is down by what went.`
            );
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    async send(row: SupplierReturnRow): Promise<void> {
        try {
            await this.api.sendSupplierReturn(row.id);
            this.notify.success('Gone. Quarantine is down by what went with it.');
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    async settle(row: SupplierReturnRow, outcome: SupplierReturnOutcome): Promise<void> {
        let creditNoteNo: string | null = null;
        let creditValue: number | null = null;

        if (outcome === 'credit') {
            creditNoteNo = await this.notify.prompt(
                'The number on the note, so it can be checked against the statement.',
                'Credit note number',
                '',
                'Next'
            );
            if (!creditNoteNo?.trim()) return;
            const raw = await this.notify.prompt(
                'Suppliers do not always allow the whole amount. Enter what they did.',
                'How much did they allow?',
                String(row.expectedCredit),
                'Record it'
            );
            if (raw === null) return;
            creditValue = Number(raw);
            if (!Number.isFinite(creditValue) || creditValue < 0) {
                this.notify.error('That is not an amount');
                return;
            }
        }

        try {
            await this.api.settleSupplierReturn(row.id, { outcome, creditNoteNo, creditValue });
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    statusLabel(status: SupplierReturnRow['status']): string {
        return SUPPLIER_RETURN_STATUS_LABELS[status];
    }

    outcomeLabel(outcome: SupplierReturnOutcome | null): string {
        return outcome ? SUPPLIER_RETURN_OUTCOME_LABELS[outcome] : '';
    }

    severity(status: SupplierReturnRow['status']): 'success' | 'warn' | 'danger' | 'info' {
        if (status === 'settled') return 'success';
        if (status === 'rejected') return 'danger';
        if (status === 'sent') return 'info';
        return 'warn';
    }

    money(v: number): string {
        return formatMoney(v);
    }

    q(qty: number, unit: string): string {
        return formatQty(qty, unit);
    }

    onlyDate(iso: string): string {
        return new Date(iso).toLocaleDateString('en-LK', { day: 'numeric', month: 'short' });
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
