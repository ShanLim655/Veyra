import { describe, expect, it } from "vitest";
import {
  reconcileLiveMessage,
  type PendingOutgoingMessage,
  type ReconcileMessageDeps,
} from "./reconcileMessage";
import type { Message } from "./ChatView";

function makeMessage(id: string, created_at: string, over: Partial<Message> = {}): Message {
  return {
    id,
    content: `content-${id}`,
    sender_id: "other-user",
    created_at,
    read_at: null,
    edited_at: null,
    image_url: null,
    reply_to_id: null,
    reactions: [],
    ...over,
  } as Message;
}

// Deferred setMessages harness: updaters are queued like React's deferred
// execution and only applied when applyPending() runs — possibly after the
// active conversation changed.
function makeHarness(initial: Message[] = []) {
  const state = { messages: [...initial] };
  const calls = { setMessages: 0 };
  const pendingUpdaters: Array<Parameters<ReconcileMessageDeps["setMessages"]>[0]> = [];
  const refs = {
    active: { current: "conv-a" as string | null },
    messages: { current: state.messages },
    pendingOutgoing: { current: new Map<string, PendingOutgoingMessage>() },
  };
  const deps: ReconcileMessageDeps = {
    userId: "me",
    activeConversationRef: refs.active,
    messagesRef: refs.messages as ReconcileMessageDeps["messagesRef"],
    pendingOutgoingMessagesRef: refs.pendingOutgoing as ReconcileMessageDeps["pendingOutgoingMessagesRef"],
    setMessages: (updater) => {
      calls.setMessages += 1;
      pendingUpdaters.push(updater);
    },
  };
  return {
    deps,
    refs,
    messages: () => state.messages,
    calls,
    switchTo: (id: string | null) => { refs.active.current = id; },
    applyPending: () => {
      for (const updater of pendingUpdaters.splice(0)) {
        state.messages = typeof updater === "function" ? updater(state.messages) : updater;
      }
      refs.messages.current = state.messages;
    },
  };
}

describe("reconcileLiveMessage — conversation lifecycle", () => {
  it("drops a queued reconcile after the conversation switches", () => {
    const h = makeHarness([makeMessage("b1", "2026-01-02T00:00:00Z")]);

    // conv-a's realtime insert is reconciled while conv-a is active.
    reconcileLiveMessage(
      makeMessage("a1", "2026-01-01T00:00:01Z", { sender_id: "me" }),
      null,
      h.deps,
    );
    expect(h.calls.setMessages).toBe(1);

    // The user switches to conv-b before React runs the updater.
    h.switchTo("conv-b");
    h.applyPending();

    expect(h.messages().map((m) => m.id)).toEqual(["b1"]);
  });

  it("still merges a live message for the active conversation", () => {
    const h = makeHarness([makeMessage("m1", "2026-01-01T00:00:01Z")]);

    reconcileLiveMessage(
      makeMessage("m2", "2026-01-01T00:00:03Z", { sender_id: "me" }),
      null,
      h.deps,
    );
    // An out-of-order insert is sorted into place.
    reconcileLiveMessage(
      makeMessage("m15", "2026-01-01T00:00:02Z", { sender_id: "me" }),
      null,
      h.deps,
    );
    h.applyPending();

    expect(h.messages().map((m) => m.id)).toEqual(["m1", "m15", "m2"]);
  });

  it("replaces a matching optimistic message with the confirmed one", () => {
    const h = makeHarness([
      makeMessage("opt-1", "2026-01-01T00:00:01Z", { sender_id: "me", _status: "sending" }),
    ]);
    h.refs.pendingOutgoing.current.set("opt-1", {
      content: "content-real-1",
      reply_to_id: null,
      image_url: null,
      created_at: Date.now(),
    });

    reconcileLiveMessage(
      makeMessage("real-1", "2026-01-01T00:00:01Z", {
        sender_id: "me",
        content: "content-real-1",
        _status: "sent",
      }),
      null,
      h.deps,
    );
    h.applyPending();

    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0].id).toBe("real-1");
    expect(h.messages()[0]._status).toBe("sent");
  });
});
