import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mediaUrl", () => ({
  signMessageMedia: vi.fn(async (value: string | null) => value),
  collectMediaUrls: vi.fn(() => []),
  prefetchChatUrls: vi.fn(async () => {}),
}));

import { fetchConversationMessages, type MessageFetchDeps } from "./messageFetch";
import type { Message } from "./ChatView";

function makeRow(id: string, created_at: string, over: Record<string, unknown> = {}) {
  return {
    id,
    content: `content-${id}`,
    sender_id: "me",
    created_at,
    read_at: null,
    edited_at: null,
    image_url: null,
    reply_to_id: null,
    ...over,
  };
}

function makeMessage(id: string, created_at: string): Message {
  return { ...makeRow(id, created_at), reactions: [] } as Message;
}

// Chainable thenable query stub. Each from(table) call shifts the next queued
// result for that table; a queued entry may be a promise to keep the request
// in flight. Every builder method returns the same thenable so the code can
// chain select/order/limit/eq/lt/in before awaiting it.
function makeSupabase(queues: { messages?: unknown[]; profiles?: unknown[] } = {}) {
  const messageQueue = [...(queues.messages ?? [])];
  const profileQueue = [...(queues.profiles ?? [])];
  const from = vi.fn((table: string) => {
    const queue = table === "profiles" ? profileQueue : messageQueue;
    const result = queue.length
      ? queue.shift()
      : { data: [], error: null };
    const chain: Record<string | symbol, unknown> = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === "then") {
          return (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onFulfilled, onRejected);
        }
        return () => chain;
      },
    });
    return chain;
  });
  return { from };
}

interface FetchHarness {
  deps: MessageFetchDeps;
  messages: () => Message[];
  calls: {
    setMessages: number;
    setHasMore: boolean[];
    setLoadingMore: number;
    fetchReactions: number;
  };
  // Mirrors the component: switching conversations bumps the epoch and moves
  // the active-conversation marker before the new fetch starts.
  switchTo: (conversationId: string) => void;
  showBMessages: () => void;
}

function makeHarness(
  supabase: ReturnType<typeof makeSupabase>,
  overrides: Partial<MessageFetchDeps> = {},
): FetchHarness {
  const state = { messages: [] as Message[] };
  const calls = { setMessages: 0, setHasMore: [] as boolean[], setLoadingMore: 0, fetchReactions: 0 };
  const refs = {
    epoch: { current: 0 },
    active: { current: "conv-a" },
    loadingMore: { current: false },
    isInitialLoad: { current: true },
    initialScrollSettled: { current: false },
    userScrolled: { current: false },
  };
  const messagesRef = { current: state.messages };
  const setMessages: MessageFetchDeps["setMessages"] = (updater) => {
    calls.setMessages += 1;
    state.messages = typeof updater === "function" ? updater(state.messages) : updater;
    messagesRef.current = state.messages;
  };
  const deps: MessageFetchDeps = {
    conversationId: "conv-a",
    conversationEpochRef: refs.epoch,
    activeConversationRef: refs.active,
    isDM: true,
    messagesTable: "messages",
    conversationIdProp: "conv-a",
    userId: "me",
    ownSenderProfile: { username: "me", display_name: "Me", avatar_url: null },
    showReceipts: true,
    hasMore: true,
    messagesRef,
    setMessages,
    setHasMore: (value) => {
      calls.setHasMore.push(typeof value === "function" ? value(true) : value);
    },
    setLoadingMore: () => { calls.setLoadingMore += 1; },
    loadingMoreRef: refs.loadingMore,
    isInitialLoad: refs.isInitialLoad,
    initialScrollSettledRef: refs.initialScrollSettled,
    userScrolledRef: refs.userScrolled,
    scrollAreaRef: { current: null },
    fetchReactions: vi.fn(async () => {
      calls.fetchReactions += 1;
      return {};
    }),
    supabase: supabase as MessageFetchDeps["supabase"],
    ...overrides,
  };
  return {
    deps,
    messages: () => state.messages,
    calls,
    switchTo: (id) => {
      refs.active.current = id;
      refs.epoch.current += 1;
    },
    showBMessages: () => {
      state.messages = [makeMessage("b1", "2026-01-02T00:00:00Z")];
      messagesRef.current = state.messages;
    },
  };
}

describe("fetchConversationMessages — conversation lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops a pending fetch for conversation A after switching to B", async () => {
    let resolveQuery: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => { resolveQuery = resolve; });
    const supabase = makeSupabase({ messages: [pending] });
    const h = makeHarness(supabase);

    const fetchPromise = fetchConversationMessages(false, h.deps);
    // Let the request reach the awaited query, then switch conversations and
    // let B's own fetch populate the visible messages.
    await Promise.resolve();
    h.switchTo("conv-b");
    h.showBMessages();
    resolveQuery({ data: [makeRow("a1", "2026-01-01T00:00:01Z"), makeRow("a2", "2026-01-01T00:00:02Z")], error: null });
    await fetchPromise;

    // A's late response must not merge into, overwrite, or touch B's
    // messages or pagination state.
    expect(h.messages().map((m) => m.id)).toEqual(["b1"]);
    expect(h.calls.setMessages).toBe(0);
    expect(h.calls.setHasMore).toHaveLength(0);
    expect(h.calls.fetchReactions).toBe(0);
  });

  it("drops the fetch when the conversation switches during enrichment", async () => {
    let resolveReactions: (v: Record<string, never>) => void = () => {};
    const pendingReactions = new Promise<Record<string, never>>((resolve) => { resolveReactions = resolve; });
    const supabase = makeSupabase({
      messages: [{ data: [makeRow("a1", "2026-01-01T00:00:01Z", { sender_id: "other-user" })], error: null }],
      profiles: [{ data: [{ id: "other-user", username: "alice", display_name: "Alice", avatar_url: null }], error: null }],
    });
    const h = makeHarness(supabase, {
      fetchReactions: vi.fn(() => pendingReactions) as MessageFetchDeps["fetchReactions"],
    });

    const fetchPromise = fetchConversationMessages(false, h.deps);
    // Wait until enrichment is in flight (the reactions fetch has been issued).
    await vi.waitFor(() => expect(h.deps.fetchReactions).toHaveBeenCalledTimes(1));
    h.switchTo("conv-b");
    h.showBMessages();
    resolveReactions({});
    await fetchPromise;

    expect(h.messages().map((m) => m.id)).toEqual(["b1"]);
    expect(h.calls.setMessages).toBe(0);
    expect(h.calls.setHasMore).toHaveLength(0);
  });

  it("still applies a fetched page for the active conversation", async () => {
    const supabase = makeSupabase({
      messages: [{
        data: [
          makeRow("m2", "2026-01-01T00:00:02Z"),
          makeRow("m1", "2026-01-01T00:00:01Z"),
        ],
        error: null,
      }],
    });
    const h = makeHarness(supabase);
    // A cached/realtime message that must survive the merge.
    h.deps.setMessages([makeMessage("cached", "2025-12-31T23:59:59Z")]);
    h.calls.setMessages = 0;

    await fetchConversationMessages(false, h.deps);

    expect(h.messages().map((m) => m.id)).toEqual(["cached", "m1", "m2"]);
    expect(h.calls.setMessages).toBe(1);
    expect(h.calls.setHasMore).toEqual([false]);
    expect(h.deps.isInitialLoad.current).toBe(true);
    expect(h.deps.initialScrollSettledRef.current).toBe(false);
    expect(h.deps.userScrolledRef.current).toBe(false);
  });
});
