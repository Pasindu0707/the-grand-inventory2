import { inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { ConsoleLayout } from '@/layout/console.layout';
import { authGuard, roleGuard } from '@/core/guards';

/**
 * Routes follow the rail: Today, Floor, Store, Buying, Control, Administration.
 *
 * `allowed` is the same table the rail filters on and the same one the API
 * enforces. Three copies of one rule is two too many, so the source is
 * ROUTE_PERMISSIONS in auth.store and this only names the key.
 */
export const appRoutes: Routes = [
    {
        path: 'login',
        loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent),
        title: 'Sign in'
    },
    {
        path: '',
        component: ConsoleLayout,
        canActivate: [authGuard],
        children: [
            { path: '', pathMatch: 'full', redirectTo: 'home' },

            // ── Today ───────────────────────────────────────────────────────
            {
                path: 'home',
                data: {
                    routeKey: 'home',
                    allowed: ['admin', 'management', 'storekeeper', 'kitchen', 'cleaning']
                },
                canActivate: [roleGuard],
                loadComponent: () => import('./pages/home.component').then((m) => m.HomeComponent),
                title: 'Overview'
            },

            // ── Floor ───────────────────────────────────────────────────────
            {
                // Asking is a drawer on Requests, not a screen. The path stays
                // so old links land somewhere sensible, with the drawer open.
                path: 'ask',
                redirectTo: () =>
                    inject(Router).createUrlTree(['/requests'], { queryParams: { ask: 1 } }),
                pathMatch: 'full'
            },
            {
                path: 'requests',
                data: {
                    routeKey: 'requests',
                    allowed: ['management', 'storekeeper', 'kitchen', 'cleaning']
                },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/requests.component').then((m) => m.RequestsComponent),
                title: 'Requests'
            },
            {
                path: 'mystock',
                data: {
                    routeKey: 'mystock',
                    allowed: ['management', 'storekeeper', 'kitchen', 'cleaning']
                },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/my-stock.component').then((m) => m.MyStockComponent),
                title: 'What we have'
            },

            {
                path: 'returns',
                data: { routeKey: 'returns', allowed: ['management', 'storekeeper'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/returns.component').then((m) => m.ReturnsComponent),
                title: 'Returns'
            },
            // ── Store ───────────────────────────────────────────────────────
            {
                path: 'grn',
                data: { routeKey: 'grn', allowed: ['management', 'storekeeper'] },
                canActivate: [roleGuard],
                loadComponent: () => import('./pages/grn.component').then((m) => m.GrnComponent),
                title: 'Receive delivery'
            },
            {
                path: 'deliveries',
                data: { routeKey: 'deliveries', allowed: ['management', 'storekeeper'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/deliveries.component').then((m) => m.DeliveriesComponent),
                title: 'Deliveries'
            },
            {
                path: 'stock',
                data: { routeKey: 'stock', allowed: ['management', 'storekeeper'] },
                canActivate: [roleGuard],
                loadComponent: () => import('./pages/stock.component').then((m) => m.StockComponent),
                title: 'Stock on hand'
            },
            {
                path: 'opening',
                data: { routeKey: 'opening', allowed: ['management', 'storekeeper'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/opening.component').then((m) => m.OpeningComponent),
                title: 'Opening stock'
            },

            // ── Buying ──────────────────────────────────────────────────────
            {
                path: 'purchases',
                data: { routeKey: 'purchases', allowed: ['management', 'storekeeper'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/purchases.component').then((m) => m.PurchasesComponent),
                title: 'Purchase orders'
            },

            {
                path: 'supplier-returns',
                data: { routeKey: 'supplierReturns', allowed: ['management', 'storekeeper'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/supplier-returns.component').then(
                        (m) => m.SupplierReturnsComponent
                    ),
                title: 'Supplier returns'
            },
            // ── Control ─────────────────────────────────────────────────────
            {
                path: 'counts',
                data: { routeKey: 'counts', allowed: ['management', 'storekeeper', 'kitchen', 'cleaning'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/counts.component').then((m) => m.CountsComponent),
                title: 'Stock counts'
            },
            {
                path: 'wastage',
                data: { routeKey: 'wastage', allowed: ['management', 'storekeeper', 'kitchen', 'cleaning'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/wastage.component').then((m) => m.WastageComponent),
                title: 'Wastage'
            },
            {
                path: 'reports',
                data: { routeKey: 'reports', allowed: ['management'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/reports.component').then((m) => m.ReportsComponent),
                title: 'Reports'
            },

            // ── Administration ──────────────────────────────────────────────
            {
                path: 'admin',
                data: { routeKey: 'admin', allowed: ['admin'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/admin-overview.component').then(
                        (m) => m.AdminOverviewComponent
                    ),
                title: 'Admin overview'
            },
            {
                path: 'users',
                data: { routeKey: 'users', allowed: ['admin'] },
                canActivate: [roleGuard],
                loadComponent: () => import('./pages/users.component').then((m) => m.UsersComponent),
                title: 'Logins'
            },
            {
                path: 'setup/items',
                data: { routeKey: 'setupItems', allowed: ['admin'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/setup-items.component').then((m) => m.SetupItemsComponent),
                title: 'Products'
            },
            {
                path: 'setup/suppliers',
                data: { routeKey: 'setupSuppliers', allowed: ['admin'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/setup-suppliers.component').then(
                        (m) => m.SetupSuppliersComponent
                    ),
                title: 'Suppliers'
            },
            {
                path: 'setup/branches',
                data: { routeKey: 'setupBranches', allowed: ['admin'] },
                canActivate: [roleGuard],
                loadComponent: () =>
                    import('./pages/setup-branches.component').then((m) => m.SetupBranchesComponent),
                title: 'Branches and sections'
            },
        ]
    },
    { path: '**', redirectTo: '' }
];
