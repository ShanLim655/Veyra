// Altare Queues worker for Veyra background jobs.
//
// Long-polls the configured Altare queue and delivers jobs to the Veyra API.
// Currently handles "notifications.deliver" jobs by forwarding them to
// POST {APP_URL}/api/queues/deliver with the QUEUES_WORKER_SECRET header.
//
// Required env:
//   ALTARE_QUEUE_URL      e.g. https://kv-us.altare.global/v1/queues/q_xxx
//   ALTARE_QUEUE_TOKEN    bearer token for the queue
//   QUEUES_WORKER_SECRET  must match the API's QUEUES_WORKER_SECRET
//   APP_URL               Veyra API origin (default http://localhost:3001)
//
// Optional env:
//   ALTARE_QUEUE_MAX_MESSAGES   batch size per poll (default 10)
//   ALTARE_QUEUE_WAIT_SECONDS   long-poll wait (default 20)
//   ALTARE_QUEUE_RETRY_SECONDS  retry delay for failed jobs (default 30)
//   ALTARE_QUEUE_IDLE_BACKOFF_MS extra delay after empty polls (default 1000)
//
// Usage: node scripts/altare-queue-worker.mjs
// Stop with Ctrl+C — in-flight messages are retried by the queue automatically.

const QUEUE_URL = String(process.env.ALTARE_QUEUE_URL || '').trim().replace(/\/+$/, '');
const QUEUE_TOKEN = String(process.env.ALTARE_QUEUE_TOKEN || '').trim();
const WORKER_SECRET = String(process.env.QUEUES_WORKER_SECRET || '').trim();
const APP_URL = String(process.env.APP_URL || 'http://localhost:3001').replace(/\/+$/, '');
const MAX_MESSAGES = Math.min(Math.max(Number(process.env.ALTARE_QUEUE_MAX_MESSAGES) || 10, 1), 100);
const WAIT_SECONDS = Math.min(Math.max(Number(process.env.ALTARE_QUEUE_WAIT_SECONDS) || 20, 0), 60);
const RETRY_SECONDS = Math.max(Number(process.env.ALTARE_QUEUE_RETRY_SECONDS) || 30, 1);
const IDLE_BACKOFF_MS = Math.max(Number(process.env.ALTARE_QUEUE_IDLE_BACKOFF_MS) || 1000, 0);

if (!QUEUE_URL || !isHttpUrl(QUEUE_URL)) {
  console.error('ALTARE_QUEUE_URL is missing or invalid.');
  process.exit(1);
}
if (!QUEUE_TOKEN) {
  console.error('ALTARE_QUEUE_TOKEN is required.');
  process.exit(1);
}
if (!WORKER_SECRET) {
  console.error('QUEUES_WORKER_SECRET is required (must match the API setting).');
  process.exit(1);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol);
  } catch {
    return false;
  }
}

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function post(path, body) {
  const response = await fetch(`${QUEUE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${QUEUE_TOKEN}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`queue ${path} responded ${response.status}`);
  return response.json();
}

async function handleJob(job) {
  const { type, payload } = job || {};
  if (type === 'notifications.deliver') {
    const response = await fetch(`${APP_URL}/api/queues/deliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-queue-worker-secret': WORKER_SECRET,
      },
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`deliver endpoint responded ${response.status}`);
    const result = await response.json().catch(() => ({}));
    if (result.ok === false) throw new Error('deliver endpoint reported failure');
    return;
  }
  // Unknown job types are acknowledged and dropped so they do not retry forever.
  console.warn(`Unknown job type "${type}"; acknowledging without action.`);
}

async function settle(receipts, path, extra = {}) {
  if (!receipts.length) return;
  await post(path, { receipts, ...extra });
}

async function main() {
  console.log(`Altare queue worker started: ${QUEUE_URL}`);
  console.log(`Delivering to ${APP_URL}/api/queues/deliver`);
  while (!stopping) {
    let messages = [];
    try {
      const result = await post('/messages/receive', {
        max_messages: MAX_MESSAGES,
        wait_seconds: WAIT_SECONDS,
      });
      messages = Array.isArray(result?.messages) ? result.messages : [];
    } catch (error) {
      console.error('Queue receive failed:', error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, Math.max(WAIT_SECONDS * 1000, 5000)));
      continue;
    }

    if (!messages.length) {
      if (IDLE_BACKOFF_MS) await new Promise((resolve) => setTimeout(resolve, IDLE_BACKOFF_MS));
      continue;
    }

    const acked = [];
    const retried = [];
    for (const message of messages) {
      try {
        await handleJob(message?.body);
        acked.push(message.receipt);
      } catch (error) {
        console.error('Job failed, scheduling retry:', error instanceof Error ? error.message : error);
        retried.push(message.receipt);
      }
    }
    try {
      await settle(acked, '/messages/ack');
      await settle(retried, '/messages/retry', { delay_seconds: RETRY_SECONDS });
    } catch (error) {
      console.error('Queue settle failed:', error instanceof Error ? error.message : error);
    }
  }
  console.log('Worker stopped.');
}

await main();
