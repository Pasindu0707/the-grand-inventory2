import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { clearLoginAttempts, db, DEMO_PIN, login, makeApp, storekeeper } from './helpers.js';
import { config } from '../src/config.js';

let app: FastifyInstance;

beforeAll(async () => {
    app = await makeApp();
});

afterAll(async () => {
    await app.close();
    await db.destroy();
});

describe('bootstrap', () => {
    it('lists locations and users without exposing PIN hashes', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/v1/auth/bootstrap' });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body.locations.length).toBeGreaterThan(0);
        expect(body.users.length).toBeGreaterThan(0);
        expect(JSON.stringify(body)).not.toMatch(/\$2[aby]\$/);
    });
});

describe('PIN login', () => {
    it('signs in with the right PIN and returns the active location and its sections', async () => {
        const user = await storekeeper();
        await clearLoginAttempts(user.id);

        const { status, body } = await login(app, user.id, user.location_id ?? 1);

        expect(status).toBe(200);
        expect(body.user.id).toBe(user.id);
        expect(body.user.role).toBe('storekeeper');
        expect(body.accessToken).toBeTruthy();
        expect(body.refreshToken).toBeTruthy();
        expect(body.location.id).toBe(user.location_id ?? 1);
        expect(body.sections.some((s: { isStore: boolean }) => s.isStore)).toBe(true);
    });

    it('rejects a wrong PIN', async () => {
        const user = await storekeeper();
        await clearLoginAttempts(user.id);

        const { status, body } = await login(app, user.id, user.location_id ?? 1, '9999');
        expect(status).toBe(401);
        expect(body.message).toMatch(/wrong pin/i);

        await clearLoginAttempts(user.id);
    });

    it('locks the account after repeated wrong PINs', async () => {
        const user = await storekeeper();
        await clearLoginAttempts(user.id);

        for (let i = 0; i < config.MAX_PIN_ATTEMPTS; i++) {
            await login(app, user.id, user.location_id ?? 1, '0000');
        }

        // Locked out now, so even the correct PIN is refused -- which is the
        // whole point of a lockout on a 4-digit secret.
        const { status, body } = await login(app, user.id, user.location_id ?? 1, DEMO_PIN);
        expect(status).toBe(429);
        expect(body.message).toMatch(/too many/i);

        await clearLoginAttempts(user.id);
    });

    it('refuses a location the user is not assigned to', async () => {
        const user = await storekeeper();
        await clearLoginAttempts(user.id);

        const other = await db
            .selectFrom('locations')
            .select('id')
            .where('id', '!=', user.location_id ?? 1)
            .executeTakeFirst();

        if (other) {
            const { status } = await login(app, user.id, other.id);
            expect(status).toBe(403);
        }
        await clearLoginAttempts(user.id);
    });
});

describe('location scoping', () => {
    it('rejects an x-location-id outside the token’s allowed set', async () => {
        const user = await storekeeper();
        await clearLoginAttempts(user.id);
        const { body } = await login(app, user.id, user.location_id ?? 1);

        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/stock',
            headers: {
                authorization: `Bearer ${body.accessToken}`,
                // A header is trivially editable, which is exactly why the
                // server checks it against the token rather than trusting it.
                'x-location-id': '999',
            },
        });

        expect(res.statusCode).toBe(403);
    });

    it('rejects a refresh token used as an access token', async () => {
        const user = await storekeeper();
        await clearLoginAttempts(user.id);
        const { body } = await login(app, user.id, user.location_id ?? 1);

        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/auth/me',
            headers: { authorization: `Bearer ${body.refreshToken}` },
        });

        expect(res.statusCode).toBe(401);
    });
});
