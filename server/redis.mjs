import { createHash } from 'node:crypto';
import { createClient } from 'redis';

const redisUrl = String(process.env.REDIS_URL || '').trim();
const inFlight = new Map();
const MAX_IN_FLIGHT = 500;
let client;
let connectPromise;
let redisDisabledUntil = 0;

function getClient() {
  if (!redisUrl || Date.now() < redisDisabledUntil) return null;
  if (!client) {
    client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 1500,
        reconnectStrategy: (retries) => (retries > 2 ? false : Math.min(250 * 2 ** retries, 1000)),
      },
    });
    client.on('error', (error) => console.warn('Redis unavailable; using MariaDB path:', error.message));
    client.on('end', () => { redisDisabledUntil = Date.now() + 2000; });
  }
  return client;
}

async function readyClient() {
  const current = getClient();
  if (!current) return null;
  if (current.isReady) return current;
  if (!connectPromise) {
    connectPromise = current.connect().catch((error) => {
      redisDisabledUntil = Date.now() + 5000;
      console.warn('Redis connection failed; using MariaDB path:', error.message);
      return null;
    }).finally(() => { connectPromise = undefined; });
  }
  return connectPromise;
}

const digest = (value) => createHash('sha256').update(value).digest('hex');

export async function coalesce(key, operation) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (inFlight.size >= MAX_IN_FLIGHT) inFlight.delete(inFlight.keys().next().value);
  const pending = Promise.resolve().then(operation).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

export async function cachedRead(userId, table, payload, operation) {
  const requestKey = digest(JSON.stringify([userId, table, payload]));
  return coalesce(requestKey, async () => {
    const redis = await readyClient();
    if (!redis) return operation();
    const epochKey = `veyra:v1:epoch:${table}`;
    let valueKey;
    let cached;
    try {
      const epoch = await redis.get(epochKey) || '0';
      valueKey = `veyra:v1:read:${table}:${epoch}:${requestKey}`;
      cached = await redis.get(valueKey);
      if (cached) return JSON.parse(cached);
    } catch (error) {
      console.warn('Redis read cache failed; using MariaDB:', error.message);
      redisDisabledUntil = Date.now() + 2000;
      return operation();
    }

    // Keep database failures outside the Redis fallback catch so a failed
    // MariaDB query is never accidentally issued a second time.
    const value = await operation();
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) <= 256 * 1024) {
      try { await redis.set(valueKey, serialized, { EX: 2 }); }
      catch (error) {
        console.warn('Redis cache write failed; returning MariaDB result:', error.message);
        redisDisabledUntil = Date.now() + 2000;
      }
    }
    return value;
  });
}

const RATE_LIMIT_PREFIX = 'veyra:v1:ratelimit:';

// Fixed-window rate limit backed by Redis so limits hold across serverless
// instances and restarts. Returns null when Redis is unavailable so callers
// can fall back to their local in-memory limiter.
export async function consumeRateLimit(key, limit, windowMs) {
  const redis = await readyClient();
  if (!redis) return null;
  try {
    const fullKey = `${RATE_LIMIT_PREFIX}${key}`;
    const count = await redis.incr(fullKey);
    if (count === 1) await redis.pExpire(fullKey, windowMs);
    return { allowed: count <= limit, count, limit };
  } catch (error) {
    console.warn('Redis rate limit failed; caller should use its fallback:', error.message);
    redisDisabledUntil = Date.now() + 2000;
    return null;
  }
}

const REALTIME_STREAM = 'veyra:v1:realtime-outbox';

export async function enqueueRealtimeBatch(messages) {
  const redis = await readyClient();
  if (!redis) return null;
  try {
    return await redis.sendCommand([
      'XADD', REALTIME_STREAM, 'MAXLEN', '~', '10000', '*', 'batch', JSON.stringify(messages),
    ]);
  } catch (error) {
    console.warn('Redis realtime queue unavailable; broadcasting directly:', error.message);
    redisDisabledUntil = Date.now() + 2000;
    return null;
  }
}

export async function pendingRealtimeBatches(limit = 20) {
  const redis = await readyClient();
  if (!redis) return [];
  try {
    const entries = await redis.xRange(REALTIME_STREAM, '-', '+', { COUNT: limit });
    return entries.map(({ id, message }) => ({
      id,
      messages: JSON.parse(message.batch || '[]'),
    }));
  } catch (error) {
    console.warn('Redis realtime queue read failed:', error.message);
    redisDisabledUntil = Date.now() + 2000;
    return [];
  }
}

export async function acknowledgeRealtimeBatch(id) {
  const redis = await readyClient();
  if (!redis) return;
  try { await redis.xDel(REALTIME_STREAM, id); }
  catch (error) { console.warn('Redis realtime acknowledgement failed:', error.message); }
}

export async function invalidateReadCache(table) {
  const redis = await readyClient();
  if (!redis) return;
  const affectedTables = table === 'conversation_members'
    ? ['conversation_members', 'messages', 'conversations']
    : table === 'user_roles'
      ? ['user_roles', 'messages', 'conversations', 'profiles', 'global_messages', 'announcement_messages']
      : [table];
  try {
    await Promise.all(affectedTables.map((affected) => redis.incr(`veyra:v1:epoch:${affected}`)));
  } catch (error) {
    console.warn('Redis cache invalidation failed; short cache TTL remains:', error.message);
    redisDisabledUntil = Date.now() + 2000;
  }
}

export async function closeRedis() {
  if (client?.isOpen) await client.quit();
}
