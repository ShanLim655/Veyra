// Lightweight browser cache for conversation metadata and recent messages.
// Goals:
//  - Render instantly from cache on mount / conversation switch.
//  - Avoid refetching on every tab focus (callers hydrate then background-refresh once).
//  - Stay safely under localStorage quota by trimming per-conversation history.

// NOTE: bump the PREFIX whenever the envelope shape changes so existing
// cached data on users' devices is invalidated rather than mis-read.
const PREFIX = "veyra-cache:v2:";
const LEGACY_PREFIXES = ["chatt-cache:v2:", "chatt-cache:", "veyra-cache:"];
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_MESSAGES_PER_CHANNEL = 50;

interface Envelope<T> {
  t: number;
  // The cache key this value was written under. Used to detect
  // cross-conversation contamination on read.
  k: string;
  v: T;
}

// One-time purge of older cache schemas to make sure any merged/misrouted
// data sitting in localStorage from a previous version cannot resurface.
let legacyPurged = false;
function purgeLegacy(): void {
  if (legacyPurged) return;
  legacyPurged = true;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (LEGACY_PREFIXES.some((p) => k.startsWith(p))) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

function read<T>(key: string): T | null {
  purgeLegacy();
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (!parsed || typeof parsed.t !== "number") return null;
    if (Date.now() - parsed.t > TTL_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    // Reject entries written under a different key (e.g. stale or
    // misrouted writes from a previous bug).
    if (parsed.k !== key) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return parsed.v;
  } catch {
    return null;
  }
}

function evictOldestEntries(count: number): void {
  try {
    const entries: Array<{ key: string; t: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(k) || "{}") as Envelope<unknown>;
        entries.push({ key: k, t: typeof parsed.t === "number" ? parsed.t : 0 });
      } catch {
        entries.push({ key: k, t: 0 });
      }
    }
    entries.sort((a, b) => a.t - b.t);
    for (const entry of entries.slice(0, count)) localStorage.removeItem(entry.key);
  } catch {
    /* ignore */
  }
}

function write<T>(key: string, value: T): void {
  purgeLegacy();
  const env: Envelope<T> = { t: Date.now(), k: key, v: value };
  const serialized = JSON.stringify(env);
  try {
    localStorage.setItem(PREFIX + key, serialized);
  } catch {
    // Quota exceeded — evict the oldest cache entries and retry once before
    // giving up, so a full cache doesn't silently drop fresh writes.
    try {
      evictOldestEntries(10);
      localStorage.setItem(PREFIX + key, serialized);
    } catch {
      try {
        localStorage.removeItem(PREFIX + key);
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------- Messages cache ----------
// `channel` is the conversation UUID for DMs, or "global"/"announcements" for shared rooms.

export function getCachedMessages<T = unknown>(channel: string | null | undefined): T[] | null {
  if (!channel) return null;
  return read<T[]>(`msgs:${channel}`);
}

export function setCachedMessages<T = unknown>(
  channel: string | null | undefined,
  messages: T[],
): void {
  if (!channel) return;
  const trimmed =
    messages.length > MAX_MESSAGES_PER_CHANNEL
      ? messages.slice(messages.length - MAX_MESSAGES_PER_CHANNEL)
      : messages;
  write(`msgs:${channel}`, trimmed);
}

// ---------- DM list cache ----------

export function getCachedDmList<T = unknown>(userId: string | null | undefined): T[] | null {
  if (!userId) return null;
  return read<T[]>(`dms:${userId}`);
}

export function setCachedDmList<T = unknown>(
  userId: string | null | undefined,
  list: T[],
): void {
  if (!userId) return;
  write(`dms:${userId}`, list);
}

// ---------- Maintenance ----------

export function clearChatCache(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(PREFIX) || LEGACY_PREFIXES.some((p) => k.startsWith(p))) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
