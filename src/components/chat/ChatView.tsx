import { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { onMariaDbRealtimeReconnect } from "@/integrations/supabase/mariadb-realtime";
import { apiFetch } from "@/lib/nativeSession";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { usePresence } from "@/hooks/usePresence";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { VoiceMessagePlayer } from "@/components/chat/VoiceMessagePlayer";
import { MessageMarkdown } from "@/components/chat/MessageMarkdown";
import { Textarea } from "@/components/ui/textarea";
import { AutoResizeTextarea } from "./AutoResizeTextarea";
import { VoiceRecordingIndicator } from "@/components/chat/VoiceRecordingIndicator";
import { 
  Send, Check, CheckCheck, Clock, MoreVertical, Pencil, X, 
  Trash2, Smile, ArrowLeft, ImagePlus, ArrowDown, Reply,
  ChevronLeft, ChevronRight, Play, Mic, Pin, Copy
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { signMessageMedia, encodeFile, decodeFile, encodeMusic, decodeMusic, collectMediaUrls, prefetchChatUrls } from "@/lib/mediaUrl";
import { compressImageForUpload } from "@/lib/imageCompress";
import { getCachedMessages, setCachedMessages } from "@/lib/chatCache";
import { parseServerDate, serverDateMs } from "@/lib/dates";
import { exceedsMaxUploadSize, MAX_UPLOAD_SIZE_LABEL } from "@/lib/uploadLimits";
import { MessageFileCard } from "@/components/chat/MessageFileCard";
import { ChatImage } from "@/components/chat/ChatImage";
import { MessageMusicPlayer } from "@/components/chat/MessageMusicPlayer";
import { FileText, Music, Paperclip } from "lucide-react";
import { UserProfileDialog } from "@/components/profile/UserProfileDialog";
import { markAnnouncementsRead } from "@/lib/announcements";
import { SmilePlus } from "lucide-react";
import { ChatSearch } from "@/components/chat/ChatSearch";
import { messageMentionsMe } from "@/lib/mentions";
import { LazyFullEmojiPicker as EmojiPickerPanel } from "@/components/chat/LazyFullEmojiPicker";
import { MentionAutocomplete, type MentionCandidate } from "@/components/chat/MentionAutocomplete";
import { PollCard, PollResultCard } from "@/components/chat/PollCard";
import { CreatePollDialog } from "@/components/chat/CreatePollDialog";
import { BarChart3, Users as UsersIcon, Settings as SettingsIcon } from "lucide-react";
import { isStatusActive } from "@/lib/customStatus";
import { GroupAvatar } from "@/components/chat/GroupAvatar";
import { GroupSettingsDialog } from "@/components/chat/GroupSettingsDialog";



const EXPIRED_ATTACHMENT_IMG = "/expired-attachment.png";
async function uploadChatMedia(bucket: "chat-images" | "chat-videos" | "chat-voice", path: string, file: Blob) {
  const response = await apiFetch("/api/storage/chat-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bucket, path, contentType: file.type || "application/octet-stream", size: file.size }) });
  const signed = await response.json() as { path?: string; token?: string; publicUrl?: string; error?: string };
  if (!response.ok || !signed.path || !signed.token || !signed.publicUrl) throw new Error(signed.error || "Could not prepare the media upload.");
  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || "application/octet-stream", cacheControl: "31536000, immutable" });
  if (error) throw error;
  return signed.publicUrl;
}
interface Reaction {
  id: string;
  emoji: string;
  user_id: string;
  message_id: string;
}

interface Message {
  id: string;
  content: string;
  sender_id: string | null;
  created_at: string;
  read_at: string | null;
  delivered_at?: string | null;
  edited_at: string | null;
  image_url: string | null;
  reply_to_id: string | null;
  is_pinned?: boolean;
  pinned_at?: string | null;
  pinned_by?: string | null;
  sender?: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
  reactions?: Reaction[];
  replied_message?: {
    id: string;
    content: string;
    sender_id: string | null;
    sender?: {
      username: string;
      display_name: string | null;
    };
  };
  _status?: "sending" | "sent" | "delivered" | "read";
}

interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  custom_status_text?: string | null;
  custom_status_emoji?: string | null;
  custom_status_expires_at?: string | null;
}

type MariaDbRefreshPayload = {
  refresh?: boolean;
  table?: string;
  eventType?: string;
  actor_id?: string;
  keys?: Record<string, string | number>;
  columns?: string[];
  record?: Record<string, unknown>;
};

type AttachmentKind = 'image' | 'video' | 'music' | 'file';

interface MediaPreview {
  file: File;
  url: string;
  type: AttachmentKind;
}

function classifyFile(file: File): AttachmentKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'music';
  return 'file';
}


interface ChatViewProps {
  conversationId?: string | null;
  onBack?: () => void;
  isMobile?: boolean;
  channel?: "dm" | "global" | "announcements";
  isActive?: boolean;
}

const EMOJI_OPTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
const MESSAGES_PER_PAGE = 30;

export function ChatView({ conversationId: conversationIdProp, onBack, isMobile = false, channel = "dm", isActive = true }: ChatViewProps) {
  const { user } = useAuth();
  const ownSenderProfile = useMemo(() => {
    if (!user) return undefined;
    const username = user.username || user.user_metadata?.username || user.email.split("@")[0] || "You";
    return {
      username,
      display_name: user.display_name || user.user_metadata?.display_name || username,
      avatar_url: user.avatar_url || null,
    };
  }, [user]);
  const { isAdmin, isSuperAdmin } = useUserRole();
  const { isBlocked, blockedIds } = useBlockedUsers();
  const [revealedBlocked, setRevealedBlocked] = useState<Set<string>>(new Set());
  const unlimitedChars = isAdmin || isSuperAdmin;
  const MAX_MESSAGE_CHARS = 2000;
  // Channel config — replaces global/announcements components
  const isDM = channel === "dm";
  const isAnnouncements = channel === "announcements";
  const isGlobal = channel === "global";
  const messagesTable: "messages" | "global_messages" | "announcement_messages" =
    isDM ? "messages" : isAnnouncements ? "announcement_messages" : "global_messages";
  const conversationId = isDM ? (conversationIdProp ?? null) : channel; // sentinel id for non-DM
  // Group state — set after we look up the conversation row. Groups disable
  // read receipts (would be misleading with many recipients) and replace the
  // DM header with a group header + settings.
  const [isGroupConv, setIsGroupConv] = useState(false);
  const [groupInfo, setGroupInfo] = useState<{ name: string | null; my_role: "owner" | "admin" | "member" | null }>({ name: null, my_role: null });
  const [groupMembers, setGroupMembers] = useState<Profile[]>([]);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const showReceipts = isDM && !isGroupConv;
  const supportsPinning = isDM || isAnnouncements;
  const canPost = isAnnouncements ? (isAdmin || isSuperAdmin) : true;
  const channelTitle = isGlobal ? "Global Chat" : isAnnouncements ? "Announcements" : null;

  // Mark announcements/global mentions as read when the channel becomes active
  useEffect(() => {
    if (!isActive || !user?.id) return;
    let cancelled = false;
    if (isAnnouncements) {
      void markAnnouncementsRead(user.id)
        .then(() => {
          if (!cancelled) window.dispatchEvent(new CustomEvent("announcements-read"));
        })
        .catch((error) => console.error("Error marking announcements as read:", error));
    } else if (isGlobal) {
      void supabase.rpc("mark_global_mentions_read" as any).then(() => {
        if (!cancelled) window.dispatchEvent(new CustomEvent("global-mentions-read"));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isAnnouncements, isGlobal, isActive, user?.id]);


  // The authenticated user already includes the profile username, so use it
  // immediately instead of waiting for another profile request.
  useEffect(() => {
    if (!user?.id) {
      setMyUsername(null);
      return;
    }
    setMyUsername(ownSenderProfile?.username || null);
  }, [user?.id, ownSenderProfile?.username]);

  const { typingUsers, setTyping } = usePresence(isDM ? conversationIdProp ?? null : null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [otherUser, setOtherUser] = useState<Profile | null>(null);

  useEffect(() => {
    const onStatus = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) return;
      setOtherUser((p) =>
        p && p.id === d.userId
          ? {
              ...p,
              custom_status_text: d.custom_status_text,
              custom_status_emoji: d.custom_status_emoji,
              custom_status_expires_at: d.custom_status_expires_at,
            }
          : p,
      );
    };
    window.addEventListener("custom-status-updated", onStatus);
    return () => window.removeEventListener("custom-status-updated", onStatus);
  }, []);

  const [loading, setLoading] = useState(false);
  const [showQuickPresets, setShowQuickPresets] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deleteMessageId, setDeleteMessageId] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaPreviews, setMediaPreviews] = useState<MediaPreview[]>([]);
  
  const [videoLightboxUrl, setVideoLightboxUrl] = useState<string | null>(null);
  const [openEmojiPopover, setOpenEmojiPopover] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const fetchMessagesRef = useRef<((loadMore?: boolean) => Promise<void>) | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isTabVisible, setIsTabVisible] = useState(!document.hidden);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Polls visible in this channel: messageId -> pollId and resultMessageId -> pollId
  const [pollByMsgId, setPollByMsgId] = useState<Record<string, string>>({});
  const [resultPollByMsgId, setResultPollByMsgId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    const load = async () => {
      let q = (supabase as any).from("polls").select("id, message_id, result_message_id, channel, conversation_id");
      if (isDM) q = q.eq("channel", "dm").eq("conversation_id", conversationIdProp);
      else if (isAnnouncements) q = q.eq("channel", "announcement");
      else q = q.eq("channel", "global");
      const { data } = await q;
      if (cancelled || !data) return;
      const a: Record<string, string> = {};
      const b: Record<string, string> = {};
      for (const p of data as any[]) {
        if (p.message_id) a[p.message_id] = p.id;
        if (p.result_message_id) b[p.result_message_id] = p.id;
      }
      setPollByMsgId(a);
      setResultPollByMsgId(b);
    };
    load();
    const ch = supabase
      .channel(`polls-index:${channel}:${conversationIdProp || "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "polls" }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [isActive, isDM, isAnnouncements, channel, conversationIdProp]);

  const renderMessageBody = (msg: { id: string; content: string | null }) => {
    if (!msg.content) return null;
    const pollMarker = msg.content.match(/^\[\[poll:([0-9a-f-]{36})\]\]\s*$/i);
    if (pollMarker) return <PollCard pollId={pollMarker[1]} />;
    if (pollByMsgId[msg.id]) return <PollCard pollId={pollByMsgId[msg.id]} />;
    if (resultPollByMsgId[msg.id]) return <PollResultCard pollId={resultPollByMsgId[msg.id]} onJump={(id) => scrollToMessage(id)} />;
    return (
      <MessageMarkdown
        content={msg.content}
        isOwn={false}
        myUsername={myUsername}
        className="text-[13px] sm:text-sm leading-snug whitespace-pre-wrap break-words"
      />
    );
  };
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [mobileActionMessage, setMobileActionMessage] = useState<Message | null>(null);
  const [myUsername, setMyUsername] = useState<string | null>(null);
  const [dmMembers, setDmMembers] = useState<MentionCandidate[]>([]);
  const [mentionState, setMentionState] = useState<{ start: number; query: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionKeyHandlerRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const dragCounterRef = useRef(0);


  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoad = useRef(true);
  const messagesRef = useRef<Message[]>([]);
  const initialScrollSettledRef = useRef(false);
  const wasActiveRef = useRef(isActive);
  const userScrolledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingOutgoingMessagesRef = useRef(new Map<string, {
    content: string;
    reply_to_id: string | null;
    image_url: string | null;
    created_at: number;
  }>());
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const realtimeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const receiptRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const receiptWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStateRef = useRef<{ messageId: string; startX: number; active: boolean } | null>(null);

  const scrollToMessage = useCallback((messageId: string) => {
    const element = messageRefs.current.get(messageId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("bg-primary/10");
      setTimeout(() => {
        element.classList.remove("bg-primary/10");
      }, 2000);
    }
  }, []);

  const fetchPinnedMessages = useCallback(async () => {
    if (!supportsPinning) return;
    if (isDM && !conversationIdProp) return;

    let q: any = (supabase as any)
      .from(messagesTable)
      .select("*")
      .eq("is_pinned", true)
      .order("pinned_at", { ascending: false });
    if (isDM) q = q.eq("conversation_id", conversationIdProp);
    const { data, error } = await q;

    if (error) {
      console.error("Error fetching pinned messages:", error);
      return;
    }

    // Fetch sender profiles
    const senderIds = [...new Set((data || []).map((m: any) => m.sender_id).filter((id: string | null) => id && id !== user?.id))] as string[];
    const { data: profiles } = senderIds.length > 0
      ? await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", senderIds)
      : { data: [] };
    const profilesMap = new Map((profiles || []).map((p) => [p.id, p]));

    const pinnedWithSenders = (data || []).map((msg: any) => ({
      ...msg,
      sender: msg.sender_id === user?.id ? ownSenderProfile : msg.sender_id ? profilesMap.get(msg.sender_id) : undefined,
    }));

    setPinnedMessages(pinnedWithSenders as Message[]);
  }, [conversationIdProp, isDM, supportsPinning, messagesTable]);

  const togglePin = async (message: Message) => {
    if (!supportsPinning) return;
    const newPinned = !message.is_pinned;
    
    const { error } = await (supabase as any)
      .from(messagesTable)
      .update({
        is_pinned: newPinned,
        pinned_at: newPinned ? new Date().toISOString() : null,
        pinned_by: newPinned ? user?.id : null,
      })
      .eq("id", message.id);

    if (error) {
      console.error("Error toggling pin:", error);
      toast({ title: "Error", description: "Failed to update pin status", variant: "destructive" });
      return;
    }

    setMessages((prev) =>
      prev.map((m) =>
        m.id === message.id
          ? { ...m, is_pinned: newPinned, pinned_at: newPinned ? new Date().toISOString() : null }
          : m
      )
    );
    fetchPinnedMessages();
    toast({ title: newPinned ? "Message pinned" : "Message unpinned" });
  };

  const handleVoiceRecordingComplete = useCallback(async (blob: Blob, duration: number) => {
    if (!user || !conversationId) return;
    if (!canPost) return;
    if (exceedsMaxUploadSize(blob)) {
      toast({
        title: "Voice message is too large",
        description: `Maximum file size is ${MAX_UPLOAD_SIZE_LABEL}.`,
        variant: "destructive",
      });
      return;
    }
    
    setUploadingVoice(true);
    try {
      const extension = blob.type.includes('webm') ? 'webm' : 'm4a';
      const folder = isDM ? conversationIdProp : channel;
      const fileName = `${user.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      
      const publicUrl = await uploadChatMedia("chat-voice", fileName, blob);
      
      const insertPayload: any = {
        sender_id: user.id,
        content: "",
        image_url: JSON.stringify([`audio:${publicUrl}:${Math.round(duration)}`]),
      };
      if (isDM) insertPayload.conversation_id = conversationIdProp;
      await (supabase as any).from(messagesTable).insert(insertPayload);
      
    } catch (error: any) {
      toast({ title: "Error sending voice message", description: error.message, variant: "destructive" });
    } finally {
      setUploadingVoice(false);
    }
  }, [user, conversationId, conversationIdProp, isDM, channel, messagesTable, canPost]);

  const voiceRecorder = useVoiceRecorder({
    onRecordingComplete: handleVoiceRecordingComplete,
    onError: (error) => {
      toast({ title: "Recording Error", description: error.message, variant: "destructive" });
    },
    onPermissionNeeded: () => {
      toast({ title: "Microphone Access", description: "Please allow microphone access when prompted by your browser." });
    },
  });

  const fetchReactions = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) return {};
    
    const { data } = await supabase
      .from("message_reactions")
      .select("*")
      .in("message_id", messageIds);
    
    const reactionsMap: { [messageId: string]: Reaction[] } = {};
    (data || []).forEach((r) => {
      if (!reactionsMap[r.message_id]) {
        reactionsMap[r.message_id] = [];
      }
      reactionsMap[r.message_id].push(r);
    });
    return reactionsMap;
  }, []);

  const refreshReceiptStatuses = useCallback(async () => {
    if (!showReceipts || messagesTable !== 'messages') return;
    const messageIds = messagesRef.current
      .filter((message) => message.sender_id === user?.id && !message.read_at)
      .map((message) => message.id);
    if (!messageIds.length) return;
    const { data } = await supabase
      .from('messages')
      .select('id, read_at, delivered_at')
      .in('id', messageIds);
    if (!data) return;
    const receipts = new Map(data.map((message: any) => [message.id, message]));
    setMessages((previous) => {
      let changed = false;
      const next = previous.map((message) => {
        const receipt = receipts.get(message.id) as { read_at: string | null; delivered_at: string | null } | undefined;
        if (!receipt) return message;
        if (receipt.read_at === message.read_at && receipt.delivered_at === message.delivered_at) return message;
        changed = true;
        return {
          ...message,
          read_at: receipt.read_at,
          delivered_at: receipt.delivered_at,
          _status: receipt.read_at ? 'read' : receipt.delivered_at ? 'delivered' : 'sent',
        };
      });
      return changed ? next : previous;
    });
  }, [messagesTable, showReceipts, user?.id]);

  const reconcileLiveMessage = useCallback((incoming: Message, matchImageUrl = incoming.image_url || null) => {
    const now = Date.now();
    let optimisticId: string | undefined;
    if (incoming.sender_id === user?.id && !messagesRef.current.some((message) => message.id === incoming.id)) {
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
  }, [user?.id]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (conversationId && isActive) {
      fetchMessages();
      if (isDM) fetchOtherUser();
      if (supportsPinning) fetchPinnedMessages();

      const subFilter = isDM
        ? { event: "*" as const, schema: "public", table: messagesTable, filter: `conversation_id=eq.${conversationIdProp}` }
        : { event: "*" as const, schema: "public", table: messagesTable };
      const channel = supabase
        .channel(`${messagesTable}:${conversationId}`)
        .on(
          "postgres_changes",
          subFilter as any,
          async (payload) => {
            const change = payload as unknown as MariaDbRefreshPayload;
            if (change.refresh) {
              if (change.eventType === 'DELETE' && change.keys?.id) {
                setMessages((previous) => previous.filter((message) => message.id !== change.keys.id));
                return;
              }

              if (change.keys?.id && change.eventType !== 'INSERT'
                && !messagesRef.current.some((message) => message.id === change.keys.id)) return;

              if (change.eventType === 'INSERT' && change.record?.id && change.table === messagesTable) {
                const received = {
                  ...change.record,
                  sender: (change.record.sender as Message['sender'] | undefined)
                    || (change.record.sender_id === user?.id ? ownSenderProfile : undefined),
                  reactions: [],
                  _status: 'sent' as const,
                } as Message;
                reconcileLiveMessage(received);
                void Promise.all([
                  received.sender_id
                    ? received.sender_id === user?.id
                      ? Promise.resolve({ data: ownSenderProfile })
                      : supabase.from('profiles').select('username, display_name, avatar_url').eq('id', received.sender_id).single()
                    : Promise.resolve({ data: null }),
                  received.reply_to_id
                    ? (supabase as any).from(messagesTable).select('id, content, sender_id').eq('id', received.reply_to_id).maybeSingle()
                    : Promise.resolve({ data: null }),
                  signMessageMedia(received.image_url).catch(() => received.image_url),
                ]).then(async ([senderResult, replyResult, signedImageUrl]) => {
                  let repliedMessage: Message['replied_message'];
                  if (replyResult.data) {
                    const replySenderResult = replyResult.data.sender_id
                      ? await supabase.from('profiles').select('username, display_name').eq('id', replyResult.data.sender_id).single()
                      : { data: null };
                    repliedMessage = { ...replyResult.data, sender: replySenderResult.data || undefined };
                  }
                  setMessages((previous) => previous.map((message) => message.id === received.id
                    ? {
                      ...message,
                      image_url: signedImageUrl,
                      sender: senderResult.data || received.sender,
                      replied_message: repliedMessage,
                    }
                    : message));
                }).catch((error) => console.warn('Could not enrich live message:', error));
                const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
                if (viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 250) {
                  setTimeout(() => scrollToBottom('smooth'), 60);
                }
                return;
              }

              const columns = change.columns as string[] | undefined;
              const receiptOnly = change.table === 'messages'
                && change.eventType === 'UPDATE'
                && columns?.length
                && columns.every((column) => column === 'read_at' || column === 'delivered_at');
              if (receiptOnly) {
                if (!receiptRefreshTimerRef.current) {
                  receiptRefreshTimerRef.current = setTimeout(() => {
                    receiptRefreshTimerRef.current = null;
                    void refreshReceiptStatuses();
                  }, 100);
                }
                return;
              }

              if (!realtimeRefreshTimerRef.current) {
                realtimeRefreshTimerRef.current = setTimeout(() => {
                  realtimeRefreshTimerRef.current = null;
                  void fetchMessagesRef.current?.();
                }, 60);
              }
              return;
            }
            if (payload.eventType === "INSERT") {
              const newMsg = payload.new as Message;
              if (newMsg.sender_id) {
                if (newMsg.sender_id === user?.id) {
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
                const { data: repliedMsg } = await (supabase as any)
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
              newMsg.image_url = await signMessageMedia(newMsg.image_url);
              reconcileLiveMessage({ ...newMsg, _status: "sent" }, rawImageUrl);
              // Scroll to bottom only if user is already near the bottom
              setTimeout(() => {
                const v = scrollAreaRef.current?.querySelector(
                  "[data-radix-scroll-area-viewport]",
                ) as HTMLElement | null;
                if (!v) return;
                const nearBottom = v.scrollHeight - v.scrollTop - v.clientHeight < 250;
                const isOwn = newMsg.sender_id === user?.id;
                if (nearBottom || isOwn) scrollToBottom("smooth");
              }, 100);

              if (isAnnouncements && isActive && user?.id) {
                void markAnnouncementsRead(user.id)
                  .then(() => window.dispatchEvent(new CustomEvent("announcements-read")))
                  .catch((error) => console.error("Error marking announcements as read:", error));
              }
            } else if (payload.eventType === "UPDATE") {
              const updatedMsg = payload.new as Message;
              setMessages((prev) =>
                prev.map((m) => {
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
                })
              );
            } else if (payload.eventType === "DELETE") {
              const deletedMsg = payload.old as Message;
              setMessages((prev) => prev.filter((m) => m.id !== deletedMsg.id));
            }
          }
        )
        .subscribe();

      const reactionsChannel = supabase
        .channel(`reactions:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "message_reactions",
          },
          (payload) => {
            const change = payload as unknown as MariaDbRefreshPayload;
            if (change.refresh) {
              const messageIds = messagesRef.current.map((message) => message.id);
              void fetchReactions(messageIds).then((reactionMap) => {
                setMessages((previous) => previous.map((message) => ({
                  ...message,
                  reactions: reactionMap[message.id] || [],
                })));
              });
              return;
            }
            if (payload.eventType === "INSERT") {
              const newReaction = payload.new as Reaction;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === newReaction.message_id
                    ? { 
                        ...m, 
                        reactions: [...(m.reactions || []).filter(r => r.id !== newReaction.id), newReaction] 
                      }
                    : m
                )
              );
            } else if (payload.eventType === "DELETE") {
              const deletedReaction = payload.old as Reaction;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === deletedReaction.message_id
                    ? {
                        ...m,
                        reactions: (m.reactions || []).filter((r) => r.id !== deletedReaction.id),
                      }
                    : m
                )
              );
            }
          }
        )
        .subscribe();

      return () => {
        if (realtimeRefreshTimerRef.current) clearTimeout(realtimeRefreshTimerRef.current);
        if (receiptRefreshTimerRef.current) clearTimeout(receiptRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
        receiptRefreshTimerRef.current = null;
        supabase.removeChannel(channel);
        supabase.removeChannel(reactionsChannel);
      };
    }
  }, [conversationId, conversationIdProp, isDM, supportsPinning, messagesTable, showReceipts, user, isActive, ownSenderProfile, reconcileLiveMessage]);

  // Broadcasts missed while the realtime channel was down are not replayed,
  // so resync the visible conversation whenever the channel recovers.
  useEffect(() => onMariaDbRealtimeReconnect(() => {
    if (!isActive || !conversationId) return;
    void fetchMessagesRef.current?.();
    if (supportsPinning) void fetchPinnedMessages();
  }), [isActive, conversationId, supportsPinning, fetchPinnedMessages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement | null;
    if (!viewport) return;
    if (behavior === "smooth") {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    } else {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, []);

  useLayoutEffect(() => {
    const becameActive = isActive && !wasActiveRef.current;
    wasActiveRef.current = isActive;
    if (!isActive) return;
    // Only scroll to bottom on first batch of messages for this conversation.
    if ((isInitialLoad.current || becameActive) && messages.length > 0) {
      isInitialLoad.current = false;
      initialScrollSettledRef.current = false;
      userScrolledRef.current = false;

      const viewport = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]",
      ) as HTMLElement | null;

      // Mark as user-initiated only on real touch/wheel input.
      const markScrolled = () => {
        userScrolledRef.current = true;
        initialScrollSettledRef.current = true;
      };
      viewport?.addEventListener("wheel", markScrolled, { passive: true });
      viewport?.addEventListener("touchmove", markScrolled, { passive: true });

      scrollToBottom("instant");
      const delays = [50, 150, 350, 700, 1200, 2000];
      const timers = delays.map((d) =>
        setTimeout(() => {
          if (userScrolledRef.current) return;
          scrollToBottom("instant");
        }, d),
      );
      const settleTimer = setTimeout(() => {
        initialScrollSettledRef.current = true;
      }, Math.max(...delays) + 50);

      const mediaEls = viewport
        ? Array.from(viewport.querySelectorAll("img, video"))
        : [];
      const onMediaLoad = () => {
        if (userScrolledRef.current) return;
        scrollToBottom("instant");
      };
      mediaEls.forEach((el) => {
        el.addEventListener("load", onMediaLoad, { once: true });
        el.addEventListener("loadeddata", onMediaLoad, { once: true });
      });

      return () => {
        timers.forEach(clearTimeout);
        clearTimeout(settleTimer);
        viewport?.removeEventListener("wheel", markScrolled);
        viewport?.removeEventListener("touchmove", markScrolled);
        mediaEls.forEach((el) => {
          el.removeEventListener("load", onMediaLoad);
          el.removeEventListener("loadeddata", onMediaLoad);
        });
      };
    }
  }, [isActive, messages.length, scrollToBottom]);

  // Track the currently-loaded conversation so async writes (debounced cache
  // persistence, in-flight fetches) can refuse to apply when the conversation
  // has switched underneath them. Defense-in-depth against cross-DM bleed.
  const activeConversationRef = useRef<string | null>(conversationId);
  useEffect(() => {
    activeConversationRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    // Reset state when conversation changes. Hydrate from cache synchronously
    // so the UI never flashes empty while the network fetch is in flight.
    const cached = getCachedMessages<Message>(conversationId);
    setMessages(cached && cached.length > 0 ? cached : []);
    pendingOutgoingMessagesRef.current.clear();
    setOtherUser(null);
    setHasMore(true);
    setReplyingTo(null);
    setEditingMessageId(null);
    setShowQuickPresets(false);
    isInitialLoad.current = true;
    initialScrollSettledRef.current = false;
    userScrolledRef.current = false;
    loadingMoreRef.current = false;
    const presetTimer = setTimeout(() => setShowQuickPresets(true), 1000);
    // Independent settle guarantee — ensures scroll-up pagination becomes
    // available even if the per-message scroll effect keeps cancelling its
    // own settle timer when new messages arrive in quick succession.
    const settleTimer = setTimeout(() => {
      initialScrollSettledRef.current = true;
    }, 2500);
    return () => {
      clearTimeout(presetTimer);
      clearTimeout(settleTimer);
    };
  }, [conversationId]);

  // Persist the most recent messages to the local cache (debounced) so
  // remounts and conversation switches render instantly without refetching.
  useEffect(() => {
    if (!conversationId) return;
    if (messages.length === 0) return;
    const writeForId = conversationId;
    const snapshot = messages;
    const handle = setTimeout(() => {
      // Guard: never write a snapshot under a key that no longer represents
      // the active conversation. This prevents one DM's messages from
      // leaking into another DM's cache slot.
      if (activeConversationRef.current !== writeForId) return;
      setCachedMessages(writeForId, snapshot);
    }, 400);
    return () => clearTimeout(handle);
  }, [conversationId, messages]);

  // Track tab visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(!document.hidden);
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!isDM || !conversationIdProp || !user || messages.length === 0) return;
    const incoming = messages.filter((message) => message.sender_id !== user.id);
    const needsRead = isTabVisible && incoming.some((message) => !message.read_at);
    const needsDelivery = incoming.some((message) => !message.delivered_at);
    if ((!needsRead && !needsDelivery) || receiptWriteTimerRef.current) return;

    const conversationToSync = conversationIdProp;
    receiptWriteTimerRef.current = setTimeout(() => {
      receiptWriteTimerRef.current = null;
      if (activeConversationRef.current !== conversationToSync) return;
      const latestIncoming = messagesRef.current.filter((message) => message.sender_id !== user.id);
      const canMarkRead = !document.hidden && latestIncoming.some((message) => !message.read_at);
      const rpc = canMarkRead ? "mark_conversation_read" : "mark_conversation_delivered";
      if (!latestIncoming.some((message) => !message.delivered_at) && !canMarkRead) return;
      void supabase.rpc(rpc, { _conversation_id: conversationToSync }).then(({ error }) => {
        if (error) console.warn(`Could not update conversation receipts (${rpc}):`, error.message);
      });
    }, 80);
  }, [isDM, conversationIdProp, user, messages, isTabVisible]);

  useEffect(() => () => {
    if (receiptWriteTimerRef.current) clearTimeout(receiptWriteTimerRef.current);
  }, []);

  // Keep group header in sync when membership / name changes elsewhere.
  useEffect(() => {
    if (!isDM || !conversationIdProp || !isGroupConv) return;
    const ch = supabase
      .channel(`group-meta:${conversationIdProp}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_members",
          filter: `conversation_id=eq.${conversationIdProp}`,
        },
        () => fetchOtherUser(),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationIdProp}`,
        },
        () => fetchOtherUser(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDM, conversationIdProp, isGroupConv]);

  const fetchOtherUser = async () => {
    if (!conversationId || !user) return;

    // Look up whether this conversation is a group so we can branch the
    // header / mention candidates / read-receipt behavior.
    const { data: conv } = await supabase
      .from("conversations")
      .select("id, is_group, name")
      .eq("id", conversationId)
      .maybeSingle();

    const isGroup = !!conv?.is_group;

    if (isGroup) {
      const { data: rows } = await supabase
        .from("conversation_members")
        .select("user_id, role, joined_at")
        .eq("conversation_id", conversationId)
        .order("joined_at", { ascending: true });

      const ids = (rows ?? []).map((r: any) => r.user_id);
      const { data: profiles } = ids.length > 0
        ? await supabase
            .from("profiles")
            .select("*")
            .in("id", ids)
        : { data: [] as any[] };

      const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      const orderedMembers: Profile[] = (rows ?? [])
        .map((r: any) => profileMap.get(r.user_id))
        .filter(Boolean) as Profile[];
      const myRole = (rows ?? []).find((r: any) => r.user_id === user.id)?.role ?? null;

      setIsGroupConv(true);
      setGroupMembers(orderedMembers);
      setGroupInfo({ name: conv?.name ?? null, my_role: myRole as any });
      setOtherUser(null);
      // Mention candidates: every other group member
      setDmMembers(
        orderedMembers
          .filter((p) => p.id !== user.id)
          .map((p) => ({
            id: p.id,
            username: p.username,
            display_name: p.display_name ?? null,
            avatar_url: p.avatar_url ?? null,
          })),
      );
      return;
    }

    setIsGroupConv(false);
    setGroupMembers([]);
    setGroupInfo({ name: null, my_role: null });

    const { data: members } = await supabase
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .neq("user_id", user.id);

    if (members && members.length > 0) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", members[0].user_id)
        .single();
      setOtherUser(profile);
      if (profile) {
        setDmMembers([
          {
            id: profile.id,
            username: profile.username,
            display_name: profile.display_name ?? null,
            avatar_url: profile.avatar_url ?? null,
          },
        ]);
      }
    }
  };


  const fetchMessages = async (loadMore = false) => {
    if (!conversationId) return;

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

    if (error) {
      console.error("Error fetching messages:", error);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      return;
    }

    // Check if there are more messages
    setHasMore((data || []).length === MESSAGES_PER_PAGE);

    const messageIds = (data || []).map((m: any) => m.id);
    const senderIds = [...new Set((data || []).map((m: any) => m.sender_id).filter((id: string | null) => id && id !== user?.id))] as string[];
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
    const replySenderIds = [...new Set(((repliedMessages || []) as any[]).map((m: any) => m.sender_id).filter((id: string | null) => id && id !== user?.id))] as string[];
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
      const sender = msg.sender_id === user?.id ? ownSenderProfile : msg.sender_id ? profilesMap.get(msg.sender_id) : undefined;
      const repliedMessage = msg.reply_to_id ? repliedMessagesMap.get(msg.reply_to_id) : undefined;
      const signedImageUrl = await signMessageMedia(msg.image_url);
      return {
        ...msg,
        image_url: signedImageUrl,
        sender: sender ? { username: sender.username, display_name: sender.display_name, avatar_url: sender.avatar_url } : undefined,
        reactions: reactionsMap[msg.id] || [],
        replied_message: repliedMessage ? {
          ...repliedMessage,
          sender: repliedMessage.sender_id === user?.id ? ownSenderProfile : repliedMessage.sender,
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
      // A failure while enriching (profiles/reactions/media signing) must not
      // wedge pagination: reset the load-more flags and keep existing messages.
      console.error("Error enriching messages:", enrichError);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      return;
    }

    if (loadMore) {
      // Preserve scroll position when loading older messages
      const scrollArea = scrollAreaRef.current;
      const scrollViewport = scrollArea?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
      const previousScrollHeight = scrollViewport?.scrollHeight || 0;
      const previousScrollTop = scrollViewport?.scrollTop || 0;

      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const fresh = messagesWithSenders.filter((m) => !existingIds.has(m.id));
        return [...fresh, ...prev];
      });

      // Restore scroll position after new messages are added
      requestAnimationFrame(() => {
        if (scrollViewport) {
          const newScrollHeight = scrollViewport.scrollHeight;
          scrollViewport.scrollTop = previousScrollTop + (newScrollHeight - previousScrollHeight);
        }
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
        const merged = new Map<string, Message>();
        for (const m of prev) merged.set(m.id, m);
        for (const m of messagesWithSenders) merged.set(m.id, m);
        return Array.from(merged.values()).sort(
          (a, b) => serverDateMs(a.created_at) - serverDateMs(b.created_at),
        );
      });
    }
  };

  fetchMessagesRef.current = fetchMessages;

  const handleScroll = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    const scrollViewport = scrollArea?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;

    if (scrollViewport) {
      // Any scroll event that moves us away from the bottom means the
      // initial auto-scroll-to-bottom flurry is over — unlock pagination.
      const distanceFromBottom =
        scrollViewport.scrollHeight - scrollViewport.scrollTop - scrollViewport.clientHeight;
      if (distanceFromBottom > 20) {
        initialScrollSettledRef.current = true;
      }

      // Trigger pagination once the user has actually scrolled up.
      // Use a generous threshold so it fires before the user has to hit the very top,
      // and gate on initialScrollSettledRef (flips true on any real user scroll or
      // after the auto-scroll-to-bottom flurry settles) instead of isInitialLoad,
      // which can be reset by unrelated re-fetches.
      if (
        initialScrollSettledRef.current &&
        !loadingMoreRef.current &&
        hasMore &&
        scrollViewport.scrollTop < 600
      ) {
        void fetchMessagesRef.current?.(true);
      }

      // Check if scrolled up to show jump button
      const isNearBottom = distanceFromBottom < 150;
      setShowScrollButton(!isNearBottom);
    }
  }, [hasMore, conversationId]);

  const lastTypingSentRef = useRef(0);
  const handleTyping = useCallback(() => {
    if (!isDM) return;
    // Throttle the realtime "typing" broadcast so it fires at most once every
    // 1.5s instead of on every keystroke (keeps typing snappy on mobile).
    const now = Date.now();
    if (now - lastTypingSentRef.current > 1500) {
      lastTypingSentRef.current = now;
      setTyping(true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      lastTypingSentRef.current = 0;
      setTyping(false);
    }, 2000);
  }, [setTyping, isDM]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversationId || !user) return;
    if (!canPost) return;
    const hasText = newMessage.trim().length > 0;
    const hasMedia = mediaPreviews.length > 0;
    if (!hasText && !hasMedia) return;

    setLoading(true);
    if (isDM) setTyping(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    const contentToSend = newMessage.trim();
    const previewsToSend = mediaPreviews;
    const replyTarget = replyingTo;

    setNewMessage("");
    setReplyingTo(null);
    setMediaPreviews([]);

    // Upload any media first
    let imageUrlJson: string | null = null;
    if (previewsToSend.length > 0) {
      setUploadingMedia(true);
      try {
        const urls: string[] = [];
        for (const preview of previewsToSend) {
          // Compress images to WebP/AVIF before upload to slash egress.
          const fileToUpload =
            preview.type === "image"
              ? await compressImageForUpload(preview.file)
              : preview.file;

          const fileExt =
            fileToUpload.name.split(".").pop() ||
            (preview.type === "video" ? "mp4" : preview.type === "image" ? "webp" : "bin");
          const folder = isDM ? conversationIdProp : channel;
          const fileName = `${user.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
          const bucket = preview.type === "video" ? "chat-videos" : "chat-images";

          const publicUrl = await uploadChatMedia(bucket, fileName, fileToUpload);
          if (preview.type === "video") {
            urls.push(`video:${publicUrl}`);
          } else if (preview.type === "image") {
            urls.push(publicUrl);
          } else if (preview.type === "music") {
            urls.push(encodeMusic({ url: publicUrl, name: preview.file.name, size: preview.file.size }));
          } else {
            urls.push(encodeFile({
              url: publicUrl,
              name: preview.file.name,
              size: preview.file.size,
              mime: preview.file.type || "application/octet-stream",
            }));
          }
          URL.revokeObjectURL(preview.url);
        }
        imageUrlJson = JSON.stringify(urls);
      } catch (error: any) {
        toast({ title: "Error uploading media", description: error.message, variant: "destructive" });
        setUploadingMedia(false);
        setLoading(false);
        // Restore composer state so user doesn't lose their work
        setNewMessage(contentToSend);
        setMediaPreviews(previewsToSend);
        if (replyTarget) setReplyingTo(replyTarget);
        return;
      } finally {
        setUploadingMedia(false);
      }
    }

    const tempId = crypto.randomUUID();
    const optimisticImageUrl = imageUrlJson ? await signMessageMedia(imageUrlJson) : null;
    const optimisticMessage: Message = {
      id: tempId,
      content: contentToSend,
      sender_id: user.id,
      created_at: new Date().toISOString(),
      read_at: null,
      edited_at: null,
      image_url: optimisticImageUrl,
      reply_to_id: replyTarget?.id || null,
      reactions: [],
      replied_message: replyTarget ? {
        id: replyTarget.id,
        content: replyTarget.content,
        sender_id: replyTarget.sender_id,
        sender: replyTarget.sender ? {
          username: replyTarget.sender.username,
          display_name: replyTarget.sender.display_name,
        } : undefined,
      } : undefined,
      sender: ownSenderProfile,
      _status: "sending",
    };

    pendingOutgoingMessagesRef.current.set(tempId, {
      content: contentToSend,
      reply_to_id: replyTarget?.id || null,
      image_url: imageUrlJson || null,
      created_at: Date.now(),
    });
    setMessages((prev) => [...prev, optimisticMessage]);

    const insertPayload: any = {
      sender_id: user.id,
      content: contentToSend,
      reply_to_id: replyTarget?.id || null,
    };
    if (imageUrlJson) insertPayload.image_url = imageUrlJson;
    if (isDM) insertPayload.conversation_id = conversationIdProp;
    const { data, error } = await (supabase as any)
      .from(messagesTable)
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      pendingOutgoingMessagesRef.current.delete(tempId);
      console.error("Error sending message:", error);
      toast({ title: "Error sending message", description: error.message, variant: "destructive" });
      setMessages((prev) => prev.some((message) => message.id === tempId)
        ? prev.filter((message) => message.id !== tempId)
        : prev);
    } else {
      pendingOutgoingMessagesRef.current.delete(tempId);
      setMessages((prev) => {
        const index = prev.findIndex((message) => message.id === tempId);
        if (index < 0) return prev;
        const next = prev.slice();
        next[index] = {
          ...prev[index],
          ...data,
          image_url: optimisticImageUrl ?? data.image_url,
          reactions: [],
          _status: "sent",
        };
        return next;
      });
    }
    setLoading(false);
  };

  const addFilesToPreview = (files: File[]) => {
    const validFiles: MediaPreview[] = [];
    for (const file of files) {
      // Reject folders: zero-size with no type, or names ending in /
      if ((file.size === 0 && !file.type) || file.name.endsWith('/')) {
        toast({
          title: "Folders can't be attached",
          description: `Skipped "${file.name}" — only files are allowed.`,
          variant: "destructive",
        });
        continue;
      }
      if (exceedsMaxUploadSize(file)) {
        toast({
          title: `${file.name} is too large`,
          description: `Maximum file size is ${MAX_UPLOAD_SIZE_LABEL}.`,
          variant: "destructive",
        });
        continue;
      }
      const kind = classifyFile(file);
      validFiles.push({
        file,
        url: URL.createObjectURL(file),
        type: kind,
      });
    }
    if (validFiles.length > 0) {
      setMediaPreviews((prev) => [...prev, ...validFiles]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(
      (f) => !((f.size === 0 && !f.type) || f.name.endsWith('/'))
    );
    if (files.length === 0) return;
    addFilesToPreview(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f && !((f.size === 0 && !f.type) || f.name.endsWith('/'))) {
          files.push(f);
        }
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFilesToPreview(files);
    }
  };


  const removePreview = (index: number) => {
    setMediaPreviews((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  };


  const startEditing = (message: Message) => {
    setEditingMessageId(message.id);
    setEditContent(message.content);
  };

  const cancelEditing = () => {
    setEditingMessageId(null);
    setEditContent("");
  };

  const saveEdit = async () => {
    if (!editingMessageId || !editContent.trim()) return;

    const { error } = await (supabase as any)
      .from(messagesTable)
      .update({
        content: editContent.trim(),
        edited_at: new Date().toISOString(),
      })
      .eq("id", editingMessageId);

    if (error) {
      console.error("Error editing message:", error);
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === editingMessageId
            ? { ...m, content: editContent.trim(), edited_at: new Date().toISOString() }
            : m
        )
      );
    }
    cancelEditing();
  };

  const deleteMessage = async () => {
    if (!deleteMessageId) return;

    const { error } = await (supabase as any).from(messagesTable).delete().eq("id", deleteMessageId);

    if (error) {
      console.error("Error deleting message:", error);
      toast({ title: "Error deleting message", variant: "destructive" });
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== deleteMessageId));
    }
    setDeleteMessageId(null);
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user) return;

    setOpenEmojiPopover(null);

    const message = messages.find((m) => m.id === messageId);
    const existingReaction = message?.reactions?.find(
      (r) => r.user_id === user.id && r.emoji === emoji
    );

    if (existingReaction) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, reactions: (m.reactions || []).filter((r) => r.id !== existingReaction.id) }
            : m
        )
      );
      await supabase.from("message_reactions").delete().eq("id", existingReaction.id);
    } else {
      const tempReaction: Reaction = {
        id: crypto.randomUUID(),
        message_id: messageId,
        user_id: user.id,
        emoji,
      };
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, reactions: [...(m.reactions || []), tempReaction] }
            : m
        )
      );
      await supabase.from("message_reactions").insert({
        message_id: messageId,
        user_id: user.id,
        emoji,
      });
    }
  };

  const getStatusIcon = (message: Message, isOwn: boolean, showReadStatus = true) => {
    if (!isOwn) return null;
    if (!showReceipts) return null;
    if (message._status === "read" && !showReadStatus) return null;

    switch (message._status) {
      case "sending":
        return (
          <span className="flex items-center gap-1 text-primary-foreground/50">
            <Clock className="h-3 w-3" />
            <span className="text-[10px]">Sending</span>
          </span>
        );
      case "read":
        return (
          <span className="flex items-center gap-1 text-emerald-300">
            <CheckCheck className="h-3 w-3" />
            <span className="text-[10px] font-medium">Read</span>
          </span>
        );
      case "delivered":
        return (
          <span className="flex items-center gap-1 text-primary-foreground/70">
            <CheckCheck className="h-3 w-3" />
            <span className="text-[10px] font-medium">Delivered</span>
          </span>
        );
      case "sent":
      default:
        return (
          <span className="flex items-center gap-1 text-amber-200">
            <Check className="h-3 w-3" />
            <span className="text-[10px] font-medium">Sent</span>
          </span>
        );
    }
  };

  const formatMessageDate = (dateString: string) => {
    const date = parseServerDate(dateString);
    if (!date) return dateString;
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    if (isToday) {
      return `Today, ${time}`;
    } else if (isYesterday) {
      return `Yesterday, ${time}`;
    } else {
      return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
    }
  };

  const getDateLabel = (dateString: string) => {
    const date = parseServerDate(dateString);
    if (!date) return "";
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    if (isToday) return "Today";
    if (isYesterday) return "Yesterday";
    return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  };

  const shouldShowDateLabel = (index: number) => {
    if (index === 0) return true;
    const current = serverDateMs(messages[index].created_at);
    const previous = serverDateMs(messages[index - 1].created_at);
    if (Number.isNaN(current) || Number.isNaN(previous)) return false;
    return new Date(current).toDateString() !== new Date(previous).toDateString();
  };



  const groupReactions = (reactions: Reaction[]) => {
    const grouped: { [emoji: string]: { count: number; userIds: string[] } } = {};
    reactions.forEach((r) => {
      if (!grouped[r.emoji]) {
        grouped[r.emoji] = { count: 0, userIds: [] };
      }
      grouped[r.emoji].count++;
      grouped[r.emoji].userIds.push(r.user_id);
    });
    return grouped;
  };

  const isOtherUserTyping = otherUser && typingUsers.has(otherUser.id);

  // Helper to render message content with clickable links
  const renderMessageContent = (content: string, isOwn: boolean) => {
    // URL regex pattern
    const urlPattern = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
    
    const parts = content.split(urlPattern);
    
    return parts.map((part, index) => {
      if (urlPattern.test(part)) {
        // Reset the regex lastIndex
        urlPattern.lastIndex = 0;
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline underline-offset-2 hover:opacity-80 transition-opacity ${
              isOwn ? 'text-primary-foreground' : 'text-primary'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <p className="text-lg">Select a conversation to start chatting</p>
        </div>
      </div>
    );
  }

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canPost) return;
    if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggingFiles(true);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canPost) return;
    if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canPost) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingFiles(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canPost) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingFiles(false);

    const files: File[] = [];
    if (e.dataTransfer.items) {
      for (const item of Array.from(e.dataTransfer.items)) {
        if (item.kind !== "file") continue;
        const entry = (item as any).webkitGetAsEntry?.();
        if (entry?.isDirectory) {
          toast({
            title: "Folders can't be attached",
            description: `Skipped "${entry.name}" — only files are allowed.`,
            variant: "destructive",
          });
          continue;
        }
        const file = item.getAsFile();
        if (file && !((file.size === 0 && !file.type) || file.name.endsWith('/'))) {
          files.push(file);
        }
      }
    } else {
      for (const file of Array.from(e.dataTransfer.files || [])) {
        if (!((file.size === 0 && !file.type) || file.name.endsWith('/'))) {
          files.push(file);
        }
      }
    }
    if (files.length > 0) addFilesToPreview(files);
  };

  return (
    <div
      className="flex-1 flex flex-col bg-background h-full overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFiles && canPost && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary m-2 rounded-lg pointer-events-none">
          <div className="text-center">
            <Paperclip className="h-10 w-10 mx-auto mb-2 text-primary" />
            <p className="text-sm font-medium">Drop files to attach</p>
            <p className="text-xs text-muted-foreground">Up to {MAX_UPLOAD_SIZE_LABEL} each</p>
          </div>
        </div>
      )}
      <div className="mx-2 mt-2 mb-0 p-2 sm:m-3 sm:mb-0 sm:p-3 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xl shadow-[0_4px_20px_-8px_hsl(var(--foreground)/0.15)] flex items-center gap-2 sm:gap-3 flex-shrink-0">
        {isMobile && onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 -ml-1 flex-shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        {isDM && isGroupConv ? (
          <button
            type="button"
            onClick={() => setGroupSettingsOpen(true)}
            className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 text-left rounded-md -mx-1 px-1 py-1 hover:bg-muted/50 transition-colors"
            title="Group settings"
          >
            <GroupAvatar
              members={groupMembers.map((m) => ({
                id: m.id,
                username: m.username,
                display_name: m.display_name,
                avatar_url: m.avatar_url,
              }))}
              name={groupInfo.name}
              size="md"
            />
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">
                {groupInfo.name && groupInfo.name.trim().length > 0
                  ? groupInfo.name
                  : groupMembers
                      .filter((m) => m.id !== user?.id)
                      .map((m) => m.display_name || m.username)
                      .slice(0, 3)
                      .join(", ") || "Group"}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <UsersIcon className="h-3 w-3" />
                {groupMembers.length} {groupMembers.length === 1 ? "member" : "members"}
                {(() => {
                  const otherTyping = Array.from(typingUsers).filter((id) => id !== user?.id);
                  if (otherTyping.length === 0) return null;
                  const typer = groupMembers.find((m) => m.id === otherTyping[0]);
                  const name = typer?.display_name || typer?.username || "Someone";
                  return (
                    <span className="ml-2 text-primary animate-pulse">
                      {otherTyping.length > 1 ? "several typing..." : `${name} typing...`}
                    </span>
                  );
                })()}
              </p>
            </div>
            <SettingsIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </button>
        ) : isDM ? (
          <button
            type="button"
            onClick={() => otherUser && setProfileUserId(otherUser.id)}
            className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 text-left rounded-md -mx-1 px-1 py-1 hover:bg-muted/50 transition-colors"
          >
            <Avatar className="h-8 w-8 sm:h-10 sm:w-10">
              <AvatarImage src={otherUser?.avatar_url || undefined} />
              <AvatarFallback>{otherUser?.username?.[0]?.toUpperCase() || "?"}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">
                {otherUser?.display_name || otherUser?.username || "Unknown"}
              </p>
              {isOtherUserTyping ? (
                <p className="text-xs text-primary animate-pulse">typing...</p>
              ) : isStatusActive(otherUser) ? (
                <p className="text-xs text-muted-foreground truncate">
                  {otherUser?.custom_status_emoji ? `${otherUser.custom_status_emoji} ` : ""}
                  {otherUser?.custom_status_text}
                </p>
              ) : null}
            </div>
          </button>

        ) : (
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{channelTitle}</p>
          </div>
        )}
        <ChatSearch messages={messages} onJump={scrollToMessage} currentUserId={user?.id} />
        {(() => {
          const mentionMsgs = messages.filter(
            (m) =>
              m.sender_id !== user?.id &&
              messageMentionsMe(m.content, myUsername),
          );
          if (mentionMsgs.length === 0) return null;
          return (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative"
                  title={`Mentions (${mentionMsgs.length})`}
                >
                  <span className="text-sm font-semibold">@</span>
                  <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-background" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="px-3 py-2 border-b text-sm font-semibold flex items-center gap-2">
                  <span className="text-destructive">@</span> Mentions ({mentionMsgs.length})
                </div>
                <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                  {mentionMsgs.slice().reverse().map((msg) => (
                    <div
                      key={msg.id}
                      className="text-sm bg-muted/50 rounded px-3 py-2 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-medium truncate">
                          {msg.sender?.display_name || msg.sender?.username || "Unknown"}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => scrollToMessage(msg.id)}
                        >
                          Jump
                        </Button>
                      </div>
                      {msg.content ? (
                        <MessageMarkdown
                          content={msg.content}
                          isOwn={false}
                          myUsername={myUsername}
                          className="text-sm whitespace-pre-wrap break-words text-muted-foreground"
                        />
                      ) : (
                        <span className="text-muted-foreground italic">[Media]</span>
                      )}
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          );
        })()}

        {pinnedMessages.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" title={`Pinned (${pinnedMessages.length})`}>
                <Pin className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="px-3 py-2 border-b flex items-center gap-2 text-sm font-semibold">
                <Pin className="h-4 w-4" /> Pinned messages ({pinnedMessages.length})
              </div>
              <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                {pinnedMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="text-sm bg-muted/50 rounded px-3 py-2 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-medium text-foreground truncate">
                        {msg.sender?.display_name || msg.sender?.username || "You"}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => scrollToMessage(msg.id)}
                      >
                        Jump
                      </Button>
                    </div>
                    {msg.content ? (
                      <MessageMarkdown
                        content={msg.content}
                        isOwn={false}
                        myUsername={myUsername}
                        className="text-sm whitespace-pre-wrap break-words text-muted-foreground"
                      />

                    ) : (
                      <span className="text-muted-foreground italic">[Media]</span>
                    )}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>



      <ScrollArea className="flex-1 overscroll-contain relative [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!min-w-0 [&>[data-radix-scroll-area-viewport]>div]:!w-full" ref={scrollAreaRef} onScrollCapture={handleScroll}>
        <div className="px-3 sm:px-4 py-2 sm:p-4 space-y-2 flex flex-col min-h-full w-full min-w-0 max-w-full overflow-x-hidden">
          {loadingMore && (
            <div className="flex justify-center py-2">
              <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!hasMore && (
            <div className="text-center text-muted-foreground text-xs py-2">
              {messages.length === 0
                ? `This is the beginning of your conversation${
                    isDM && isGroupConv && groupInfo.name
                      ? ` in ${groupInfo.name}`
                      : isDM && otherUser
                      ? ` with ${otherUser.display_name || otherUser.username}`
                      : ""
                  }`
                : "Beginning of conversation"}
            </div>
          )}
          {(() => messages.map((message, index) => {
            const isOwn = message.sender_id === user?.id;
            const nextMessage = messages[index + 1];
            const continuesReadChain = message._status === "read"
              && nextMessage?.sender_id === message.sender_id
              && nextMessage._status === "read"
              && serverDateMs(nextMessage.created_at) - serverDateMs(message.created_at) <= 5 * 60 * 1000;
            const isEditing = editingMessageId === message.id;
            const groupedReactions = groupReactions(message.reactions || []);

            // In shared rooms, collapse messages from blocked users behind a
            // placeholder (their avatar, name and content stay hidden until
            // explicitly revealed). DMs are unaffected — blocking unfriends.
            const senderBlocked = !isDM && !isOwn && isBlocked(message.sender_id);
            if (senderBlocked && !revealedBlocked.has(message.id)) {
              return (
                <div key={message.id} className="px-2 sm:px-3 py-1">
                  <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    <span className="flex-1">This message was sent by a user you blocked.</span>
                    <button
                      onClick={() =>
                        setRevealedBlocked((prev) => new Set(prev).add(message.id))
                      }
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted transition-colors"
                    >
                      Show message
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={message.id} className="relative overflow-hidden">
                {isMobile && canPost && (
                  <div
                    className="absolute inset-y-0 left-0 flex items-center pl-3 sm:pl-4 pointer-events-none z-0 opacity-0 transition-opacity duration-200"
                    data-swipe-bg={message.id}
                  >
                    <Reply className="h-5 w-5 text-primary" />
                  </div>
                )}
                {shouldShowDateLabel(index) && (
                  <div className="flex items-center gap-3 my-3 px-2">
                    <div className="flex-1 h-px bg-muted-foreground/30" />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {getDateLabel(message.created_at)}
                    </span>
                    <div className="flex-1 h-px bg-muted-foreground/30" />
                  </div>
                )}
                <div
                  ref={(el) => {
                    if (el) messageRefs.current.set(message.id, el);
                  }}
                  className={`relative flex gap-1.5 sm:gap-3 group transition-colors duration-500 rounded-lg px-2 sm:px-3 py-1 hover:bg-muted/50 items-start overflow-hidden min-w-0 ${
                    messageMentionsMe(message.content, myUsername) && message.sender_id !== user?.id
                      ? "ring-1 ring-destructive/40 bg-destructive/[0.04]"
                      : ""
                  } ${isMobile ? 'select-none [-webkit-touch-callout:none] [touch-action:pan-y]' : ''}`}

                  style={{ willChange: 'transform' }}
                  onContextMenu={(e) => {
                    if (isMobile) e.preventDefault();
                  }}
                  onTouchStart={(e) => {
                    if (!isMobile) return;
                    const startY = e.touches[0]?.clientY ?? 0;
                    const startX = e.touches[0]?.clientX ?? 0;
                    (e.currentTarget as any).__lpStart = { x: startX, y: startY };
                    longPressFiredRef.current = false;
                    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                    try { window.getSelection()?.removeAllRanges(); } catch { /* selection API unavailable */ }
                    swipeStateRef.current = null;
                    const bg = e.currentTarget.parentElement?.querySelector(`[data-swipe-bg="${message.id}"]`) as HTMLElement | null;
                    if (bg) { bg.style.opacity = '0'; bg.style.transition = ''; }
                    e.currentTarget.style.transform = '';
                    e.currentTarget.style.transition = '';
                    longPressTimerRef.current = setTimeout(() => {
                      longPressFiredRef.current = true;
                      try { (navigator as any).vibrate?.(15); } catch { /* vibration unavailable */ }
                      try { window.getSelection()?.removeAllRanges(); } catch { /* selection API unavailable */ }
                      setMobileActionMessage(message);
                    }, 400);
                  }}
                  onTouchMove={(e) => {
                    const start = (e.currentTarget as any).__lpStart;
                    if (start) {
                      const dx = Math.abs((e.touches[0]?.clientX ?? 0) - start.x);
                      const dy = Math.abs((e.touches[0]?.clientY ?? 0) - start.y);
                      if (dx > 8 || dy > 8) {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = null;
                        }
                      }
                    }
                    const swipeStart = (e.currentTarget as any).__lpStart?.x;
                    if (typeof swipeStart === 'number') {
                      const currentX = e.touches[0]?.clientX ?? 0;
                      const deltaX = currentX - swipeStart;
                      if (deltaX > 0 && deltaX > Math.abs((e.touches[0]?.clientY ?? 0) - (e.currentTarget as any).__lpStart.y)) {
                        const maxSwipe = 100;
                        const translateX = Math.min(deltaX, maxSwipe);
                        e.currentTarget.style.transform = `translateX(${translateX}px)`;
                        e.currentTarget.style.transition = 'none';
                        const bg = e.currentTarget.parentElement?.querySelector(`[data-swipe-bg="${message.id}"]`) as HTMLElement | null;
                        if (bg) {
                          bg.style.transition = 'none';
                          bg.style.opacity = String(Math.min(translateX / 60, 1));
                        }
                        if (deltaX > 10) {
                          swipeStateRef.current = { messageId: message.id, startX: swipeStart, active: true };
                        }
                      }
                    }
                  }}
                  onTouchEnd={(e) => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                    if (longPressFiredRef.current) {
                      e.preventDefault();
                    }
                    const swipe = swipeStateRef.current;
                    if (swipe && swipe.messageId === message.id) {
                      const el = messageRefs.current.get(message.id);
                      if (el) {
                        el.style.transition = 'transform 0.25s ease';
                        el.style.transform = '';
                      }
                      const bg = el?.parentElement?.querySelector(`[data-swipe-bg="${message.id}"]`) as HTMLElement | null;
                      if (bg) {
                        bg.style.transition = 'opacity 0.25s ease';
                        bg.style.opacity = '0';
                      }
                      if (swipe.active && e.changedTouches[0]) {
                        const endX = e.changedTouches[0].clientX;
                        if (endX - swipe.startX > 80) {
                          setReplyingTo(message);
                        }
                      }
                      swipeStateRef.current = null;
                    }
                  }}
                  onTouchCancel={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                    const swipe = swipeStateRef.current;
                    if (swipe && swipe.messageId === message.id) {
                      const el = messageRefs.current.get(message.id);
                      if (el) {
                        el.style.transition = 'transform 0.25s ease';
                        el.style.transform = '';
                      }
                      const bg = el?.parentElement?.querySelector(`[data-swipe-bg="${message.id}"]`) as HTMLElement | null;
                      if (bg) {
                        bg.style.transition = 'opacity 0.25s ease';
                        bg.style.opacity = '0';
                      }
                      swipeStateRef.current = null;
                    }
                  }}
                >
                {messageMentionsMe(message.content, myUsername) && message.sender_id !== user?.id && (
                  <span
                    className="absolute top-1 right-1 z-10 inline-flex items-center justify-center h-3 w-3 rounded-full bg-destructive ring-2 ring-background pointer-events-none"
                    title="You were mentioned"
                  />
                )}

                {message.sender_id && message.sender_id !== user?.id ? (

                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="flex-shrink-0 rounded-full focus:outline-none focus-visible:outline-none mt-0.5">
                        <Avatar className="h-7 w-7 sm:h-8 sm:w-8">
                          <AvatarImage src={message.sender?.avatar_url || undefined} />
                          <AvatarFallback>
                            {message.sender?.username?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-44 p-1">
                      <Button
                        variant="ghost"
                        className="w-full justify-start h-9"
                        onClick={() => setProfileUserId(message.sender_id!)}
                      >
                        View Profile
                      </Button>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Avatar className="h-7 w-7 sm:h-8 sm:w-8 flex-shrink-0 mt-0.5">
                    <AvatarImage src={message.sender?.avatar_url || undefined} />
                    <AvatarFallback>
                      {message.sender?.username?.[0]?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                )}

                <div className="flex-1 min-w-0">

                  {isEditing ? (
                    <div className="flex gap-2 items-end">
                      <AutoResizeTextarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-w-[200px] min-h-[40px] py-2"
                        maxRows={23}
                        autoFocus
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !isMobile &&
                            !(e.nativeEvent as KeyboardEvent).isComposing
                          ) {
                            e.preventDefault();
                            saveEdit();
                          }
                          if (e.key === "Escape") cancelEditing();
                        }}
                      />
                      <Button size="icon" variant="ghost" onClick={saveEdit}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={cancelEditing}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-start gap-1 min-w-0">
                      <div className="relative flex-1 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-x-1.5 gap-y-0.5 mb-0.5 flex-wrap min-w-0">
                          <button
                            type="button"
                            onClick={() => message.sender_id && setProfileUserId(message.sender_id)}
                            className="font-semibold text-[13px] sm:text-sm text-foreground truncate max-w-[58vw] sm:max-w-none hover:underline focus:outline-none focus-visible:underline cursor-pointer text-left"
                          >
                            {message.sender?.display_name || message.sender?.username || "Unknown"}
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {formatMessageDate(message.created_at)}
                          </span>
                          {message.edited_at && (
                            <span
                              className="text-[10px] italic text-muted-foreground/80"
                              title={`Edited ${formatMessageDate(message.edited_at)}`}
                            >
                              (edited)
                            </span>
                          )}
                          {isOwn && getStatusIcon(message, isOwn, !continuesReadChain)}
                        </div>


                        <div className="text-foreground break-words min-w-0">
                          {message.replied_message && (
                            <button
                              type="button"
                              onClick={() => scrollToMessage(message.replied_message!.id)}
                              className="mb-2 p-1.5 sm:p-2 rounded border-l-2 bg-muted/40 border-primary/50 w-full max-w-full text-left hover:bg-muted/60 transition-colors cursor-pointer overflow-hidden"
                            >
                              <p className="text-xs font-medium text-primary">
                                {message.replied_message.sender?.display_name || message.replied_message.sender?.username || "Unknown"}
                              </p>
                              <p className="text-xs truncate text-muted-foreground min-w-0">
                                {message.replied_message.content || "[Image]"}
                              </p>
                            </button>
                          )}
                          {message.image_url && (() => {
                            let mediaUrls: string[] = [];
                            try {
                              const parsed = JSON.parse(message.image_url);
                              mediaUrls = Array.isArray(parsed) ? parsed : [message.image_url];
                            } catch {
                              mediaUrls = [message.image_url];
                            }

                            const audioMessages = mediaUrls.filter(url => url.startsWith('audio:'));
                            const videos = mediaUrls.filter(url => url.startsWith('video:'));
                            const musicItems = mediaUrls.filter(url => url.startsWith('music:'));
                            const fileItems = mediaUrls.filter(url => url.startsWith('file:'));
                            const expiredItems = mediaUrls.filter(url => url.startsWith('expired:'));
                            const images = mediaUrls.filter(url =>
                              !url.startsWith('video:') &&
                              !url.startsWith('audio:') &&
                              !url.startsWith('music:') &&
                              !url.startsWith('file:') &&
                              !url.startsWith('expired:')
                            );

                            const getImageGridClass = (count: number) => {
                              if (count === 1) return '';
                              if (count === 2) return 'grid grid-cols-2 gap-1';
                              if (count === 3) return 'grid grid-cols-2 gap-1';
                              return 'grid grid-cols-2 gap-1';
                            };

                            const getImageSizeClass = (count: number, idx: number, isMobileView: boolean) => {
                              if (count === 1) return 'max-w-full max-h-64 rounded-lg';
                              if (count === 2) return `w-full ${isMobileView ? 'h-28' : 'h-32'} object-cover rounded-lg`;
                              if (count === 3 && idx === 0) return `w-full ${isMobileView ? 'h-36' : 'h-40'} object-cover rounded-lg col-span-2`;
                              if (count === 3) return `w-full ${isMobileView ? 'h-24' : 'h-28'} object-cover rounded-lg`;
                              if (count === 4) return `w-full ${isMobileView ? 'h-24' : 'h-28'} object-cover rounded-lg`;
                              if (count > 4 && idx < 3) return `w-full ${isMobileView ? 'h-24' : 'h-28'} object-cover rounded-lg`;
                              if (count > 4 && idx === 3) return `w-full ${isMobileView ? 'h-24' : 'h-28'} object-cover rounded-lg`;
                              return `w-full ${isMobileView ? 'h-24' : 'h-28'} object-cover rounded-lg`;
                            };

                            const displayImages = images.length > 4 ? images.slice(0, 4) : images;
                            const remainingCount = images.length - 4;

                            return (
                              <div className="mb-2 space-y-2 w-full max-w-full md:max-w-md overflow-hidden">
                                {audioMessages.map((audioData, idx) => {
                                  const withoutPrefix = audioData.slice(6);
                                  const lastColonIndex = withoutPrefix.lastIndexOf(':');
                                  const audioUrl = lastColonIndex > 0 ? withoutPrefix.slice(0, lastColonIndex) : withoutPrefix;
                                  const duration = lastColonIndex > 0 ? parseInt(withoutPrefix.slice(lastColonIndex + 1)) : undefined;
                                  return (
                                    <VoiceMessagePlayer
                                      key={`audio-${idx}`}
                                      url={audioUrl}
                                      duration={duration}
                                      isOwn={false}
                                    />
                                  );
                                })}

                                {videos.map((url, idx) => {
                                  const videoUrl = url.replace('video:', '');
                                  return (
                                    <div
                                      key={`video-${idx}`}
                                      className="relative rounded-lg overflow-hidden cursor-pointer max-w-full"
                                      onClick={() => setVideoLightboxUrl(videoUrl)}
                                    >
                                      <video
                                        src={videoUrl}
                                        className="w-full max-w-full max-h-48 rounded-lg object-contain"
                                        muted
                                        playsInline
                                        preload="metadata"
                                      />
                                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/20 transition-colors">
                                        <div className="bg-white/90 rounded-full p-3">
                                          <Play className="h-6 w-6 text-black fill-black" />
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}

                                {images.length > 0 && (
                                  <div className={`${getImageGridClass(images.length)} max-w-full overflow-hidden`}>
                                    {displayImages.map((url, idx) => (
                                      <div
                                        key={idx}
                                        className={`relative ${images.length === 3 && idx === 0 ? 'col-span-2' : ''}`}
                                      >
                                        <ChatImage
                                          src={url}
                                          alt={`Shared image ${idx + 1}`}
                                          className={`cursor-pointer hover:opacity-90 transition-opacity ${getImageSizeClass(images.length, idx, isMobile)}`}
                                          onClick={() => {
                                            setLightboxImages(images);
                                            setLightboxIndex(idx);
                                          }}
                                        />
                                        {images.length > 4 && idx === 3 && remainingCount > 0 && (
                                          <div
                                            className="absolute inset-0 bg-black/60 rounded-lg flex items-center justify-center cursor-pointer"
                                            onClick={() => {
                                              setLightboxImages(images);
                                              setLightboxIndex(3);
                                            }}
                                          >
                                            <span className="text-white text-lg font-semibold">+{remainingCount}</span>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {musicItems.map((item, idx) => {
                                  const meta = decodeMusic(item);
                                  if (!meta) return null;
                                  return <MessageMusicPlayer key={`music-${idx}`} meta={meta} />;
                                })}

                                {fileItems.map((item, idx) => {
                                  const meta = decodeFile(item);
                                  if (!meta) return null;
                                  return <MessageFileCard key={`file-${idx}`} meta={meta} />;
                                })}

                                {expiredItems.map((item, idx) => (
                                  <div
                                    key={`expired-${idx}`}
                                    className="flex items-center gap-2 sm:gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-2 sm:px-3 py-2 max-w-full md:max-w-md overflow-hidden"
                                    title="This attachment was automatically removed after 14 days"
                                  >
                                    <img
                                      src={EXPIRED_ATTACHMENT_IMG}
                                      alt="Attachment expired"
                                      width={40}
                                      height={40}
                                      loading="lazy"
                                      className="h-10 w-10 rounded-md object-cover"
                                    />
                                    <div className="text-xs text-muted-foreground min-w-0">
                                      Attachment expired
                                      <div className="text-[10px] opacity-70">
                                        Files are deleted after 14 days.
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          {message.content && renderMessageBody(message)}

                        </div>

                        {Object.keys(groupedReactions).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5 max-w-full">
                            {Object.entries(groupedReactions).map(([emoji, data]) => {
                              const reacted = data.userIds.includes(user?.id || "");
                              return (
                                <button
                                  key={emoji}
                                  onClick={() => toggleReaction(message.id, emoji)}
                                  className={`inline-flex items-center justify-center gap-1 min-w-[44px] h-8 px-2 rounded-lg border text-sm font-medium transition-colors ${
                                    reacted
                                      ? "border-[#5865f2] text-foreground"
                                      : "bg-muted border-border hover:bg-muted/80"
                                  }`}
                                  style={reacted ? { backgroundColor: "#1a1d41" } : undefined}
                                >
                                  <span className="text-base leading-none">{emoji}</span>
                                  <span className="text-xs tabular-nums">{data.count}</span>
                                </button>
                              );
                            })}
                            <Popover
                              open={openEmojiPopover === `inline-${message.id}`}
                              onOpenChange={(open) => setOpenEmojiPopover(open ? `inline-${message.id}` : null)}
                            >
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center min-w-[44px] h-8 px-2 rounded-lg border border-border bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                                  title="Add reaction"
                                >
                                  <SmilePlus className="h-4 w-4" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0 border-none" side="top">
                                <EmojiPickerPanel
                                  onSelect={(emoji) => {
                                    toggleReaction(message.id, emoji);
                                    setOpenEmojiPopover(null);
                                  }}
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                        )}
                      </div>

                      {isMobile ? null : (
                      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setReplyingTo(message)}
                          title="Reply"
                        >
                          <Reply className="h-4 w-4" />
                        </Button>
                        <Popover 
                          open={openEmojiPopover === message.id} 
                          onOpenChange={(open) => setOpenEmojiPopover(open ? message.id : null)}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                            >
                              <Smile className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0 border-none" side="top">
                            <EmojiPickerPanel
                              onSelect={(emoji) => {
                                toggleReaction(message.id, emoji);
                                setOpenEmojiPopover(null);
                              }}
                            />
                          </PopoverContent>
                        </Popover>

                        {(isOwn || isSuperAdmin) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => togglePin(message)}>
                                <Pin className="h-4 w-4 mr-2" />
                                {message.is_pinned ? "Unpin" : "Pin"}
                              </DropdownMenuItem>
                              {message.content && (
                                <DropdownMenuItem onClick={() => startEditing(message)}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit {!isOwn && isSuperAdmin && "(Mod)"}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => setDeleteMessageId(message.id)}
                                className="text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete {!isOwn && isSuperAdmin && "(Mod)"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                      )}
                    </div>
                  )}
                </div>
                </div>
              </div>
            );

          }))()}
          {isOtherUserTyping && (
            <div className="flex gap-3">
              <Avatar className="h-8 w-8 flex-shrink-0">
                <AvatarImage src={otherUser?.avatar_url || undefined} />
                <AvatarFallback>{otherUser?.username?.[0]?.toUpperCase() || "?"}</AvatarFallback>
              </Avatar>
              <div className="bg-muted rounded-lg px-4 py-2">
                <div className="flex gap-1">
                  <span
                    className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            </div>
          )}
          <div className="flex-1" />
          <div ref={scrollRef} />
        </div>
        {showScrollButton && (
          <Button
            size="icon"
            variant="secondary"
            className="absolute bottom-4 right-4 rounded-full shadow-lg h-10 w-10 z-10"
            onClick={() => scrollToBottom("smooth")}
          >
            <ArrowDown className="h-5 w-5" />
          </Button>
        )}
      </ScrollArea>

      <form onSubmit={sendMessage} className="mx-2 mt-2 mb-[max(0.5rem,env(safe-area-inset-bottom))] sm:m-3 sm:mt-0 p-3 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xl shadow-[0_4px_20px_-8px_hsl(var(--foreground)/0.15)] flex-shrink-0">
        {!canPost ? (
          <div className="text-center text-sm text-muted-foreground py-2">
            Only admins can post in this channel.
          </div>
        ) : null}
        {canPost && replyingTo && (
          <div className="flex items-center gap-2 mb-2 p-2 bg-muted rounded-lg">
            <Reply className="h-4 w-4 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-primary">
                Replying to {replyingTo.sender?.display_name || replyingTo.sender?.username || "Unknown"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {replyingTo.content || "[Image]"}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6 flex-shrink-0"
              onClick={() => setReplyingTo(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        {!canPost ? null : voiceRecorder.isRecording || uploadingVoice ? (
          <VoiceRecordingIndicator
            isRecording={voiceRecorder.isRecording}
            duration={voiceRecorder.formattedDuration}
            audioLevel={voiceRecorder.audioLevel}
            onCancel={voiceRecorder.cancelRecording}
            onStop={voiceRecorder.stopRecording}
            isUploading={uploadingVoice}
          />
        ) : (
          <div className="flex flex-col gap-1">
            {mediaPreviews.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {mediaPreviews.map((preview, index) => (
                  <div key={index} className="relative flex-shrink-0">
                    {preview.type === "video" ? (
                      <div className="relative w-20 h-20 bg-muted rounded-lg overflow-hidden">
                        <video src={preview.url} className="w-full h-full object-cover" muted />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <Play className="h-5 w-5 text-white" />
                        </div>
                      </div>
                    ) : preview.type === "image" ? (
                      <img
                        src={preview.url}
                        alt={`Attachment ${index + 1}`}
                        className="w-20 h-20 object-cover rounded-lg"
                      />
                    ) : (
                      <div
                        className="w-20 h-20 bg-muted rounded-lg flex flex-col items-center justify-center px-1 text-center"
                        title={preview.file.name}
                      >
                        {preview.type === "music" ? (
                          <Music className="h-6 w-6 text-primary mb-1" />
                        ) : (
                          <FileText className="h-6 w-6 text-primary mb-1" />
                        )}
                        <span className="text-[10px] leading-tight truncate w-full">
                          {preview.file.name}
                        </span>
                      </div>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      className="absolute -top-1 -right-1 h-5 w-5 rounded-full"
                      onClick={() => removePreview(index)}
                      disabled={uploadingMedia}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {messages.length === 0 && !loading && showQuickPresets && (
              <div className="flex flex-wrap gap-2 pb-1">
                {[
                  ...(isDM && otherUser
                    ? [`Hey ${otherUser.display_name || otherUser.username}! 👋`]
                    : []),
                  "Hello! How's it going?",
                  "Nice to meet you!",
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setNewMessage(preset)}
                    className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70 border border-border transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="*/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingMedia || uploadingVoice}
            >
              {uploadingMedia ? (
                <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </Button>
            {canPost && (
              <CreatePollDialog
                channel={isDM ? "dm" : isAnnouncements ? "announcement" : "global"}
                conversationId={conversationIdProp}
                messagesTable={messagesTable}
                trigger={
                  <Button type="button" size="icon" variant="ghost" title="Create poll">
                    <BarChart3 className="h-4 w-4" />
                  </Button>
                }
              />
            )}
            <AutoResizeTextarea
              ref={textareaRef}
              placeholder="Type a message..."
              value={newMessage}
              maxRows={23}
              onChange={(e) => {
                const next = unlimitedChars
                  ? e.target.value
                  : e.target.value.slice(0, MAX_MESSAGE_CHARS);
                setNewMessage(next);
                // Detect @mention trigger based on caret position
                const caret = e.target.selectionStart ?? next.length;
                const before = next.slice(0, caret);
                const m = before.match(/(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{0,32})$/);
                if (m) {
                  setMentionState({
                    start: caret - m[1].length - 1, // position of `@`
                    query: m[1],
                  });
                } else {
                  setMentionState(null);
                }
                if (next.trim()) {
                  handleTyping();
                }
              }}
              onKeyUp={(e) => {
                const el = e.currentTarget;
                const caret = el.selectionStart ?? el.value.length;
                const before = el.value.slice(0, caret);
                const m = before.match(/(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{0,32})$/);
                if (m) {
                  setMentionState({ start: caret - m[1].length - 1, query: m[1] });
                } else if (mentionState) {
                  setMentionState(null);
                }
              }}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                // Forward keys to mention popover when open
                if (mentionState && mentionKeyHandlerRef.current) {
                  const consumed = mentionKeyHandlerRef.current(e.nativeEvent);
                  if (consumed) return;
                }
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !isMobile &&
                  !(e.nativeEvent as KeyboardEvent).isComposing
                ) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                }
              }}
              className="flex-1 min-h-[40px] py-2"
            />
            {mentionState && (
              <MentionAutocomplete
                query={mentionState.query}
                scope={isDM ? "dm" : isAnnouncements ? "announcements" : "global"}
                dmMembers={dmMembers}
                allowEveryone={isAdmin || isSuperAdmin}
                anchorEl={textareaRef.current}
                registerKeyHandler={(h) => {
                  mentionKeyHandlerRef.current = h;
                }}
                onDismiss={() => setMentionState(null)}
                onSelect={(value) => {
                  const start = mentionState.start;
                  const queryLen = mentionState.query.length;
                  const before = newMessage.slice(0, start);
                  const after = newMessage.slice(start + 1 + queryLen);
                  const insert = `@${value} `;
                  const next = before + insert + after;
                  setNewMessage(next);
                  setMentionState(null);
                  // Restore caret right after the inserted mention
                  requestAnimationFrame(() => {
                    const el = textareaRef.current;
                    if (!el) return;
                    const caret = before.length + insert.length;
                    el.focus();
                    el.setSelectionRange(caret, caret);
                  });
                }}
              />
            )}

            {newMessage.trim() || mediaPreviews.length > 0 ? (
              <Button type="submit" size="icon" disabled={loading || uploadingMedia}>
                <Send className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={voiceRecorder.startRecording}
                disabled={uploadingVoice}
                className="text-primary hover:text-primary hover:bg-primary/10"
              >
                {uploadingVoice ? (
                  <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            )}
            </div>
            {!unlimitedChars && (
              <div
                className={`text-[10px] self-end pr-1 tabular-nums ${
                  newMessage.length >= MAX_MESSAGE_CHARS
                    ? "text-destructive"
                    : newMessage.length >= MAX_MESSAGE_CHARS - 100
                    ? "text-amber-500"
                    : "text-muted-foreground"
                }`}
              >
                {newMessage.length}/{MAX_MESSAGE_CHARS}
              </div>
            )}
          </div>
        )}
      </form>



      <AlertDialog open={!!deleteMessageId} onOpenChange={() => setDeleteMessageId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The message will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteMessage}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lightbox for viewing images */}
      <Dialog open={lightboxImages.length > 0} onOpenChange={() => setLightboxImages([])}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black/95 border-none">
          <div className="relative flex items-center justify-center min-h-[50vh]">
            {/* Close button */}
            <Button
              size="icon"
              variant="ghost"
              className="absolute top-2 right-2 z-10 text-white hover:bg-white/20"
              onClick={() => setLightboxImages([])}
            >
              <X className="h-6 w-6" />
            </Button>

            {/* Image counter */}
            {lightboxImages.length > 1 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/80 text-sm bg-black/50 px-3 py-1 rounded-full">
                {lightboxIndex + 1} / {lightboxImages.length}
              </div>
            )}

            {/* Previous button */}
            {lightboxImages.length > 1 && (
              <Button
                size="icon"
                variant="ghost"
                className="absolute left-2 text-white hover:bg-white/20 h-12 w-12"
                onClick={() => setLightboxIndex((prev) => (prev - 1 + lightboxImages.length) % lightboxImages.length)}
              >
                <ChevronLeft className="h-8 w-8" />
              </Button>
            )}

            {/* Main image */}
            <img
              src={lightboxImages[lightboxIndex]}
              alt={`Image ${lightboxIndex + 1}`}
              className="max-w-full max-h-[85vh] object-contain"
            />

            {/* Next button */}
            {lightboxImages.length > 1 && (
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-2 text-white hover:bg-white/20 h-12 w-12"
                onClick={() => setLightboxIndex((prev) => (prev + 1) % lightboxImages.length)}
              >
                <ChevronRight className="h-8 w-8" />
              </Button>
            )}

            {/* Thumbnail strip */}
            {lightboxImages.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                {lightboxImages.map((url, idx) => (
                  <button
                    key={idx}
                    onClick={() => setLightboxIndex(idx)}
                    className={`w-12 h-12 rounded overflow-hidden border-2 transition-all ${
                      idx === lightboxIndex ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Video Lightbox */}
      <Dialog open={!!videoLightboxUrl} onOpenChange={() => setVideoLightboxUrl(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black/95 border-none">
          <div className="relative flex items-center justify-center min-h-[50vh]">
            <Button
              size="icon"
              variant="ghost"
              className="absolute top-2 right-2 z-10 text-white hover:bg-white/20"
              onClick={() => setVideoLightboxUrl(null)}
            >
              <X className="h-6 w-6" />
            </Button>
            {videoLightboxUrl && (
              <video
                src={videoLightboxUrl}
                controls
                autoPlay
                className="max-w-full max-h-[85vh] rounded-lg"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <UserProfileDialog
        userId={profileUserId}
        onOpenChange={(open) => !open && setProfileUserId(null)}
      />

      {isDM && isGroupConv && conversationIdProp && (
        <GroupSettingsDialog
          open={groupSettingsOpen}
          onOpenChange={setGroupSettingsOpen}
          conversationId={conversationIdProp}
          initialName={groupInfo.name}
          onChanged={() => {
            void fetchOtherUser();
          }}
          onLeft={() => {
            // Reuse the friend-removed event to clear active conversation in ChatLayout.
            window.dispatchEvent(
              new CustomEvent("friend-removed", {
                detail: { conversationId: conversationIdProp },
              }),
            );
          }}
        />
      )}

      {/* Mobile long-press action sheet */}
      <Sheet open={!!mobileActionMessage} onOpenChange={(open) => !open && setMobileActionMessage(null)}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)] border-t border-border max-h-[80vh]"
        >
          {mobileActionMessage && (() => {
            const m = mobileActionMessage;
            const own = m.sender_id === user?.id;
            const close = () => setMobileActionMessage(null);
            return (
              <div className="flex flex-col">
                {/* Reactions row */}
                <div className="flex justify-around items-center px-3 pt-5 pb-3">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        toggleReaction(m.id, emoji);
                        close();
                      }}
                      className="text-2xl rounded-full w-11 h-11 flex items-center justify-center hover:bg-muted active:scale-95 transition-all"
                    >
                      {emoji}
                    </button>
                  ))}
                  <Popover
                    open={openEmojiPopover === `mobile-${m.id}`}
                    onOpenChange={(open) => setOpenEmojiPopover(open ? `mobile-${m.id}` : null)}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="text-2xl rounded-full w-11 h-11 flex items-center justify-center hover:bg-muted active:scale-95 transition-all text-muted-foreground"
                        title="More emojis"
                      >
                        <SmilePlus className="h-6 w-6" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 border-none" side="top">
                      <EmojiPickerPanel
                        onSelect={(emoji) => {
                          toggleReaction(m.id, emoji);
                          setOpenEmojiPopover(null);
                          close();
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="h-px bg-border/60 mx-3" />

                {/* Action list */}
                <div className="flex flex-col py-2">
                  {canPost && (
                    <button
                      type="button"
                      onClick={() => { setReplyingTo(m); close(); }}
                      className="flex items-center gap-3 px-5 py-3 text-left hover:bg-muted active:bg-muted/80 transition-colors"
                    >
                      <Reply className="h-5 w-5 text-muted-foreground" />
                      <span className="text-base">Reply</span>
                    </button>
                  )}
                  {m.content && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(m.content);
                          toast({ title: "Copied to clipboard" });
                        } catch {
                          toast({ title: "Could not copy", variant: "destructive" });
                        }
                        close();
                      }}
                      className="flex items-center gap-3 px-5 py-3 text-left hover:bg-muted active:bg-muted/80 transition-colors"
                    >
                      <Copy className="h-5 w-5 text-muted-foreground" />
                      <span className="text-base">Copy text</span>
                    </button>
                  )}
                  {(own || isSuperAdmin) && m.content && (
                    <button
                      type="button"
                      onClick={() => { startEditing(m); close(); }}
                      className="flex items-center gap-3 px-5 py-3 text-left hover:bg-muted active:bg-muted/80 transition-colors"
                    >
                      <Pencil className="h-5 w-5 text-muted-foreground" />
                      <span className="text-base">Edit message{!own && isSuperAdmin && " (Mod)"}</span>
                    </button>
                  )}
                  {supportsPinning && (own || isSuperAdmin) && (
                    <button
                      type="button"
                      onClick={() => { togglePin(m); close(); }}
                      className="flex items-center gap-3 px-5 py-3 text-left hover:bg-muted active:bg-muted/80 transition-colors"
                    >
                      <Pin className="h-5 w-5 text-muted-foreground" />
                      <span className="text-base">{m.is_pinned ? "Unpin message" : "Pin message"}</span>
                    </button>
                  )}
                  {(own || isSuperAdmin) && (
                    <button
                      type="button"
                      onClick={() => { setDeleteMessageId(m.id); close(); }}
                      className="flex items-center gap-3 px-5 py-3 text-left text-destructive hover:bg-destructive/10 active:bg-destructive/20 transition-colors"
                    >
                      <Trash2 className="h-5 w-5" />
                      <span className="text-base">Delete message{!own && isSuperAdmin && " (Mod)"}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>

  );
}
