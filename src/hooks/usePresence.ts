import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface PresenceState {
  odataclause: string;
  user_id: string;
  online_at: string;
  typing_in?: string;
}

export function usePresence(conversationId: string | null) {
  const { user } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !conversationId) return;

    const channel = supabase.channel(`presence:${conversationId}`);

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const online = new Set<string>();
        const typing = new Set<string>();

        Object.values(state).forEach((presences: any) => {
          presences.forEach((presence: PresenceState) => {
            if (presence.user_id !== user.id) {
              online.add(presence.user_id);
              if (presence.typing_in === conversationId) {
                typing.add(presence.user_id);
              }
            }
          });
        });

        setOnlineUsers(online);
        setTypingUsers(typing);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: user.id,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, conversationId]);

  const setTyping = useCallback(
    async (isTyping: boolean) => {
      if (!user || !conversationId) return;

      const channel = supabase.channel(`presence:${conversationId}`);
      await channel.track({
        user_id: user.id,
        online_at: new Date().toISOString(),
        typing_in: isTyping ? conversationId : undefined,
      });
    },
    [user, conversationId]
  );

  return { onlineUsers, typingUsers, setTyping };
}

let globalPresenceChannel: ReturnType<typeof supabase.channel> | null = null;
let globalOnlineUsersSet = new Set<string>();
let globalPresenceListeners = new Set<(users: Set<string>) => void>();

export function useGlobalPresence() {
  const { user } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(globalOnlineUsersSet);

  useEffect(() => {
    if (!user) return;
    const listener = (users: Set<string>) => setOnlineUsers(new Set(users));
    globalPresenceListeners.add(listener);
    if (!globalPresenceChannel) {
      globalPresenceChannel = supabase.channel("global-presence");

      globalPresenceChannel
        .on("presence", { event: "sync" }, () => {
          const state = globalPresenceChannel!.presenceState();
          const online = new Set<string>();

          Object.values(state).forEach((presences: any) => {
            presences.forEach((presence: { user_id: string }) => {
              online.add(presence.user_id);
            });
          });

          globalOnlineUsersSet = online;
          globalPresenceListeners.forEach((l) => l(online));
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await globalPresenceChannel!.track({
              user_id: user.id,
              online_at: new Date().toISOString(),
            });
          }
        });
    } else {
      globalPresenceChannel.track({
        user_id: user.id,
        online_at: new Date().toISOString(),
      });
    }

    setOnlineUsers(new Set(globalOnlineUsersSet));

    return () => {
      globalPresenceListeners.delete(listener);
    };
  }, [user]);

  return { onlineUsers };
}
