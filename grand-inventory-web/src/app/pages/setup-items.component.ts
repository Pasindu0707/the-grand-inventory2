/**
 * Products - the item master, and the screen that decides whether this system
 * can be handed over at all.
 *
 * Everything else in the app reads from here. A GRN picks a pack from here, a
 * request picks an item from here, and the reorder report reads the numbers
 * typed on this screen. Until it existed, adding one new item meant a
 * developer with psql.
 *
 * The form is built around the one rule the whole system rests on: stock is
 * held in the *small* unit (g, ml, ea) and bought in *packs*. Get that
 * backwards -- an item in kg with a "25 kg sack" pack -- and every quantity in
 * the system is a thousand times wrong, in a way nobody notices for a month.
 * So the unit is three buttons rather than a text field, the pack rows show
 * what they come to, and the server refuses "kg" outright.
 *
 * Nothing is deleted. An item that has been received is in the ledger forever;
 * retiring it takes it off the lists and leaves the history alone.
 */
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { DrawerModule } from 'primeng/drawer';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import { formatQty } from '@/core/format';
import {
    DEFAULT_PAGE_SIZE,
    emptyPage,
    STORAGE_LABELS,
    type Page,
    type PageRequest,
    type SetupCategory,
    type SetupItem,
    type SetupPack,
    type StorageType
} from '@/core/types';
import { AppPaginator, type PageChange } from '@/shared/paginator.component';
import { AppFilterBar, type FilterOption } from '@/shared/filter-bar.component';

interface PackDraft {
    packName: string;
    qtyInStockUnit: number | null;
    isDefaultPurchase: boolean;
}

/** The three units anything in a kitchen is actually counted in. */
const UNITS: { unit: string; label: string; hint: string }[] = [
    { unit: 'g', label: 'Grams', hint: 'Anything weighed - flour, chicken, sugar' },
    { unit: 'ml', label: 'Millilitres', hint: 'Anything poured - oil, gin, milk' },
    { unit: 'ea', label: 'Each', hint: 'Anything counted - eggs, bottles, cloths' }
];

@Component({
    selector: 'app-setup-items',
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
                    <h1 class="text-2xl font-bold">Products</h1>
                    <p class="text-surface-500 text-sm">
                        Everything the store can hold, and the packs it is bought in
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <button
                        pButton
                        outlined
                        icon="pi pi-tags"
                        label="Categories"
                        (click)="openCategories()"></button>
                    <button pButton icon="pi pi-plus" label="Add product" (click)="openAdd()"></button>
                </div>
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
                <input
                    pInputText
                    class="w-64"
                    placeholder="Search by name or code"
                    [ngModel]="search()"
                    (ngModelChange)="onSearch($event)" />
                <app-filter-bar
                    label="Which products"
                    [options]="retiredOptions"
                    [value]="includeRetired()"
                    (valueChange)="setIncludeRetired($event)" />
            </div>

            <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                @if (items().length === 0) {
                    <div class="p-10 text-center text-surface-500">
                        @if (loading()) {
                            Loading…
                        } @else if (search()) {
                            Nothing matches "{{ search() }}".
                        } @else {
                            <div class="space-y-3">
                                <p class="font-medium">There are no products yet.</p>
                                <p class="text-sm">
                                    Add the first one and the store can start receiving it.
                                </p>
                                <button pButton label="Add the first product" (click)="openAdd()"></button>
                            </div>
                        }
                    </div>
                } @else {
                    <ul class="divide-y divide-surface">
                        @for (item of items(); track item.id) {
                            <li class="px-5 py-4">
                                <div class="flex flex-wrap items-start justify-between gap-3">
                                    <div class="min-w-0">
                                        <div class="flex items-center gap-2 flex-wrap">
                                            <span
                                                class="font-medium"
                                                [class.text-surface-400]="!item.isActive"
                                                >{{ item.name }}</span
                                            >
                                            <span class="text-xs font-mono text-surface-500">{{
                                                item.code
                                            }}</span>
                                            @if (item.isCritical) {
                                                <p-tag severity="warn" value="Counted daily"></p-tag>
                                            }
                                            @if (!item.isActive) {
                                                <p-tag severity="secondary" value="Retired"></p-tag>
                                            }
                                        </div>
                                        <div class="text-xs text-surface-500 mt-1">
                                            {{ item.categoryName }} · held in {{ item.stockUnit }} ·
                                            reorder at
                                            {{ qty(item.reorderPoint, item.stockUnit) }} · par
                                            {{ qty(item.parLevel, item.stockUnit) }}
                                        </div>
                                        <div class="flex flex-wrap gap-2 mt-2">
                                            @for (p of activePacks(item); track p.id) {
                                                <span
                                                    class="text-xs px-2 py-1 rounded-lg border border-surface">
                                                    {{ p.packName }} =
                                                    {{ qty(p.qtyInStockUnit, item.stockUnit) }}
                                                    @if (p.isDefaultPurchase) {
                                                        <span class="text-primary">· default</span>
                                                    }
                                                </span>
                                            }
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        @if (item.isActive) {
                                            <button
                                                pButton
                                                size="small"
                                                outlined
                                                label="Edit"
                                                (click)="openEdit(item)"></button>
                                            <button
                                                pButton
                                                size="small"
                                                text
                                                severity="danger"
                                                label="Retire"
                                                (click)="setActive(item, false)"></button>
                                        } @else {
                                            <button
                                                pButton
                                                size="small"
                                                outlined
                                                label="Bring back"
                                                (click)="setActive(item, true)"></button>
                                        }
                                    </div>
                                </div>
                            </li>
                        }
                    </ul>
                    <app-paginator [page]="pageInfo()" (pageChange)="onPageChange($event)" />
                }
            </div>
        </div>

        <!-- Add / edit ------------------------------------------------------->
        <p-drawer
            [visible]="editing()"
            (visibleChange)="editing.set($event)"
            position="right"
            [header]="current() ? 'Edit product' : 'Add a product'"
            styleClass="!w-full sm:!w-[38rem]">
            <div class="space-y-5">
                @if (formError()) {
                    <div class="app-note app-note--error">{{ formError() }}</div>
                }

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium mb-1 app-req">Code</label>
                        <input
                            pInputText
                            class="w-full font-mono"
                            placeholder="DRY-0007"
                            [disabled]="!!current()"
                            [ngModel]="code()"
                            (ngModelChange)="code.set($event)" />
                        @if (current()) {
                            <p class="text-xs text-surface-500 mt-1">
                                A code is on documents already; it does not change.
                            </p>
                        }
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1 app-req">Category</label>
                        <select
                            class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                            [ngModel]="categoryId()"
                            (ngModelChange)="categoryId.set(+$event)">
                            <option [ngValue]="0">Choose one…</option>
                            @for (c of activeCategories(); track c.id) {
                                <option [ngValue]="c.id">{{ c.name }}</option>
                            }
                        </select>
                    </div>
                </div>

                <div>
                    <label class="block text-sm font-medium mb-1 app-req">Name</label>
                    <input
                        pInputText
                        class="w-full"
                        placeholder="e.g. Sunflower oil"
                        [ngModel]="name()"
                        (ngModelChange)="name.set($event)" />
                </div>

                <div>
                    <label class="block text-sm font-medium mb-2">How is it counted?</label>
                    <div class="grid grid-cols-3 gap-2">
                        @for (u of units; track u.unit) {
                            <button
                                type="button"
                                class="text-left p-3 rounded-xl border transition"
                                [class.border-primary]="stockUnit() === u.unit"
                                [class.bg-primary-50]="stockUnit() === u.unit"
                                [class.dark:bg-primary-950]="stockUnit() === u.unit"
                                [class.border-surface]="stockUnit() !== u.unit"
                                [disabled]="unitLocked()"
                                (click)="stockUnit.set(u.unit)">
                                <div class="font-medium">{{ u.label }}</div>
                                <div class="text-xs text-surface-500">{{ u.hint }}</div>
                            </button>
                        }
                    </div>
                    <p class="text-xs text-surface-500 mt-1">
                        @if (unitLocked()) {
                            This has already moved in {{ stockUnit() }}, so the unit is fixed.
                            Changing it now would reinterpret every past figure.
                        } @else {
                            Always the small unit. A 25 kg sack is a <em>pack</em>, below.
                        }
                    </p>
                </div>

                <!-- Packs. An item with none can be neither received nor
                     ordered, so the form starts with one. -->
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <label class="text-sm font-medium">Packs it is bought in</label>
                        <button
                            pButton
                            size="small"
                            text
                            icon="pi pi-plus"
                            label="Add a pack size"
                            (click)="addPackDraft()"></button>
                    </div>

                    <div class="space-y-2">
                        @for (p of packs(); track $index) {
                            <div class="flex flex-wrap items-center gap-2">
                                <input
                                    pInputText
                                    class="flex-1 min-w-[10rem]"
                                    placeholder="25 kg sack"
                                    [ngModel]="p.packName"
                                    (ngModelChange)="setPackName($index, $event)" />
                                <span class="text-surface-500 text-sm">=</span>
                                <input
                                    pInputText
                                    class="w-28 text-right"
                                    inputmode="decimal"
                                    placeholder="25000"
                                    [ngModel]="p.qtyInStockUnit"
                                    (ngModelChange)="setPackQty($index, $event)" />
                                <span class="text-surface-500 text-sm w-8">{{ stockUnit() }}</span>
                                <button
                                    type="button"
                                    class="text-xs px-2 py-1 rounded-lg border"
                                    [class.border-primary]="p.isDefaultPurchase"
                                    [class.text-primary]="p.isDefaultPurchase"
                                    [class.border-surface]="!p.isDefaultPurchase"
                                    (click)="makeDefault($index)">
                                    Default
                                </button>
                                @if (packs().length > 1) {
                                    <button
                                        pButton
                                        size="small"
                                        text
                                        severity="danger"
                                        icon="pi pi-times"
                                        (click)="removePackDraft($index)"></button>
                                }
                            </div>
                            @if (packHint($index); as hint) {
                                <p class="text-xs text-surface-500 pl-1">{{ hint }}</p>
                            }
                        }
                    </div>
                    <p class="text-xs text-surface-500 mt-2">
                        Bought loose? Make the pack "1 {{ stockUnit() }}" = 1.
                        The default is what the delivery screen offers first.
                    </p>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium mb-1">
                            Reorder at ({{ stockUnit() }})
                        </label>
                        <input
                            pInputText
                            class="w-full text-right"
                            inputmode="decimal"
                            [ngModel]="reorderPoint()"
                            (ngModelChange)="reorderPoint.set($event)" />
                        <p class="text-xs text-surface-500 mt-1">
                            Below this, it appears on the order suggestion.
                        </p>
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1">
                            Par level ({{ stockUnit() }})
                        </label>
                        <input
                            pInputText
                            class="w-full text-right"
                            inputmode="decimal"
                            [ngModel]="parLevel()"
                            (ngModelChange)="parLevel.set($event)" />
                        <p class="text-xs text-surface-500 mt-1">
                            What a full shelf looks like. Orders are sized to reach it.
                        </p>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3 items-start">
                    <div>
                        <label class="block text-sm font-medium mb-1">Shelf life (days)</label>
                        <input
                            pInputText
                            class="w-full text-right"
                            inputmode="numeric"
                            placeholder="optional"
                            [ngModel]="shelfLifeDays()"
                            (ngModelChange)="shelfLifeDays.set($event)" />
                    </div>
                    <label class="flex items-start gap-2 pt-7 cursor-pointer">
                        <input
                            type="checkbox"
                            class="mt-1"
                            [checked]="isCritical()"
                            (change)="isCritical.set(!isCritical())" />
                        <span>
                            <span class="text-sm font-medium">Count this every day</span>
                            <span class="block text-xs text-surface-500">
                                For the expensive and the easily lost. Everything ticked here
                                lands on the daily count.
                            </span>
                        </span>
                    </label>
                </div>

                <!-- Existing packs are edited against the server, because a
                     pack that is already on a delivery cannot be resized. -->
                @if (current(); as item) {
                    <div class="pt-2 border-t border-surface">
                        <div class="text-sm font-medium mb-2">Pack sizes on record</div>
                        <ul class="space-y-2">
                            @for (p of item.packs; track p.id) {
                                <li class="flex flex-wrap items-center justify-between gap-2 text-sm">
                                    <span [class.text-surface-400]="!p.isActive">
                                        {{ p.packName }} = {{ qty(p.qtyInStockUnit, item.stockUnit) }}
                                        @if (p.isDefaultPurchase) {
                                            <span class="text-primary">· default</span>
                                        }
                                        @if (p.inUse) {
                                            <span class="text-xs text-surface-500">· in use</span>
                                        }
                                    </span>
                                    <span class="flex items-center gap-1">
                                        @if (p.isActive) {
                                            @if (!p.isDefaultPurchase) {
                                                <button
                                                    pButton
                                                    size="small"
                                                    text
                                                    label="Make default"
                                                    (click)="setDefaultPack(p)"></button>
                                            }
                                            <button
                                                pButton
                                                size="small"
                                                text
                                                severity="danger"
                                                label="Retire"
                                                (click)="retirePack(p)"></button>
                                        } @else {
                                            <p-tag severity="secondary" value="Retired"></p-tag>
                                        }
                                    </span>
                                </li>
                            }
                        </ul>
                    </div>
                }

                <div class="flex justify-end gap-2 pt-2">
                    <button pButton outlined label="Cancel" (click)="editing.set(false)"></button>
                    <button
                        pButton
                        icon="pi pi-check"
                        [label]="current() ? 'Save changes' : 'Create product'"
                        [disabled]="!canSave() || busy()"
                        [loading]="busy()"
                        (click)="save()"></button>
                </div>
            </div>
        </p-drawer>

        <!-- Categories ------------------------------------------------------->
        <p-drawer
            [visible]="categoriesOpen()"
            (visibleChange)="categoriesOpen.set($event)"
            position="right"
            header="Categories"
            styleClass="!w-full sm:!w-[30rem]">
            <div class="space-y-5">
                <p class="text-sm text-surface-500">
                    A category says where something is kept. It is what the storage columns in
                    the reports read.
                </p>

                <div class="space-y-2">
                    <label class="block text-sm font-medium app-req">New category</label>
                    <input
                        pInputText
                        class="w-full"
                        placeholder="e.g. Frozen fish"
                        [ngModel]="newCategoryName()"
                        (ngModelChange)="newCategoryName.set($event)" />
                    <select
                        class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                        [ngModel]="newCategoryStorage()"
                        (ngModelChange)="newCategoryStorage.set($event)">
                        @for (s of storages; track s) {
                            <option [ngValue]="s">{{ storageLabel(s) }}</option>
                        }
                    </select>
                    <button
                        pButton
                        class="w-full"
                        label="Add category"
                        [disabled]="newCategoryName().trim().length < 2"
                        (click)="addCategory()"></button>
                </div>

                <ul class="divide-y divide-surface border-t border-surface">
                    @for (c of categories(); track c.id) {
                        <li class="py-3 flex items-center justify-between gap-2">
                            <span [class.text-surface-400]="!c.isActive">
                                <span class="font-medium">{{ c.name }}</span>
                                <span class="block text-xs text-surface-500">
                                    {{ storageLabel(c.storage) }} · {{ c.itemCount }} product{{
                                        c.itemCount === 1 ? '' : 's'
                                    }}
                                </span>
                            </span>
                            @if (c.isActive) {
                                <button
                                    pButton
                                    size="small"
                                    text
                                    severity="danger"
                                    label="Retire"
                                    (click)="retireCategory(c)"></button>
                            } @else {
                                <button
                                    pButton
                                    size="small"
                                    text
                                    label="Bring back"
                                    (click)="reviveCategory(c)"></button>
                            }
                        </li>
                    }
                </ul>
            </div>
        </p-drawer>
    `
})
export class SetupItemsComponent implements OnInit {
    private api = inject(GrandService);
    private notify = inject(NotifyService);

    readonly units = UNITS;
    readonly storages: StorageType[] = [
        'dry',
        'chiller',
        'freezer',
        'bar',
        'chemical',
        'packaging',
        'gas'
    ];

    readonly retiredOptions: FilterOption<boolean>[] = [
        { value: false, label: 'In use' },
        { value: true, label: 'Including retired' }
    ];

    readonly items = signal<SetupItem[]>([]);
    readonly pageInfo = signal<Page<SetupItem>>(emptyPage<SetupItem>());
    readonly pageReq = signal<PageRequest>({ page: 1, limit: DEFAULT_PAGE_SIZE });
    readonly categories = signal<SetupCategory[]>([]);
    readonly search = signal('');
    readonly includeRetired = signal(false);
    readonly loading = signal(false);
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);
    readonly formError = signal<string | null>(null);

    readonly editing = signal(false);
    readonly categoriesOpen = signal(false);
    readonly current = signal<SetupItem | null>(null);

    readonly code = signal('');
    readonly name = signal('');
    readonly categoryId = signal<number>(0);
    readonly stockUnit = signal('g');
    readonly parLevel = signal<string | number>(0);
    readonly reorderPoint = signal<string | number>(0);
    readonly shelfLifeDays = signal<string | number>('');
    readonly isCritical = signal(false);
    readonly packs = signal<PackDraft[]>([]);

    readonly newCategoryName = signal('');
    readonly newCategoryStorage = signal<StorageType>('dry');

    private searchTimer: ReturnType<typeof setTimeout> | null = null;

    readonly activeCategories = computed(() => this.categories().filter((c) => c.isActive));

    readonly unitLocked = computed(() => !!this.current()?.hasMoved);

    readonly canSave = computed(() => {
        if (this.name().trim().length < 2) return false;
        if (!this.current() && this.code().trim().length < 2) return false;
        if (!this.categoryId()) return false;
        // Only new products carry pack drafts; an existing one edits its packs
        // against the server, one at a time.
        if (this.current()) return true;
        return this.packs().every((p) => p.packName.trim() && Number(p.qtyInStockUnit) > 0);
    });

    async ngOnInit(): Promise<void> {
        await Promise.all([this.load(), this.loadCategories()]);
    }

    qty(value: number, unit: string): string {
        return formatQty(value, unit);
    }

    storageLabel(s: StorageType): string {
        return STORAGE_LABELS[s];
    }

    activePacks(item: SetupItem): SetupPack[] {
        return item.packs.filter((p) => p.isActive);
    }

    /** What one pack comes to, spelled out - the conversion people get wrong. */
    packHint(index: number): string | null {
        const p = this.packs()[index];
        if (!p || !p.qtyInStockUnit || !p.packName.trim()) return null;
        return `One "${p.packName.trim()}" adds ${formatQty(
            Number(p.qtyInStockUnit),
            this.stockUnit()
        )} to the shelf.`;
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
            const page = await this.api.setupItems({
                ...this.pageReq(),
                search: this.search().trim() || undefined,
                includeRetired: this.includeRetired()
            });
            this.pageInfo.set(page);
            this.items.set(page.items);
            this.error.set(null);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    async loadCategories(): Promise<void> {
        try {
            this.categories.set(await this.api.setupCategories());
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        }
    }

    openCategories(): void {
        this.categoriesOpen.set(true);
    }

    openAdd(): void {
        this.current.set(null);
        this.formError.set(null);
        this.code.set('');
        this.name.set('');
        this.stockUnit.set('g');
        this.parLevel.set(0);
        this.reorderPoint.set(0);
        this.shelfLifeDays.set('');
        this.isCritical.set(false);
        this.packs.set([{ packName: '', qtyInStockUnit: null, isDefaultPurchase: true }]);
        // Deliberately no default: a category the admin did not choose is a
        // category nobody notices is wrong until a report is filed under it.
        this.categoryId.set(0);
        this.editing.set(true);
    }

    openEdit(item: SetupItem): void {
        this.current.set(item);
        this.formError.set(null);
        this.code.set(item.code);
        this.name.set(item.name);
        this.categoryId.set(item.categoryId);
        this.stockUnit.set(item.stockUnit);
        this.parLevel.set(item.parLevel);
        this.reorderPoint.set(item.reorderPoint);
        this.shelfLifeDays.set(item.shelfLifeDays ?? '');
        this.isCritical.set(item.isCritical);
        this.packs.set([]);
        this.editing.set(true);
    }

    addPackDraft(): void {
        this.packs.set([
            ...this.packs(),
            { packName: '', qtyInStockUnit: null, isDefaultPurchase: this.packs().length === 0 }
        ]);
    }

    removePackDraft(index: number): void {
        const next = this.packs().filter((_, i) => i !== index);
        // Something always has to be the default, or the delivery screen has
        // nothing to pre-select.
        if (next.length > 0 && !next.some((p) => p.isDefaultPurchase)) {
            next[0]!.isDefaultPurchase = true;
        }
        this.packs.set(next);
    }

    setPackName(index: number, value: string): void {
        this.packs.set(
            this.packs().map((p, i) => (i === index ? { ...p, packName: value } : p))
        );
    }

    setPackQty(index: number, value: string): void {
        const parsed = value === '' ? null : Number(value);
        this.packs.set(
            this.packs().map((p, i) =>
                i === index
                    ? { ...p, qtyInStockUnit: parsed !== null && isNaN(parsed) ? null : parsed }
                    : p
            )
        );
    }

    makeDefault(index: number): void {
        this.packs.set(this.packs().map((p, i) => ({ ...p, isDefaultPurchase: i === index })));
    }

    async save(): Promise<void> {
        if (!this.canSave()) return;
        this.busy.set(true);
        this.formError.set(null);
        try {
            const existing = this.current();
            if (existing) {
                await this.api.updateItem(existing.id, {
                    name: this.name().trim(),
                    categoryId: this.categoryId(),
                    stockUnit: this.unitLocked() ? undefined : this.stockUnit(),
                    parLevel: Number(this.parLevel()) || 0,
                    reorderPoint: Number(this.reorderPoint()) || 0,
                    shelfLifeDays: this.shelfLifeDays() === '' ? null : Number(this.shelfLifeDays()),
                    isCritical: this.isCritical()
                });

                // Any pack rows typed on an existing product are additions.
                for (const p of this.packs()) {
                    if (!p.packName.trim() || !p.qtyInStockUnit) continue;
                    await this.api.addPack(existing.id, {
                        packName: p.packName.trim(),
                        qtyInStockUnit: Number(p.qtyInStockUnit),
                        isDefaultPurchase: p.isDefaultPurchase
                    });
                }
                this.notify.success(`${this.name().trim()} saved`);
            } else {
                await this.api.createItem({
                    code: this.code().trim(),
                    name: this.name().trim(),
                    categoryId: this.categoryId(),
                    stockUnit: this.stockUnit(),
                    parLevel: Number(this.parLevel()) || 0,
                    reorderPoint: Number(this.reorderPoint()) || 0,
                    shelfLifeDays: this.shelfLifeDays() === '' ? null : Number(this.shelfLifeDays()),
                    isCritical: this.isCritical(),
                    packs: this.packs().map((p) => ({
                        packName: p.packName.trim(),
                        qtyInStockUnit: Number(p.qtyInStockUnit),
                        isDefaultPurchase: p.isDefaultPurchase
                    }))
                });
                this.notify.success(`${this.name().trim()} added`);
            }
            this.editing.set(false);
            await this.load();
        } catch (err) {
            this.formError.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    async setActive(item: SetupItem, isActive: boolean): Promise<void> {
        if (!isActive) {
            const ok = await this.notify.confirm(
                `${item.name} will stop appearing on new requests and deliveries. Everything already recorded against it stays exactly as it is.`,
                'Retire this product?',
                'Retire'
            );
            if (!ok) return;
        }
        try {
            await this.api.updateItem(item.id, { isActive });
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    async setDefaultPack(pack: SetupPack): Promise<void> {
        try {
            await this.api.updatePack(pack.id, { isDefaultPurchase: true });
            await this.refreshCurrent();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    async retirePack(pack: SetupPack): Promise<void> {
        const ok = await this.notify.confirm(
            `"${pack.packName}" will not be offered on new deliveries. Past deliveries in it are untouched.`,
            'Retire this pack size?',
            'Retire'
        );
        if (!ok) return;
        try {
            await this.api.updatePack(pack.id, { isActive: false });
            await this.refreshCurrent();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    /** Reloads the list and re-points the open drawer at the fresh row. */
    private async refreshCurrent(): Promise<void> {
        const id = this.current()?.id;
        await this.load();
        if (id) {
            const fresh = this.items().find((i) => i.id === id);
            if (fresh) this.current.set(fresh);
        }
    }

    async addCategory(): Promise<void> {
        try {
            await this.api.createCategory({
                name: this.newCategoryName().trim(),
                storage: this.newCategoryStorage()
            });
            this.newCategoryName.set('');
            await this.loadCategories();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    async retireCategory(category: SetupCategory): Promise<void> {
        try {
            await this.api.updateCategory(category.id, { isActive: false });
            await this.loadCategories();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    async reviveCategory(category: SetupCategory): Promise<void> {
        try {
            await this.api.updateCategory(category.id, { isActive: true });
            await this.loadCategories();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }
}
