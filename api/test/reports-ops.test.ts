/**
 * The operating reports, over the wire.
 *
 * The services themselves are plain SQL and would be tested well enough by
 * calling them directly - but that is not where these break. The failure mode
 * for a report route is the zod *response* schema: a `nullif` that returns null
 * where the schema promised a number, or a `round()` that pg hands back as a
 * string. Neither shows up in a service-level test, and both turn into a 500
 * the first time somebody opens the screen.
 *
 * So these go through `app.inject` as management, and assert the shape that
 * actually crosses the wire.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../src/db/index.js';
import { DEMO_PIN, login, makeApp } from './helpers.js';

const RANGE = { from: '2026-06-01', to: '2026-08-31' };

/** Every operating report, and the field that proves it ran rather than 404'd. */
const REPORTS = [
    'open-purchase-orders',
    'service-level',
    'supplier-performance',
    'valuation',
    'dead-stock',
    'consumption',
    'count-accuracy'
] as const;

let app: FastifyInstance;
let headers: Record<string, string>;

beforeAll(async () => {
    app = await makeApp();

    // Reports are management-only, so a storekeeper token - what the shared
    // helper hands out - would 403 on every one of these and prove nothing.
    const manager = await db
        .selectFrom('users')
        .select(['id', 'location_id'])
        .where('role', '=', 'management')
        .where('is_active', '=', true)
        .orderBy('id')
        .executeTakeFirstOrThrow();

    const locationId = manager.location_id ?? 1;
    const { body } = await login(app, manager.id, locationId, DEMO_PIN);
    headers = {
        authorization: `Bearer ${body.accessToken}`,
        'x-location-id': String(locationId)
    };
});

afterAll(async () => {
    await app.close();
    await db.destroy();
});

describe('the operating reports', () => {
    for (const path of REPORTS) {
        it(`${path} answers with a rows array that survives its response schema`, async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/v1/reports/${path}?from=${RANGE.from}&to=${RANGE.to}`,
                headers
            });

            // A schema violation serialises as 500, which is the whole point of
            // going over the wire rather than calling the service.
            expect(res.statusCode, res.payload).toBe(200);

            const body = res.json();
            expect(body.from).toBe(RANGE.from);
            expect(body.to).toBe(RANGE.to);
            expect(Array.isArray(body.rows)).toBe(true);
        });
    }

    it('refuses a storekeeper', async () => {
        const keeper = await db
            .selectFrom('users')
            .select(['id', 'location_id'])
            .where('role', '=', 'storekeeper')
            .where('is_active', '=', true)
            .orderBy('id')
            .executeTakeFirstOrThrow();

        const locationId = keeper.location_id ?? 1;
        const { body } = await login(app, keeper.id, locationId, DEMO_PIN);

        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/reports/valuation',
            headers: {
                authorization: `Bearer ${body.accessToken}`,
                'x-location-id': String(locationId)
            }
        });

        expect(res.statusCode).toBe(403);
    });

    it('defaults to the last 30 days when no range is given', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/reports/consumption',
            headers
        });

        expect(res.statusCode, res.payload).toBe(200);
        const body = res.json();
        const days = (Date.parse(body.to) - Date.parse(body.from)) / 86_400_000;
        expect(days).toBe(29);
    });
});
