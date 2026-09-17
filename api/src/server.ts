import { buildApp } from './app.js';
import { config } from './config.js';
import { db } from './db/index.js';

const app = await buildApp();

const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.destroy();
    process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
    await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
