// Optional Altare Queues integration for background job publishing.
//
// Queues are DISABLED by default: with no ALTARE_QUEUE_URL configured the
// module performs no network activity and callers run their inline fallback,
// so Veyra keeps working without a queue connection.
//
// API contract (https://kv-us.altare.global style endpoints):
//   enqueue:  POST {ALTARE_QUEUE_URL}/messages         { body: {...} }
//   receive:  POST {ALTARE_QUEUE_URL}/messages/receive { max_messages, wait_seconds }
//   ack:      POST {ALTARE_QUEUE_URL}/messages/ack     { receipts: [...] }
//   retry:    POST {ALTARE_QUEUE_URL}/messages/retry   { receipts: [...], delay_seconds }
// Authentication uses `Authorization: Bearer ${ALTARE_QUEUE_TOKEN}`.
//
// If publishing fails, callers run their fallback so jobs are never silently
// discarded. See docs/queues.md and scripts/altare-queue-worker.mjs.

const QUEUE_URL = String(process.env.ALTARE_QUEUE_URL || '').trim().replace(/\/+$/, '');
const QUEUE_TOKEN = String(process.env.ALTARE_QUEUE_TOKEN || '').trim();
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.ALTARE_QUEUE_TIMEOUT_MS) || 5000, 500), 30000);

function isValidEndpoint(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol);
  } catch {
    return false;
  }
}

export function queuesEnabled() {
  return isValidEndpoint(QUEUE_URL);
}

// Call once at startup: a malformed queue URL is a configuration error that
// must fail fast with an actionable message.
export function assertQueuesConfig() {
  if (!QUEUE_URL) return;
  if (!isValidEndpoint(QUEUE_URL)) {
    throw new Error(
      'ALTARE_QUEUE_URL is set but is not a valid http(s) URL. ' +
      'Set it to your Altare queue endpoint (e.g. https://kv-us.altare.global/v1/queues/q_xxx) or unset it to disable queues.',
    );
  }
  if (!QUEUE_TOKEN) {
    console.warn('ALTARE_QUEUE_URL is set but ALTARE_QUEUE_TOKEN is empty; queue publishes will be sent without authentication.');
  }
}

async function post(path, body) {
  const response = await fetch(`${QUEUE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(QUEUE_TOKEN ? { Authorization: `Bearer ${QUEUE_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Altare queue responded ${response.status} for ${path}`);
  return response.json();
}

// Enqueues { type, payload, idempotency_key } as the message body.
// Returns { delivered: 'queued' | 'inline' | 'inline-fallback' | 'unavailable' }.
// `fallback` is an async function run whenever the job could not be queued
// (queues disabled or publish failure), so supported operations always execute.
export async function enqueueJob(type, payload, { idempotencyKey, fallback } = {}) {
  if (!queuesEnabled()) {
    if (fallback) {
      const result = await fallback();
      return { delivered: 'inline', result };
    }
    return { delivered: 'inline' };
  }
  try {
    await post('/messages', {
      body: {
        type,
        payload,
        idempotency_key: idempotencyKey || null,
        source: 'veyra',
      },
    });
    return { delivered: 'queued' };
  } catch (error) {
    console.warn(`Altare queue publish failed for "${type}"; running inline fallback:`, error instanceof Error ? error.message : error);
    if (fallback) {
      const result = await fallback();
      return { delivered: 'inline-fallback', result };
    }
    return { delivered: 'unavailable' };
  }
}
