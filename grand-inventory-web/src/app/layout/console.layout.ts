/**
 * The console shell: an ink rail down the left, a thin bar across the top, and
 * the page itself on ruled paper.
 *
 * The rail stays fixed and never collapses to icons on a desktop. Everyone
 * using this has one screen open all day and learns the list by position;
 * a rail that changes width costs more than the 244px it saves.
 */
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
    NavigationEnd,
    Router,
    RouterLink,
    RouterLinkActive,
    RouterOutlet
} from '@angular/router';
import { filter } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { DrawerModule } from 'primeng/drawer';
import { ButtonModule } from 'primeng/button';
import { AuthStore } from '@/core/auth.store';
import { NetworkStore } from '@/core/network.store';
import { NotifyService } from '@/core/notify.service';
import { ROLE_LABELS } from '@/core/types';
import { NAV, type NavGroup } from './nav';
import { ThemeStore } from './theme.store';

@Component({
    selector: 'grand-console',
    standalone: true,
    imports: [
        CommonModule,
        RouterOutlet,
        RouterLink,
        RouterLinkActive,
        DrawerModule,
        ButtonModule
    ],
    template: `
        <div class="shell">
            @if (railOpen()) {
                <button
                    type="button"
                    class="scrim"
                    aria-label="Close menu"
                    (click)="railOpen.set(false)"
                ></button>
            }

            <!-- ── Rail ──────────────────────────────────────────────────── -->
            <nav class="rail" [class.rail--open]="railOpen()" aria-label="Sections">
                <div class="rail__brand">
                    <span class="rail__mark" aria-hidden="true"></span>
                    <div class="min-w-0">
                        <div class="rail__name">The Grand</div>
                        <div class="rail__sub">Inventory</div>
                    </div>
                </div>

                <div class="rail__scroll">
                    @for (group of visibleNav(); track group.title) {
                        <div class="rail__group">{{ group.title }}</div>
                        @for (item of group.items; track item.path) {
                            <a
                                class="rail__link"
                                routerLinkActive="rail__link--on"
                                [routerLink]="item.path"
                                (click)="railOpen.set(false)"
                            >
                                <i [class]="item.icon" aria-hidden="true"></i>
                                <span>{{ item.label }}</span>
                            </a>
                        }
                    }
                </div>

                <div class="rail__foot">
                    <div class="flex items-center gap-2.5">
                        <div class="app-avatar" style="width:28px;height:28px">
                            {{ initials() }}
                        </div>
                        <div class="min-w-0 flex-1">
                            <div
                                class="text-[13px] font-semibold text-white truncate leading-tight"
                            >
                                {{ auth.user()?.name }}
                            </div>
                            <div class="text-[11px] text-white/45 leading-tight">
                                {{ roleLabel() }}
                            </div>
                        </div>
                        <button
                            type="button"
                            class="iconbtn"
                            style="color:rgba(255,255,255,.6)"
                            title="Sign out"
                            aria-label="Sign out"
                            (click)="signOut()"
                        >
                            <i class="pi pi-sign-out" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            </nav>

            <!-- ── Main ──────────────────────────────────────────────────── -->
            <div class="main">
                <header class="topbar">
                    <button
                        type="button"
                        class="iconbtn railtoggle"
                        [attr.aria-expanded]="railOpen()"
                        aria-label="Open menu"
                        (click)="railOpen.set(!railOpen())"
                    >
                        <i class="pi pi-bars" aria-hidden="true"></i>
                    </button>

                    <span class="topbar__title">{{ title() }}</span>

                    <span class="topbar__spacer"></span>

                    @if (!net.online()) {
                        <span class="chip chip--out">
                            <i class="pi pi-wifi text-[10px]" aria-hidden="true"></i>
                            No connection
                        </span>
                    }

                    <button
                        type="button"
                        class="stamp"
                        (click)="outletOpen.set(true)"
                        title="Which outlet you are working in"
                    >
                        <span class="stamp__code">{{ auth.location()?.code }}</span>
                        <span class="stamp__name">{{ auth.location()?.name }}</span>
                    </button>

                    <button
                        type="button"
                        class="iconbtn"
                        [attr.aria-label]="theme.dark() ? 'Switch to light' : 'Switch to dark'"
                        (click)="theme.toggle()"
                    >
                        <i
                            [class]="theme.dark() ? 'pi pi-sun' : 'pi pi-moon'"
                            aria-hidden="true"
                        ></i>
                    </button>
                </header>

                <main class="canvas">
                    <router-outlet />
                </main>
            </div>
        </div>

        <!-- Which outlet, and which day the entries you write will belong to. -->
        <p-drawer
            [(visible)]="outletOpenModel"
            position="right"
            header="This outlet"
            styleClass="!w-full sm:!w-[24rem]"
        >
            <div class="space-y-4">
                <div>
                    <div class="eyebrow">Outlet</div>
                    <div class="mt-1 flex items-center gap-2">
                        <span class="stamp__code">{{ auth.location()?.code }}</span>
                        <span class="font-semibold">{{ auth.location()?.name }}</span>
                    </div>
                </div>

                <div>
                    <div class="eyebrow">Business day starts</div>
                    <div class="fig fig--lg mt-1">{{ auth.location()?.dayStart }}</div>
                    <p class="text-sm text-surface-500 mt-1">
                        Anything posted before this time counts against yesterday.
                    </p>
                </div>

                <div>
                    <div class="eyebrow">Sections here</div>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                        @for (s of activeSections(); track s.id) {
                            <span class="chip" [class.chip--brass]="s.isStore">
                                {{ s.name }}
                            </span>
                        }
                    </div>
                </div>

                @if (auth.locations().length > 1) {
                    <div class="app-note">
                        <div class="app-note__title">Working somewhere else today?</div>
                        <p class="mt-1">
                            Sign out and pick the outlet on the way back in. Entries are written
                            against the outlet you signed in to, so it is not a setting.
                        </p>
                        <button
                            type="button"
                            class="mt-2"
                            pButton
                            severity="secondary"
                            size="small"
                            label="Sign out and switch"
                            (click)="signOut()"
                        ></button>
                    </div>
                }
            </div>
        </p-drawer>
    `
})
export class ConsoleLayout {
    readonly auth = inject(AuthStore);
    readonly theme = inject(ThemeStore);
    readonly net = inject(NetworkStore);
    private notify = inject(NotifyService);
    private router = inject(Router);

    readonly railOpen = signal(false);
    readonly outletOpen = signal(false);

    /** PrimeNG's drawer wants a plain two-way binding, not a signal. */
    get outletOpenModel(): boolean {
        return this.outletOpen();
    }
    set outletOpenModel(v: boolean) {
        this.outletOpen.set(v);
    }

    constructor() {
        this.net.startWatching();
    }

    private readonly navigated = toSignal(
        this.router.events.pipe(filter((e) => e instanceof NavigationEnd)),
        { initialValue: null }
    );

    /** The title the router put on the route, so the bar never drifts. */
    readonly title = computed(() => {
        this.navigated();
        let route = this.router.routerState.root;
        while (route.firstChild) route = route.firstChild;
        return (route.snapshot.title as string) ?? 'The Grand';
    });

    readonly visibleNav = computed<NavGroup[]>(() =>
        NAV.map((g) => ({
            title: g.title,
            items: g.items.filter((i) => this.auth.canUseRoute(i.routeKey))
        })).filter((g) => g.items.length > 0)
    );

    readonly activeSections = computed(() => this.auth.sections().filter((s) => s.isActive));

    readonly roleLabel = computed(() => {
        const role = this.auth.role();
        return role ? ROLE_LABELS[role] : '';
    });

    readonly initials = computed(() => {
        const name = this.auth.user()?.name ?? '';
        return name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((p) => p[0]?.toUpperCase() ?? '')
            .join('');
    });

    async signOut(): Promise<void> {
        const ok = await this.notify.confirm(
            'Anything you have not saved will be lost.',
            'Sign out?',
            'Sign out'
        );
        if (!ok) return;
        this.auth.clearSession();
        this.router.navigate(['/login']);
    }
}
