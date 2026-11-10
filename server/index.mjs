import express from 'express';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mjs';
import { createApp } from './app.mjs';
import { closeRedis } from './redis.mjs';

const port = Number(process.env.PORT || 3001);
const app = createApp();
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
  app.get(/.*/, (_req, res) => res.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url))));
}
app.listen(port, '127.0.0.1', () => console.log(`Veyra API listening on port ${port}.`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => { await Promise.allSettled([pool.end(), closeRedis()]); process.exit(0); });
}
