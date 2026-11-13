import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { signMessageMedia, collectMediaUrls, prefetchChatUrls } from "@/lib/mediaUrl";
import { mergeMessagePage, prependOlderMessages } from "@/lib/messageMerge";
import type { Message, Reaction } from "./ChatView";

const MESSAGES_PER_PAGE = 30;

interface FetchedProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface MessageFetchDeps {
  // The conversation this fetch belongs to. Requests capture the epoch and
  // conversation id at start and bail via isStale() if either moved on, so a
  // slow request for conversation A can never merge into B's messages,
  // pagination flags, or scroll position.
  conversationId: string | null;
  conversationEpochRef: MutableRefObject<number>;
  activeConversationRef: MutableRefObject<string | null>;
  isDM: boolean;
  messagesTable: "messages" | "global_messages" | "announcement_messages";
  conversationIdProp: string | null | undefined;
  userId: string | undefined;
  ownSenderProfile: Message["sender"];
  showReceipts: boolean;
  hasMore: boolean;
  messagesRef: MutableRefObject<Message[]>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setHasMore: Dispatch<SetStateAction<boolean>>;
  setLoadingMore: Dispatch<SetStateAction<boolean>>;
  loadingMoreRef: MutableRefObject<boolean>;
  isInitialLoad: MutableRefObject<boolean>;
  initialScrollSettledRef: MutableRefObject<boolean>;
  userScrolledRef: MutableRefObject<boolean>;
  scrollAreaRef: MutableRefObject<HTMLElement | null>;
  fetchReactions: (messageIds: string[]) => Promise<Record<string, Reaction[]>>;
  // The supabase facade's query builder is untyped for these ad-hoc chains.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (table: string) => any };
}

// Fetches one page of messages (latest or older) and applies it to the
// conversation's state. Every await is followed by an isStale() check before
// touching messages, pagination, loading flags, or scroll position.
export async function fetchConversationMessages(
  loadMore: boolean,
  deps: MessageFetchDeps,
): Promise<void> {
  const {
    conversationId,
    conversationEpochRef,
    activeConversationRef,
    isDM,
    messagesTable,
    conversationIdProp,
    userId,
    ownSenderProfile,
    showReceipts,
    hasMore,
    messagesRef,
    setMessages,
    setHasMore,
    setLoadingMore,
    loadingMoreRef,
    isInitialLoad,
    initialScrollSettledRef,
    userScrolledRef,
    scrollAreaRef,
    fetchReactions,
    supabase,
  } = deps;

  if (!conversationId) return;
  const epoch = conversationEpochRef.current;
  // True when the user switched conversations (or a newer fetch cycle
  // started) while this request was in flight. Stale requests must not
  // touch messages, pagination, loading flags, or scroll position — the
  // conversation-change effect owns resetting those now.
  const isStale = () => epoch !== conversationEpochRef.current || activeConversationRef.current !== conversationId;

  if (loadMore) {
    if (loadingMoreRef.current || !hasMore || messagesRef.current.length === 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
  }

  const currentMessages = messagesRef.current;
  const oldestMessage = loadMore && currentMessages.length > 0 ? currentMessages[0] : null;

  let query: any = (supabase as any)
    .from(messagesTable)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(MESSAGES_PER_PAGE);
  if (isDM) query = query.eq("conversation_id", conversationIdProp);

  if (oldestMessage) {
    query = query.lt("created_at", oldestMessage.created_at);
  }

  const { data, error } = await query;

  if (isStale()) return;

  if (error) {
    console.error("Error fetching messages:", error);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    return;
  }

  const messageIds = (data || []).map((m: any) => m.id);
  const senderIds = [...new Set((data || []).map((m: any) => m.sender_id).filter((id: string | null) => id && id !== userId))] as string[];
  const replyToIds = [...new Set((data || []).map((m: any) => m.reply_to_id).filter(Boolean))] as string[];

  let messagesWithSenders: Message[] = [];
  try {
  // These reads are independent; issue them together instead of making each
  // chat load wait through multiple database round trips in sequence.
  const [reactionsMap, , profileResult, repliedResult] = await Promise.all([
    fetchReactions(messageIds),
    // Sign every media URL in the page with one batched request instead of
    // one API call per message. Result is unused — it only warms the
    // signChatUrl cache that signMessageMedia reads below.
    prefetchChatUrls((data || []).flatMap((m: any) => collectMediaUrls(m.image_url))),
    senderIds.length > 0
      ? supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", senderIds)
      : Promise.resolve({ data: [] }),
    replyToIds.length > 0
      ? (supabase as any)
        .from(messagesTable)
        .select("id, content, sender_id")
        .in("id", replyToIds)
      : Promise.resolve({ data: [] }),
  ]);
  const profiles = profileResult.data;
  const profilesMap = new Map((profiles || []).map((p) => [p.id, p]));
  const repliedMessages = repliedResult.data;

  // Fetch sender profiles for replied messages
  const replySenderIds = [...new Set(((repliedMessages || []) as any[]).map((m: any) => m.sender_id).filter((id: string | null) => id && id !== userId))] as string[];
  const { data: replyProfiles } = replySenderIds.length > 0
    ? await supabase
        .from("profiles")
        .select("id, username, display_name")
        .in("id", replySenderIds)
    : { data: [] };

  const replyProfilesMap = new Map((replyProfiles || []).map((p) => [p.id, p]));
  const repliedMessagesMap = new Map(((repliedMessages || []) as any[]).map((m: any) => {
    const sender = m.sender_id ? replyProfilesMap.get(m.sender_id) : undefined;
    return [m.id, { ...m, sender }];
  }));

  messagesWithSenders = await Promise.all((data || []).map(async (msg: any) => {
    const sender = msg.sender_id === userId ? ownSenderProfile : msg.sender_id ? profilesMap.get(msg.sender_id) : undefined;
    const repliedMessage = msg.reply_to_id ? repliedMessagesMap.get(msg.reply_to_id) : undefined;
    // A single unsigned/failed media URL must not fail the whole page.
    const signedImageUrl = await signMessageMedia(msg.image_url).catch(() => msg.image_url);
    return {
      ...msg,
      image_url: signedImageUrl,
      sender: sender ? { username: sender.username, display_name: sender.display_name, avatar_url: sender.avatar_url } : undefined,
      reactions: reactionsMap[msg.id] || [],
      replied_message: repliedMessage ? {
        ...repliedMessage,
        sender: repliedMessage.sender_id === userId ? ownSenderProfile : repliedMessage.sender,
      } : undefined,
      _status: !showReceipts
        ? ("sent" as const)
        : msg.read_at
          ? ("read" as const)
          : (msg as any).delivered_at
            ? ("delivered" as const)
            : ("sent" as const),
    };
  }));
  messagesWithSenders.reverse(); // ascending order
  } catch (enrichError) {
    // Enrichment (profiles/reactions/media signing) is best-effort: fall
    // back to the raw fetched rows so a failure in an optimization can
    // never keep message history from rendering. Sender names and media
    // signing are still attempted per-message with their own guards.
    console.error("Error enriching messages:", enrichError);
    const fallbackSenderIds = [...new Set((data || []).map((m: any) => m.sender_id).filter((id: string | null) => id && id !== userId))] as string[];
    let fallbackProfiles: FetchedProfile[] = [];
    if (fallbackSenderIds.length) {
      try {
        const { data: rows } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .in("id", fallbackSenderIds);
        fallbackProfiles = (rows as FetchedProfile[]) || [];
      } catch {
        // Names are cosmetic; continue without them.
      }
    }
    const fallbackProfilesMap = new Map(fallbackProfiles.map((p) => [p.id, p]));
    messagesWithSenders = await Promise.all(((data || []) as any[]).slice().reverse().map(async (msg: any) => {
      const sender = msg.sender_id === userId ? ownSenderProfile : msg.sender_id ? fallbackProfilesMap.get(msg.sender_id) : undefined;
      const signedImageUrl = await signMessageMedia(msg.image_url).catch(() => msg.image_url);
      return {
        ...msg,
        image_url: signedImageUrl,
        sender: sender ? { username: sender.username, display_name: sender.display_name, avatar_url: sender.avatar_url } : undefined,
        reactions: [],
        replied_message: undefined,
        _status: !showReceipts
          ? ("sent" as const)
          : msg.read_at
            ? ("read" as const)
            : (msg as any).delivered_at
              ? ("delivered" as const)
              : ("sent" as const),
      } as Message;
    }));
  }

  if (isStale()) return;

  // Check if there are more messages — applied only after the staleness
  // guard so a superseded request cannot clobber the new conversation's
  // pagination state.
  setHasMore((data || []).length === MESSAGES_PER_PAGE);

  if (loadMore) {
    // Preserve scroll position when loading older messages
    const scrollArea = scrollAreaRef.current;
    const scrollViewport = scrollArea?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    const previousScrollHeight = scrollViewport?.scrollHeight || 0;
    const previousScrollTop = scrollViewport?.scrollTop || 0;

    setMessages((prev) => {
      if (isStale()) return prev;
      return prependOlderMessages(prev, messagesWithSenders);
    });

    // Restore scroll position after new messages are added
    requestAnimationFrame(() => {
      if (isStale() || !scrollViewport) return;
      const newScrollHeight = scrollViewport.scrollHeight;
      scrollViewport.scrollTop = previousScrollTop + (newScrollHeight - previousScrollHeight);
    });
    setLoadingMore(false);
    loadingMoreRef.current = false;
  } else {
    // Merge fetched page with whatever we already have (cache + realtime),
    // so we don't drop older cached history or messages that arrived
    // optimistically/via realtime while the fetch was in flight.
    isInitialLoad.current = true;
    initialScrollSettledRef.current = false;
    userScrolledRef.current = false;
    setMessages((prev) => {
      if (isStale()) return prev;
      return mergeMessagePage(prev, messagesWithSenders);
    });
  }
}
