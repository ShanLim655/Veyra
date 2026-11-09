import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Tracks the current user's block list and exposes block/unblock helpers.
 * Blocking is silent — the blocked user is never notified.
 */
export function useBlockedUsers() {
  const { user } = useAuth();
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setBlockedIds(new Set());
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("blocked_users")
      .select("blocked_id")
      .eq("blocker_id", user.id);
    setBlockedIds(new Set((data || []).map((r: any) => r.blocked_id)));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
    if (!user) return;
    const channel = supabase
      .channel(`blocked_users:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "blocked_users", filter: `blocker_id=eq.${user.id}` },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, refresh]);

  const isBlocked = useCallback((id: string | null | undefined) => !!id && blockedIds.has(id), [blockedIds]);

  return { blockedIds, isBlocked, loading, refresh };
}
