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

const localRateLimits = new Map();
const RATE_LIMIT_FALLBACK_MAX = 10000;
const RATE_LIMIT_SCRIPT = "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return count";

function consumeLocalRateLimit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = localRateLimits.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  localRateLimits.set(key, bucket);
  if (localRateLimits.size > RATE_LIMIT_FALLBACK_MAX) {
    for (const [entryKey, entry] of localRateLimits) {
      if (entry.resetAt <= now || localRateLimits.size > RATE_LIMIT_FALLBACK_MAX) localRateLimits.delete(entryKey);
      if (localRateLimits.size <= RATE_LIMIT_FALLBACK_MAX * 0.9) break;
    }
  }
  return bucket.count <= limit;
}

export async function consumeRateLimit(scope, identifier, limit, windowMs) {
  const localKey = digest(JSON.stringify([scope, identifier]));
  const redis = await readyClient();
  if (!redis) return consumeLocalRateLimit(localKey, limit, windowMs);
  try {
    const count = Number(await redis.eval(RATE_LIMIT_SCRIPT, {
      keys: [`veyra:v1:rate-limit:${localKey}`],
      arguments: [String(windowMs)],
    }));
    return count <= limit;
  } catch (error) {
    console.warn('Redis rate limiting failed; using process-local limits:', error.message);
    redisDisabledUntil = Date.now() + 2000;
    return consumeLocalRateLimit(localKey, limit, windowMs);
  }
}


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
