import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.MARIADB_USER ||= 'test';
process.env.MARIADB_DATABASE ||= 'test';

const { createApp } = await import('./app.mjs');

test('self-hosted frontend routes serve the SPA without swallowing API 404s', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'veyra-static-'));
  writeFileSync(path.join(directory, 'index.html'), '<!doctype html><title>Veyra test</title>');
  const app = createApp({ staticDirectory: directory });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  try {
    const root = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /Veyra test/);

    const nested = await fetch(`http://127.0.0.1:${address.port}/conversations/example`);
    assert.equal(nested.status, 200);
    assert.match(await nested.text(), /Veyra test/);

    const missingApi = await fetch(`http://127.0.0.1:${address.port}/api/not-a-route`);
    assert.equal(missingApi.status, 404);
    assert.match(missingApi.headers.get('content-type') || '', /application\/json/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
