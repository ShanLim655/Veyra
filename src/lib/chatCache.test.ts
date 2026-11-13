import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearChatCache,
  getCachedDmList,
  getCachedMessages,
  setCachedDmList,
  setCachedMessages,
} from "./chatCache";

// Minimal in-memory localStorage stub — Node has no Web Storage.
function installLocalStorage() {
  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  vi.stubGlobal("localStorage", storage);
  return store;
}

describe("chatCache", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("round-trips messages for a conversation", () => {
    const msgs = [{ id: "m1" }, { id: "m2" }];
    setCachedMessages("conv-a", msgs);
    expect(getCachedMessages("conv-a")).toEqual(msgs);
  });

  it("keeps conversations isolated — DM A data never appears under DM B", () => {
    setCachedMessages("conv-a", [{ id: "a1", secret: "dm-a" }]);
    setCachedMessages("conv-b", [{ id: "b1", secret: "dm-b" }]);
    expect(getCachedMessages("conv-a")).toEqual([{ id: "a1", secret: "dm-a" }]);
    expect(getCachedMessages("conv-b")).toEqual([{ id: "b1", secret: "dm-b" }]);
    expect(getCachedMessages("conv-c")).toBeNull();
  });

  it("rejects entries whose embedded key does not match the requested key", () => {
    // Simulate a misrouted/corrupted write: envelope claims key "conv-a"
    // but is stored under "conv-b"'s slot.
    const store = installLocalStorage();
    store.set(
      "veyra-cache:v2:msgs:conv-b",
      JSON.stringify({ t: Date.now(), k: "conv-a", v: [{ id: "leak" }] }),
    );
    expect(getCachedMessages("conv-b")).toBeNull();
    // The poisoned entry is evicted so it cannot resurface.
    expect(store.has("veyra-cache:v2:msgs:conv-b")).toBe(false);
  });

  it("expires entries older than the TTL", () => {
    const store = installLocalStorage();
    const twoDaysAgo = Date.now() - 25 * 60 * 60 * 1000;
    store.set(
      "veyra-cache:v2:msgs:conv-a",
      JSON.stringify({ t: twoDaysAgo, k: "conv-a", v: [{ id: "old" }] }),
    );
    expect(getCachedMessages("conv-a")).toBeNull();
  });

  it("trims message history to the most recent entries", () => {
    const msgs = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}` }));
    setCachedMessages("conv-a", msgs);
    const cached = getCachedMessages<{ id: string }>("conv-a")!;
    expect(cached).toHaveLength(50);
    expect(cached[0].id).toBe("m30");
    expect(cached[49].id).toBe("m79");
  });

  it("does not write for a null/undefined channel", () => {
    setCachedMessages(null, [{ id: "x" }]);
    setCachedMessages(undefined, [{ id: "x" }]);
    const store = installLocalStorage();
    expect(store.size).toBe(0);
  });

  it("scopes the DM list cache per user", () => {
    setCachedDmList("user-1", [{ id: "d1" }]);
    setCachedDmList("user-2", [{ id: "d2" }]);
    expect(getCachedDmList("user-1")).toEqual([{ id: "d1" }]);
    expect(getCachedDmList("user-2")).toEqual([{ id: "d2" }]);
    expect(getCachedDmList("user-3")).toBeNull();
  });

  it("clearChatCache removes only veyra cache keys", () => {
    const store = installLocalStorage();
    setCachedMessages("conv-a", [{ id: "m1" }]);
    setCachedDmList("user-1", [{ id: "d1" }]);
    store.set("unrelated-key", "keep-me");
    store.set("veyra-cache:v1:old", "legacy");
    clearChatCache();
    expect(getCachedMessages("conv-a")).toBeNull();
    expect(getCachedDmList("user-1")).toBeNull();
    expect(store.get("unrelated-key")).toBe("keep-me");
    expect(store.has("veyra-cache:v1:old")).toBe(false);
  });
});
