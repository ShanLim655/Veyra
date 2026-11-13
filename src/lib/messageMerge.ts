import { serverDateMs } from "./dates";

// Merge a freshly fetched page of older messages above the current list.
// Messages already present (by id) are kept as-is so realtime updates and
// optimistic entries are never dropped or duplicated.
export function prependOlderMessages<T extends { id: string }>(
  previous: T[],
  older: T[],
): T[] {
  const existingIds = new Set(previous.map((m) => m.id));
  return [...older.filter((m) => !existingIds.has(m.id)), ...previous];
}

// Merge a fetched page into the visible list for the initial/realtime
// refresh path. Fetched rows win on id conflicts (they carry fresh receipt
// and enrichment state) and the result is sorted chronologically.
export function mergeMessagePage<
  T extends { id: string; created_at: string },
>(previous: T[], page: T[]): T[] {
  const merged = new Map<string, T>();
  for (const m of previous) merged.set(m.id, m);
  for (const m of page) merged.set(m.id, m);
  return [...merged.values()].sort(
    (a, b) => serverDateMs(a.created_at) - serverDateMs(b.created_at),
  );
}
