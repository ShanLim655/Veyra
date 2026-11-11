import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface PresenceState {
  odataclause: string;
  user_id: string;
  online_at: string;
  typing_in?: string;
  typing_until?: number;
}

export function usePresence(conversationId: string | null) {
  const { user } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingExpiryRef = useRef(new Map<string, number>());
  const trackQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!user || !conversationId) {
      channelRef.current = null;
      typingExpiryRef.current.clear();
      setOnlineUsers(new Set());
      setTypingUsers(new Set());
      return;
    }

    setOnlineUsers(new Set());
    setTypingUsers(new Set());
    typingExpiryRef.current.clear();

    const channel = supabase.channel(`presence:${conversationId}`);
    let active = true;
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const online = new Set<string>();
        const typing = new Set<string>();
        const expiry = new Map<string, number>();

        Object.values(state as Record<string, PresenceState[]>).forEach((presences) => {
          presences.forEach((presence: PresenceState) => {
            if (presence.user_id !== user.id) {
              online.add(presence.user_id);
              if (presence.typing_in === conversationId && (presence.typing_until || 0) > Date.now()) {
                typing.add(presence.user_id);
                expiry.set(presence.user_id, Math.max(expiry.get(presence.user_id) || 0, presence.typing_until || 0));
              }
            }
          });
        });

        setOnlineUsers(online);
        typingExpiryRef.current = expiry;
        setTypingUsers(typing);
      })
      .subscribe(async (status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          try {
            await channel.track({
              user_id: user.id,
              online_at: new Date().toISOString(),
              typing_until: 0,
            });
          } catch (error) {
            console.warn("Conversation presence tracking failed:", error);
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          typingExpiryRef.current.clear();
          setOnlineUsers(new Set());
          setTypingUsers(new Set());
        }
      });

    const expiryTimer = window.setInterval(() => {
      const now = Date.now();
      setTypingUsers((previous) => {
        const current = new Set([...previous].filter((id) => (typingExpiryRef.current.get(id) || 0) > now));
        if (current.size !== previous.size) return current;
        return previous;
      });
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(expiryTimer);
      typingExpiryRef.current.clear();
      if (channelRef.current === channel) channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [user, conversationId]);

  const setTyping = useCallback(
    async (isTyping: boolean) => {
      const channel = channelRef.current;
      if (!user || !conversationId || !channel) return;

      const payload = {
        user_id: user.id,
        online_at: new Date().toISOString(),
        typing_in: isTyping ? conversationId : null,
        typing_until: isTyping ? Date.now() + 5000 : 0,
      };
      trackQueueRef.current = trackQueueRef.current.catch(() => undefined).then(async () => {
        if (channelRef.current === channel) await channel.track(payload);
      }).catch((error) => {
        console.warn("Conversation presence update failed:", error);
      });
      await trackQueueRef.current;
    },
    [user, conversationId]
  );

  return { onlineUsers, typingUsers, setTyping };
}

let globalPresenceChannel: ReturnType<typeof supabase.channel> | null = null;
let globalPresenceUserId: string | null = null;
let globalOnlineUsersSet = new Set<string>();
const globalPresenceListeners = new Set<(users: Set<string>) => void>();

function publishGlobalPresence(users: Set<string>) {
  globalOnlineUsersSet = users;
  globalPresenceListeners.forEach((listener) => listener(new Set(users)));
}

async function stopGlobalPresence(channel: ReturnType<typeof supabase.channel>) {
  if (globalPresenceChannel !== channel || globalPresenceListeners.size > 0) return;
  globalPresenceChannel = null;
  globalPresenceUserId = null;
  publishGlobalPresence(new Set());
  await supabase.removeChannel(channel);
}

export function useGlobalPresence() {
  const { user } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(globalOnlineUsersSet);

  useEffect(() => {
    if (!user) {
      setOnlineUsers(new Set());
      return;
    }

    const listener = (users: Set<string>) => setOnlineUsers(new Set(users));
    globalPresenceListeners.add(listener);

    if (!globalPresenceChannel) {
      const channel = supabase.channel("global-presence");
      globalPresenceChannel = channel;
      globalPresenceUserId = user.id;

      channel
        .on("presence", { event: "sync" }, () => {
          const online = new Set<string>();
          Object.values(channel.presenceState() as Record<string, Array<{ user_id?: string }>>).forEach((presences) => {
            presences.forEach((presence: { user_id?: string }) => {
              if (presence.user_id) online.add(presence.user_id);
            });
          });
          publishGlobalPresence(online);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED" && globalPresenceChannel === channel) {
            try {
              await channel.track({
                user_id: user.id,
                online_at: new Date().toISOString(),
              });
            } catch (error) {
              console.warn("Global presence tracking failed:", error);
            }
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            if (globalPresenceChannel === channel) publishGlobalPresence(new Set());
          }
        });
    } else if (globalPresenceUserId !== user.id) {
      globalPresenceUserId = user.id;
      void globalPresenceChannel.track({
        user_id: user.id,
        online_at: new Date().toISOString(),
      }).catch((error) => console.warn("Global presence tracking failed:", error));
    }

    setOnlineUsers(new Set(globalOnlineUsersSet));

    return () => {
      globalPresenceListeners.delete(listener);
      const channel = globalPresenceChannel;
      if (channel && globalPresenceListeners.size === 0) void Promise.resolve().then(() => stopGlobalPresence(channel));
    };
  }, [user]);

  return { onlineUsers };
}
