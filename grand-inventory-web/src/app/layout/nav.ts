/**
 * The menu, grouped by where in the building the work happens.
 *
 * Not by feature area and not alphabetically: a storekeeper's day runs down
 * the Store group, a chef's down Floor, and the owner's down Control. Grouping
 * by role would have been the other option, but people hold more than one job
 * in a restaurant this size, and a menu that changes shape when you change hats
 * is a menu nobody learns.
 *
 * Rows the signed-in role cannot open are not shown. The server still refuses
 * them - this only decides what is worth offering.
 */
import type { RouteKey } from '@/core/types';

export interface NavItem {
    label: string;
    icon: string;
    path: string;
    routeKey: RouteKey;
    /** Shown under the label on the Administration rows, which need a hint. */
    hint?: string;
}

export interface NavGroup {
    title: string;
    items: NavItem[];
}

export const NAV: NavGroup[] = [
    {
        title: 'Today',
        items: [{ label: 'Overview', icon: 'pi pi-home', path: '/home', routeKey: 'home' }]
    },
    {
        title: 'Floor',
        items: [
            { label: 'Requests', icon: 'pi pi-inbox', path: '/requests', routeKey: 'requests' },
            { label: 'What we have', icon: 'pi pi-box', path: '/mystock', routeKey: 'mystock' }
        ]
    },
    {
        title: 'Store',
        items: [
            { label: 'Receive delivery', icon: 'pi pi-truck', path: '/grn', routeKey: 'grn' },
            {
                label: 'Deliveries',
                icon: 'pi pi-receipt',
                path: '/deliveries',
                routeKey: 'deliveries'
            },
            { label: 'Stock on hand', icon: 'pi pi-database', path: '/stock', routeKey: 'stock' },
            {
                label: 'Returns',
                icon: 'pi pi-reply',
                path: '/returns',
                routeKey: 'returns'
            },
            { label: 'Opening stock', icon: 'pi pi-flag', path: '/opening', routeKey: 'opening' }
        ]
    },
    {
        title: 'Buying',
        items: [
            {
                label: 'Purchase orders',
                icon: 'pi pi-file-edit',
                path: '/purchases',
                routeKey: 'purchases'
            },
            {
                label: 'Supplier returns',
                icon: 'pi pi-undo',
                path: '/supplier-returns',
                routeKey: 'supplierReturns'
            }
        ]
    },
    {
        title: 'Control',
        items: [
            { label: 'Stock counts', icon: 'pi pi-list', path: '/counts', routeKey: 'counts' },
            { label: 'Wastage', icon: 'pi pi-trash', path: '/wastage', routeKey: 'wastage' },
            { label: 'Reports', icon: 'pi pi-chart-bar', path: '/reports', routeKey: 'reports' }
        ]
    },
    {
        title: 'Administration',
        items: [
            {
                label: 'Admin overview',
                icon: 'pi pi-sliders-h',
                path: '/admin',
                routeKey: 'admin',
                hint: 'What is set up, and what is still missing'
            },
            {
                label: 'Logins',
                icon: 'pi pi-users',
                path: '/users',
                routeKey: 'users',
                hint: 'Who can sign in, and as what'
            },
            {
                label: 'Products',
                icon: 'pi pi-tags',
                path: '/setup/items',
                routeKey: 'setupItems',
                hint: 'Items, units and pack sizes'
            },
            {
                label: 'Suppliers',
                icon: 'pi pi-briefcase',
                path: '/setup/suppliers',
                routeKey: 'setupSuppliers',
                hint: 'Who you buy from, and at what price'
            },
            {
                label: 'Branches',
                icon: 'pi pi-sitemap',
                path: '/setup/branches',
                routeKey: 'setupBranches',
                hint: 'Outlets and the sections inside them'
            }
        ]
    }
];
