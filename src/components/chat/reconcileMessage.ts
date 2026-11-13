import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { serverDateMs } from "@/lib/dates";
import type { Message } from "./ChatView";

export interface PendingOutgoingMessage {
  content: string;
  reply_to_id: string | null;
  image_url: string | null;
  created_at: number;
}

export interface ReconcileMessageDeps {
  userId: string | undefined;
  // Tracks which conversation async work belongs to. The functional
  // setMessages updater may run after a conversation switch, so it
  // re-validates against the conversation captured at call time.
  activeConversationRef: MutableRefObject<string | null>;
  messagesRef: MutableRefObject<Message[]>;
  pendingOutgoingMessagesRef: MutableRefObject<Map<string, PendingOutgoingMessage>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

// Merges a realtime-confirmed message into the visible list: dedupes by id,
// replaces matching optimistic "sending" entries, and keeps chronological
// order. Callers must invoke this only while the owning conversation is
// active (the realtime handlers check isCurrent() first); the updater
// re-checks so a deferred execution cannot touch a different conversation.
export function reconcileLiveMessage(
  incoming: Message,
  matchImageUrl: string | null,
  deps: ReconcileMessageDeps,
): void {
  const { userId, activeConversationRef, messagesRef, pendingOutgoingMessagesRef, setMessages } = deps;
  const targetConversation = activeConversationRef.current;
  const now = Date.now();
  let optimisticId: string | undefined;
  if (incoming.sender_id === userId && !messagesRef.current.some((message) => message.id === incoming.id)) {
    for (const [id, pending] of pendingOutgoingMessagesRef.current) {
      if (now - pending.created_at > 120_000) {
        pendingOutgoingMessagesRef.current.delete(id);
        continue;
      }
      if (pending.content === incoming.content
        && pending.reply_to_id === (incoming.reply_to_id || null)
        && pending.image_url === matchImageUrl) {
        optimisticId = id;
        pendingOutgoingMessagesRef.current.delete(id);
        break;
      }
    }
  }

  setMessages((previous) => {
    if (activeConversationRef.current !== targetConversation) return previous;
    const existingIndex = previous.findIndex((message) => message.id === incoming.id);
    if (existingIndex >= 0) {
      const existing = previous[existingIndex];
      const next = previous.slice();
      next[existingIndex] = {
        ...incoming,
        ...existing,
        sender: existing.sender || incoming.sender,
        replied_message: existing.replied_message || incoming.replied_message,
        image_url: existing.image_url || incoming.image_url,
        reactions: existing.reactions?.length ? existing.reactions : incoming.reactions || [],
        _status: existing._status === 'sending' ? 'sent' : existing._status || 'sent',
      };
      return next;
    }

    const optimisticIndex = optimisticId
      ? previous.findIndex((message) => message.id === optimisticId)
      : -1;
    if (optimisticIndex >= 0) {
      const optimistic = previous[optimisticIndex];
      const next = previous.slice();
      next[optimisticIndex] = {
        ...optimistic,
        ...incoming,
        image_url: optimistic.image_url || incoming.image_url,
        reactions: optimistic.reactions || incoming.reactions || [],
        replied_message: optimistic.replied_message || incoming.replied_message,
        _status: 'sent',
      };
      return next.sort((left, right) =>
        serverDateMs(left.created_at) - serverDateMs(right.created_at));
    }

    if (!previous.length || serverDateMs(previous[previous.length - 1].created_at) <= serverDateMs(incoming.created_at)) {
      return [...previous, incoming];
    }
    const next = [...previous, incoming];
    return next.sort((left, right) =>
      serverDateMs(left.created_at) - serverDateMs(right.created_at));
  });
}
