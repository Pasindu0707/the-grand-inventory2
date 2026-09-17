/**
 * Home. Different for each role, and deliberately short.
 *
 * The old dashboard showed everyone the same wall of numbers. A cleaner does
 * not need a stock valuation; they need "ask for shampoo" and "did my last
 * request arrive". So this screen is a small number of large buttons, and the
 * first one is whatever that person came here to do.
 *
 * Anything waiting on you is shown as a count on the button. That is the whole
 * notification system, and it is enough.
 */
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthStore } from '@/core/auth.store';
import { GrandService } from '@/core/grand.service';
import { apiErrorMessage } from '@/core/api';
import { ROLE_LABELS, type MyContext, type PurchaseOrder, type RequestRow } from '@/core/types';
import { UsersComponent } from './users.component';

interface Tile {
    label: string;
    hint: string;
    icon: string;
    link: string;
    query?: Record<string, unknown>;
    count?: number;
    primary?: boolean;
}

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, RouterLink, UsersComponent],
    template: `
        <div class="space-y-8">
            <div>
                <h1 class="text-3xl font-bold">{{ greeting() }}</h1>
                <p class="text-surface-500 mt-1">
                    {{ roleLabel() }} · {{ auth.location()?.name }}
                </p>
            </div>

            @if (error()) {
                <div class="app-note app-note--error">{{ error() }}</div>
            }

            <!-- The admin can reach exactly two routes, and one of them only
                 existed to link to the other: home was a single tile saying
                 "Manage logins". Managing logins *is* their home, so it is
                 rendered here rather than one click away. -->
            @if (isAdmin()) {
                <app-users [showHeading]="false" />
            } @else {

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                @for (tile of tiles(); track tile.link) {
                    <a
                        [routerLink]="tile.link"
                        [queryParams]="tile.query ?? null"
                        class="relative block rounded-2xl border p-6 transition hover:shadow-md"
                        [class.border-primary]="tile.primary"
                        [class.bg-primary-50]="tile.primary"
                        [class.dark:bg-primary-950]="tile.primary"
                        [class.border-surface]="!tile.primary"
                        [class.bg-surface-0]="!tile.primary"
                        [class.dark:bg-surface-900]="!tile.primary">
                        <div class="flex items-start gap-4">
                            <i [class]="tile.icon + ' text-2xl mt-1'" [class.text-primary]="tile.primary"></i>
                            <div class="min-w-0">
                                <div class="text-lg font-semibold">{{ tile.label }}</div>
                                <div class="text-sm text-surface-500 mt-0.5">{{ tile.hint }}</div>
                            </div>
                        </div>
                        @if (tile.count) {
                            <span
                                class="absolute top-4 right-4 min-w-7 h-7 px-2 rounded-full bg-red-500 text-white text-sm font-bold flex items-center justify-center">
                                {{ tile.count }}
                            </span>
                        }
                    </a>
                }
            </div>

            @if (waitingOnMe().length > 0) {
                <div class="app-note app-note--warn">
                    <div class="app-note__title mb-2">
                        Waiting for you
                    </div>
                    <ul class="space-y-1 text-sm">
                        @for (r of waitingOnMe().slice(0, 5); track r.id) {
                            <li>
                                {{ r.sectionName }} · {{ r.lineCount }} item(s)
                                @if (r.status === 'requested') {
                                    - needs releasing
                                } @else {
                                    - released, needs confirming
                                }
                                @if (r.neededBy) {
                                    <span class="font-semibold">by {{ r.neededBy }}</span>
                                }
                            </li>
                        }
                    </ul>
                </div>
            }

            }
        </div>
    `
})
export class HomeComponent implements OnInit {
    readonly auth = inject(AuthStore);
    private api = inject(GrandService);

    readonly ctx = signal<MyContext | null>(null);
    readonly requests = signal<RequestRow[]>([]);
    readonly counts = signal({ toRelease: 0, toConfirm: 0, posWaiting: 0, returned: 0 });
    readonly error = signal<string | null>(null);

    readonly greeting = computed(() => {
        const name = this.auth.user()?.name.split(' ')[0] ?? '';
        const hour = new Date().getHours();
        const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
        return `${part}, ${name}`;
    });

    readonly roleLabel = computed(() => {
        const role = this.auth.role();
        return role ? ROLE_LABELS[role] : '';
    });

    readonly isAdmin = computed(() => this.auth.role() === 'admin');

    /** Already filtered to `needsMe` by the server. */
    readonly waitingOnMe = computed(() => this.requests());

    readonly tiles = computed<Tile[]>(() => {
        const ctx = this.ctx();
        const role = this.auth.role();
        if (!ctx || !role) return [];

        const { toRelease, toConfirm, posWaiting, returned } = this.counts();

        // No admin branch: their home renders the logins screen itself, so the
        // tile that used to link across to it has nothing left to do.

        const tiles: Tile[] = [];

        // Sections lead with asking, because that is why they open the app.
        if (role === 'kitchen' || role === 'cleaning') {
            tiles.push({
                label: 'Ask for stock',
                hint: 'Request what you need, and when you need it',
                icon: 'pi pi-plus-circle',
                // Opens the drawer on Requests. Asking is done beside the list
                // of what you have already asked for, not on a screen of its own.
                link: '/requests',
                query: { ask: 1 },
                primary: true
            });
            tiles.push({
                label: 'Confirm arrivals',
                hint: 'Say it came',
                icon: 'pi pi-check-circle',
                link: '/requests',
                count: toConfirm
            });
        }

        if (ctx.canRelease) {
            tiles.push({
                label: 'Requests to release',
                hint: 'Approve and hand over',
                icon: 'pi pi-send',
                link: '/requests',
                count: toRelease,
                primary: role === 'storekeeper'
            });
        }

        tiles.push({
            label: role === 'storekeeper' ? 'Stock everywhere' : 'What we have',
            hint:
                role === 'storekeeper'
                    ? 'Store, kitchen and cleaning'
                    : 'Everything in your section right now',
            icon: 'pi pi-box',
            link: '/mystock'
        });

        // Only the two roles that can open the screen. A section login raises
        // no purchases -- the store does that on their behalf when it cannot
        // cover a request -- so the tile would lead them to a locked route.
        if (role === 'management' || role === 'storekeeper') {
            tiles.push({
                label: 'Purchases',
                hint: ctx.canDecidePurchases
                    ? 'Approve what needs buying'
                    : 'What you asked to be bought',
                icon: 'pi pi-shopping-cart',
                link: '/purchases',
                count: ctx.canDecidePurchases ? posWaiting : 0
            });
        }

        /**
         * Stock that came back off the floor and is sitting in quarantine.
         *
         * Without this the chain simply stopped: a return moved the stock
         * correctly and then nothing anywhere said it had happened, so the
         * goods sat in the right place and nobody knew. For a storekeeper that
         * is the same as lost, and every day it sits is a day closer to the
         * supplier saying it is too late to argue.
         */
        if (role === 'management' || role === 'storekeeper') {
            tiles.push({
                label: 'Returns',
                hint: returned > 0 ? 'Came back, waiting to go to the supplier' : 'Nothing waiting',
                icon: 'pi pi-reply',
                link: '/returns',
                count: returned
            });
        }

        if (ctx.seesAdvanced) {
            tiles.push({
                label: 'Reports',
                hint: 'Usage, loss, waste, prices, stock-outs',
                icon: 'pi pi-chart-bar',
                link: '/reports'
            });
        }

        return tiles;
    });

    async ngOnInit(): Promise<void> {
        // The admin's home renders the logins screen, which fetches its own
        // data. Nothing below feeds anything they can see, so it is not fetched.
        if (this.isAdmin()) {
            return;
        }
        try {
            const ctx = await this.api.myContext();
            this.ctx.set(ctx);

            // The tile badges are counts of *everything* outstanding, so they
            // are read from each list's `total` rather than by counting rows.
            // Counting a fetched page would have quietly turned "8 to confirm"
            // into "8 of the first 25 are to confirm", which is worse than no
            // badge at all - it looks precise and is not.
            const canSeeReturns = ctx.role === 'management' || ctx.role === 'storekeeper';
            const [waiting, toRelease, toConfirm, posWaiting, returned] = await Promise.all([
                // Enough rows for the "Waiting for you" list, which shows five.
                this.api.listRequests({ needsMe: true, limit: 20 }),
                this.api.listRequests({ status: 'requested', limit: 1 }),
                this.api.listRequests({ status: 'released', mineOnly: true, limit: 1 }),
                this.api.listPurchaseOrders({ status: 'requested', limit: 1 }),
                // Came back and not yet on a supplier return. A section login
                // has no tile for this, so it is not asked for.
                canSeeReturns
                    ? this.api.listSectionReturns({ awaitingSupplier: true, limit: 1 })
                    : Promise.resolve({ total: 0 })
            ]);

            this.requests.set(waiting.items);
            this.counts.set({
                toRelease: toRelease.total,
                toConfirm: toConfirm.total,
                posWaiting: posWaiting.total,
                returned: returned.total
            });
        } catch (err) {
            this.error.set(apiErrorMessage(err));
        }
    }
}
