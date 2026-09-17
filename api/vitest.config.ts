import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // These tests talk to a real Postgres. Mocking the database would only
        // prove the mock agrees with itself, and the things worth testing here
        // -- append-only triggers, weighted average, idempotency races -- are
        // all database behaviour.
        fileParallelism: false,
        sequence: { concurrent: false },
        testTimeout: 30_000,
        hookTimeout: 60_000,
        env: { NODE_ENV: 'test' },
    },
});
