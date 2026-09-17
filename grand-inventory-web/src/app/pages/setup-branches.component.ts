/**
 * Branches and the sections inside them.
 *
 * A section is anywhere stock can sit, and the main store is one too - which is
 * what keeps every movement in the system a section-to-section transfer with no
 * special cases anywhere.
 *
 * The one thing this screen will not let you do is invent a kind of section.
 * Permissions are decided by kind: a kitchen login can see the sections of kind
 * KITCHEN and nothing else. A section of some new kind would be a room nobody
 * could reach - created successfully, visible to no one, and very confusing to
 * be handed. So the kind comes from a list the server supplies, and the name is
 * yours: "Pastry room" of kind Kitchen is two kitchens at one branch, both
 * visible to the people who cook.
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
import type { SectionKind, SetupBranch, SetupSection } from '@/core/types';

@Component({
    selector: 'app-setup-branches',
    standalone: true,
    imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, TagModule, DrawerModule],
    template: `
        <div class="space-y-6">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold">Branches and sections</h1>
                    <p class="text-surface-500 text-sm">
                        Where stock is kept, and who can reach each place
                    </p>
                </div>
                <button pButton icon="pi pi-plus" label="Add branch" (click)="openBranch()"></button>
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                @for (b of branches(); track b.id) {
                    <div
                        class="rounded-2xl border border-surface bg-surface-0 dark:bg-surface-900 overflow-hidden">
                        <div
                            class="px-5 py-4 border-b border-surface flex flex-wrap items-center justify-between gap-2">
                            <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="font-semibold" [class.text-surface-400]="!b.isActive">
                                        {{ b.name }}
                                    </span>
                                    <span class="text-xs font-mono text-surface-500">{{ b.code }}</span>
                                    @if (!b.isActive) {
                                        <p-tag severity="secondary" value="Closed"></p-tag>
                                    }
                                </div>
                                <div class="text-xs text-surface-500 mt-1">
                                    Business day starts at {{ b.dayStart }}
                                    @if (b.dayStart !== '06:00') {
                                        · a 24-hour site
                                    }
                                </div>
                            </div>
                            <div class="flex items-center gap-1">
                                <button
                                    pButton
                                    size="small"
                                    text
                                    label="Edit"
                                    (click)="openBranchEdit(b)"></button>
                                <button
                                    pButton
                                    size="small"
                                    outlined
                                    icon="pi pi-plus"
                                    label="Section"
                                    (click)="openSection(b)"></button>
                            </div>
                        </div>

                        <ul class="divide-y divide-surface">
                            @for (s of b.sections; track s.id) {
                                <li class="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                                    <div class="min-w-0">
                                        <div class="flex items-center gap-2">
                                            <span
                                                class="font-medium text-sm"
                                                [class.text-surface-400]="!s.isActive">
                                                {{ s.name }}
                                            </span>
                                            <span class="text-xs font-mono text-surface-500">{{
                                                s.code
                                            }}</span>
                                            @if (s.isStore) {
                                                <p-tag severity="success" value="Main store"></p-tag>
                                            }
                                            @if (!s.isActive) {
                                                <p-tag severity="secondary" value="Off"></p-tag>
                                            }
                                        </div>
                                        <div class="text-xs text-surface-500">
                                            {{ s.kindLabel }} · {{ whoCanUse(s) }}
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-1">
                                        <button
                                            pButton
                                            size="small"
                                            text
                                            label="Rename"
                                            (click)="renameSection(s)"></button>
                                        @if (s.isActive) {
                                            @if (!s.isStore) {
                                                <button
                                                    pButton
                                                    size="small"
                                                    text
                                                    severity="danger"
                                                    label="Switch off"
                                                    (click)="setSectionActive(s, false)"></button>
                                            }
                                        } @else {
                                            <button
                                                pButton
                                                size="small"
                                                text
                                                label="Turn on"
                                                (click)="setSectionActive(s, true)"></button>
                                        }
                                    </div>
                                </li>
                            }
                        </ul>
                    </div>
                }
            </div>
        </div>

        <!-- Branch ----------------------------------------------------------->
        <p-drawer
            [visible]="branchOpen()"
            (visibleChange)="branchOpen.set($event)"
            position="right"
            [header]="currentBranch() ? 'Edit branch' : 'Add a branch'"
            styleClass="!w-full sm:!w-[30rem]">
            <div class="space-y-5">
                @if (formError()) {
                    <div class="app-note app-note--error">{{ formError() }}</div>
                }

                <div>
                    <label class="block text-sm font-medium mb-1 app-req">Short code</label>
                    <input
                        pInputText
                        class="w-full font-mono"
                        placeholder="GB"
                        [disabled]="!!currentBranch()"
                        [ngModel]="branchCode()"
                        (ngModelChange)="branchCode.set($event)" />
                </div>

                <div>
                    <label class="block text-sm font-medium mb-1 app-req">Name</label>
                    <input
                        pInputText
                        class="w-full"
                        placeholder="The Grand Gastrobar"
                        [ngModel]="branchName()"
                        (ngModelChange)="branchName.set($event)" />
                </div>

                <div>
                    <label class="block text-sm font-medium mb-1">Business day starts at</label>
                    <input
                        pInputText
                        class="w-32"
                        type="time"
                        [ngModel]="dayStart()"
                        (ngModelChange)="dayStart.set($event)" />
                    <p class="text-xs text-surface-500 mt-1">
                        06:00 for an ordinary site. A 24-hour site runs 04:00 to 04:00, so a
                        count taken at 02:00 belongs to the day before.
                    </p>
                </div>

                @if (!currentBranch()) {
                    <div class="app-note">
                        A main store is created with the branch. Without one it could not
                        receive a delivery or issue anything.
                    </div>
                }

                <div class="flex justify-end gap-2 pt-2">
                    <button pButton outlined label="Cancel" (click)="branchOpen.set(false)"></button>
                    <button
                        pButton
                        icon="pi pi-check"
                        [label]="currentBranch() ? 'Save' : 'Create branch'"
                        [disabled]="!canSaveBranch() || busy()"
                        [loading]="busy()"
                        (click)="saveBranch()"></button>
                </div>
            </div>
        </p-drawer>

        <!-- Section ---------------------------------------------------------->
        <p-drawer
            [visible]="sectionOpen()"
            (visibleChange)="sectionOpen.set($event)"
            position="right"
            header="Add a section"
            styleClass="!w-full sm:!w-[32rem]">
            <div class="space-y-5">
                @if (formError()) {
                    <div class="app-note app-note--error">{{ formError() }}</div>
                }

                <p class="text-sm text-surface-500">
                    Adding to <span class="font-medium">{{ sectionBranch()?.name }}</span
                    >.
                </p>

                <div>
                    <label class="block text-sm font-medium mb-2">What kind of place is it?</label>
                    <div class="grid grid-cols-1 gap-2">
                        @for (k of kinds(); track k.kind) {
                            <button
                                type="button"
                                class="text-left p-3 rounded-xl border transition"
                                [class.border-primary]="sectionKind() === k.kind"
                                [class.bg-primary-50]="sectionKind() === k.kind"
                                [class.dark:bg-primary-950]="sectionKind() === k.kind"
                                [class.border-surface]="sectionKind() !== k.kind"
                                (click)="sectionKind.set(k.kind)">
                                <div class="font-medium">{{ k.label }}</div>
                                <div class="text-xs text-surface-500">{{ kindHint(k) }}</div>
                            </button>
                        }
                    </div>
                    <p class="text-xs text-surface-500 mt-1">
                        The kind decides who can work there. A pastry room is a Kitchen with a
                        different name.
                    </p>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium mb-1 app-req">Short code</label>
                        <input
                            pInputText
                            class="w-full font-mono"
                            placeholder="PASTRY"
                            [ngModel]="sectionCode()"
                            (ngModelChange)="sectionCode.set($event)" />
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1 app-req">Name</label>
                        <input
                            pInputText
                            class="w-full"
                            placeholder="Pastry room"
                            [ngModel]="sectionName()"
                            (ngModelChange)="sectionName.set($event)" />
                    </div>
                </div>

                <div class="flex justify-end gap-2 pt-2">
                    <button pButton outlined label="Cancel" (click)="sectionOpen.set(false)"></button>
                    <button
                        pButton
                        icon="pi pi-check"
                        label="Add section"
                        [disabled]="!canSaveSection() || busy()"
                        [loading]="busy()"
                        (click)="saveSection()"></button>
                </div>
            </div>
        </p-drawer>
    `
})
export class SetupBranchesComponent implements OnInit {
    private api = inject(GrandService);
    private notify = inject(NotifyService);

    readonly branches = signal<SetupBranch[]>([]);
    readonly kinds = signal<SectionKind[]>([]);
    readonly error = signal<string | null>(null);
    readonly formError = signal<string | null>(null);
    readonly busy = signal(false);

    readonly branchOpen = signal(false);
    readonly currentBranch = signal<SetupBranch | null>(null);
    readonly branchCode = signal('');
    readonly branchName = signal('');
    readonly dayStart = signal('06:00');

    readonly sectionOpen = signal(false);
    readonly sectionBranch = signal<SetupBranch | null>(null);
    readonly sectionCode = signal('');
    readonly sectionName = signal('');
    readonly sectionKind = signal('KITCHEN');

    readonly canSaveBranch = computed(
        () =>
            this.branchName().trim().length >= 2 &&
            (!!this.currentBranch() || this.branchCode().trim().length >= 2)
    );

    readonly canSaveSection = computed(
        () => this.sectionCode().trim().length >= 2 && this.sectionName().trim().length >= 2
    );

    async ngOnInit(): Promise<void> {
        await this.load();
    }

    async load(): Promise<void> {
        try {
            const [branches, kinds] = await Promise.all([
                this.api.setupBranches(),
                this.api.sectionKinds()
            ]);
            this.branches.set(branches);
            this.kinds.set(kinds);
            this.error.set(null);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        }
    }

/**
     * Spelled out on every row, because "who can see this" is the whole point.
     *
     * Quarantine is the one that was wrong: it read "the kitchen logins" by
     * falling through the default, when SECTION_KINDS gives it to the
     * storekeeper and to nobody else. That is not a cosmetic slip -- the
     * admin reading this row is deciding whether the branch is set up safely,
     * and faulty stock the kitchen could reach is faulty stock the kitchen can
     * ask for again tomorrow.
     */
    whoCanUse(section: SetupSection): string {
        switch (section.kind) {
            case 'STORE':
                return 'the storekeeper and management';
            case 'CLEAN':
                return 'the cleaning logins';
            case 'QUARANTINE':
                return 'the storekeeper only';
            default:
                return 'the kitchen logins';
        }
    }

    kindHint(kind: SectionKind): string {
        if (kind.isStore) return 'Where deliveries land. One per branch.';
        if (kind.kind === 'CLEAN') return 'Cleaning supplies. Reached by the cleaning logins.';
        if (kind.kind === 'QUARANTINE') {
            return 'Where returned goods wait for the supplier. The storekeeper only, and every branch needs one.';
        }
        return 'Reached by the kitchen logins. A pastry bench or a drinks shelf is a second Kitchen with its own name.';
    }

    openBranch(): void {
        this.currentBranch.set(null);
        this.formError.set(null);
        this.branchCode.set('');
        this.branchName.set('');
        this.dayStart.set('06:00');
        this.branchOpen.set(true);
    }

    openBranchEdit(branch: SetupBranch): void {
        this.currentBranch.set(branch);
        this.formError.set(null);
        this.branchCode.set(branch.code);
        this.branchName.set(branch.name);
        this.dayStart.set(branch.dayStart);
        this.branchOpen.set(true);
    }

    async saveBranch(): Promise<void> {
        this.busy.set(true);
        this.formError.set(null);
        try {
            const existing = this.currentBranch();
            if (existing) {
                await this.api.updateBranch(existing.id, {
                    name: this.branchName().trim(),
                    dayStart: this.dayStart()
                });
                this.notify.success(`${this.branchName().trim()} saved`);
            } else {
                await this.api.createBranch({
                    code: this.branchCode().trim(),
                    name: this.branchName().trim(),
                    dayStart: this.dayStart()
                });
                this.notify.success(`${this.branchName().trim()} created, with its main store`);
            }
            this.branchOpen.set(false);
            await this.load();
        } catch (err) {
            this.formError.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    openSection(branch: SetupBranch): void {
        this.sectionBranch.set(branch);
        this.formError.set(null);
        this.sectionCode.set('');
        this.sectionName.set('');
        this.sectionKind.set('KITCHEN');
        this.sectionOpen.set(true);
    }

    async saveSection(): Promise<void> {
        const branch = this.sectionBranch();
        if (!branch) return;
        this.busy.set(true);
        this.formError.set(null);
        try {
            await this.api.createSection({
                locationId: branch.id,
                code: this.sectionCode().trim(),
                name: this.sectionName().trim(),
                kind: this.sectionKind()
            });
            this.notify.success(`${this.sectionName().trim()} added`);
            this.sectionOpen.set(false);
            await this.load();
        } catch (err) {
            this.formError.set(apiErrorMessage(err));
        } finally {
            this.busy.set(false);
        }
    }

    async renameSection(section: SetupSection): Promise<void> {
        const name = await this.notify.prompt(
            `New name for ${section.name}`,
            'Rename section',
            section.name
        );
        if (!name || name.trim().length < 2) return;
        try {
            await this.api.updateSection(section.id, { name: name.trim() });
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }

    async setSectionActive(section: SetupSection, isActive: boolean): Promise<void> {
        if (!isActive) {
            const ok = await this.notify.confirm(
                `${section.name} will stop appearing anywhere. It has to be empty first - anything left on its shelves would be stranded where no screen can reach it.`,
                'Switch off this section?',
                'Switch off'
            );
            if (!ok) return;
        }
        try {
            await this.api.updateSection(section.id, { isActive });
            await this.load();
        } catch (err) {
            this.notify.error(apiErrorMessage(err));
        }
    }
}
