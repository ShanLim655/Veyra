import { fileURLToPath } from 'node:url';
import { pool } from './db.mjs';
import { createApp } from './app.mjs';
import { closeRedis } from './redis.mjs';
import { startBackgroundWorker } from './jobs.mjs';

const port = Number(process.env.PORT || 3001);
const staticDirectory = process.env.NODE_ENV === 'production' ? fileURLToPath(new URL('../dist', import.meta.url)) : null;
const app = createApp({ staticDirectory });
const stopBackgroundWorker = await startBackgroundWorker();
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Veyra API listening on port ${port}.`));
let shutdownPromise;

function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    await new Promise((resolve) => server.close(resolve));
    try {
      await stopBackgroundWorker();
    } catch (error) {
      console.error('Background worker shutdown failed:', error);
    }
    await Promise.allSettled([pool.end(), closeRedis()]);
  })();
  return shutdownPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}
