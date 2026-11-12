// Optional Altare Queues integration for background job publishing.
//
// Queues are DISABLED by default. Set ALTARE_QUEUES_ENABLED=true together with
// ALTARE_QUEUES_URL to publish jobs to an Altare Queues HTTP endpoint. When
// disabled the module performs no network activity and callers must use their
// inline fallback so Veyra keeps working without a queue connection.
//
// Jobs are published as POST {ALTARE_QUEUES_URL}/jobs with a JSON body:
//   { type, payload, idempotency_key }
// Authentication uses `Authorization: Bearer ${ALTARE_QUEUES_API_KEY}` when
// ALTARE_QUEUES_API_KEY is configured.
//
// If publishing fails, callers run their fallback so jobs are never silently
// discarded. See docs/queues.md for the worker contract.

const ENABLED = ['true', '1', 'yes'].includes(
  String(process.env.ALTARE_QUEUES_ENABLED || '').trim().toLowerCase(),
);
const QUEUES_URL = String(process.env.ALTARE_QUEUES_URL || '').trim().replace(/\/+$/, '');
const API_KEY = String(process.env.ALTARE_QUEUES_API_KEY || '').trim();
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.ALTARE_QUEUES_TIMEOUT_MS) || 5000, 500), 30000);

function isValidEndpoint(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol);
  } catch {
    return false;
  }
}

export function queuesEnabled() {
  return ENABLED;
}

export function queuesConfigured() {
  return ENABLED && isValidEndpoint(QUEUES_URL);
}

// Call once at startup: enabling queues without a valid endpoint is a
// configuration error that must fail fast with an actionable message.
export function assertQueuesConfig() {
  if (!ENABLED) return;
  if (!isValidEndpoint(QUEUES_URL)) {
    throw new Error(
      'ALTARE_QUEUES_ENABLED is true but ALTARE_QUEUES_URL is missing or invalid. ' +
      'Set ALTARE_QUEUES_URL to your Altare Queues HTTP endpoint, or set ALTARE_QUEUES_ENABLED=false.',
    );
  }
}

// Returns { delivered: 'queued' | 'inline' | 'inline-fallback' | 'unavailable' }.
// `fallback` is an async function run whenever the job could not be queued
// (queues disabled or publish failure), so supported operations always execute.
export async function enqueueJob(type, payload, { idempotencyKey, fallback } = {}) {
  if (!ENABLED) {
    if (fallback) {
      const result = await fallback();
      return { delivered: 'inline', result };
    }
    return { delivered: 'inline' };
  }
  try {
    const response = await fetch(`${QUEUES_URL}/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({
        type,
        payload,
        idempotency_key: idempotencyKey || null,
        source: 'veyra',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`queue endpoint responded ${response.status}`);
    return { delivered: 'queued' };
  } catch (error) {
    console.warn(`Altare Queues publish failed for "${type}"; running inline fallback:`, error instanceof Error ? error.message : error);
    if (fallback) {
      const result = await fallback();
      return { delivered: 'inline-fallback', result };
    }
    return { delivered: 'unavailable' };
  }
}
