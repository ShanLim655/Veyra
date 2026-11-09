import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useGlobalPresence } from "@/hooks/usePresence";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { toast } from "@/hooks/use-toast";
import { UserPlus, Check, X, Settings, Globe, Megaphone, MoreVertical, UserMinus, Loader2, Shield, ShieldAlert, Pin, PinOff, Users, Plus } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { UserProfileDialog } from "@/components/profile/UserProfileDialog";
import { markAnnouncementsRead } from "@/lib/announcements";
import { getCachedDmList, setCachedDmList } from "@/lib/chatCache";
import { isStatusActive } from "@/lib/customStatus";
import { CreateGroupDialog } from "@/components/chat/CreateGroupDialog";
import { GroupAvatar, type GroupAvatarMember } from "@/components/chat/GroupAvatar";

interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string | null;
  custom_status_text?: string | null;
  custom_status_emoji?: string | null;
  custom_status_expires_at?: string | null;
}

interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: string;
  sender?: Profile;
  receiver?: Profile;
}

interface Conversation {
  id: string;
  is_group: boolean;
  other_user?: Profile;
  unread_count?: number;
  friend_request_id?: string;
  last_message_at?: string;
  is_pinned?: boolean;
}

interface GroupEntry {
  id: string;
  name: string | null;
  member_count: number;
  my_role: "owner" | "admin" | "member";
  unread_count: number;
  last_message_at: string | null;
  is_pinned: boolean;
  member_previews: GroupAvatarMember[];
}

interface FriendsListProps {
  onSelectConversation: (conversationId: string) => void;
  selectedConversationId: string | null;
}

export function FriendsList({ onSelectConversation, selectedConversationId }: FriendsListProps) {
  const { user, signOut } = useAuth();
  const { isAdmin, isSuperAdmin } = useUserRole();
  const navigate = useNavigate();
  const { onlineUsers } = useGlobalPresence();
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [searchUsername, setSearchUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [showUnfriendDialog, setShowUnfriendDialog] = useState<Conversation | null>(null);
  const [unfriending, setUnfriending] = useState(false);
  const [unreadAnnouncementCount, setUnreadAnnouncementCount] = useState(0);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [profileOpenUserId, setProfileOpenUserId] = useState<string | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, status, custom_status_text, custom_status_emoji, custom_status_expires_at")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setMyProfile(data as Profile);
      });
  }, [user]);

  useEffect(() => {
    const onStatus = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || !user || d.userId !== user.id) return;
      setMyProfile((p) =>
        p
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
  }, [user]);



  const fetchUnreadAnnouncements = async () => {
    if (!user) return;

    // Read last-read timestamp from the user's profile (syncs across devices)
    const { data: profile } = await supabase
      .from("profiles")
      .select("announcements_last_read_at")
      .eq("id", user.id)
      .maybeSingle();

    const lastRead = profile?.announcements_last_read_at;

    let query = supabase
      .from("announcement_messages")
      .select("*", { count: "exact", head: true });

    if (lastRead) {
      query = query.gt("created_at", lastRead);
    }

    const { count } = await query;
    setUnreadAnnouncementCount(count || 0);
  };

  const fetchGroups = async () => {
    if (!user) return;
    const { data, error } = await supabase.rpc("get_user_group_list");
    if (error) {
      console.error("Error fetching groups:", error);
      return;
    }
    const mapped: GroupEntry[] = (data || []).map((row: any) => ({
      id: row.conversation_id,
      name: row.name ?? null,
      member_count: Number(row.member_count ?? 0),
      my_role: row.my_role,
      unread_count: Number(row.unread_count ?? 0),
      last_message_at: row.last_message_at ?? null,
      is_pinned: !!row.is_pinned,
      member_previews: Array.isArray(row.member_previews) ? row.member_previews : [],
    }));
    setGroups(mapped);
  };

  useEffect(() => {
    if (user) {
      // Hydrate from cache instantly so the sidebar renders without waiting
      // on the network, then refresh in the background.
      const cached = getCachedDmList<Conversation>(user.id);
      if (cached && cached.length > 0) setConversations(cached);
      fetchFriendRequests();
      fetchConversations();
      fetchGroups();
      fetchUnreadAnnouncements();
    }
  }, [user]);

  // Keep the cached DM list in sync with any local mutations (pin toggles,
  // unfriend, unread updates from realtime, etc.).
  useEffect(() => {
    if (!user) return;
    const h = setTimeout(() => setCachedDmList(user.id, conversations), 300);
    return () => clearTimeout(h);
  }, [user, conversations]);

  // Subscribe to new announcements
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("announcements-unread")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "announcement_messages",
        },
        () => {
          fetchUnreadAnnouncements();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Clear announcement badge when read from another component (e.g. ChatView)
  useEffect(() => {
    const handler = () => setUnreadAnnouncementCount(0);
    window.addEventListener("announcements-read", handler);
    return () => window.removeEventListener("announcements-read", handler);
  }, []);

  const fetchFriendRequests = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from("friend_requests")
      .select("*")
      .eq("status", "pending")
      .eq("receiver_id", user.id);

    if (error) {
      console.error("Error fetching friend requests:", error);
      return;
    }

    const requestsWithProfiles = await Promise.all(
      (data || []).map(async (request) => {
        const { data: senderData } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", request.sender_id)
          .single();
        return { ...request, sender: senderData };
      })
    );

    setFriendRequests(requestsWithProfiles);
  };

  const fetchConversations = async () => {
    if (!user) return;

    const { data, error } = await supabase.rpc("get_user_dm_list");
    if (error) {
      console.error("Error fetching conversations:", error);
      return;
    }

    const mapped: Conversation[] = (data || []).map((row: any) => ({
      id: row.conversation_id,
      is_group: false,
      unread_count: Number(row.unread_count ?? 0),
      last_message_at: row.last_message_at,
      friend_request_id: row.friend_request_id ?? undefined,
      is_pinned: !!row.is_pinned,
      other_user: row.other_user_id
        ? {
            id: row.other_user_id,
            username: row.other_username,
            display_name: row.other_display_name,
            avatar_url: row.other_avatar_url,
            status: row.other_status,
            custom_status_text: row.other_custom_status_text ?? null,
            custom_status_emoji: row.other_custom_status_emoji ?? null,
            custom_status_expires_at: row.other_custom_status_expires_at ?? null,
          }
        : undefined,
    }));

    setConversations(mapped);
    if (user) setCachedDmList(user.id, mapped);
  };

  const togglePin = async (conv: Conversation) => {
    if (!user) return;
    // optimistic update
    setConversations((prev) => {
      const updated = prev.map((c) => (c.id === conv.id ? { ...c, is_pinned: !c.is_pinned } : c));
      return [...updated].sort((a, b) => {
        if (!!b.is_pinned !== !!a.is_pinned) return b.is_pinned ? 1 : -1;
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return tb - ta;
      });
    });
    if (conv.is_pinned) {
      const { error } = await supabase
        .from("pinned_conversations")
        .delete()
        .eq("user_id", user.id)
        .eq("conversation_id", conv.id);
      if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      const { error } = await supabase
        .from("pinned_conversations")
        .insert({ user_id: user.id, conversation_id: conv.id });
      if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const unfriend = async () => {
    if (!showUnfriendDialog || !user) return;
    setUnfriending(true);

    try {
      // Find and delete the friend request
      const otherId = showUnfriendDialog.other_user?.id;
      if (otherId) {
        const { error } = await supabase
          .from("friend_requests")
          .delete()
          .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${user.id})`);

        if (error) throw error;
      }

      // Remove from conversations
      await supabase
        .from("conversation_members")
        .delete()
        .eq("conversation_id", showUnfriendDialog.id)
        .eq("user_id", user.id);

      toast({ title: "Unfriended successfully" });
      setConversations((prev) =>
        prev.filter(
          (conv) => conv.id !== showUnfriendDialog.id && conv.other_user?.id !== otherId,
        ),
      );
      window.dispatchEvent(
        new CustomEvent("friend-removed", {
          detail: {
            otherUserId: showUnfriendDialog.other_user?.id,
            conversationId: showUnfriendDialog.id,
          },
        }),
      );
      setShowUnfriendDialog(null);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setUnfriending(false);
    }
  };

  // Subscribe to message changes to update unread counts (DMs + groups)
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("unread-messages")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
        },
        () => {
          fetchConversations();
          fetchGroups();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Live-refresh groups when membership changes (added/removed, role changes,
  // ownership transfers) or when a group is renamed.
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("group-membership-sidebar")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_members" },
        () => fetchGroups(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        () => fetchGroups(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  // Refresh when a friend is removed elsewhere (e.g. UserProfileDialog)
  useEffect(() => {
    let refreshTimer: number | null = null;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const removedConvId = detail.conversationId as string | null | undefined;
      const removedUserId = detail.otherUserId as string | null | undefined;
      setConversations((prev) =>
        prev.filter(
          (conv) =>
            (!removedConvId || conv.id !== removedConvId) &&
            (!removedUserId || conv.other_user?.id !== removedUserId),
        ),
      );
      fetchFriendRequests();
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(fetchConversations, 1000);
    };
    window.addEventListener("friend-removed", handler);
    return () => {
      window.removeEventListener("friend-removed", handler);
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, []);

  const sendFriendRequest = async () => {
    if (!user || !searchUsername.trim()) return;
    setLoading(true);

    try {
      const { data: targetUser, error: findError } = await supabase
        .from("profiles")
        .select("*")
        .eq("username", searchUsername.trim())
        .single();

      if (findError || !targetUser) {
        toast({ title: "User not found", variant: "destructive" });
        return;
      }

      if (targetUser.id === user.id) {
        toast({ title: "You can't add yourself", variant: "destructive" });
        return;
      }

      const { data: existingRequest } = await supabase
        .from("friend_requests")
        .select("*")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .or(`sender_id.eq.${targetUser.id},receiver_id.eq.${targetUser.id}`);

      // Only block if there's a pending or accepted relationship — a
      // previously rejected/cancelled row shouldn't prevent re-adding.
      const blocking = existingRequest?.find(
        (r) =>
          ((r.sender_id === user.id && r.receiver_id === targetUser.id) ||
            (r.sender_id === targetUser.id && r.receiver_id === user.id)) &&
          (r.status === "pending" || r.status === "accepted"),
      );

      if (blocking) {
        toast({
          title: blocking.status === "accepted"
            ? "You're already friends"
            : "Friend request already pending",
          variant: "destructive",
        });
        return;
      }

      // Clear any stale reverse-direction row so the unique constraint
      // can't block a fresh request after a prior rejection / unfriend.
      await supabase
        .from("friend_requests")
        .delete()
        .eq("sender_id", targetUser.id)
        .eq("receiver_id", user.id);

      const { error } = await supabase
        .from("friend_requests")
        .upsert(
          { sender_id: user.id, receiver_id: targetUser.id, status: "pending" },
          { onConflict: "sender_id,receiver_id" },
        );

      if (error) throw error;

      toast({ title: "Friend request sent!" });
      setSearchUsername("");
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleFriendRequest = async (requestId: string, accept: boolean) => {
    const { error } = await supabase
      .from("friend_requests")
      .update({ status: accept ? "accepted" : "rejected" })
      .eq("id", requestId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: accept ? "Friend added!" : "Request declined" });
    fetchFriendRequests();
    if (accept) {
      setTimeout(fetchConversations, 500);
    }
  };

  const isUserOnline = (userId: string) => onlineUsers.has(userId);

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="p-4">
        <h2 className="text-lg font-semibold text-sidebar-foreground mb-3">Chatt</h2>
        <div className="flex gap-2">
          <Input
            placeholder="Add friend by username"
            value={searchUsername}
            onChange={(e) => setSearchUsername(e.target.value)}
            className="text-sm"
            onKeyDown={(e) => e.key === "Enter" && sendFriendRequest()}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            name="friend-search"
            id="friend-search"
            data-lpignore="true"
            data-form-type="other"
          />
          <Button size="icon" onClick={sendFriendRequest} disabled={loading} aria-label="Send friend request">
            <UserPlus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {friendRequests.length > 0 && (
        <div className="p-4">
          <h3 className="text-sm font-medium text-sidebar-foreground mb-2">
            Friend Requests ({friendRequests.length})
          </h3>
          <div className="space-y-2">
            {friendRequests.map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between p-2 rounded-lg bg-sidebar-accent"
              >
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={request.sender?.avatar_url || undefined} />
                      <AvatarFallback>
                        {request.sender?.username?.[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    {request.sender && isUserOnline(request.sender.id) && (
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-sidebar-accent" />
                    )}
                  </div>
                  <span className="text-sm text-sidebar-accent-foreground">
                    {request.sender?.display_name || request.sender?.username}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => handleFriendRequest(request.id, true)}
                    aria-label="Accept friend request"
                  >
                    <Check className="h-4 w-4 text-green-500" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => handleFriendRequest(request.id, false)}
                    aria-label="Decline friend request"
                  >
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Announcements & Global Chat Buttons */}
      <div className="px-4 py-2 space-y-2">
        <Button
          variant="outline"
          className="w-full justify-between"
          onClick={() => {
            if (user?.id) {
              setUnreadAnnouncementCount(0);
              void markAnnouncementsRead(user.id).catch((error) =>
                console.error("Error marking announcements as read:", error),
              );
            }
            navigate("/announcements");
          }}
        >
          <span className="flex items-center gap-2">
            <Megaphone className="h-4 w-4" />
            Announcements
          </span>
          {unreadAnnouncementCount > 0 && (
            <Badge variant="default" className="h-5 min-w-5 flex items-center justify-center rounded-full px-1.5 text-xs">
              {unreadAnnouncementCount > 99 ? "99+" : unreadAnnouncementCount}
            </Badge>
          )}
        </Button>
        <Separator className="my-2" />
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => navigate("/global-chat")}
        >
          <Globe className="h-4 w-4" />
          Global Chat
        </Button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <ScrollArea className="flex-1">
          <div className="px-2 pb-2">
            <div className="flex items-center justify-between px-2 pt-3 pb-1">
              <h3 className="text-sm font-medium text-sidebar-foreground">Groups</h3>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setShowCreateGroup(true)}
                title="Create group"
                aria-label="Create new group chat"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                New
              </Button>
            </div>

            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2 px-3">
                No groups yet.
              </p>
            ) : (
              groups.map((g) => {
                const displayName =
                  g.name && g.name.trim().length > 0
                    ? g.name
                    : g.member_previews
                        .map((m) => m.display_name || m.username || "Member")
                        .slice(0, 3)
                        .join(", ");
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => onSelectConversation(g.id)}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-colors w-full text-left ${
                      selectedConversationId === g.id
                        ? "bg-sidebar-accent"
                        : "hover:bg-sidebar-accent/50"
                    }`}
                  >
                    <GroupAvatar members={g.member_previews} name={g.name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="font-medium text-sidebar-foreground truncate">
                          {displayName}
                        </p>
                        {g.is_pinned && (
                          <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {g.member_count} {g.member_count === 1 ? "member" : "members"}
                      </p>
                    </div>
                    {g.unread_count > 0 && (
                      <Badge variant="default" className="h-5 min-w-5 flex items-center justify-center rounded-full px-1.5 text-xs flex-shrink-0">
                        {g.unread_count > 99 ? "99+" : g.unread_count}
                      </Badge>
                    )}
                  </button>
                );
              })
            )}

            <h3 className="text-sm font-medium text-sidebar-foreground px-2 pt-4 pb-1">
              Direct Messages
            </h3>
            {conversations.map((conv) => {
              const isOnline = conv.other_user && isUserOnline(conv.other_user.id);
              return (
                <div
                  key={conv.id}
                  className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                    selectedConversationId === conv.id
                      ? "bg-sidebar-accent"
                      : "hover:bg-sidebar-accent/50"
                  }`}
                >
                  <button
                    onClick={() => onSelectConversation(conv.id)}
                    className="flex items-center gap-3 flex-1 min-w-0"
                  >
                    <div className="relative flex-shrink-0">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={conv.other_user?.avatar_url || undefined} />
                        <AvatarFallback>
                          {conv.other_user?.username?.[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span
                        className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-sidebar ${
                          isOnline ? "bg-green-500" : "bg-muted-foreground"
                        }`}
                      />
                    </div>
                    <div className="text-left flex-1 min-w-0">
                      <p className="font-medium text-sidebar-foreground truncate">
                        {conv.other_user?.display_name || conv.other_user?.username || "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isOnline ? "Online" : "Offline"}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {conv.is_pinned && (
                      <Pin className="h-3 w-3 text-muted-foreground" />
                    )}
                    {conv.unread_count && conv.unread_count > 0 ? (
                      <Badge variant="default" className="h-5 min-w-5 flex items-center justify-center rounded-full px-1.5 text-xs">
                        {conv.unread_count > 99 ? "99+" : conv.unread_count}
                      </Badge>
                    ) : null}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-0" align="end">
                        <div className="p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <Avatar className="h-12 w-12">
                              <AvatarImage src={conv.other_user?.avatar_url || undefined} />
                              <AvatarFallback>{conv.other_user?.username?.[0]?.toUpperCase() || "?"}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold truncate">{conv.other_user?.display_name || conv.other_user?.username}</p>
                              <p className="text-sm text-muted-foreground truncate">@{conv.other_user?.username}</p>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            className="w-full mb-2"
                            onClick={() => togglePin(conv)}
                          >
                            {conv.is_pinned ? (
                              <>
                                <PinOff className="h-4 w-4 mr-2" />
                                Unpin
                              </>
                            ) : (
                              <>
                                <Pin className="h-4 w-4 mr-2" />
                                Pin to top
                              </>
                            )}
                          </Button>
                          <Button 
                            variant="destructive" 
                            className="w-full" 
                            onClick={() => setShowUnfriendDialog(conv)}
                          >
                            <UserMinus className="h-4 w-4 mr-2" />
                            Unfriend
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              );
            })}
            {conversations.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8 px-3">
                No friends yet. Add someone above!
              </p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Admin Dashboard Link - shows for admins */}
      {isAdmin && (
        <div className="px-4 py-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => navigate("/admin")}
          >
            {isSuperAdmin ? (
              <ShieldAlert className="h-4 w-4 text-destructive" />
            ) : (
              <Shield className="h-4 w-4" />
            )}
            Admin Dashboard
            {isSuperAdmin && (
              <Badge variant="destructive" className="ml-auto text-[10px]">
                Super
              </Badge>
            )}
          </Button>
        </div>
      )}

      {/* Unfriend Dialog */}
      <AlertDialog open={!!showUnfriendDialog} onOpenChange={() => setShowUnfriendDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Unfriend {showUnfriendDialog?.other_user?.display_name || showUnfriendDialog?.other_user?.username}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove them from your friends list. You can send a new friend request later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unfriending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={unfriend}
              disabled={unfriending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {unfriending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Unfriend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="p-3">
        <div className="flex items-center gap-2 rounded-2xl border border-sidebar-border bg-sidebar-accent/60 backdrop-blur p-2 shadow-sm">
          <button
            type="button"
            onClick={() => user && setProfileOpenUserId(user.id)}
            className="block rounded-full focus:outline-none flex-shrink-0"
            aria-label="Open profile"
          >
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarImage src={myProfile?.avatar_url || undefined} />
              <AvatarFallback>
                {myProfile?.username?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          </button>
          <button
            type="button"
            onClick={() => user && setProfileOpenUserId(user.id)}
            className="flex flex-col flex-1 min-w-0 rounded-xl px-1 py-1 hover:bg-sidebar-accent transition-colors focus:outline-none text-left"
          >
            <span className="text-sm font-medium text-sidebar-foreground truncate">
              {myProfile?.display_name || myProfile?.username || "Profile"}
            </span>
            {isStatusActive(myProfile) && (
              <span className="text-xs text-muted-foreground truncate">
                {myProfile?.custom_status_emoji ? `${myProfile.custom_status_emoji} ` : ""}
                {myProfile?.custom_status_text}
              </span>
            )}
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground flex-shrink-0"
            onClick={() => navigate("/settings")}
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>


      <UserProfileDialog
        userId={profileOpenUserId}
        onOpenChange={(open) => !open && setProfileOpenUserId(null)}
      />

      <CreateGroupDialog
        open={showCreateGroup}
        onOpenChange={setShowCreateGroup}
        onCreated={(id) => {
          fetchGroups();
          onSelectConversation(id);
        }}
      />
    </div>
  );
}
