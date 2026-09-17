/**
 * Photo uploads.
 *
 * This file is what is left of market-cleaning.test.ts. The cash market
 * purchase and the cleaning checklist were both removed (db/migrations/0006),
 * and their tests went with them, but the upload endpoint they shared is still
 * carrying wastage photos and delivery slips.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authedHeaders, db, makeApp } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
    app = await makeApp();
    await authedHeaders(app);
});

afterAll(async () => {
    await app.close();
    await db.destroy();
});

describe('uploads', () => {
    // The multipart happy path and the mime-type rejection are exercised over
    // real HTTP by the slice-3 smoke script - inject() with a FormData body is
    // fiddly enough that the test would mostly be testing the test harness.
    // What belongs here is the guard that does not need a body at all.
    it('requires a session', async () => {
        const res = await app.inject({ method: 'POST', url: '/api/v1/uploads' });
        expect(res.statusCode).toBe(401);
    });
});
