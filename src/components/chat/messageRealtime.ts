import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { signMessageMedia } from "@/lib/mediaUrl";
import { markAnnouncementsRead } from "@/lib/announcements";
import type { Message, Reaction } from "./ChatView";

export type MariaDbRefreshPayload = {
  refresh?: boolean;
  table?: string;
  eventType?: string;
  actor_id?: string;
  keys?: Record<string, string | number>;
  columns?: string[];
  record?: Record<string, unknown>;
};

export interface MessageRealtimeDeps {
  // True while the conversation this subscription belongs to is still the
  // active one. Every state mutation — synchronous or async — must check it.
  isCurrent: () => boolean;
  userId: string | undefined;
  ownSenderProfile: Message["sender"];
  messagesTable: "messages" | "global_messages" | "announcement_messages";
  isAnnouncements: boolean;
  isActive: boolean;
  showReceipts: boolean;
  messagesRef: MutableRefObject<Message[]>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  reconcileLiveMessage: (incoming: Message, matchImageUrl?: string | null) => void;
  refreshReceiptStatuses: () => void;
  refreshTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  receiptTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  refetch: () => void;
  scrollAreaRef: MutableRefObject<HTMLElement | null>;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  // The supabase facade's query builder is untyped for these ad-hoc chains.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (table: string) => any };
}

export interface ReactionRealtimeDeps {
  isCurrent: () => boolean;
  messagesRef: MutableRefObject<Message[]>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  fetchReactions: (messageIds: string[]) => Promise<Record<string, Reaction[]>>;
}

function scrollViewport(scrollAreaRef: MutableRefObject<HTMLElement | null>) {
  return scrollAreaRef.current?.querySelector(
    "[data-radix-scroll-area-viewport]",
  ) as HTMLElement | null;
}

// Handles one postgres_changes payload for the messages table. The callback
// can outlive its subscription (async lookups, deferred timers, or a payload
// dispatched just before a conversation switch), so every path — refresh and
// standard events alike — validates isCurrent() before touching state.
export async function handleMessageRealtimePayload(
  payload: unknown,
  deps: MessageRealtimeDeps,
): Promise<void> {
  const {
    isCurrent,
    userId,
    ownSenderProfile,
    messagesTable,
    isAnnouncements,
    isActive,
    showReceipts,
    messagesRef,
    setMessages,
    reconcileLiveMessage,
    refreshReceiptStatuses,
    refreshTimerRef,
    receiptTimerRef,
    refetch,
    scrollAreaRef,
    scrollToBottom,
    supabase,
  } = deps;

  // A callback queued under a previous conversation must not mutate the
  // newly active one's messages, timers, or scroll position.
  if (!isCurrent()) return;

  const change = payload as MariaDbRefreshPayload;
  if (change.refresh) {
    if (change.eventType === "DELETE" && change.keys?.id) {
      setMessages((previous) => {
        // React may run this updater after a conversation switch — the
        // entry isCurrent() check alone cannot cover deferred execution.
        if (!isCurrent()) return previous;
        return previous.filter((message) => message.id !== change.keys!.id);
      });
      return;
    }

    if (change.keys?.id && change.eventType !== "INSERT"
      && !messagesRef.current.some((message) => message.id === change.keys!.id)) return;

    if (change.eventType === "INSERT" && change.record?.id && change.table === messagesTable) {
      const received = {
        ...change.record,
        sender: (change.record.sender as Message["sender"] | undefined)
          || (change.record.sender_id === userId ? ownSenderProfile : undefined),
        reactions: [],
        _status: "sent" as const,
      } as Message;
      reconcileLiveMessage(received);
      void Promise.all([
        received.sender_id
          ? received.sender_id === userId
            ? Promise.resolve({ data: ownSenderProfile })
            : supabase.from("profiles").select("username, display_name, avatar_url").eq("id", received.sender_id).single()
          : Promise.resolve({ data: null }),
        received.reply_to_id
          ? supabase.from(messagesTable).select("id, content, sender_id").eq("id", received.reply_to_id).maybeSingle()
          : Promise.resolve({ data: null }),
        signMessageMedia(received.image_url).catch(() => received.image_url),
      ]).then(async ([senderResult, replyResult, signedImageUrl]) => {
        // The user may have switched conversations while enrichment
        // was in flight — never merge into the new conversation's state.
        if (!isCurrent()) return;
        let repliedMessage: Message["replied_message"];
        if (replyResult.data) {
          const replySenderResult = replyResult.data.sender_id
            ? await supabase.from("profiles").select("username, display_name").eq("id", replyResult.data.sender_id).single()
            : { data: null };
          repliedMessage = { ...replyResult.data, sender: replySenderResult.data || undefined };
        }
        if (!isCurrent()) return;
        setMessages((previous) => {
          if (!isCurrent()) return previous;
          return previous.map((message) => message.id === received.id
            ? {
              ...message,
              image_url: signedImageUrl,
              sender: senderResult.data || received.sender,
              replied_message: repliedMessage,
            }
            : message);
        });
      }).catch((error) => console.warn("Could not enrich live message:", error));
      const viewport = scrollViewport(scrollAreaRef);
      if (viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 250) {
        setTimeout(() => {
          if (!isCurrent()) return;
          scrollToBottom("smooth");
        }, 60);
      }
      return;
    }

    const columns = change.columns as string[] | undefined;
    const receiptOnly = change.table === "messages"
      && change.eventType === "UPDATE"
      && columns?.length
      && columns.every((column) => column === "read_at" || column === "delivered_at");
    if (receiptOnly) {
      if (!receiptTimerRef.current) {
        const timer = setTimeout(() => {
          // Only clear the ref if this callback still owns it — a newer
          // conversation's timer may have replaced it meanwhile.
          if (receiptTimerRef.current === timer) receiptTimerRef.current = null;
          if (!isCurrent()) return;
          refreshReceiptStatuses();
        }, 100);
        receiptTimerRef.current = timer;
      }
      return;
    }

    if (!refreshTimerRef.current) {
      const timer = setTimeout(() => {
        if (refreshTimerRef.current === timer) refreshTimerRef.current = null;
        if (!isCurrent()) return;
        refetch();
      }, 60);
      refreshTimerRef.current = timer;
    }
    return;
  }

  const event = (payload as { eventType?: string }).eventType;
  if (event === "INSERT") {
    const newMsg = (payload as { new: Message }).new;
    if (newMsg.sender_id) {
      if (newMsg.sender_id === userId) {
        newMsg.sender = ownSenderProfile;
      } else {
        const { data: sender } = await supabase
          .from("profiles")
          .select("username, display_name, avatar_url")
          .eq("id", newMsg.sender_id)
          .single();
        newMsg.sender = sender || undefined;
      }
    }
    // Fetch replied message data if exists
    if (newMsg.reply_to_id) {
      const { data: repliedMsg } = await supabase
        .from(messagesTable)
        .select("id, content, sender_id")
        .eq("id", newMsg.reply_to_id)
        .maybeSingle();
      if (repliedMsg) {
        const { data: replySender } = repliedMsg.sender_id
          ? await supabase
            .from("profiles")
            .select("username, display_name")
            .eq("id", repliedMsg.sender_id)
            .single()
          : { data: null };
        newMsg.replied_message = {
          ...repliedMsg,
          sender: replySender || undefined,
        };
      }
    }
    newMsg.reactions = [];
    const rawImageUrl = newMsg.image_url || null;
    // Signing is best-effort — a failure must not drop the live message.
    newMsg.image_url = await signMessageMedia(newMsg.image_url).catch(() => newMsg.image_url);
    // The sender/reply/signing lookups above are async — the user may
    // have switched conversations meanwhile. Never merge this message
    // into a different conversation's state.
    if (!isCurrent()) return;
    reconcileLiveMessage({ ...newMsg, _status: "sent" }, rawImageUrl);
    // Scroll to bottom only if user is already near the bottom
    setTimeout(() => {
      if (!isCurrent()) return;
      const v = scrollViewport(scrollAreaRef);
      if (!v) return;
      const nearBottom = v.scrollHeight - v.scrollTop - v.clientHeight < 250;
      const isOwn = newMsg.sender_id === userId;
      if (nearBottom || isOwn) scrollToBottom("smooth");
    }, 100);

    if (isAnnouncements && isActive && userId) {
      void markAnnouncementsRead(userId)
        .then(() => window.dispatchEvent(new CustomEvent("announcements-read")))
        .catch((error) => console.error("Error marking announcements as read:", error));
    }
  } else if (event === "UPDATE") {
    const updatedMsg = (payload as { new: Message }).new;
    setMessages((prev) => {
      if (!isCurrent()) return prev;
      return prev.map((m) => {
        if (m.id === updatedMsg.id) {
          const newStatus = !showReceipts
            ? m._status
            : updatedMsg.read_at
              ? ("read" as const)
              : updatedMsg.delivered_at
                ? ("delivered" as const)
                : (m._status === "sending" ? "sent" as const : m._status);
          return {
            ...m,
            ...updatedMsg,
            reactions: m.reactions,
            _status: newStatus,
          };
        }
        return m;
      });
    });
  } else if (event === "DELETE") {
    const deletedMsg = (payload as { old: Message }).old;
    setMessages((prev) => {
      if (!isCurrent()) return prev;
      return prev.filter((m) => m.id !== deletedMsg.id);
    });
  }
}

// Handles one postgres_changes payload for the message_reactions table.
// Same lifecycle rules as the messages handler: validate before mutating.
export function handleReactionRealtimePayload(
  payload: unknown,
  deps: ReactionRealtimeDeps,
): void {
  const { isCurrent, messagesRef, setMessages, fetchReactions } = deps;

  if (!isCurrent()) return;

  const change = payload as MariaDbRefreshPayload;
  if (change.refresh) {
    const messageIds = messagesRef.current.map((message) => message.id);
    void fetchReactions(messageIds).then((reactionMap) => {
      // The fetch is async — bail if the conversation changed so a
      // stale reaction map cannot wipe the new conversation's
      // reactions (every id would miss and reset to []).
      if (!isCurrent()) return;
      setMessages((previous) => {
        if (!isCurrent()) return previous;
        return previous.map((message) => ({
          ...message,
          reactions: reactionMap[message.id] || [],
        }));
      });
    });
    return;
  }

  const event = (payload as { eventType?: string }).eventType;
  if (event === "INSERT") {
    const newReaction = (payload as { new: Reaction }).new;
    setMessages((prev) => {
      if (!isCurrent()) return prev;
      return prev.map((m) =>
        m.id === newReaction.message_id
          ? {
            ...m,
            reactions: [...(m.reactions || []).filter((r) => r.id !== newReaction.id), newReaction],
          }
          : m
      );
    });
  } else if (event === "DELETE") {
    const deletedReaction = (payload as { old: Reaction }).old;
    setMessages((prev) => {
      if (!isCurrent()) return prev;
      return prev.map((m) =>
        m.id === deletedReaction.message_id
          ? {
            ...m,
            reactions: (m.reactions || []).filter((r) => r.id !== deletedReaction.id),
          }
          : m
      );
    });
  }
}
