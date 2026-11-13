import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mediaUrl", () => ({
  signMessageMedia: vi.fn(async (value: string | null) => value),
}));
vi.mock("@/lib/announcements", () => ({
  markAnnouncementsRead: vi.fn(async () => {}),
}));

import { signMessageMedia } from "@/lib/mediaUrl";
import {
  handleMessageRealtimePayload,
  handleReactionRealtimePayload,
  type MessageRealtimeDeps,
  type ReactionRealtimeDeps,
} from "./messageRealtime";
import type { Message, Reaction } from "./ChatView";

const mockedSign = vi.mocked(signMessageMedia);

function makeMessage(id: string, over: Partial<Message> = {}): Message {
  return {
    id,
    content: `content-${id}`,
    sender_id: "other-user",
    created_at: "2026-01-01T00:00:00Z",
    read_at: null,
    edited_at: null,
    image_url: null,
    reply_to_id: null,
    reactions: [],
    ...over,
  } as Message;
}

// Chainable supabase.from() stub. Queue entries may be plain values or
// promises; single()/maybeSingle() resolve the next queued result.
function makeSupabase(queues: { profiles?: unknown[]; messages?: unknown[] } = {}) {
  const profileQueue = [...(queues.profiles ?? [])];
  const messageQueue = [...(queues.messages ?? [])];
  const from = vi.fn((table: string) => {
    const queue = table === "profiles" ? profileQueue : messageQueue;
    const next = () => (queue.length ? queue.shift() : null);
    const target: Record<string | symbol, unknown> = {};
    const chain: Record<string | symbol, unknown> = new Proxy(target, {
      get: (_t, prop) => {
        if (prop === "single" || prop === "maybeSingle") {
          return async () => ({ data: await next() });
        }
        if (prop === "then") return undefined;
        return () => chain;
      },
    });
    return chain;
  });
  return { from };
}

interface Harness {
  deps: MessageRealtimeDeps;
  messages: () => Message[];
  calls: {
    reconcile: Message[];
    setMessages: number;
    refetch: number;
    scroll: string[];
    receiptRefresh: number;
  };
  setCurrent: (v: boolean) => void;
  isCurrent: () => boolean;
}

function makeHarness(overrides: Partial<MessageRealtimeDeps> = {}, initial: Message[] = []): Harness {
  let current = true;
  const state = { messages: [...initial] };
  const calls = { reconcile: [] as Message[], setMessages: 0, refetch: 0, scroll: [] as string[], receiptRefresh: 0 };
  const messagesRef = { current: state.messages };
  const timers = {
    refresh: { current: null as ReturnType<typeof setTimeout> | null },
    receipt: { current: null as ReturnType<typeof setTimeout> | null },
  };
  const setMessages: MessageRealtimeDeps["setMessages"] = (updater) => {
    calls.setMessages += 1;
    state.messages = typeof updater === "function" ? updater(state.messages) : updater;
    messagesRef.current = state.messages;
  };
  const deps: MessageRealtimeDeps = {
    isCurrent: () => current,
    userId: "me",
    ownSenderProfile: { username: "me", display_name: "Me", avatar_url: null },
    messagesTable: "messages",
    isAnnouncements: false,
    isActive: true,
    showReceipts: true,
    messagesRef: messagesRef as MessageRealtimeDeps["messagesRef"],
    setMessages,
    reconcileLiveMessage: (incoming) => {
      calls.reconcile.push(incoming);
      // Mirror the real reconcile: insert if absent so later enrichment
      // updates have a target, like the component's setMessages does.
      if (!state.messages.some((m) => m.id === incoming.id)) {
        state.messages = [...state.messages, incoming];
        messagesRef.current = state.messages;
      }
    },
    refreshReceiptStatuses: () => { calls.receiptRefresh += 1; },
    refreshTimerRef: timers.refresh as MessageRealtimeDeps["refreshTimerRef"],
    receiptTimerRef: timers.receipt as MessageRealtimeDeps["receiptTimerRef"],
    refetch: () => { calls.refetch += 1; },
    scrollAreaRef: { current: null } as MessageRealtimeDeps["scrollAreaRef"],
    scrollToBottom: (behavior) => { calls.scroll.push(behavior || "auto"); },
    supabase: makeSupabase() as MessageRealtimeDeps["supabase"],
    ...overrides,
  };
  return {
    deps,
    messages: () => state.messages,
    calls,
    setCurrent: (v) => { current = v; },
    isCurrent: () => current,
  };
}

const refreshInsert = (record: Record<string, unknown>) => ({
  refresh: true,
  table: "messages",
  eventType: "INSERT",
  keys: { id: record.id, conversation_id: "conv-a" },
  record,
});

const refreshDelete = (id: string) => ({
  refresh: true,
  table: "messages",
  eventType: "DELETE",
  keys: { id, conversation_id: "conv-a" },
});

const refreshUpdate = (id: string, columns: string[]) => ({
  refresh: true,
  table: "messages",
  eventType: "UPDATE",
  keys: { id, conversation_id: "conv-a" },
  columns,
});

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("handleMessageRealtimePayload — conversation guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSign.mockImplementation(async (value) => value);
  });

  it("drops a queued refresh INSERT once the conversation is no longer active", async () => {
    const h = makeHarness();
    h.setCurrent(false);
    const supabase = makeSupabase();
    h.deps.supabase = supabase as MessageRealtimeDeps["supabase"];

    await handleMessageRealtimePayload(refreshInsert({ id: "m1", sender_id: "other-user", content: "hi" }), h.deps);

    expect(h.calls.reconcile).toHaveLength(0);
    expect(h.calls.setMessages).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("drops a queued refresh DELETE so it cannot remove messages from the new conversation", async () => {
    const h = makeHarness({}, [makeMessage("m1"), makeMessage("m2")]);
    h.setCurrent(false);

    await handleMessageRealtimePayload(refreshDelete("m1"), h.deps);

    expect(h.calls.setMessages).toBe(0);
    expect(h.messages().map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("does not schedule a refetch or receipt refresh for stale refresh UPDATEs", async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness({}, [makeMessage("m1")]);
      h.setCurrent(false);

      await handleMessageRealtimePayload(refreshUpdate("m1", ["content"]), h.deps);
      await handleMessageRealtimePayload(refreshUpdate("m1", ["read_at"]), h.deps);
      await vi.advanceTimersByTimeAsync(500);

      expect(h.calls.refetch).toBe(0);
      expect(h.calls.receiptRefresh).toBe(0);
      expect(h.deps.refreshTimerRef.current).toBeNull();
      expect(h.deps.receiptTimerRef.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still applies refresh DELETE/UPDATE scheduling for the active conversation", async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness({}, [makeMessage("m1"), makeMessage("m2")]);

      await handleMessageRealtimePayload(refreshDelete("m1"), h.deps);
      expect(h.messages().map((m) => m.id)).toEqual(["m2"]);

      await handleMessageRealtimePayload(refreshUpdate("m2", ["content"]), h.deps);
      await handleMessageRealtimePayload(refreshUpdate("m2", ["content"]), h.deps);
      await vi.advanceTimersByTimeAsync(100);
      expect(h.calls.refetch).toBe(1);

      await handleMessageRealtimePayload(refreshUpdate("m2", ["read_at", "delivered_at"]), h.deps);
      await vi.advanceTimersByTimeAsync(200);
      expect(h.calls.receiptRefresh).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("deferred refresh timers — conversation guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSign.mockImplementation(async (value) => value);
  });

  it("does not refresh receipt statuses after the conversation switches", async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness({}, [makeMessage("m1")]);

      // Schedule the receipt-refresh debounce while conv-a is active.
      await handleMessageRealtimePayload(refreshUpdate("m1", ["read_at", "delivered_at"]), h.deps);
      expect(h.deps.receiptTimerRef.current).not.toBeNull();

      // Switch conversations before the 100ms timer fires.
      h.setCurrent(false);
      await vi.advanceTimersByTimeAsync(500);

      expect(h.calls.receiptRefresh).toBe(0);
      expect(h.deps.receiptTimerRef.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refetch after the conversation switches", async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness({}, [makeMessage("m1")]);

      // Schedule the general refresh debounce while conv-a is active.
      await handleMessageRealtimePayload(refreshUpdate("m1", ["content"]), h.deps);
      expect(h.deps.refreshTimerRef.current).not.toBeNull();

      h.setCurrent(false);
      await vi.advanceTimersByTimeAsync(500);

      expect(h.calls.refetch).toBe(0);
      expect(h.deps.refreshTimerRef.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still fires both debounced refreshes for the active conversation", async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness({}, [makeMessage("m1")]);

      await handleMessageRealtimePayload(refreshUpdate("m1", ["content"]), h.deps);
      await handleMessageRealtimePayload(refreshUpdate("m1", ["read_at", "delivered_at"]), h.deps);
      await vi.advanceTimersByTimeAsync(200);

      expect(h.calls.refetch).toBe(1);
      expect(h.calls.receiptRefresh).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("handleMessageRealtimePayload — standard INSERT lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSign.mockImplementation(async (value) => (value ? `SIGNED:${value}` : value));
  });

  const insertPayload = (msg: Message) => ({ eventType: "INSERT", new: msg, old: {} });

  it("reconciles a live insert for the active conversation with enrichment", async () => {
    const supabase = makeSupabase({
      profiles: [
        { username: "alice", display_name: "Alice", avatar_url: null }, // sender lookup
        { username: "bob", display_name: "Bob" }, // reply sender lookup
      ],
      messages: [{ id: "reply-1", content: "earlier", sender_id: "bob" }],
    });
    const h = makeHarness({ supabase: supabase as MessageRealtimeDeps["supabase"] });
    const incoming = makeMessage("live-1", {
      sender_id: "alice-id",
      reply_to_id: "reply-1",
      image_url: JSON.stringify(["https://x.test/a.png"]),
    });

    await handleMessageRealtimePayload(insertPayload(incoming), h.deps);
    await flush();

    expect(h.calls.reconcile).toHaveLength(1);
    const merged = h.calls.reconcile[0];
    expect(merged.id).toBe("live-1");
    expect(merged.sender?.username).toBe("alice");
    expect(merged.replied_message?.content).toBe("earlier");
    expect(merged.image_url).toContain("SIGNED:");
    expect(h.messages().some((m) => m.id === "live-1")).toBe(true);
  });

  it("drops the insert when the conversation switches during sender lookup", async () => {
    let resolveSender: (v: unknown) => void = () => {};
    const deferred = new Promise((resolve) => { resolveSender = resolve; });
    const supabase = makeSupabase({ profiles: [deferred] });
    const h = makeHarness({ supabase: supabase as MessageRealtimeDeps["supabase"] });

    const pending = handleMessageRealtimePayload(
      insertPayload(makeMessage("live-2", { sender_id: "alice-id" })),
      h.deps,
    );
    // Let the handler reach the sender await, then switch conversations.
    await Promise.resolve();
    h.setCurrent(false);
    resolveSender({ username: "alice", display_name: "Alice", avatar_url: null });
    await pending;
    await flush();

    expect(h.calls.reconcile).toHaveLength(0);
    expect(h.calls.setMessages).toBe(0);
    expect(h.messages()).toHaveLength(0);
  });

  it("drops the insert when the conversation switches during media signing", async () => {
    let resolveSign: (v: string | null) => void = () => {};
    mockedSign.mockImplementationOnce(() => new Promise((resolve) => { resolveSign = resolve; }));
    const h = makeHarness();
    const incoming = makeMessage("live-3", { sender_id: "me", image_url: "raw-media" });

    const pending = handleMessageRealtimePayload(insertPayload(incoming), h.deps);
    await Promise.resolve();
    h.setCurrent(false);
    resolveSign("SIGNED:raw-media");
    await pending;

    expect(h.calls.reconcile).toHaveLength(0);
  });

  it("does not apply refresh-INSERT enrichment after a switch, and cannot resurrect state", async () => {
    let resolveSender: (v: unknown) => void = () => {};
    const deferred = new Promise((resolve) => { resolveSender = resolve; });
    const supabase = makeSupabase({ profiles: [deferred] });
    const h = makeHarness({ supabase: supabase as MessageRealtimeDeps["supabase"] });

    await handleMessageRealtimePayload(
      refreshInsert({ id: "m9", sender_id: "alice-id", content: "hi", image_url: "raw" }),
      h.deps,
    );
    // Reconcile already ran synchronously while still current.
    expect(h.calls.reconcile).toHaveLength(1);
    expect(h.messages().find((m) => m.id === "m9")?.image_url).toBe("raw");

    h.setCurrent(false);
    resolveSender({ username: "alice", display_name: "Alice", avatar_url: null });
    await flush();

    // Enrichment must not have rewritten the message for the new conversation.
    expect(h.calls.setMessages).toBe(0);
    expect(h.messages().find((m) => m.id === "m9")?.image_url).toBe("raw");
  });

  it("suppresses the deferred scroll-to-bottom once the conversation switches", async () => {
    vi.useFakeTimers();
    try {
      const viewport = { scrollHeight: 1000, scrollTop: 950, clientHeight: 100 };
      const scrollAreaRef = {
        current: { querySelector: () => viewport } as unknown as HTMLElement,
      };
      const h = makeHarness({ scrollAreaRef: scrollAreaRef as MessageRealtimeDeps["scrollAreaRef"] });
      // Own message always scrolls, so the guard is what must stop it.
      const incoming = makeMessage("live-4", { sender_id: "me" });

      await handleMessageRealtimePayload(insertPayload(incoming), h.deps);
      h.setCurrent(false);
      await vi.advanceTimersByTimeAsync(200);

      expect(h.calls.scroll).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrolls for the active conversation when near the bottom or own message", async () => {
    vi.useFakeTimers();
    try {
      const viewport = { scrollHeight: 1000, scrollTop: 950, clientHeight: 100 };
      const scrollAreaRef = {
        current: { querySelector: () => viewport } as unknown as HTMLElement,
      };
      const h = makeHarness({ scrollAreaRef: scrollAreaRef as MessageRealtimeDeps["scrollAreaRef"] });

      await handleMessageRealtimePayload(
        insertPayload(makeMessage("live-5", { sender_id: "me" })),
        h.deps,
      );
      await vi.advanceTimersByTimeAsync(200);

      expect(h.calls.scroll).toEqual(["smooth"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies UPDATE and DELETE only to matching messages in the active conversation", async () => {
    const h = makeHarness({}, [makeMessage("m1"), makeMessage("m2")]);

    await handleMessageRealtimePayload(
      { eventType: "UPDATE", new: { ...makeMessage("m1"), content: "edited" }, old: {} },
      h.deps,
    );
    expect(h.messages().find((m) => m.id === "m1")?.content).toBe("edited");
    expect(h.messages().find((m) => m.id === "m2")?.content).toBe("content-m2");

    await handleMessageRealtimePayload(
      { eventType: "DELETE", new: {}, old: makeMessage("m2") },
      h.deps,
    );
    expect(h.messages().map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("handleReactionRealtimePayload — conversation guard", () => {
  function makeReactionHarness(initial: Message[] = []) {
    const state = { messages: [...initial] };
    const calls = { setMessages: 0, fetchReactions: 0 };
    let current = true;
    const deps: ReactionRealtimeDeps = {
      isCurrent: () => current,
      messagesRef: { current: state.messages } as ReactionRealtimeDeps["messagesRef"],
      setMessages: (updater) => {
        calls.setMessages += 1;
        state.messages = typeof updater === "function" ? updater(state.messages) : updater;
      },
      fetchReactions: vi.fn(async () => {
        calls.fetchReactions += 1;
        return { "m1": [{ id: "r1", emoji: "👍", user_id: "u", message_id: "m1" }] };
      }),
    };
    return { deps, messages: () => state.messages, calls, setCurrent: (v: boolean) => { current = v; } };
  }

  it("ignores events once the conversation is no longer active", () => {
    const h = makeReactionHarness([makeMessage("m1")]);
    h.setCurrent(false);

    handleReactionRealtimePayload(
      { refresh: true, table: "message_reactions", eventType: "INSERT", keys: {} },
      h.deps,
    );
    handleReactionRealtimePayload(
      { eventType: "INSERT", new: { id: "r9", message_id: "m1", emoji: "🔥", user_id: "u" } as Reaction, old: {} },
      h.deps,
    );

    expect(h.calls.fetchReactions).toBe(0);
    expect(h.calls.setMessages).toBe(0);
    expect(h.messages()[0].reactions).toEqual([]);
  });

  it("does not let a stale reaction refresh wipe the new conversation's reactions", async () => {
    let resolveFetch: (v: Record<string, Reaction[]>) => void = () => {};
    const h = makeReactionHarness([makeMessage("m1", { reactions: [{ id: "keep", emoji: "❤️", user_id: "u", message_id: "m1" }] })]);
    h.deps.fetchReactions = vi.fn(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    ) as ReactionRealtimeDeps["fetchReactions"];

    handleReactionRealtimePayload(
      { refresh: true, table: "message_reactions", eventType: "INSERT", keys: {} },
      h.deps,
    );
    h.setCurrent(false);
    resolveFetch({});
    await flush();

    expect(h.calls.setMessages).toBe(0);
    expect(h.messages()[0].reactions?.[0]?.id).toBe("keep");
  });

  it("applies reaction INSERT/DELETE for the active conversation", () => {
    const h = makeReactionHarness([makeMessage("m1")]);

    handleReactionRealtimePayload(
      { eventType: "INSERT", new: { id: "r1", message_id: "m1", emoji: "👍", user_id: "u" } as Reaction, old: {} },
      h.deps,
    );
    expect(h.messages()[0].reactions).toHaveLength(1);

    handleReactionRealtimePayload(
      { eventType: "DELETE", new: {}, old: { id: "r1", message_id: "m1", emoji: "👍", user_id: "u" } as Reaction },
      h.deps,
    );
    expect(h.messages()[0].reactions).toHaveLength(0);
  });
});
