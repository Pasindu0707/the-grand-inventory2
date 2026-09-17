/**
 * Suppliers, and what they charge.
 *
 * Two things live here that look like one. The supplier list is what the
 * delivery and market screens choose from. The price list is what the
 * price-movement report compares a delivery against - and without a starting
 * price, the first time a supplier puts oil up 32% it looks exactly like the
 * normal price, and the report only notices on the delivery after that.
 *
 * Prices are also written automatically by every GRN, so this screen is for
 * the ones agreed in advance: the opening price list, the annual contract.
 */
import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { DrawerModule } from 'primeng/drawer';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import { formatMoney } from '@/core/format';
import {
    DEFAULT_PAGE_SIZE,
    emptyPage,
    type Item,
    type Page,
    type PageRequest,
    type SetupSupplier,
    type SupplierPrice
} from '@/core/types';
import { AppPaginator, type PageChange } from '@/shared/paginator.component';
import { AppFilterBar, type FilterOption } from '@/shared/filter-bar.component';

@Component({
    selector: 'app-setup-suppliers',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        InputTextModule,
        TagModule,
        DrawerModule,
        AppPaginator,
        AppFilterBar
    ],
    template: `
        <div class="space-y-6">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold">Suppliers</h1>
                    <p class="text-surface-500 text-sm">Who you buy from, and at what price</p>
                </div>
                <button pButton icon="pi pi-plus" label="Add supplier" (click)="openAdd()"></button>
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
                <input
                    pInputText
                    class="w-64"
                    placeholder="Search by name"
                    [ngModel]="search()"
                    (ngModelChange)="onSearch($event)" />
                <app-filter-bar
                    label="Which suppliers"
                    [options]="retiredOptions"
                    [value]="includeRetired()"
                    (valueChange)="setIncludeRetired($event)" />
            </div>

            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                @if (suppliers().length === 0) {
                    <div class="p-10 text-center text-surface-500">
                        @if (loading()) {
                            Loading…
                        } @else {
                            <div class="space-y-3">
                                <p class="font-medium">No suppliers yet.</p>
                                <p class="text-sm">
                                    A delivery cannot be booked in until there is somebody to
                                    book it from.
                                </p>
                                <button pButton label="Add the first supplier" (click)="openAdd()"></button>
                            </div>
                        }
                    </div>
                } @else {
                    <ul class="divide-y divide-surface">
                        @for (s of suppliers(); track s.id) {
                            <li class="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <span class="font-medium" [class.text-surface-400]="!s.isActive">
                                            {{ s.name }}
                                        </span>
                                        @if (!s.isActive) {
                                            <p-tag severity="secondary" value="Retired"></p-tag>
                                        }
                                    </div>
                                    <div class="text-xs text-surface-500 mt-1">
                                        {{ s.phone || 'No phone' }}
                                        @if (s.paymentTerms) {
                                            · {{ s.paymentTerms }}
                                        }
                                        @if (s.vatNo) {
                                            · VAT {{ s.vatNo }}
                                        }
                                        · {{ s.deliveries }} deliver{{
                                            s.deliveries === 1 ? 'y' : 'ies'
                                        }}
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button
                                        pButton
                                        size="small"
                                        text
                                        label="Prices"
                                        (click)="openPrices(s)"></button>
                                    @if (s.isActive) {
                                        <button
                                            pButton
                                            size="small"
                                            outlined
                                            label="Edit"
                                            (click)="openEdit(s)"></button>
                                        <button
                                            pButton
                                            size="small"
                                            text
                                            severity="danger"
                                            label="Retire"
                                            (click)="setActive(s, false)"></button>
                                    } @else {
                                        <button
                                            pButton
                                            size="small"
                                            outlined
                                            label="Bring back"
                                            (click)="setActive(s, true)"></button>
                                    }
                                </div>
                            </li>
                        }
                    </ul>
                    <app-paginator [page]="pageInfo()" (pageChange)="onPageChange($event)" />
                }
            </div>
        </div>

        <p-drawer
            [visible]="editing()"
            (visibleChange)="editing.set($event)"
            position="right"
            [header]="current() ? 'Edit supplier' : 'Add a supplier'"
            styleClass="!w-full sm:!w-[32rem]">
            <div class="space-y-5">
                @if (formError()) {
                    <div class="app-note app-note--error">{{ formError() }}</div>
                }

                <div>
                    <label class="block text-sm font-medium mb-1 app-req">Name</label>
                    <input
                        pInputText
                        class="w-full"
                        placeholder="e.g. Ceylon Provisions (Pvt) Ltd"
                        [ngModel]="name()"
                        (ngModelChange)="name.set($event)" />
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium mb-1">Phone</label>
                        <input
                            pInputText
                            class="w-full"
                            placeholder="077 123 4567"
                            [ngModel]="phone()"
                            (ngModelChange)="phone.set($event)" />
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1">VAT number</label>
                        <input
                            pInputText
                            class="w-full"
                            placeholder="optional"
                            [ngModel]="vatNo()"
                            (ngModelChange)="vatNo.set($event)" />
                    </div>
                </div>

                <div>
                    <label class="block text-sm font-medium mb-1">Payment terms</label>
                    <input
                        pInputText
                        class="w-full"
                        placeholder="e.g. 30 days"
                        [ngModel]="paymentTerms()"
                        (ngModelChange)="paymentTerms.set($event)" />
                </div>

                <div class="flex justify-end gap-2 pt-2">
                    <button pButton outlined label="Cancel" (click)="editing.set(false)"></button>
                    <button
                        pButton
                        icon="pi pi-check"
                        [label]="current() ? 'Save changes' : 'Add supplier'"
                        [disabled]="name().trim().length < 2 || busy()"
                        [loading]="busy()"
                        (click)="save()"></button>
                </div>
            </div>
        </p-drawer>

        <!-- Agreed prices ---------------------------------------------------->
        <p-drawer
            [visible]="pricesOpen()"
            (visibleChange)="pricesOpen.set($event)"
            position="right"
            [header]="priceSupplier()?.name ?? 'Prices'"
            styleClass="!w-full sm:!w-[34rem]">
            <div class="space-y-5">
                <p class="text-sm text-surface-500">
                    The price you have agreed, per pack. Deliveries add to this list by
                    themselves - what you set here is the starting point the first delivery is
                    measured against.
                </p>

                <div class="space-y-2 rounded-xl border border-surface p-3">
                    <label class="block text-sm font-medium">Add a price</label>
                    <select
                        class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                        [ngModel]="priceItemId()"
                        (ngModelChange)="onPriceItem(+$event)">
                        <option [ngValue]="0">Choose a product…</option>
                        @for (i of items(); track i.id) {
                            <option [ngValue]="i.id">{{ i.name }}</option>
                        }
                    </select>

                    @if (packOptions().length > 0) {
                        <select
                            class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                            [ngModel]="pricePackId()"
                            (ngModelChange)="pricePackId.set(+$event)">
                            @for (p of packOptions(); track p.id) {
                                <option [ngValue]="p.id">{{ p.packName }}</option>
                            }
                        </select>
                    }

                    <div class="flex items-center gap-2">
                        <input
                            pInputText
                            class="flex-1 text-right"
                            inputmode="decimal"
                            placeholder="Price per pack"
                            [ngModel]="priceValue()"
                            (ngModelChange)="priceValue.set($event)" />
                        <input
                            pInputText
                            class="w-40"
                            type="date"
                            [ngModel]="priceFrom()"
                            (ngModelChange)="priceFrom.set($event)" />
                    </div>

                    <button
                        pButton
                        class="w-full"
                        label="Record this price"
                        [disabled]="!pricePackId() || !priceValue()"
                        (click)="addPrice()"></button>
                </div>

                @if (prices().length === 0) {
                    <p class="text-sm text-surface-500">No prices recorded yet.</p>
                } @else {
                    <ul class="divide-y divide-surface border-t border-surface">
                        @for (p of prices(); track p.id) {
                            <li class="py-3 flex items-center justify-between gap-2 text-sm">
                                <span>
                                    <span class="font-medium">{{ p.itemName }}</span>
                                    <span class="block text-xs text-surface-500">
                                        {{ p.packName }} · from {{ p.effectiveFrom }}
                                    </span>
                                </span>
                                <span class="font-medium">{{ money(p.price) }}</span>
                            </li>
                        }
                    </ul>
                }
            </div>
        </p-drawer>
    `
})
export class SetupSuppliersComponent implements OnInit {
    private api = inject(GrandService);
    private notify = inject(NotifyService);

    readonly retiredOptions: FilterOption<boolean>[] = [
        { value: false, label: 'In use' },
        { value: true, label: 'Including retired' }
    ];

    readonly suppliers = signal<SetupSupplier[]>([]);
    readonly pageInfo = signal<Page<SetupSupplier>>(emptyPage<SetupSupplier>());
    readonly pageReq = signal<PageRequest>({ page: 1, limit: DEFAULT_PAGE_SIZE });
    readonly search = signal('');
    readonly includeRetired = signal(false);
    readonly loading = signal(false);
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);
    readonly formError = signal<string | null>(null);

    readonly editing = signal(false);
    readonly current = signal<SetupSupplier | null>(null);
    readonly name = signal('');
    readonly phone = signal('');
    readonly vatNo = signal('');
    readonly paymentTerms = signal('');

    readonly pricesOpen = signal(false);
    readonly priceSupplier = signal<SetupSupplier | null>(null);
    readonly prices = signal<SupplierPrice[]>([]);
    readonly items = signal<Item[]>([]);
    readonly priceItemId = signal(0);
    readonly pricePackId = signal(0);
    readonly priceValue = signal<string | number>('');
    readonly priceFrom = signal(new Date().toISOString().slice(0, 10));
    readonly packOptions = signal<{ id: number; packName: string }[]>([]);

    private searchTimer: ReturnType<typeof setTimeout> | null = null;

    async ngOnInit(): Promise<void> {
        await this.load();
    }

    money(value: number): string {
        return formatMoney(value);
    }

    onSearch(value: string): void {
        this.search.set(value);
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            this.pageReq.set({ ...this.pageReq(), page: 1 });
            void this.load();
        }, 250);
    }

    setIncludeRetired(value: boolean): void {
        this.includeRetired.set(value);
        this.pageReq.set({ ...this.pageReq(), page: 1 });
        void this.load();
    }

    onPageChange(e: PageChange): void {
        this.pageReq.set(e);
        void this.load();
    }

    async load(): Promise<void> {
        this.loading.set(true);
        try {
            const page = await this.api.setupSuppliers({
                ...this.pageReq(),
                search: this.search().trim() || undefined,
                includeRetired: this.includeRetired()
            });
            this.pageInfo.set(page);
            this.suppliers.set(page.items);
            this.error.set(null);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    openAdd(): void {
        this.current.set(null);
        this.formError.set(null);
        this.name.set('');
        this.phone.set('');
        this.vatNo.set('');
        this.paymentTerms.set('');
        this.editing.set(true);
    }

    openEdit(supplier: SetupSupplier): void {
        this.current.set(supplier);
        this.formError.set(null);
        this.name.set(supplier.name);
        this.phone.set(supplier.phone ?? '');
        this.vatNo.set(supplier.vatNo ?? '');
        this.paymentTerms.set(supplier.paymentTerms ?? '');
        this.editing.set(true);
    }

    async save(): Promise<void> {
        this.busy.set(true);
        this.formError.set(null);
        const body = {
            name: this.name().trim(),
            phone: this.phone().trim() || null,
            vatNo: this.vatNo().trim() || null,
            paymentTerms: this.paymentTerms().trim() || null
        };
        try {
            const existing = this.current();
            if (existing) {
                await this.api.updateSupplier(existing.id, body);
                this.notify.success(`${body.name} saved`);
            } else {
                await this.api.createSupplier(body);
                this.notify.success(`${body.name} added`);
            }
            this.editing.set(false);
            await this.load();
        } catch (err) {
            this.formError.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    async setActive(supplier: SetupSupplier, isActive: boolean): Promise<void> {
        if (!isActive) {
            const ok = await this.notify.confirm(
                `${supplier.name} will not be offered on new deliveries. Everything already received from them stays on record.`,
                'Retire this supplier?',
                'Retire'
            );
            if (!ok) return;
        }
        try {
            await this.api.updateSupplier(supplier.id, { isActive });
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    async openPrices(supplier: SetupSupplier): Promise<void> {
        this.priceSupplier.set(supplier);
        this.pricesOpen.set(true);
        this.priceItemId.set(0);
        this.pricePackId.set(0);
        this.priceValue.set('');
        this.packOptions.set([]);
        try {
            const [prices, items] = await Promise.all([
                this.api.supplierPrices(supplier.id),
                this.items().length > 0 ? Promise.resolve(this.items()) : this.api.listItems()
            ]);
            this.prices.set(prices);
            this.items.set(items);
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    onPriceItem(itemId: number): void {
        this.priceItemId.set(itemId);
        const item = this.items().find((i) => i.id === itemId);
        const packs = item?.packs ?? [];
        this.packOptions.set(packs.map((p) => ({ id: p.id, packName: p.packName })));
        // Pre-select what the item is normally bought in, which is what a
        // price is normally agreed for.
        const preferred = packs.find((p) => p.isDefaultPurchase) ?? packs[0];
        this.pricePackId.set(preferred?.id ?? 0);
    }

    async addPrice(): Promise<void> {
        const supplier = this.priceSupplier();
        if (!supplier) return;
        try {
            await this.api.addSupplierPrice(supplier.id, {
                itemPackId: this.pricePackId(),
                price: Number(this.priceValue()),
                effectiveFrom: this.priceFrom()
            });
            this.priceValue.set('');
            this.prices.set(await this.api.supplierPrices(supplier.id));
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }
}
