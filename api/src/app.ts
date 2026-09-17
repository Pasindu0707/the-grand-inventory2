import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {
    serializerCompiler,
    validatorCompiler,
    type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AppError } from './errors.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { itemRoutes } from './routes/items.js';
import { grnRoutes } from './routes/grn.js';
import { stockRoutes } from './routes/stock.js';
import { documentRoutes } from './routes/documents.js';
import { uploadRoutes } from './routes/uploads.js';
import { reportRoutes } from './routes/reports.js';
import { requestRoutes } from './routes/requests.js';
import { adminRoutes } from './routes/admin.js';
import { setupRoutes } from './routes/setup.js';
import { purchasingRoutes } from './routes/purchasing.js';
import { openingRoutes } from './routes/opening.js';
import { returnRoutes } from './routes/returns.js';

export async function buildApp(): Promise<FastifyInstance> {
    const app = Fastify({
        logger:
            config.NODE_ENV === 'test'
                ? false
                : {
                      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
                      // A PIN in a log file is a PIN in a backup, forever.
                      redact: ['req.headers.authorization', 'req.body.pin'],
                  },
    }).withTypeProvider<ZodTypeProvider>();

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    /**
     * Treat an empty body as `{}`.
     *
     * Several endpoints are pure commands - approve, close, verify, cancel -
     * and take no body at all. Fastify's default parser rejects a POST that
     * declares `application/json` and then sends nothing, which is exactly what
     * a reasonable client does for a bodyless command. Failing those with a
     * parse error is a trap, not a safety feature.
     */
    app.addContentTypeParser(
        'application/json',
        { parseAs: 'string' },
        (_req, body: string, done) => {
            if (!body || body.trim() === '') return done(null, {});
            try {
                done(null, JSON.parse(body));
            } catch (err) {
                (err as { statusCode?: number }).statusCode = 400;
                done(err as Error, undefined);
            }
        }
    );

    await app.register(cors, {
        origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()),
        credentials: true,
    });

    await app.register(jwt, { secret: config.JWT_SECRET });

    await app.register(multipart, {
        limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 }
    });

    // Photos are served straight off the volume. They are evidence, not
    // content: no directory listing, and a long cache since the filenames are
    // random and immutable.
    await mkdir(config.UPLOAD_DIR, { recursive: true });
    await app.register(fastifyStatic, {
        root: resolve(config.UPLOAD_DIR),
        prefix: '/uploads/',
        index: false,
        list: false,
        cacheControl: true,
        maxAge: '365d'
    });

    await app.register(rateLimit, {
        global: false,
        max: 100,
        timeWindow: '1 minute',
    });

    await app.register(authPlugin);

    app.setErrorHandler((err, req, reply) => {
        if (err instanceof AppError) {
            return reply
                .status(err.statusCode)
                .send({ error: err.code, message: err.message, details: err.details });
        }

        const asRecord = err as unknown as { validation?: unknown; message?: string };
        if (err instanceof ZodError || asRecord.validation) {
            return reply.status(400).send({
                error: 'VALIDATION_FAILED',
                message: asRecord.message ?? 'Request failed validation',
                details: asRecord.validation,
            });
        }

        if ((err as { statusCode?: number }).statusCode === 429) {
            return reply
                .status(429)
                .send({ error: 'TOO_MANY_REQUESTS', message: 'Slow down and try again shortly' });
        }

        // Anything Fastify itself has already classified as a client error --
        // malformed JSON, unsupported media type -- is the caller's problem,
        // not ours. Reporting it as a 500 sends people hunting server logs for
        // a broken request body.
        const status = (err as { statusCode?: number }).statusCode;
        if (status && status >= 400 && status < 500) {
            return reply.status(status).send({
                error: (err as { code?: string }).code ?? 'BAD_REQUEST',
                message: asRecord.message ?? 'Request could not be processed'
            });
        }

        req.log.error({ err }, 'unhandled error');
        return reply
            .status(500)
            .send({ error: 'INTERNAL', message: 'Something went wrong on our side' });
    });

    const v1 = '/api/v1';
    await app.register(healthRoutes, { prefix: v1 });
    await app.register(authRoutes, { prefix: `${v1}/auth` });
    await app.register(itemRoutes, { prefix: v1 });
    await app.register(grnRoutes, { prefix: v1 });
    await app.register(stockRoutes, { prefix: v1 });
    await app.register(documentRoutes, { prefix: v1 });
    await app.register(uploadRoutes, { prefix: v1 });
    await app.register(reportRoutes, { prefix: v1 });
    await app.register(requestRoutes, { prefix: v1 });
    await app.register(adminRoutes, { prefix: v1 });
    await app.register(setupRoutes, { prefix: v1 });
    await app.register(purchasingRoutes, { prefix: v1 });
    await app.register(openingRoutes, { prefix: v1 });
    await app.register(returnRoutes, { prefix: v1 });

    return app;
}
