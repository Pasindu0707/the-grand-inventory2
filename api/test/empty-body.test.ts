import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authedHeaders, db, makeApp } from './helpers.js';

/**
 * Command endpoints take no body. A client that sets Content-Type:
 * application/json and sends nothing must not get a parse error - this was a
 * real 500 found by driving the API over HTTP rather than through inject().
 */
let app: FastifyInstance;
let headers: Record<string, string>;

beforeAll(async () => {
    app = await makeApp();
    headers = (await authedHeaders(app)).headers;
});

afterAll(async () => {
    await app.close();
    await db.destroy();
});

describe('bodyless commands', () => {
    it('accepts an empty body with a JSON content-type', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/wastage/999999/approve',
            headers: { ...headers, 'content-type': 'application/json' },
            payload: ''
        });

        // 403 (role) or 404 (no such wastage) are both fine here. What must not
        // happen is a body-parse failure.
        expect([403, 404]).toContain(res.statusCode);
        expect(res.json().error).not.toBe('INTERNAL');
    });

    it('still rejects genuinely malformed JSON', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/issues',
            headers: { ...headers, 'content-type': 'application/json' },
            payload: '{"toSectionId": '
        });
        expect(res.statusCode).toBe(400);
    });
});
