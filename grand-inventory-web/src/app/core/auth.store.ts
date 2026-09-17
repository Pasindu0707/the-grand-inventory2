/**
 * Session state: who is signed in, at which outlet, and what they may open.
 *
 * Signals + localStorage, so a reload at the delivery door does not sign the
 * storekeeper out mid-GRN. The active location is session state rather than a
 * property of the user, because owners and managers move between outlets
 * inside one session.
 */
import { Injectable, computed, signal } from '@angular/core';
import type {
    ActiveLocation,
    LocationRef,
    Role,
    RouteKey,
    Section,
    SessionResponse,
    SessionUser
} from './types';

const STORAGE_KEY = 'grand-console-session';

interface AuthState {
    accessToken: string | null;
    refreshToken: string | null;
    user: SessionUser | null;
    location: ActiveLocation | null;
    locations: LocationRef[];
    sections: Section[];
}

const EMPTY: AuthState = {
    accessToken: null,
    refreshToken: null,
    user: null,
    location: null,
    locations: [],
    sections: []
};

function load(): AuthState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return { ...EMPTY, ...JSON.parse(raw) };
    } catch {
        /* a corrupt session is just a signed-out session */
    }
    return { ...EMPTY };
}

const EVERYONE: Role[] = ['admin', 'management', 'storekeeper', 'kitchen', 'cleaning'];
const ASKERS: Role[] = ['management', 'storekeeper', 'kitchen', 'cleaning'];
const ADMIN_ONLY: Role[] = ['admin'];

/**
 * Who sees what.
 *
 * Unchanged from the rules the API already enforces - this table only decides
 * which menu rows are worth showing. The server is still the authority; a role
 * that types a URL it has no business at gets a 403, not a screen.
 */
export const ROUTE_PERMISSIONS: Record<RouteKey, Role[]> = {
    home: EVERYONE,
    ask: ASKERS,
    requests: ASKERS,
    mystock: ASKERS,
    purchases: ['management', 'storekeeper'],

    // Administration
    admin: ADMIN_ONLY,
    users: ADMIN_ONLY,
    setupItems: ADMIN_ONLY,
    setupSuppliers: ADMIN_ONLY,
    setupBranches: ADMIN_ONLY,

    // Store and control
    grn: ['management', 'storekeeper'],
    /**
     * The record of what has arrived. Read-only, and open to the same two
     * roles that can book a delivery in - management need it to answer "what
     * did we pay for that", which is the question the reports raise.
     */
    deliveries: ['management', 'storekeeper'],
    stock: ['management', 'storekeeper'],
    wastage: ['management', 'storekeeper', 'kitchen', 'cleaning'],
    counts: ['management', 'storekeeper', 'kitchen', 'cleaning'],
    /**
     * The store's own shelf only.
     *
     * A section returns from Requests, against the release that delivered the
     * goods -- that is the screen where the question comes up and it is what
     * caps the quantity. This screen exists for the other case: bad stock the
     * store found on its own shelf, which arrived on a delivery and so has no
     * release to measure against.
     */
    returns: ['management', 'storekeeper'],
    // Only the two who can see what is really in quarantine, and only they can
    // decide something goes back to a supplier.
    supplierReturns: ['management', 'storekeeper'],
    reports: ['management'],
    opening: ['management', 'storekeeper']
};

export function canAccess(role: Role | undefined | null, allowed: Role[]): boolean {
    return !!role && allowed.includes(role);
}

export function canUseRoute(role: Role | null, routeKey: RouteKey): boolean {
    return canAccess(role, ROUTE_PERMISSIONS[routeKey]);
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
    private state = signal<AuthState>(load());

    readonly accessToken = computed(() => this.state().accessToken);
    readonly refreshToken = computed(() => this.state().refreshToken);
    readonly user = computed(() => this.state().user);
    readonly location = computed(() => this.state().location);
    readonly locations = computed(() => this.state().locations);
    readonly sections = computed(() => this.state().sections);
    readonly isAuthenticated = computed(() => !!this.state().accessToken);
    readonly role = computed<Role | null>(() => this.state().user?.role ?? null);
    readonly locationId = computed<number | null>(() => this.state().location?.id ?? null);

    /** The main store section for the active location, if it has one. */
    readonly storeSection = computed(() => this.state().sections.find((s) => s.isStore) ?? null);

    private persist(s: AuthState): void {
        this.state.set(s);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        } catch {
            /* private browsing; the session simply will not survive a reload */
        }
    }

    setSession(res: SessionResponse): void {
        this.persist({
            accessToken: res.accessToken,
            refreshToken: res.refreshToken,
            user: res.user,
            location: res.location,
            locations: res.locations,
            sections: res.sections
        });
    }

    setTokens(access: string, refresh: string): void {
        this.persist({ ...this.state(), accessToken: access, refreshToken: refresh });
    }

    setActiveLocation(location: ActiveLocation, sections: Section[]): void {
        this.persist({ ...this.state(), location, sections });
    }

    clearSession(): void {
        this.persist({ ...EMPTY });
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            /* ignore */
        }
    }

    canUseRoute(routeKey: RouteKey): boolean {
        return canUseRoute(this.role(), routeKey);
    }
}
