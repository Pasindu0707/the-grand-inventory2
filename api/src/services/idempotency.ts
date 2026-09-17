/**
 * Replay protection for document POSTs.
 *
 * The storekeeper is standing at the delivery door on patchy 4G. The request
 * goes out, the lorry driver is waiting, the spinner hangs, they tap Save
 * again. Without this, that is two GRNs and a stock figure nobody can explain a
 * week later.
 *
 * The client sends an Idempotency-Key (the Angular template already generates
 * UUIDs). A repeat of the same key returns the first response instead of doing
 * the work twice. A repeat of the same key with a *different* body is a bug on
 * the client, and says so rather than guessing which one was meant.
 */
import { createHash } from 'node:crypto';
import type { Tx } from './ledger.js';
import { db } from '../db/index.js';
import { conflict } from '../errors.js';

export const hashBody = (body: unknown): string =>
    createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');

export interface Replay<T> {
    replayed: true;
    response: T;
    statusCode: number;
}

/** Returns the stored response for this key, or null if it is new. */
export async function findReplay<T>(
    key: string,
    endpoint: string,
    requestHash: string
): Promise<Replay<T> | null> {
    const row = await db
        .selectFrom('idempotency_keys')
        .selectAll()
        .where('key', '=', key)
        .executeTakeFirst();

    if (!row) return null;

    if (row.request_hash !== requestHash) {
        throw conflict(
            'This Idempotency-Key was already used with a different request body',
            { key }
        );
    }

    if (row.endpoint !== endpoint) {
        throw conflict('This Idempotency-Key was already used on a different endpoint', { key });
    }

    return {
        replayed: true,
        response: row.response as T,
        statusCode: row.status_code ?? 200,
    };
}

/**
 * Claims the key inside the caller's transaction.
 *
 * Claiming before doing the work means two concurrent requests with the same
 * key cannot both proceed -- the second blocks on the primary key and then
 * fails, rather than both writing a GRN.
 */
export async function claimKey(
    trx: Tx,
    key: string,
    endpoint: string,
    requestHash: string,
    userId: number
): Promise<void> {
    try {
        await trx
            .insertInto('idempotency_keys')
            .values({
                key,
                endpoint,
                request_hash: requestHash,
                user_id: userId,
            })
            .execute();
    } catch (err) {
        if ((err as { code?: string }).code === '23505') {
            throw conflict('That request is already being processed', { key });
        }
        throw err;
    }
}

/** Stores the response so a later replay can return it. */
export async function storeResponse(
    trx: Tx,
    key: string,
    response: unknown,
    statusCode: number
): Promise<void> {
    await trx
        .updateTable('idempotency_keys')
        .set({ response: JSON.stringify(response), status_code: statusCode })
        .where('key', '=', key)
        .execute();
}
