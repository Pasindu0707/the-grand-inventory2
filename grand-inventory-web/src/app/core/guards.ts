/**
 * Route guards. Same data-driven shape as the POS template - roles come from
 * route `data`, not from a switch buried in each component - minus the
 * subscription-plan feature gate, which does not apply here.
 */
import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { AuthStore, canAccess } from './auth.store';
import type { Role } from './types';

export const authGuard: CanActivateFn = (_route, state) => {
    const auth = inject(AuthStore);
    const router = inject(Router);
    if (auth.isAuthenticated()) return true;
    return router.createUrlTree(['/login'], { queryParams: { from: state.url } });
};

export const roleGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
    const auth = inject(AuthStore);
    const router = inject(Router);

    const allowed = (route.data['allowed'] as Role[]) ?? [];
    if (!canAccess(auth.role(), allowed)) {
        // Everyone can see Today, so it is a safe landing place for a role
        // that wandered somewhere it should not be.
        return router.createUrlTree(['/home']);
    }
    return true;
};
