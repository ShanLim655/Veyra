import { describe, expect, it } from "vitest";
import { mergeMessagePage, prependOlderMessages } from "./messageMerge";

const msg = (id: string, created_at: string, tag = "") => ({
  id,
  created_at,
  content: tag || id,
});

describe("prependOlderMessages", () => {
  it("places older messages above existing ones without reordering them", () => {
    const prev = [msg("b", "2026-01-01T00:00:02Z"), msg("c", "2026-01-01T00:00:03Z")];
    const older = [msg("a", "2026-01-01T00:00:01Z")];
    expect(prependOlderMessages(prev, older).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("does not duplicate messages that are already loaded", () => {
    const prev = [msg("b", "2026-01-01T00:00:02Z"), msg("c", "2026-01-01T00:00:03Z")];
    // Page overlaps at the boundary (cursor races / realtime inserts).
    const older = [msg("a", "2026-01-01T00:00:01Z"), msg("b", "2026-01-01T00:00:02Z")];
    const merged = prependOlderMessages(prev, older);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(merged.filter((m) => m.id === "b")).toHaveLength(1);
  });

  it("keeps the existing copy when ids collide so realtime state wins", () => {
    const live = { ...msg("b", "2026-01-01T00:00:02Z"), _status: "read" as const };
    const stale = { ...msg("b", "2026-01-01T00:00:02Z"), _status: "sent" as const };
    const merged = prependOlderMessages([live], [stale]);
    expect(merged).toHaveLength(1);
    expect((merged[0] as any)._status).toBe("read");
  });

  it("handles an empty previous list and an empty page", () => {
    expect(prependOlderMessages([], [msg("a", "2026-01-01T00:00:01Z")])).toHaveLength(1);
    const prev = [msg("a", "2026-01-01T00:00:01Z")];
    expect(prependOlderMessages(prev, [])).toEqual(prev);
  });
});

describe("mergeMessagePage", () => {
  it("merges a fetched page into cached/realtime messages sorted by created_at", () => {
    const cached = [msg("m1", "2026-01-01T00:00:01Z"), msg("m3", "2026-01-01T00:00:03Z")];
    const page = [msg("m2", "2026-01-01T00:00:02Z"), msg("m4", "2026-01-01T00:00:04Z")];
    expect(mergeMessagePage(cached, page).map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("lets fetched rows win on id conflicts (fresh receipt/enrichment state)", () => {
    const prev = [{ ...msg("m1", "2026-01-01T00:00:01Z"), read_at: null }];
    const page = [{ ...msg("m1", "2026-01-01T00:00:01Z"), read_at: "2026-01-01T00:05:00Z" }];
    const merged = mergeMessagePage(prev, page);
    expect(merged).toHaveLength(1);
    expect((merged[0] as any).read_at).toBe("2026-01-01T00:05:00Z");
  });

  it("preserves messages that arrived via realtime while the fetch was in flight", () => {
    const realtime = msg("live-1", "2026-01-01T00:00:05Z");
    const prev = [msg("m1", "2026-01-01T00:00:01Z"), realtime];
    const page = [msg("m1", "2026-01-01T00:00:01Z"), msg("m2", "2026-01-01T00:00:02Z")];
    const merged = mergeMessagePage(prev, page);
    expect(merged.map((m) => m.id)).toEqual(["m1", "m2", "live-1"]);
  });

  it("keeps messages from different conversations isolated by id", () => {
    // Simulates the merge contract the component relies on: merging only ever
    // combines rows that share the same id space (one conversation's table).
    const convA = [msg("a1", "2026-01-01T00:00:01Z")];
    const convB = [msg("b1", "2026-01-01T00:00:01Z")];
    const merged = mergeMessagePage(convA, convB);
    expect(merged.map((m) => m.id).sort()).toEqual(["a1", "b1"]);
  });

  it("sorts legacy server datetime strings correctly", () => {
    const prev = [msg("new", "2026-01-01 00:00:03")];
    const page = [msg("old", "2026-01-01 00:00:01"), msg("mid", "2026-01-01T00:00:02Z")];
    expect(mergeMessagePage(prev, page).map((m) => m.id)).toEqual(["old", "mid", "new"]);
  });
});
