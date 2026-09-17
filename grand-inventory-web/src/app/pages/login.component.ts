/**
 * Sign in on a shared device.
 *
 * Pick the outlet, tap your name, key in a PIN. Nobody types an email address
 * on a wet tablet in a store room with a delivery waiting, which is why the
 * schema stores a PIN and not a password.
 *
 * Three steps down one column rather than a form: on a shared tablet the
 * question is never "what are your credentials", it is "which of these five
 * people are you", and a list of names answers that in one tap.
 */
import { Component, HostListener, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AuthStore } from '@/core/auth.store';
import { GrandService } from '@/core/grand.service';
import { NotifyService } from '@/core/notify.service';
import { apiErrorMessage } from '@/core/api';
import { ROLE_LABELS, type LocationRef, type Role } from '@/core/types';

interface Tile {
    id: number;
    name: string;
    role: Role;
    locationId: number | null;
}

@Component({
    selector: 'grand-login',
    standalone: true,
    imports: [CommonModule, ButtonModule],
    styles: [
        `
            .signin {
                display: grid;
                grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
                min-height: 100vh;
                background: var(--g-paper);
            }

            /* The ink half carries the one thing worth saying about this system
               before anybody has signed in to it. */
            .signin__ink {
                position: relative;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                padding: 40px;
                background: var(--g-ink);
                color: #fff;
                overflow: hidden;
            }

            .signin__brand {
                display: flex;
                align-items: center;
                gap: 13px;
            }
            .signin__mark {
                width: 4px;
                height: 34px;
                background: var(--g-brass);
            }
            .signin__wordmark {
                font-size: 21px;
                font-weight: 700;
                letter-spacing: -0.025em;
                line-height: 1.05;
            }
            .signin__kicker {
                font-size: 10px;
                font-weight: 600;
                letter-spacing: 0.22em;
                text-transform: uppercase;
                color: rgba(255, 255, 255, 0.42);
            }

            .signin__thesis {
                max-width: 30ch;
                font-size: 27px;
                font-weight: 600;
                line-height: 1.24;
                letter-spacing: -0.03em;
            }
            .signin__thesis em {
                font-style: normal;
                color: var(--g-brass);
            }
            .signin__gloss {
                margin-top: 14px;
                max-width: 42ch;
                font-size: 13.5px;
                line-height: 1.6;
                color: rgba(255, 255, 255, 0.56);
            }

            .signin__foot {
                display: flex;
                gap: 26px;
                font-size: 12px;
                color: rgba(255, 255, 255, 0.4);
            }
            .signin__foot b {
                display: block;
                font-family: 'IBM Plex Mono', monospace;
                font-size: 17px;
                font-weight: 500;
                color: #fff;
            }

            .signin__pane {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 36px 28px;
            }
            .signin__form {
                width: 100%;
                max-width: 380px;
            }

            .step {
                font-size: 10px;
                font-weight: 600;
                letter-spacing: 0.18em;
                text-transform: uppercase;
                color: var(--g-text-3);
            }
            .step__q {
                margin-top: 3px;
                font-size: 22px;
                font-weight: 700;
                letter-spacing: -0.028em;
            }

            /* A ruled list, not a grid of cards: this is a roster. */
            .roster {
                margin-top: 18px;
                border: 1px solid var(--g-rule);
                border-radius: var(--g-radius-lg);
                background: var(--g-card);
                overflow: hidden;
            }
            .roster__row {
                display: flex;
                align-items: center;
                gap: 11px;
                width: 100%;
                padding: 12px 14px;
                text-align: left;
                background: transparent;
                border: 0;
                border-bottom: 1px solid var(--g-rule);
                border-left: 3px solid transparent;
                cursor: pointer;
                color: inherit;
                transition:
                    background-color 0.12s ease,
                    border-left-color 0.12s ease;
            }
            .roster__row:last-child {
                border-bottom: 0;
            }
            .roster__row:hover {
                background: var(--g-card-2);
                border-left-color: var(--g-brass);
            }
            .roster__name {
                font-weight: 600;
                font-size: 14px;
            }
            .roster__meta {
                font-size: 12px;
                color: var(--g-text-2);
            }
            .roster__chevron {
                margin-left: auto;
                color: var(--g-text-3);
                font-size: 12px;
            }

            /* Four cells, filled left to right. A cell is a digit's worth of
               space, so a half-typed PIN reads as unfinished, not as an error. */
            .pin {
                display: flex;
                justify-content: center;
                gap: 9px;
                margin: 20px 0 22px;
            }
            .pin__cell {
                width: 40px;
                height: 48px;
                border: 1px solid var(--g-rule-strong);
                border-radius: var(--g-radius);
                background: var(--g-card);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .pin__cell--on {
                border-color: var(--g-brass);
                background: var(--g-brass-wash);
            }
            .pin__dot {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: var(--g-brass-deep);
            }

            .keypad {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 8px;
            }
            .key {
                height: 54px;
                border: 1px solid var(--g-rule);
                border-radius: var(--g-radius);
                background: var(--g-card);
                font-family: 'IBM Plex Mono', monospace;
                font-size: 19px;
                font-weight: 500;
                color: var(--g-text);
                cursor: pointer;
                transition:
                    background-color 0.1s ease,
                    border-color 0.1s ease;
            }
            .key:hover:not(:disabled) {
                background: var(--g-card-2);
                border-color: var(--g-rule-strong);
            }
            .key:disabled {
                opacity: 0.5;
                cursor: default;
            }
            /* The pad is the obvious way in; this says the keyboard works too,
               without competing with it for attention. */
            .typehint {
                margin-top: 14px;
                text-align: center;
                font-size: 12px;
                color: var(--g-text-3);
            }

            .key--soft {
                border-color: transparent;
                background: transparent;
                font-family: 'Archivo', system-ui, sans-serif;
                font-size: 13px;
                font-weight: 600;
                color: var(--g-text-2);
            }

            @media (max-width: 900px) {
                .signin {
                    grid-template-columns: 1fr;
                }
                .signin__ink {
                    padding: 24px;
                }
                .signin__thesis,
                .signin__gloss,
                .signin__foot {
                    display: none;
                }
                .signin__pane {
                    padding: 26px 20px 44px;
                }
            }
        `
    ],
    template: `
        <div class="signin">
            <!-- ── The ink half ──────────────────────────────────────────── -->
            <aside class="signin__ink">
                <div class="signin__brand">
                    <span class="signin__mark" aria-hidden="true"></span>
                    <div>
                        <div class="signin__wordmark">The Grand</div>
                        <div class="signin__kicker">Inventory</div>
                    </div>
                </div>

                <div>
                    <h1 class="signin__thesis">
                        Every entry is signed.<br />Nothing is <em>edited</em>, nothing is
                        <em>deleted</em>.
                    </h1>
                    <p class="signin__gloss">
                        Deliveries, issues, wastage and counts stack up in one ledger. A mistake is
                        put right by a reversal that stays on the record, so the story of the store
                        can always be read back.
                    </p>
                </div>

                <div class="signin__foot">
                    <div>
                        <b>{{ locations().length || '-' }}</b>
                        Outlets
                    </div>
                    <div>
                        <b>{{ allUsersCount() || '-' }}</b>
                        People
                    </div>
                </div>
            </aside>

            <!-- ── The sign-in half ──────────────────────────────────────── -->
            <main class="signin__pane">
                <div class="signin__form">
                    <!-- Step 1: which outlet -->
                    @if (step() === 'location') {
                        <div class="step">Step 1 of 3</div>
                        <h2 class="step__q">Where are you?</h2>

                        @if (loading()) {
                            <div class="empty">
                                <div class="empty__rule"></div>
                                <div class="empty__body">Fetching the outlets</div>
                            </div>
                        } @else if (loadError()) {
                            <div class="app-note app-note--error mt-4">
                                <div class="app-note__title">Cannot reach the system</div>
                                <p class="mt-1">{{ loadError() }}</p>
                                <button
                                    pButton
                                    class="mt-2"
                                    size="small"
                                    label="Try again"
                                    (click)="loadBootstrap()"
                                ></button>
                            </div>
                        } @else {
                            <div class="roster">
                                @for (loc of locations(); track loc.id) {
                                    <button
                                        type="button"
                                        class="roster__row"
                                        (click)="pickLocation(loc)"
                                    >
                                        <span class="stamp__code">{{ loc.code }}</span>
                                        <span class="roster__name">{{ loc.name }}</span>
                                        <i class="pi pi-angle-right roster__chevron"></i>
                                    </button>
                                }
                            </div>
                        }
                    }

                    <!-- Step 2: who are you -->
                    @if (step() === 'user') {
                        <div class="step">Step 2 of 3</div>
                        <div class="flex items-center justify-between gap-3">
                            <h2 class="step__q">Who are you?</h2>
                            <button
                                pButton
                                text
                                size="small"
                                label="Change outlet"
                                (click)="step.set('location')"
                            ></button>
                        </div>

                        @if (usersHere().length === 0) {
                            <div class="app-note app-note--warn mt-4">
                                <div class="app-note__title">No logins here yet</div>
                                <p class="mt-1">
                                    Nobody has been given a login at
                                    {{ selectedLocation()?.name }}. An admin adds people under
                                    Logins.
                                </p>
                            </div>
                        } @else {
                            <div class="roster">
                                @for (u of usersHere(); track u.id) {
                                    <button type="button" class="roster__row" (click)="pickUser(u)">
                                        <span
                                            class="app-avatar"
                                            style="width:32px;height:32px;flex:0 0 auto"
                                            >{{ initials(u.name) }}</span
                                        >
                                        <span class="min-w-0">
                                            <span class="roster__name block truncate">{{
                                                u.name
                                            }}</span>
                                            <span class="roster__meta">{{
                                                roleLabel(u.role)
                                            }}</span>
                                        </span>
                                        <i class="pi pi-angle-right roster__chevron"></i>
                                    </button>
                                }
                            </div>
                        }
                    }

                    <!-- Step 3: PIN -->
                    @if (step() === 'pin') {
                        <div class="step">Step 3 of 3</div>
                        <h2 class="step__q">Your PIN</h2>

                        <div class="flex items-center gap-2.5 mt-3">
                            <span class="app-avatar" style="width:32px;height:32px">{{
                                initials(selectedUser()!.name)
                            }}</span>
                            <div class="min-w-0">
                                <div class="roster__name truncate">{{ selectedUser()!.name }}</div>
                                <div class="roster__meta">{{ selectedLocation()?.name }}</div>
                            </div>
                        </div>

                        <div class="pin" role="status" [attr.aria-label]="pinLabel()">
                            @for (i of [0, 1, 2, 3]; track i) {
                                <div class="pin__cell" [class.pin__cell--on]="pin().length > i">
                                    @if (pin().length > i) {
                                        <span class="pin__dot"></span>
                                    }
                                </div>
                            }
                        </div>

                        <div class="keypad">
                            @for (d of digits; track d) {
                                <button
                                    type="button"
                                    class="key"
                                    [disabled]="submitting()"
                                    (click)="press(d)"
                                >
                                    {{ d }}
                                </button>
                            }
                            <button type="button" class="key key--soft" (click)="back()">
                                Back
                            </button>
                            <button
                                type="button"
                                class="key"
                                [disabled]="submitting()"
                                (click)="press('0')"
                            >
                                0
                            </button>
                            <button
                                type="button"
                                class="key key--soft"
                                [disabled]="submitting()"
                                (click)="backspace()"
                            >
                                Delete
                            </button>
                        </div>

                        @if (error()) {
                            <div class="app-note app-note--error mt-4">{{ error() }}</div>
                        } @else if (submitting()) {
                            <p class="text-surface-500 text-sm mt-4 text-center">Signing in…</p>
                        } @else {
                            <p class="typehint">Or type it on the keyboard</p>
                        }
                    }
                </div>
            </main>
        </div>
    `
})
export class LoginComponent implements OnInit {
    private api = inject(GrandService);
    private auth = inject(AuthStore);
    private router = inject(Router);
    private notify = inject(NotifyService);

    readonly digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

    readonly step = signal<'location' | 'user' | 'pin'>('location');
    readonly loading = signal(false);
    readonly loadError = signal<string | null>(null);
    readonly submitting = signal(false);
    readonly error = signal<string | null>(null);
    readonly pin = signal('');

    readonly locations = signal<LocationRef[]>([]);
    private allUsers = signal<Tile[]>([]);
    readonly selectedLocation = signal<LocationRef | null>(null);
    readonly selectedUser = signal<Tile | null>(null);

    readonly allUsersCount = computed(() => this.allUsers().length);

    /** Outlet staff plus group-wide roles, who can sign in anywhere. */
    readonly usersHere = computed(() => {
        const locId = this.selectedLocation()?.id;
        return this.allUsers().filter((u) => u.locationId === locId || u.locationId === null);
    });

    /** The dots are decorative; this is what a screen reader gets instead. */
    readonly pinLabel = computed(() => `${this.pin().length} of 4 digits entered`);

    ngOnInit(): void {
        void this.loadBootstrap();
    }

    async loadBootstrap(): Promise<void> {
        this.loading.set(true);
        this.loadError.set(null);
        try {
            const data = await this.api.bootstrap();
            this.locations.set(data.locations);
            this.allUsers.set(data.users);
            if (data.locations.length === 1) this.pickLocation(data.locations[0]);
        } catch (err) {
            this.loadError.set(apiErrorMessage(err));
        } finally {
            this.loading.set(false);
        }
    }

    pickLocation(loc: LocationRef): void {
        this.selectedLocation.set(loc);
        this.step.set('user');
    }

    pickUser(user: Tile): void {
        this.selectedUser.set(user);
        this.pin.set('');
        this.error.set(null);
        this.step.set('pin');
    }

    back(): void {
        this.pin.set('');
        this.error.set(null);
        this.step.set('user');
    }

    backspace(): void {
        this.pin.update((p) => p.slice(0, -1));
        this.error.set(null);
    }

    press(digit: string): void {
        if (this.pin().length >= 4) return;
        this.pin.update((p) => p + digit);
        this.error.set(null);
        if (this.pin().length === 4) void this.submit();
    }

    /**
     * The keypad is for the tablet by the door; the keyboard is for the office.
     *
     * Bound on the document rather than on a hidden input, because there is no
     * field here to put a caret in - the four cells are the display, not a
     * control - and asking the manager at a desk to click the pad before they
     * can type would be the whole complaint again.
     *
     * Backspace has to be swallowed: on a page with nothing focused, some
     * browsers still read it as "go back", which would throw away the outlet
     * and the name that were already chosen.
     */
    @HostListener('document:keydown', ['$event'])
    onKeydown(event: KeyboardEvent): void {
        if (this.step() !== 'pin') return;
        // Leave shortcuts alone - Ctrl+R is a reload, not a digit.
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        if (/^[0-9]$/.test(event.key)) {
            if (this.submitting()) return;
            event.preventDefault();
            this.press(event.key);
            return;
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            if (!this.submitting()) this.backspace();
            return;
        }

        // Away from the PIN, back to the roster: the same thing the Back key
        // on the pad does, and the gesture people already have for "not me".
        if (event.key === 'Escape') {
            event.preventDefault();
            this.back();
        }
    }

    private async submit(): Promise<void> {
        const user = this.selectedUser();
        const loc = this.selectedLocation();
        if (!user || !loc) return;

        this.submitting.set(true);
        try {
            const session = await this.api.login(user.id, loc.id, this.pin());
            this.auth.setSession(session);
            this.notify.success(`Welcome, ${session.user.name}`);
            await this.router.navigate(['/home']);
        } catch (err) {
            this.error.set(apiErrorMessage(err));
            this.pin.set('');
        } finally {
            this.submitting.set(false);
        }
    }

    initials(name: string): string {
        return name
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((p) => p[0]?.toUpperCase() ?? '')
            .join('');
    }

    roleLabel(role: Role): string {
        return ROLE_LABELS[role] ?? role;
    }
}
