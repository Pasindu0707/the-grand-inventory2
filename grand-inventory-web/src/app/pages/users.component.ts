/**
 * Manage logins. The admin's only screen.
 *
 * Four fields to add somebody: name, what they do, which branch, and a PIN.
 * The PIN is shown once, in plain text, immediately after creating the account
 * - because the admin has to read it out to the person standing there, and a
 * system that hides it just gets a sticky note on the tablet instead.
 *
 * Nobody is ever deleted, only switched off: their name is on every document
 * they created, and the ledger does not forget.
 */
import { Component, computed, inject, input, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { DrawerModule } from 'primeng/drawer';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import {
    ROLE_LABELS,
    type Branch,
    type ManagedUser,
    type Role,
    type SectionKind,
    type SetupBranch
} from '@/core/types';
import { DEFAULT_PAGE_SIZE, emptyPage, type Page, type PageRequest } from '@/core/types';
import { AppPaginator, type PageChange } from '@/shared/paginator.component';

const ROLE_HINTS: Record<Role, string> = {
    admin: 'Adds and removes logins. Cannot touch stock.',
    management: 'Approves requests and purchases. Sees all reports.',
    storekeeper: 'Holds the store. Releases stock to sections.',
    kitchen: 'Asks the store for stock and confirms it arrived.',
    cleaning: 'Asks the store for cleaning supplies and confirms they arrived.'
};

@Component({
    selector: 'app-users',
    standalone: true,
    imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, TagModule, DrawerModule, AppPaginator],
    template: `
        <!-- No max-width: the role cards are the whole screen for an admin, and
             capping them left a third of a wide monitor empty. -->
        <div class="space-y-8">
            <div class="flex flex-wrap items-center justify-between gap-3">
                @if (showHeading()) {
                    <div>
                        <h1 class="text-2xl font-bold">Logins</h1>
                        <p class="text-surface-500 text-sm">Who can sign in, and what they can do</p>
                    </div>
                }
                <button
                    class="ml-auto"
                    pButton
                    icon="pi pi-plus"
                    label="Add someone"
                    (click)="openAdd()"></button>
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            @if (justCreated(); as created) {
                <div class="app-note app-note--ok app-note--strong">
                    <div class="app-note__title text-lg">
                        {{ created.name }} can now sign in
                    </div>
                    <p class="text-sm mt-1">
                        Tell them this PIN. It will not be shown again.
                    </p>
                    <div class="app-note__title mt-3 text-4xl font-mono font-bold tracking-widest">
                        {{ created.pin }}
                    </div>
                    <button pButton text size="small" label="Got it" class="mt-2" (click)="justCreated.set(null)"></button>
                </div>
            }

            <!-- The form is a right-hand drawer rather than a block pushed into
                 the page: adding somebody is an errand, not part of reading the
                 list, and inlining it shoved every role card down the screen. -->
            <p-drawer
                [visible]="adding()"
                (visibleChange)="adding.set($event)"
                position="right"
                header="Add someone"
                styleClass="!w-full sm:!w-[34rem]">
                <div class="space-y-5">
                    <div>
                        <label class="block text-sm font-medium mb-1 app-req">Their name</label>
                        <input
                            pInputText
                            class="w-full"
                            placeholder="e.g. Kamal Perera"
                            [ngModel]="name()"
                            (ngModelChange)="name.set($event)" />
                        <p class="text-xs text-surface-500 mt-1">
                            This is what they tap on the sign-in screen.
                        </p>
                    </div>

                    <div>
                        <label class="block text-sm font-medium mb-2">What do they do?</label>
                        <div class="grid grid-cols-1 gap-2">
                            @for (r of roles; track r) {
                                <button
                                    type="button"
                                    class="text-left p-3 rounded-xl border transition"
                                    [class.border-primary]="role() === r"
                                    [class.bg-primary-50]="role() === r"
                                    [class.dark:bg-primary-950]="role() === r"
                                    [class.border-surface]="role() !== r"
                                    (click)="role.set(r)">
                                    <div class="font-medium">{{ roleLabel(r) }}</div>
                                    <div class="text-xs text-surface-500">{{ roleHint(r) }}</div>
                                </button>
                            }
                        </div>
                    </div>

                    <div>
                        <label class="block text-sm font-medium mb-1">Which branch?</label>
                        <select
                            class="w-full px-3 py-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900"
                            [ngModel]="locationId()"
                            (ngModelChange)="locationId.set($event === 'null' ? null : +$event)">
                            @for (b of branches(); track b.id) {
                                <option [ngValue]="b.id">{{ b.name }}</option>
                            }
                            <option [ngValue]="null">All branches (management and admin)</option>
                        </select>

                        <!-- Adding a login and adding a section are two screens
                             that never mention each other, and a new branch
                             arrives with only a Main store. Without this, the
                             first anyone hears of it is the person tapping Send
                             on a request and being told they are not attached
                             to a section. -->
                        @if (noSectionWarning(); as warning) {
                            <div class="app-note app-note--warn mt-2">
                                <div class="app-note__title">
                                    Nowhere for them to work yet
                                </div>
                                <p class="mt-1">{{ warning }}</p>
                                <p class="mt-1">
                                    You can still create the login - they will be able to sign in,
                                    but not ask the store for anything until the section is on.
                                </p>
                            </div>
                        }
                    </div>

                    <div>
                        <label class="block text-sm font-medium mb-1 app-req">PIN (4 digits)</label>
                        <div class="flex items-center gap-2">
                            <input
                                pInputText
                                class="w-32 text-2xl font-mono tracking-widest text-center"
                                maxlength="4"
                                inputmode="numeric"
                                [ngModel]="pin()"
                                (ngModelChange)="setPin($event)" />
                            <button pButton outlined size="small" label="Suggest one" (click)="suggestPin()"></button>
                        </div>
                    </div>

                    <div class="flex justify-end gap-2 pt-2">
                        <button pButton outlined label="Cancel" (click)="adding.set(false)"></button>
                        <button
                            pButton
                            label="Create login"
                            icon="pi pi-check"
                            [disabled]="!canCreate() || busy()"
                            [loading]="busy()"
                            (click)="create()"></button>
                    </div>
                </div>
            </p-drawer>

            <!-- Two columns of role cards. items-start so a short card (one
                 storekeeper) does not stretch to match a long one (five cooks). -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                @for (group of grouped(); track group.role) {
                <div class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                    <div class="px-5 py-4 border-b border-surface">
                        <div class="font-semibold">{{ roleLabel(group.role) }}</div>
                        <div class="text-xs text-surface-500">{{ roleHint(group.role) }}</div>
                    </div>
                    <ul class="divide-y divide-surface">
                        @for (u of group.users; track u.id) {
                            <li class="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                                <div class="min-w-0">
                                    <div class="font-medium" [class.text-surface-400]="!u.isActive">
                                        {{ u.name }}
                                    </div>
                                    <div class="text-xs text-surface-500">
                                        {{ u.locationCode ?? 'All branches' }}
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    @if (!u.isActive) {
                                        <p-tag severity="secondary" value="Switched off"></p-tag>
                                        <button pButton size="small" outlined label="Turn back on" (click)="setActive(u, true)"></button>
                                    } @else {
                                        @if (u.isLocked) {
                                            <p-tag severity="danger" value="Locked out"></p-tag>
                                            <button pButton size="small" label="Unlock" (click)="unlock(u)"></button>
                                        }
                                        <button pButton size="small" text label="New PIN" (click)="resetPin(u)"></button>
                                        <button pButton size="small" text severity="danger" label="Switch off" (click)="setActive(u, false)"></button>
                                    }
                                </div>
                            </li>
                        }
                    </ul>
                </div>
                }
            </div>

            <app-paginator [page]="pageInfo()" (pageChange)="onPageChange($event)" />
        </div>
    `
})
export class UsersComponent implements OnInit {
    /**
     * Home renders this component inline for the admin, and supplies its own
     * greeting, so the "Logins" title would be a second heading stacked on the
     * first. The "Add someone" button is never hidden - it is the only way in.
     */
    readonly showHeading = input(true);

    private api = inject(GrandService);
    private notify = inject(NotifyService);

    readonly roles: Role[] = ['kitchen', 'cleaning', 'storekeeper', 'management', 'admin'];

    readonly users = signal<ManagedUser[]>([]);
    readonly pageInfo = signal<Page<ManagedUser>>(emptyPage<ManagedUser>());
    readonly pageReq = signal<PageRequest>({ page: 1, limit: DEFAULT_PAGE_SIZE });
    readonly branches = signal<Branch[]>([]);
    /** The same branches with their sections, which `/admin/branches` omits. */
    readonly branchDetail = signal<SetupBranch[]>([]);
    readonly sectionKinds = signal<SectionKind[]>([]);
    readonly adding = signal(false);
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);
    readonly justCreated = signal<{ name: string; pin: string } | null>(null);

    readonly name = signal('');
    readonly role = signal<Role>('kitchen');
    readonly locationId = signal<number | null>(null);
    readonly pin = signal('');

    readonly canCreate = computed(
        () => this.name().trim().length >= 2 && /^\d{4}$/.test(this.pin())
    );

    /**
     * Does the branch on the form have a shelf this role can stand at?
     *
     * `ownedBy` comes from the server's own section-kind table rather than a
     * copy of the rule kept here, so this warning and the refusal the API would
     * eventually give cannot disagree. Management and admin stand at no shelf,
     * so they never trigger it.
     */
    readonly noSectionWarning = computed<string | null>(() => {
        const locationId = this.locationId();
        const kinds = this.sectionKinds();
        if (locationId === null || kinds.length === 0) return null;

        const wanted = kinds.filter((k) => k.ownedBy.includes(this.role()));
        if (wanted.length === 0) return null;

        const branch = this.branchDetail().find((b) => b.id === locationId);
        if (!branch) return null;

        const wantedKinds = wanted.map((k) => k.kind);
        const open = branch.sections.filter((s) => s.isActive && wantedKinds.includes(s.kind));
        if (open.length > 0) return null;

        const off = branch.sections.filter((s) => wantedKinds.includes(s.kind));
        const what = wanted.map((k) => k.label).join(' or ');
        return off.length
            ? `${branch.name} has ${off.map((s) => `"${s.name}"`).join(' and ')}, but it is switched off. Turn it back on under Branches and sections.`
            : `${branch.name} has no ${what} section. Add one under Branches and sections.`;
    });

    readonly grouped = computed(() => {
        const order: Role[] = ['management', 'storekeeper', 'kitchen', 'cleaning', 'admin'];
        return order
            .map((role) => ({ role, users: this.users().filter((u) => u.role === role) }))
            .filter((g) => g.users.length > 0);
    });

    async ngOnInit(): Promise<void> {
        await this.load();
    }

    onPageChange(e: PageChange): void {
        this.pageReq.set(e);
        void this.load();
    }

    async load(): Promise<void> {
        try {
            const [users, branches, branchDetail, kinds] = await Promise.all([
                this.api.listUsers({ ...this.pageReq() }),
                this.api.listBranches(),
                this.api.setupBranches(),
                this.api.sectionKinds()
            ]);
            this.pageInfo.set(users);
            this.users.set(users.items);
            this.branches.set(branches);
            this.branchDetail.set(branchDetail);
            this.sectionKinds.set(kinds);
            if (this.locationId() === null && branches.length > 0) {
                this.locationId.set(branches[0].id);
            }
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        }
    }

    roleLabel(role: Role): string {
        return ROLE_LABELS[role];
    }

    roleHint(role: Role): string {
        return ROLE_HINTS[role];
    }

    /** Opens the drawer on a clean form. The drawer closes itself (X, mask, Esc). */
    openAdd(): void {
        this.name.set('');
        this.pin.set('');
        this.suggestPin();
        this.adding.set(true);
    }

    setPin(value: string): void {
        this.pin.set(value.replace(/\D/g, '').slice(0, 4));
    }

    /** Avoids 1234 and 0000, which is where people go unprompted. */
    suggestPin(): void {
        let candidate = '1234';
        while (['1234', '0000', '1111', '4321'].includes(candidate)) {
            candidate = String(Math.floor(1000 + Math.random() * 9000));
        }
        this.pin.set(candidate);
    }

    async create(): Promise<void> {
        if (!this.canCreate()) return;
        this.busy.set(true);
        this.error.set(null);
        try {
            const created = await this.api.createUser({
                name: this.name().trim(),
                role: this.role(),
                locationId: this.locationId(),
                pin: this.pin()
            });
            this.justCreated.set({ name: created.name, pin: this.pin() });
            this.adding.set(false);
            await this.load();
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    async setActive(user: ManagedUser, isActive: boolean): Promise<void> {
        if (!isActive) {
            const ok = await this.notify.confirm(
                `${user.name} will not be able to sign in. Everything they have already done stays on record.`,
                'Switch off this login?'
            );
            if (!ok) return;
        }
        try {
            await this.api.updateUser(user.id, { isActive });
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    async resetPin(user: ManagedUser): Promise<void> {
        const pin = String(Math.floor(1000 + Math.random() * 9000));
        try {
            await this.api.updateUser(user.id, { pin });
            this.justCreated.set({ name: user.name, pin });
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    async unlock(user: ManagedUser): Promise<void> {
        try {
            await this.api.unlockUser(user.id);
            this.notify.success(`${user.name} can try again`);
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }
}
