/**
 * Admin overview - is this system ready to be trusted?
 *
 * Every other admin screen answers "how do I change this one thing". None of
 * them answers the question the owner actually asks on the day of cutover:
 * what is already set up, and what is still missing. That question was only
 * answerable by opening four screens and counting, so it went unasked until
 * something broke in week two.
 *
 * Everything here is read back from the same endpoints the setup screens
 * write to. There is no separate readiness table to drift out of date, and no
 * check that can pass while the thing it describes is untrue.
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { GrandService } from '@/core/grand.service';
import { apiErrorMessage } from '@/core/api';
import { AuthStore } from '@/core/auth.store';
import { ROLE_LABELS, type Role } from '@/core/types';
import type {
    ManagedUser,
    OpeningSection,
    SectionKind,
    SetupBranch,
    SetupCategory,
    SetupItem,
    SetupSupplier
} from '@/core/types';

/** One line of the go-live checklist. */
interface Check {
    key: string;
    label: string;
    /** What breaks if this is skipped. Written for the owner, not the build. */
    why: string;
    done: boolean;
    count: number;
    unit: string;
    link: string;
    action: string;
    /** Somebody else's step: this role cannot see or do it. Not counted. */
    blocked?: string;
}

/** Something already set up that is wrong or incomplete. */
interface Gap {
    label: string;
    detail: string;
    count: number;
    severity: 'low' | 'out';
    link: string;
    action: string;
}

/** Items are paged; the checks need all of them. 5 × 200 covers any real master. */
const ITEM_PAGE = 200;
const ITEM_PAGE_CAP = 5;

@Component({
    selector: 'grand-admin-overview',
    standalone: true,
    imports: [CommonModule, RouterLink, ButtonModule],
    template: `
        <div class="pagehead">
            <h1 class="pagehead__title">Admin overview</h1>
            <p class="pagehead__sub">
                What the system is made of, and what is still missing. Everything below is read
                back from the setup screens, so it is never out of date.
            </p>
        </div>

        @if (error()) {
            <div class="app-note app-note--error mb-4">
                <div class="app-note__title">Could not load the overview</div>
                <p class="mt-1">{{ error() }}</p>
                <button
                    pButton
                    class="mt-2"
                    severity="secondary"
                    size="small"
                    label="Try again"
                    (click)="load()"
                ></button>
            </div>
        }

        @if (loading()) {
            <div class="empty">
                <div class="empty__rule"></div>
                <div class="empty__title">Counting what is set up</div>
                <div class="empty__body">Reading branches, products, suppliers and logins.</div>
            </div>
        } @else if (!error()) {
            <!-- ── The census ────────────────────────────────────────────── -->
            <div class="grid gap-3 mb-5" style="grid-template-columns:repeat(auto-fit,minmax(158px,1fr))">
                <a class="stat stat--brass" routerLink="/setup/branches">
                    <div class="stat__label">Outlets</div>
                    <div class="stat__value">{{ activeBranches().length }}</div>
                    <div class="stat__note">{{ sectionCount() }} sections inside them</div>
                </a>
                <a class="stat" routerLink="/setup/items">
                    <div class="stat__label">Products</div>
                    <div class="stat__value">{{ activeItems().length }}</div>
                    <div class="stat__note">
                        in {{ activeCategories().length }}
                        {{ activeCategories().length === 1 ? 'category' : 'categories' }}
                    </div>
                </a>
                <a class="stat" routerLink="/setup/suppliers">
                    <div class="stat__label">Suppliers</div>
                    <div class="stat__value">{{ activeSuppliers().length }}</div>
                </a>
                <a class="stat" routerLink="/users">
                    <div class="stat__label">Logins</div>
                    <div class="stat__value">{{ activeUsers().length }}</div>
                    <div class="stat__note">{{ lockedUsers().length }} locked out</div>
                </a>
                @if (openingVisible()) {
                    <a
                        class="stat"
                        [class.stat--low]="sectionsAwaitingOpening().length > 0"
                        routerLink="/opening"
                    >
                        <div class="stat__label">Opening stock</div>
                        <div class="stat__value">
                            {{ openingDone().length }}/{{ opening().length }}
                        </div>
                        <div class="stat__note">sections with a starting balance</div>
                    </a>
                }
            </div>

            <div class="grid gap-4" style="grid-template-columns:repeat(auto-fit,minmax(400px,1fr))">
                <!-- ── Before go-live ────────────────────────────────────── -->
                <section class="panel">
                    <div class="panel__head">
                        <span class="panel__title">Before go-live</span>
                        <span class="topbar__spacer"></span>
                        <span
                            class="chip"
                            [class.chip--ok]="doneChecks() === countedChecks().length"
                            [class.chip--low]="doneChecks() < countedChecks().length"
                        >
                            {{ doneChecks() }} of {{ countedChecks().length }} done
                        </span>
                    </div>
                    <div>
                        @for (c of checks(); track c.key) {
                            <div
                                class="flex items-start gap-3 px-4 py-3 border-b border-surface last:border-b-0"
                            >
                                <i
                                    class="pi mt-0.5"
                                    [class.pi-check-circle]="c.done"
                                    [class.pi-minus-circle]="!c.done && !!c.blocked"
                                    [class.pi-circle]="!c.done && !c.blocked"
                                    [style.color]="c.done ? 'var(--g-ok)' : 'var(--g-rule-strong)'"
                                    aria-hidden="true"
                                ></i>
                                <div class="min-w-0 flex-1">
                                    <div class="font-medium">{{ c.label }}</div>
                                    <div class="text-xs text-surface-500 mt-0.5">
                                        {{ c.blocked ?? c.why }}
                                    </div>
                                </div>
                                @if (!c.blocked) {
                                    <div class="text-right shrink-0">
                                        <div class="fig text-sm font-medium">{{ c.count }}</div>
                                        <div class="text-[11px] text-surface-500">{{ c.unit }}</div>
                                    </div>
                                }
                                @if (!c.done && !c.blocked) {
                                    <a
                                        class="chip chip--brass shrink-0 mt-0.5"
                                        [routerLink]="c.link"
                                        >{{ c.action }}</a
                                    >
                                }
                            </div>
                        }
                    </div>
                </section>

                <!-- ── Needs attention ───────────────────────────────────── -->
                <section class="panel">
                    <div class="panel__head">
                        <span class="panel__title">Needs attention</span>
                        <span class="topbar__spacer"></span>
                        <span class="chip" [class.chip--low]="gaps().length > 0">
                            {{ gaps().length }} open
                        </span>
                    </div>

                    @if (gaps().length === 0) {
                        <div class="empty">
                            <div class="empty__rule" style="background:var(--g-ok)"></div>
                            <div class="empty__title">Nothing to fix</div>
                            <div class="empty__body">
                                Every product can be ordered and every login has somewhere to work.
                            </div>
                        </div>
                    } @else {
                        <div>
                            @for (g of gaps(); track g.label) {
                                <div
                                    class="flex items-start gap-3 px-4 py-3 border-b border-surface last:border-b-0"
                                    [style.box-shadow]="
                                        'inset 3px 0 0 ' +
                                        (g.severity === 'out' ? 'var(--g-out)' : 'var(--g-low)')
                                    "
                                >
                                    <div class="min-w-0 flex-1">
                                        <div class="font-medium">{{ g.label }}</div>
                                        <div class="text-xs text-surface-500 mt-0.5">
                                            {{ g.detail }}
                                        </div>
                                    </div>
                                    <div class="text-right shrink-0">
                                        <div
                                            class="fig text-sm font-semibold"
                                            [style.color]="
                                                g.severity === 'out'
                                                    ? 'var(--g-out)'
                                                    : 'var(--g-low)'
                                            "
                                        >
                                            {{ g.count }}
                                        </div>
                                    </div>
                                    <a class="chip shrink-0 mt-0.5" [routerLink]="g.link">{{
                                        g.action
                                    }}</a>
                                </div>
                            }
                        </div>
                    }
                </section>

                <!-- ── Who can sign in ───────────────────────────────────── -->
                <section class="panel">
                    <div class="panel__head">
                        <span class="panel__title">Who can sign in</span>
                        <span class="topbar__spacer"></span>
                        <a class="chip chip--brass" routerLink="/users">Manage logins</a>
                    </div>
                    <table class="ledger">
                        <thead>
                            <tr>
                                <th>Role</th>
                                <th>What they do</th>
                                <th class="num">People</th>
                            </tr>
                        </thead>
                        <tbody>
                            @for (r of roleCounts(); track r.role) {
                                <tr [class.flagged]="r.count === 0 && r.role !== 'cleaning'">
                                    <td class="font-medium">{{ r.label }}</td>
                                    <td class="text-surface-500">{{ r.does }}</td>
                                    <td class="num">{{ r.count }}</td>
                                </tr>
                            }
                        </tbody>
                    </table>
                </section>

                <!-- ── Where stock lives ─────────────────────────────────── -->
                <section class="panel">
                    <div class="panel__head">
                        <span class="panel__title">Where stock lives</span>
                        <span class="topbar__spacer"></span>
                        <a class="chip chip--brass" routerLink="/setup/branches">Edit sections</a>
                    </div>
                    <table class="ledger">
                        <thead>
                            <tr>
                                <th>Outlet</th>
                                <th>Sections</th>
                                <th class="num">Day starts</th>
                            </tr>
                        </thead>
                        <tbody>
                            @for (b of activeBranches(); track b.id) {
                                <tr>
                                    <td>
                                        <div class="font-medium">{{ b.name }}</div>
                                        <div class="code">{{ b.code }}</div>
                                    </td>
                                    <td>
                                        <div class="flex flex-wrap gap-1.5">
                                            @for (s of activeSectionsOf(b); track s.id) {
                                                <span
                                                    class="chip"
                                                    [class.chip--brass]="s.isStore"
                                                    [title]="s.kindLabel"
                                                    >{{ s.name }}</span
                                                >
                                            }
                                            @if (activeSectionsOf(b).length === 0) {
                                                <span class="text-surface-500 text-xs"
                                                    >No sections yet</span
                                                >
                                            }
                                        </div>
                                    </td>
                                    <td class="num">{{ b.dayStart }}</td>
                                </tr>
                            }
                        </tbody>
                    </table>
                </section>
            </div>

            @if (itemsTruncated()) {
                <div class="app-note app-note--warn mt-4">
                    <div class="app-note__title">Counted the first {{ itemsSeen() }} products</div>
                    <p class="mt-1">
                        The product master is larger than this screen reads in one go. The checks
                        above cover the first {{ itemsSeen() }}; open Products to see the rest.
                    </p>
                </div>
            }
        }
    `
})
export class AdminOverviewComponent implements OnInit {
    private api = inject(GrandService);
    private auth = inject(AuthStore);

    readonly loading = signal(true);
    readonly error = signal<string | null>(null);

    readonly branches = signal<SetupBranch[]>([]);
    readonly categories = signal<SetupCategory[]>([]);
    readonly items = signal<SetupItem[]>([]);
    readonly suppliers = signal<SetupSupplier[]>([]);
    readonly users = signal<ManagedUser[]>([]);
    readonly sectionKinds = signal<SectionKind[]>([]);
    readonly opening = signal<OpeningSection[]>([]);
    /** False when the signed-in role may not read opening balances. */
    readonly openingVisible = signal(true);
    readonly itemsTruncated = signal(false);

    readonly itemsSeen = computed(() => this.items().length);

    ngOnInit(): void {
        void this.load();
    }

    async load(): Promise<void> {
        this.loading.set(true);
        this.error.set(null);
        try {
            const locationId = this.auth.locationId();
            const [branches, categories, suppliers, users, kinds] = await Promise.all([
                this.api.setupBranches(),
                this.api.setupCategories(),
                this.api.setupSuppliers({ limit: ITEM_PAGE, includeRetired: true }),
                this.api.listUsers({ limit: ITEM_PAGE }),
                this.api.sectionKinds()
            ]);

            this.branches.set(branches);
            this.categories.set(categories);
            this.suppliers.set(suppliers.items);
            this.users.set(users.items);
            this.sectionKinds.set(kinds);
            await Promise.all([this.loadAllItems(), this.loadOpening()]);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    /** Pages through the product master so the pack and reorder checks are real. */
    private async loadAllItems(): Promise<void> {
        const all: SetupItem[] = [];
        let page = 1;
        let pageCount = 1;
        while (page <= pageCount && page <= ITEM_PAGE_CAP) {
            const res = await this.api.setupItems({ page, limit: ITEM_PAGE });
            all.push(...res.items);
            pageCount = res.pageCount;
            page += 1;
        }
        this.items.set(all);
        this.itemsTruncated.set(pageCount > ITEM_PAGE_CAP);
    }

    /**
     * Opening balances are the store's business, not the admin's - the endpoint
     * is management and storekeeper only, because entering one writes real
     * quantities and real money. So an admin signed in here gets a refusal
     * rather than a list, and that is correct.
     *
     * A refusal must not take the rest of the page down with it. The line stays
     * on the checklist, marked as somebody else's to complete, and is left out
     * of the count so the tally never reads "7 of 8 done" for a step this
     * person cannot do anything about.
     */
    private async loadOpening(): Promise<void> {
        try {
            this.opening.set(await this.api.openingState());
            this.openingVisible.set(true);
        } catch {
            this.opening.set([]);
            this.openingVisible.set(false);
        }
    }

    // ── Slices ──────────────────────────────────────────────────────────────

    readonly activeBranches = computed(() => this.branches().filter((b) => b.isActive));
    readonly activeCategories = computed(() => this.categories().filter((c) => c.isActive));
    readonly activeItems = computed(() => this.items().filter((i) => i.isActive));
    readonly activeSuppliers = computed(() => this.suppliers().filter((s) => s.isActive));
    readonly activeUsers = computed(() => this.users().filter((u) => u.isActive));
    readonly lockedUsers = computed(() => this.users().filter((u) => u.isActive && u.isLocked));

    readonly sectionCount = computed(() =>
        this.activeBranches().reduce((n, b) => n + this.activeSectionsOf(b).length, 0)
    );

    readonly openingDone = computed(() => this.opening().filter((s) => !s.canOpen));
    readonly sectionsAwaitingOpening = computed(() => this.opening().filter((s) => s.canOpen));

    activeSectionsOf(b: SetupBranch) {
        return b.sections.filter((s) => s.isActive);
    }

    // ── The checklist ───────────────────────────────────────────────────────

    readonly checks = computed<Check[]>(() => {
        const branches = this.activeBranches();
        const items = this.activeItems();
        const suppliers = this.activeSuppliers();

        return [
            {
                key: 'branches',
                label: 'An outlet with its sections',
                why: 'Stock is held by section. Without them there is nowhere to put anything.',
                done: branches.length > 0 && this.sectionCount() > 0,
                count: this.sectionCount(),
                unit: 'sections',
                link: '/setup/branches',
                action: 'Add'
            },
            {
                key: 'categories',
                label: 'Categories, with a storage type',
                why: 'Storage type decides what a count sheet looks like and what spoils.',
                done: this.activeCategories().length > 0,
                count: this.activeCategories().length,
                unit: 'categories',
                link: '/setup/items',
                action: 'Add'
            },
            {
                key: 'items',
                label: 'The product master',
                why: 'Every item you hold, in the unit you count it in.',
                done: items.length > 0,
                count: items.length,
                unit: 'products',
                link: '/setup/items',
                action: 'Add'
            },
            {
                key: 'packs',
                label: 'A purchase pack on each product',
                why: 'Orders are raised in packs - a case, a 20 L can - not in grams.',
                done: items.length > 0 && this.itemsWithoutPack().length === 0,
                count: items.length - this.itemsWithoutPack().length,
                unit: 'have one',
                link: '/setup/items',
                action: 'Fix'
            },
            {
                key: 'suppliers',
                label: 'Suppliers you buy from',
                why: 'A delivery has to be received against somebody.',
                done: suppliers.length > 0,
                count: suppliers.length,
                unit: 'suppliers',
                link: '/setup/suppliers',
                action: 'Add'
            },
            {
                key: 'logins',
                label: 'A login for each person',
                why: 'Every entry is signed. A shared login means nobody took anything.',
                done: this.activeUsers().length > 1,
                count: this.activeUsers().length,
                unit: 'people',
                link: '/users',
                action: 'Add'
            },
            {
                key: 'opening',
                label: 'Opening balance per section',
                why: 'Entered once, before the first delivery. After that the ledger owns it.',
                done:
                    this.openingVisible() &&
                    this.opening().length > 0 &&
                    this.sectionsAwaitingOpening().length === 0,
                count: this.openingDone().length,
                unit: this.openingVisible() ? 'of ' + this.opening().length : 'sections',
                link: '/opening',
                action: 'Enter',
                blocked: this.openingVisible()
                    ? undefined
                    : 'The storekeeper enters this - an admin login cannot see the balances.'
            }
        ];
    });

    /** Steps this role can actually complete. A blocked step is not a failure. */
    readonly countedChecks = computed(() => this.checks().filter((c) => !c.blocked));
    readonly doneChecks = computed(() => this.countedChecks().filter((c) => c.done).length);

    /** Cannot be ordered: nothing to order it in. */
    private readonly itemsWithoutPack = computed(() =>
        this.activeItems().filter((i) => i.packs.filter((p) => p.isActive).length === 0)
    );

    /** Ordered in packs, but no pack is marked as the one you normally buy. */
    private readonly itemsWithoutDefaultPack = computed(() =>
        this.activeItems().filter(
            (i) =>
                i.packs.some((p) => p.isActive) &&
                !i.packs.some((p) => p.isActive && p.isDefaultPurchase)
        )
    );

    /** Never appears on a suggested order, however low it goes. */
    private readonly itemsWithoutReorder = computed(() =>
        this.activeItems().filter((i) => !i.reorderPoint || i.reorderPoint <= 0)
    );

    private readonly usersWithoutLocation = computed(() =>
        this.activeUsers().filter((u) => u.role !== 'admin' && u.locationId === null)
    );

    /**
     * People whose branch has no section they can stand at.
     *
     * Adding a login and adding a section are two screens that never mention
     * each other, and a new branch is created with only a Main store - so a
     * kitchen or cleaning login at a branch whose kitchen or cleaning store was
     * never added, or was later switched off, is easy to make and impossible to
     * notice. Nothing goes wrong until that person taps Send on a request and
     * the server tells them they are not attached to a section, which is a long
     * way from the screen where it could have been fixed.
     *
     * Judged on `ownedBy` from the server's own table rather than a copy of the
     * rule kept here, so this cannot drift from what the API will actually
     * refuse. Management and admin stand at no shelf of their own, so they are
     * never counted.
     */
    readonly usersWithNoSection = computed(() => {
        const kinds = this.sectionKinds();
        if (kinds.length === 0) return [];
        const byId = new Map(this.branches().map((b) => [b.id, b]));

        return this.activeUsers().flatMap((u) => {
            const wanted = kinds.filter((k) => k.ownedBy.includes(u.role)).map((k) => k.kind);
            if (wanted.length === 0 || u.locationId === null) return [];

            const branch = byId.get(u.locationId);
            if (!branch) return [];
            const open = branch.sections.filter((s) => s.isActive && wanted.includes(s.kind));
            if (open.length > 0) return [];

            // "switched off" and "never added" are different repairs, so the
            // line says which one this is.
            const switchedOff = branch.sections.filter((s) => wanted.includes(s.kind));
            return [
                {
                    name: u.name,
                    role: u.role,
                    branch: branch.name,
                    reason: switchedOff.length
                        ? `${switchedOff.map((s) => s.name).join(', ')} is switched off`
                        : 'no section of their kind here'
                }
            ];
        });
    });

    private readonly emptyCategories = computed(() =>
        this.activeCategories().filter((c) => c.itemCount === 0)
    );

    readonly gaps = computed<Gap[]>(() => {
        const out: Gap[] = [];

        if (this.itemsWithoutPack().length > 0) {
            out.push({
                label: 'Products with no pack',
                detail: 'Cannot be put on a purchase order or received on a delivery.',
                count: this.itemsWithoutPack().length,
                severity: 'out',
                link: '/setup/items',
                action: 'Products'
            });
        }
        if (this.lockedUsers().length > 0) {
            out.push({
                label: 'Logins locked out',
                detail: 'Too many wrong PINs. They cannot sign in until you unlock them.',
                count: this.lockedUsers().length,
                severity: 'out',
                link: '/users',
                action: 'Unlock'
            });
        }
        if (this.usersWithNoSection().length > 0) {
            const who = this.usersWithNoSection();
            out.push({
                label: 'Logins with nowhere to work',
                detail:
                    who
                        .slice(0, 3)
                        .map((w) => `${w.name} at ${w.branch} - ${w.reason}`)
                        .join('; ') + (who.length > 3 ? `; and ${who.length - 3} more` : ''),
                count: who.length,
                severity: 'out',
                link: '/setup/branches',
                action: 'Sections'
            });
        }
        if (this.usersWithoutLocation().length > 0) {
            out.push({
                label: 'Logins with no outlet',
                detail: 'They can sign in, but there is no store for them to ask.',
                count: this.usersWithoutLocation().length,
                severity: 'out',
                link: '/users',
                action: 'Logins'
            });
        }
        if (this.openingVisible() && this.sectionsAwaitingOpening().length > 0) {
            out.push({
                label: 'Sections with no opening balance',
                detail: 'They start at zero, so the first count will read as a huge gain.',
                count: this.sectionsAwaitingOpening().length,
                severity: 'low',
                link: '/opening',
                action: 'Enter'
            });
        }
        if (this.itemsWithoutDefaultPack().length > 0) {
            out.push({
                label: 'Products with no usual pack',
                detail: 'Orderable, but whoever raises the order has to pick the size each time.',
                count: this.itemsWithoutDefaultPack().length,
                severity: 'low',
                link: '/setup/items',
                action: 'Products'
            });
        }
        if (this.itemsWithoutReorder().length > 0) {
            out.push({
                label: 'Products with no reorder point',
                detail: 'They will never appear on a suggested order, however low they run.',
                count: this.itemsWithoutReorder().length,
                severity: 'low',
                link: '/setup/items',
                action: 'Products'
            });
        }
        if (this.emptyCategories().length > 0) {
            out.push({
                label: 'Categories with nothing in them',
                detail: 'Harmless, but they clutter every product filter in the app.',
                count: this.emptyCategories().length,
                severity: 'low',
                link: '/setup/items',
                action: 'Products'
            });
        }

        return out;
    });

    // ── Roles ───────────────────────────────────────────────────────────────

    private static readonly ROLE_DOES: Record<Role, string> = {
        admin: 'Sets the system up and hands out logins',
        management: 'Decides purchases and reads the reports',
        storekeeper: 'Receives deliveries and releases stock',
        kitchen: 'Asks the store for what they need',
        cleaning: 'Asks the store for cleaning supplies'
    };

    readonly roleCounts = computed(() => {
        const roles: Role[] = ['admin', 'management', 'storekeeper', 'kitchen', 'cleaning'];
        const active = this.activeUsers();
        return roles.map((role) => ({
            role,
            label: ROLE_LABELS[role],
            does: AdminOverviewComponent.ROLE_DOES[role],
            count: active.filter((u) => u.role === role).length
        }));
    });
}
