import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageMarkdown } from "@/components/chat/MessageMarkdown";
import { CustomStatusBubble } from "@/components/chat/CustomStatusBubble";
import { stripBioHeadings } from "@/lib/bio";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, MessageSquare, UserPlus, UserCheck, UserX, Clock, Check, Ban, ShieldOff } from "lucide-react";

interface UserProfileDialogProps {
  userId: string | null;
  onOpenChange: (open: boolean) => void;
}

interface ProfileData {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  banner_gradient: string | null;
  created_at: string;
  bio: string | null;
  pronouns: string | null;
  status: string | null;
  allow_friend_requests: boolean | null;
  custom_status_text: string | null;
  custom_status_emoji: string | null;
  custom_status_expires_at: string | null;
}

type ParsedGradient = { enabled: boolean; from: string; to: string } | null;

function parseGradient(raw: string | null | undefined): ParsedGradient {
  if (!raw) return null;
  try {
    const g = JSON.parse(raw);
    if (typeof g?.from === "string" && typeof g?.to === "string") {
      return { enabled: !!g.enabled, from: g.from, to: g.to };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hexLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const toLin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

function shade(hex: string, pct: number): string {
  // pct -100..100 — negative darkens, positive lightens
  const target = pct < 0 ? "#000000" : "#ffffff";
  return mixHex(hex, target, Math.abs(pct) / 100);
}

function colorDistance(a: string, b: string): number {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

function buttonColors(
  base: string,
  gradActive: boolean,
  onLight: boolean,
  gradFrom?: string,
  gradTo?: string,
) {
  let bg = base;
  if (gradActive && gradFrom && gradTo) {
    // If too close to either gradient stop, nudge away
    const minDist = Math.min(colorDistance(bg, gradFrom), colorDistance(bg, gradTo));
    if (minDist < 90) {
      bg = mixHex(bg, onLight ? "#000000" : "#ffffff", 0.25);
    } else {
      // small contrast nudge
      bg = mixHex(bg, onLight ? "#000000" : "#ffffff", 0.08);
    }
  }
  const border = shade(bg, hexLuminance(bg) > 0.5 ? -18 : 22);
  const fg = hexLuminance(bg) > 0.6 ? "#0f0f0f" : "#ffffff";
  return { bg, border, fg };
}

type RelState =
  | "none"
  | "sent"
  | "received"
  | "friends"
  | "unavailable"
  | "requests_off"
  | "self"
  | "loading";

export function UserProfileDialog({ userId, onOpenChange }: UserProfileDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [rel, setRel] = useState<RelState>("loading");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [messagePending, setMessagePending] = useState(false);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [blockPending, setBlockPending] = useState(false);

  useEffect(() => {
    if (!userId || !user || userId === user.id) {
      setBlockedByMe(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("blocked_users")
      .select("id")
      .eq("blocker_id", user.id)
      .eq("blocked_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setBlockedByMe(!!data);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, user]);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setRel("loading");
      setRequestId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .from("profiles")
      .select(
        "id, username, display_name, avatar_url, banner_url, banner_gradient, created_at, bio, pronouns, status, allow_friend_requests, custom_status_text, custom_status_emoji, custom_status_expires_at",
      )
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setProfile(data as ProfileData | null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loadRelationship = useCallback(async () => {
    if (!userId || !user) return;
    if (userId === user.id) {
      setRel("self");
      return;
    }
    if (profile?.status === "deleted" || profile?.status === "blocked") {
      setRel("unavailable");
      return;
    }
    const { data, error } = await supabase
      .from("friend_requests")
      .select("id, sender_id, receiver_id, status")
      .or(
        `and(sender_id.eq.${user.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${user.id})`,
      )
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      setRel("none");
      setRequestId(null);
      return;
    }
    if (!data) {
      setRel(profile?.allow_friend_requests === false ? "requests_off" : "none");
      setRequestId(null);
      return;
    }
    setRequestId(data.id);
    if (data.status === "accepted") setRel("friends");
    else if (data.status === "pending") {
      setRel(data.sender_id === user.id ? "sent" : "received");
    } else {
      setRel(profile?.allow_friend_requests === false ? "requests_off" : "none");
    }
  }, [userId, user, profile?.status, profile?.allow_friend_requests]);

  useEffect(() => {
    if (profile && user) loadRelationship();
  }, [profile, user, loadRelationship]);

  const open = !!userId;
  const displayName = profile?.display_name || profile?.username || "User";
  const grad = parseGradient(profile?.banner_gradient);
  const gradActive = !!grad?.enabled;
  const gradientCss = grad ? `linear-gradient(0deg, ${grad.from}, ${grad.to})` : undefined;
  const avgLum = grad ? (hexLuminance(grad.from) + hexLuminance(grad.to)) / 2 : 1;
  const onLight = avgLum > 0.5;
  const textColor = gradActive ? (onLight ? "#000000" : "#ffffff") : undefined;
  const mutedTextColor = gradActive
    ? onLight
      ? "rgba(0,0,0,0.7)"
      : "rgba(255,255,255,0.75)"
    : undefined;
  const joined = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  // ---- Actions ----

  const sendRequest = async () => {
    if (!user || !userId || actionPending) return;
    setActionPending(true);
    const prev = rel;
    setRel("sent"); // optimistic

    // Clear any stale row in the reverse direction (e.g. a rejected request
    // they once sent us) so the unique constraint can't trip us up.
    await supabase
      .from("friend_requests")
      .delete()
      .eq("sender_id", userId)
      .eq("receiver_id", user.id);

    const { data, error } = await supabase
      .from("friend_requests")
      .upsert(
        { sender_id: user.id, receiver_id: userId, status: "pending" },
        { onConflict: "sender_id,receiver_id" },
      )
      .select("id")
      .single();
    if (error) {
      setRel(prev);
      toast.error(error.message || "Failed to send friend request");
    } else {
      setRequestId(data.id);
      toast.success("Friend request sent");
    }
    setActionPending(false);
  };

  const cancelRequest = async () => {
    if (!requestId || actionPending) return;
    setActionPending(true);
    const prev = rel;
    setRel("none");
    const { error } = await supabase.from("friend_requests").delete().eq("id", requestId);
    if (error) {
      setRel(prev);
      toast.error(error.message || "Failed to cancel");
    } else {
      setRequestId(null);
      toast.success("Request cancelled");
    }
    setActionPending(false);
  };

  const acceptRequest = async () => {
    if (!requestId || actionPending) return;
    setActionPending(true);
    const prev = rel;
    setRel("friends");
    const { error } = await supabase
      .from("friend_requests")
      .update({ status: "accepted" })
      .eq("id", requestId);
    if (error) {
      setRel(prev);
      toast.error(error.message || "Failed to accept");
    } else {
      toast.success("Friend added");
    }
    setActionPending(false);
  };

  // Remove any friendship/pending request and leave the shared DM. Shared by
  // both the Unfriend action and the Block action (block also unfriends).
  const removeFriendship = async () => {
    if (!user || !userId) return;
    let removedConversationId: string | null = null;
    try {
      const { data: list } = await supabase.rpc("get_user_dm_list");
      const existing = (list || []).find((r: any) => r.other_user_id === userId);
      removedConversationId = existing?.conversation_id ?? null;
    } catch {
      /* non-fatal */
    }

    const { error } = await supabase
      .from("friend_requests")
      .delete()
      .or(
        `and(sender_id.eq.${user.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${user.id})`,
      );
    if (error) throw error;

    if (removedConversationId) {
      try {
        await supabase
          .from("conversation_members")
          .delete()
          .eq("conversation_id", removedConversationId)
          .eq("user_id", user.id);
      } catch {
        /* non-fatal */
      }
    }

    window.dispatchEvent(
      new CustomEvent("friend-removed", {
        detail: { otherUserId: userId, conversationId: removedConversationId },
      }),
    );
  };

  const unfriend = async () => {
    if (!user || !userId || actionPending) return;
    setActionPending(true);
    const prev = rel;
    const prevId = requestId;
    setRel("none");
    setRequestId(null);
    try {
      await removeFriendship();
      toast.success("Removed friend");
    } catch (error: any) {
      setRel(prev);
      setRequestId(prevId);
      toast.error(error.message || "Failed to unfriend");
    } finally {
      setActionPending(false);
    }
  };

  const block = async () => {
    if (!user || !userId || blockPending) return;
    setBlockPending(true);
    try {
      // Blocking also unfriends (silent — they aren't notified).
      await removeFriendship().catch(() => {});
      const { error } = await supabase
        .from("blocked_users")
        .insert({ blocker_id: user.id, blocked_id: userId });
      if (error && !error.message.includes("duplicate")) throw error;
      setBlockedByMe(true);
      setRel("none");
      setRequestId(null);
      window.dispatchEvent(new CustomEvent("user-blocked", { detail: { userId } }));
      toast.success("User blocked");
    } catch (error: any) {
      toast.error(error.message || "Failed to block user");
    } finally {
      setBlockPending(false);
    }
  };

  const unblock = async () => {
    if (!user || !userId || blockPending) return;
    setBlockPending(true);
    try {
      const { error } = await supabase
        .from("blocked_users")
        .delete()
        .eq("blocker_id", user.id)
        .eq("blocked_id", userId);
      if (error) throw error;
      setBlockedByMe(false);
      window.dispatchEvent(new CustomEvent("user-unblocked", { detail: { userId } }));
      toast.success("User unblocked");
      loadRelationship();
    } catch (error: any) {
      toast.error(error.message || "Failed to unblock user");
    } finally {
      setBlockPending(false);
    }
  };

  const handleMessage = async () => {
    if (!user || !userId || messagePending) return;
    if (rel === "unavailable" || rel === "self") return;
    setMessagePending(true);
    try {
      // 1. Look for an existing DM between both users
      const { data: list, error: listErr } = await supabase.rpc("get_user_dm_list");
      if (listErr) throw listErr;
      const existing = (list || []).find((r: any) => r.other_user_id === userId);
      let convId: string | null = existing?.conversation_id ?? null;

      // 2. Create one if it doesn't exist (via secure RPC; requires accepted friendship)
      if (!convId) {
        const { data: newConvId, error: rpcErr } = await supabase.rpc("get_or_create_dm", {
          _other_user_id: userId,
        });
        if (rpcErr) throw rpcErr;
        convId = newConvId as unknown as string;
      }

      onOpenChange(false);
      navigate(`/chat?c=${convId}`);
    } catch (e: any) {
      toast.error(e?.message || "Could not open conversation");
    } finally {
      setMessagePending(false);
    }
  };

  // ---- Button styling ----

  const renderFriendButton = () => {
    if (rel === "self" || rel === "loading") return null;
    if (rel === "unavailable") {
      return (
        <button
          disabled
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium opacity-60 cursor-not-allowed border"
          style={{ background: "#3a3a3a", borderColor: "#555", color: "#fff" }}
        >
          Unavailable
        </button>
      );
    }
    if (rel === "requests_off") {
      return (
        <button
          disabled
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium opacity-60 cursor-not-allowed border"
          style={{ background: "#3a3a3a", borderColor: "#555", color: "#fff" }}
        >
          <UserX className="h-4 w-4" />
          Not accepting requests
        </button>
      );
    }

    let label = "";
    let baseColor = "#5865f2";
    let icon: React.ReactNode = <UserPlus className="h-4 w-4" />;
    let onClick = sendRequest;

    if (rel === "none") {
      label = "Add Friend";
      baseColor = "#5865f2";
      icon = <UserPlus className="h-4 w-4" />;
      onClick = sendRequest;
    } else if (rel === "sent") {
      label = "Request Sent";
      baseColor = "#4f545c";
      icon = <Clock className="h-4 w-4" />;
      onClick = cancelRequest;
    } else if (rel === "received") {
      label = "Accept Request";
      baseColor = "#3ba55d";
      icon = <Check className="h-4 w-4" />;
      onClick = acceptRequest;
    } else if (rel === "friends") {
      label = "Unfriend";
      baseColor = "#d22d39";
      icon = <UserX className="h-4 w-4" />;
      onClick = unfriend;
    }

    const c = buttonColors(baseColor, gradActive, onLight, grad?.from, grad?.to);

    return (
      <button
        onClick={onClick}
        disabled={actionPending}
        className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border transition-all hover:brightness-110 active:brightness-95 disabled:opacity-70 disabled:cursor-wait"
        style={{ background: c.bg, borderColor: c.border, color: c.fg }}
      >
        {actionPending ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {label}
      </button>
    );
  };

  const renderMessageButton = () => {
    if (rel !== "friends") return null;
    const disabled = messagePending;
    const c = buttonColors("#0f0f0f", gradActive, onLight, grad?.from, grad?.to);
    return (
      <button
        onClick={handleMessage}
        disabled={disabled}
        className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border transition-all hover:brightness-125 active:brightness-95 disabled:opacity-60 disabled:cursor-not-allowed"
        style={{ background: c.bg, borderColor: c.border, color: c.fg }}
      >
        {messagePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
        Message
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`p-0 overflow-hidden max-w-md w-[calc(100vw-1.5rem)] sm:w-full gap-0 rounded-2xl [&>button.absolute]:bg-black/40 [&>button.absolute]:backdrop-blur-sm [&>button.absolute]:text-white [&>button.absolute]:p-1 [&>button.absolute]:opacity-100 [&>button.absolute]:hover:bg-black/60 ${gradActive ? "border-0" : ""}`}
        style={
          gradActive
            ? {
                background: `${gradientCss} padding-box, ${gradientCss} border-box`,
                color: textColor,
                border: "4px solid transparent",
              }
            : undefined
        }
      >
        <DialogTitle className="sr-only">{displayName}</DialogTitle>
        <DialogDescription className="sr-only">User profile</DialogDescription>

        {/* Banner */}
        <div className="h-[7.5rem] sm:h-36 w-full overflow-hidden bg-muted">
          {profile?.banner_url && (
            <img src={profile.banner_url} alt="" className="h-full w-full object-cover" />
          )}
        </div>

        <div className="px-4 sm:px-5 pb-5 -mt-10 flex flex-col items-start text-left">
          <div className="relative w-fit">
            <Avatar className="h-20 w-20 sm:h-24 sm:w-24 border-4 border-background shadow-md flex-shrink-0">
              <AvatarImage src={profile?.avatar_url || undefined} />
              <AvatarFallback className="text-2xl">
                {profile?.username?.[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            {profile && (
              <CustomStatusBubble
                status={{
                  custom_status_text: profile.custom_status_text,
                  custom_status_emoji: profile.custom_status_emoji,
                  custom_status_expires_at: profile.custom_status_expires_at,
                }}
                isOwner={user?.id === profile.id}
                onChange={(next) =>
                  setProfile((p) => (p ? { ...p, ...next } : p))
                }
              />
            )}
          </div>

          <div className="mt-3 space-y-1 w-full">
            <h2
              className="text-lg sm:text-xl font-semibold leading-tight"
              style={textColor ? { color: textColor } : undefined}
            >
              {loading ? "Loading…" : displayName}
            </h2>
            {profile?.username && profile.display_name && (
              <p
                className="text-sm text-muted-foreground"
                style={mutedTextColor ? { color: mutedTextColor } : undefined}
              >
                @{profile.username}
              </p>
            )}
            {profile?.pronouns && (
              <p
                className="text-xs text-muted-foreground"
                style={mutedTextColor ? { color: mutedTextColor } : undefined}
              >
                {profile.pronouns}
              </p>
            )}
          </div>

          {/* Action buttons */}
          {rel !== "self" && rel !== "loading" && (
            <div className="mt-4 w-full space-y-2">
              {blockedByMe ? (
                <button
                  onClick={unblock}
                  disabled={blockPending}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border transition-all hover:brightness-110 active:brightness-95 disabled:opacity-70 disabled:cursor-wait"
                  style={{ background: "#4f545c", borderColor: "#3a3a3a", color: "#fff" }}
                >
                  {blockPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
                  Unblock User
                </button>
              ) : (
                <>
                  <div className="flex gap-2">
                    {renderFriendButton()}
                    {renderMessageButton()}
                  </div>
                  <button
                    onClick={block}
                    disabled={blockPending}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border transition-all hover:brightness-110 active:brightness-95 disabled:opacity-70 disabled:cursor-wait"
                    style={{ background: "transparent", borderColor: "#d22d39", color: "#d22d39" }}
                  >
                    {blockPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                    Block User
                  </button>
                </>
              )}
            </div>
          )}

          {profile?.bio && (
            <div
              className="mt-4 w-full text-left text-sm break-words"
              style={textColor ? { color: textColor } : undefined}
            >
              <MessageMarkdown content={stripBioHeadings(profile.bio)} />
            </div>
          )}

          {joined && (
            <p
              className="mt-3 text-xs text-muted-foreground"
              style={mutedTextColor ? { color: mutedTextColor } : undefined}
            >
              Joined {joined}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Keep UserCheck import alive if tree-shaking complains in future
void UserCheck;
