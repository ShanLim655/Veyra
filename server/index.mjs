import express from 'express';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mjs';
import { createApp } from './app.mjs';
import { closeRedis } from './redis.mjs';
import { startBackgroundWorker } from './jobs.mjs';

const port = Number(process.env.PORT || 3001);
const app = createApp();
const stopBackgroundWorker = await startBackgroundWorker();
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
  app.get(/.*/, (_req, res) => res.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url))));
}
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
