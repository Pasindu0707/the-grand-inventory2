import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { db } from '../db/index.js';

export async function healthRoutes(app: FastifyInstance) {
    app.withTypeProvider<ZodTypeProvider>().get(
        '/health',
        {
            schema: {
                response: {
                    200: z.object({
                        status: z.literal('ok'),
                        db: z.literal('up'),
                        ledgerRows: z.number(),
                    }),
                },
            },
        },
        async () => {
            const row = await sql<{
                n: string;
            }>`select count(*)::text as n from stock_ledger`.execute(db);
            return {
                status: 'ok' as const,
                db: 'up' as const,
                ledgerRows: Number(row.rows[0]?.n ?? 0),
            };
        }
    );
}
