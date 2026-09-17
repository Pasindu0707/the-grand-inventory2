import { z } from 'zod';

const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().default('postgres://grand:grand_dev@localhost:5433/thegrand'),

    // Rotating this invalidates every session, which is the intended lever.
    JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-in-production'),
    ACCESS_TOKEN_TTL: z.string().default('12h'),
    REFRESH_TOKEN_TTL: z.string().default('30d'),

    // A store room tablet is shared, so lockout is per user, not per IP.
    MAX_PIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
    PIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

    CORS_ORIGIN: z.string().default('http://localhost:4200'),

    // Photos of cash-purchase slips and wastage. On the VPS this is a mounted
    // volume so it survives a container rebuild -- losing it would destroy the
    // only evidence a cash buy ever has.
    UPLOAD_DIR: z.string().default('uploads'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
    console.error('Invalid environment:');
    for (const issue of parsed.error.issues) {
        console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
}

export const config = parsed.data;

if (config.NODE_ENV === 'production' && config.JWT_SECRET.startsWith('dev-only')) {
    console.error('JWT_SECRET is still the development default. Refusing to start in production.');
    process.exit(1);
}
