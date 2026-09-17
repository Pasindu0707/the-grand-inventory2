/**
 * Photo upload.
 *
 * This is the evidence trail. A crate of spoiled lettuce and a delivery that
 * arrived short are both arguments waiting to happen, and a photograph taken
 * at the time is what settles them - which is why this endpoint is strict
 * about what it accepts.
 *
 * Files go to a disk volume rather than object storage. One VPS, one restaurant
 * group, and the nightly pg_dump has a matching rsync; S3 is a Phase 4 problem
 * when there are five outlets writing to the same bucket.
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { extname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest } from '../errors.js';
import { config } from '../config.js';

const ALLOWED = new Map([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/heic', '.heic']
]);

export async function uploadRoutes(app: FastifyInstance) {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.post(
        '/uploads',
        {
            preHandler: app.authenticate,
            schema: {
                response: {
                    201: z.object({ url: z.string(), filename: z.string() })
                }
            }
        },
        async (req, reply) => {
            const file = await req.file();
            if (!file) throw badRequest('No file was sent');

            const ext = ALLOWED.get(file.mimetype);
            if (!ext) {
                throw badRequest(
                    `Photos only (jpeg, png, webp, heic). Got "${file.mimetype}".`
                );
            }

            // Date-partitioned so one directory does not accumulate every photo
            // the site has ever taken.
            const day = new Date().toISOString().slice(0, 10);
            const dir = join(config.UPLOAD_DIR, day);
            await mkdir(dir, { recursive: true });

            const filename = `${randomUUID()}${ext || extname(file.filename) || '.jpg'}`;
            const target = join(dir, filename);

            await pipeline(file.file, createWriteStream(target));

            if (file.file.truncated) {
                throw badRequest(
                    `That photo is over the ${Math.round(config.MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`
                );
            }

            return reply.status(201).send({
                url: `/uploads/${day}/${filename}`,
                filename
            });
        }
    );
}
