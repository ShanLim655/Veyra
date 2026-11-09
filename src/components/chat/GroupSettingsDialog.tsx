import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  Crown,
  Loader2,
  LogOut,
  MoreVertical,
  Pencil,
  Shield,
  UserMinus,
  UserPlus,
} from "lucide-react";

type Role = "owner" | "admin" | "member";

interface Member {
  user_id: string;
  role: Role;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface FriendProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface GroupSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  initialName: string | null;
  onChanged?: () => void;
  onLeft?: () => void;
}

export function GroupSettingsDialog({
  open,
  onOpenChange,
  conversationId,
  initialName,
  onChanged,
  onLeft,
}: GroupSettingsDialogProps) {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(initialName ?? "");
  const [savingName, setSavingName] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [addSearch, setAddSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const myRole: Role | null = useMemo(() => {
    if (!user) return null;
    return (members.find((m) => m.user_id === user.id)?.role as Role) ?? null;
  }, [members, user]);

  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";

  const loadMembers = async () => {
    if (!conversationId) return;
    setLoading(true);
    const { data: rows, error } = await supabase
      .from("conversation_members")
      .select("user_id, role, joined_at")
      .eq("conversation_id", conversationId)
      .order("joined_at", { ascending: true });

    if (error) {
      toast({ title: "Couldn't load members", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const ids = (rows ?? []).map((r) => r.user_id);
    if (ids.length === 0) {
      setMembers([]);
      setLoading(false);
      return;
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", ids);

    const map = new Map((profiles ?? []).map((p) => [p.id, p]));
    setMembers(
      (rows ?? []).map((r) => {
        const p = map.get(r.user_id);
        return {
          user_id: r.user_id,
          role: r.role as Role,
          username: p?.username ?? "Unknown",
          display_name: p?.display_name ?? null,
          avatar_url: p?.avatar_url ?? null,
        };
      }),
    );
    setLoading(false);
  };

  useEffect(() => {
    if (!open) return;
    setName(initialName ?? "");
    loadMembers();

    const ch = supabase
      .channel(`group-settings:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_members",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => loadMembers(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId, initialName]);

  const loadFriends = async () => {
    if (!user) return;
    setFriendsLoading(true);
    const { data: rows } = await supabase
      .from("friend_requests")
      .select("sender_id, receiver_id")
      .eq("status", "accepted")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);
    const memberSet = new Set(members.map((m) => m.user_id));
    const otherIds = Array.from(
      new Set(
        (rows ?? [])
          .map((r) => (r.sender_id === user.id ? r.receiver_id : r.sender_id))
          .filter((id): id is string => !!id && !memberSet.has(id)),
      ),
    );
    if (otherIds.length === 0) {
      setFriends([]);
      setFriendsLoading(false);
      return;
    }
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", otherIds);
    setFriends((profiles ?? []) as FriendProfile[]);
    setFriendsLoading(false);
  };

  useEffect(() => {
    if (showAdd) {
      setAddSelected(new Set());
      setAddSearch("");
      loadFriends();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdd, members.length]);

  const handleSaveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === (initialName ?? "")) return;
    setSavingName(true);
    const { error } = await supabase.rpc("rename_group", { _conv: conversationId, _name: trimmed });
    setSavingName(false);
    if (error) {
      toast({ title: "Couldn't rename", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Group renamed" });
    onChanged?.();
  };

  const handleAddMembers = async () => {
    if (addSelected.size === 0) return;
    setAdding(true);
    const { error } = await supabase.rpc("add_group_members", {
      _conv: conversationId,
      _user_ids: Array.from(addSelected),
    });
    setAdding(false);
    if (error) {
      toast({ title: "Couldn't add members", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Members added" });
    setShowAdd(false);
    loadMembers();
    onChanged?.();
  };

  const handleRemove = async (target: Member) => {
    const { error } = await supabase.rpc("remove_group_member", {
      _conv: conversationId,
      _user_id: target.user_id,
    });
    if (error) {
      toast({ title: "Couldn't remove", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Removed ${target.display_name || target.username}` });
    loadMembers();
    onChanged?.();
  };

  const handleSetRole = async (target: Member, role: "admin" | "member") => {
    const { error } = await supabase.rpc("set_member_role", {
      _conv: conversationId,
      _user_id: target.user_id,
      _role: role,
    });
    if (error) {
      toast({ title: "Couldn't update role", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: role === "admin" ? "Promoted to admin" : "Demoted to member" });
    loadMembers();
  };

  const handleTransfer = async (target: Member) => {
    const { error } = await supabase.rpc("transfer_group_ownership", {
      _conv: conversationId,
      _new_owner: target.user_id,
    });
    if (error) {
      toast({ title: "Couldn't transfer ownership", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Ownership transferred" });
    loadMembers();
  };

  const handleLeave = async () => {
    setLeaving(true);
    const { error } = await supabase.rpc("leave_group", { _conv: conversationId });
    setLeaving(false);
    if (error) {
      toast({ title: "Couldn't leave group", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Left group" });
    setConfirmLeave(false);
    onOpenChange(false);
    onLeft?.();
  };

  const filteredFriends = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    const list = q
      ? friends.filter(
          (f) =>
            f.username.toLowerCase().includes(q) ||
            (f.display_name ?? "").toLowerCase().includes(q),
        )
      : friends;
    return [...list].sort((a, b) =>
      (a.display_name || a.username).localeCompare(b.display_name || b.username),
    );
  }, [friends, addSearch]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Group settings</DialogTitle>
            <DialogDescription>
              Manage members and group details. Your role: <span className="font-medium">{myRole ?? "—"}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canManage}
                  maxLength={60}
                />
                <Button
                  size="sm"
                  onClick={handleSaveName}
                  disabled={!canManage || savingName || name.trim() === (initialName ?? "") || !name.trim()}
                >
                  {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Members ({members.length})</label>
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
                    <UserPlus className="h-4 w-4 mr-1.5" /> Add
                  </Button>
                )}
              </div>

              <ScrollArea className="h-64 rounded-md border">
                {loading ? (
                  <div className="flex items-center justify-center h-full py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="p-1">
                    {members.map((m) => {
                      const isMe = m.user_id === user?.id;
                      return (
                        <div
                          key={m.user_id}
                          className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-accent/60"
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={m.avatar_url || undefined} />
                            <AvatarFallback>
                              {(m.display_name || m.username)[0]?.toUpperCase() || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium truncate">
                                {m.display_name || m.username}
                                {isMe && <span className="text-muted-foreground"> (you)</span>}
                              </p>
                              {m.role === "owner" && (
                                <Badge variant="default" className="h-5 px-1.5 text-[10px]">
                                  <Crown className="h-3 w-3 mr-0.5" /> owner
                                </Badge>
                              )}
                              {m.role === "admin" && (
                                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                  <Shield className="h-3 w-3 mr-0.5" /> admin
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">@{m.username}</p>
                          </div>
                          {!isMe && (canManage || isOwner) && m.role !== "owner" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-7 w-7">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {isOwner && m.role === "member" && (
                                  <DropdownMenuItem onClick={() => handleSetRole(m, "admin")}>
                                    <Shield className="h-4 w-4 mr-2" /> Promote to admin
                                  </DropdownMenuItem>
                                )}
                                {isOwner && m.role === "admin" && (
                                  <DropdownMenuItem onClick={() => handleSetRole(m, "member")}>
                                    <Shield className="h-4 w-4 mr-2" /> Demote to member
                                  </DropdownMenuItem>
                                )}
                                {isOwner && (
                                  <DropdownMenuItem onClick={() => handleTransfer(m)}>
                                    <Crown className="h-4 w-4 mr-2" /> Transfer ownership
                                  </DropdownMenuItem>
                                )}
                                {(isOwner || (myRole === "admin" && m.role !== "admin")) && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => handleRemove(m)}
                                      className="text-destructive"
                                    >
                                      <UserMinus className="h-4 w-4 mr-2" /> Remove from group
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              variant="destructive"
              onClick={() => setConfirmLeave(true)}
              disabled={leaving}
            >
              <LogOut className="h-4 w-4 mr-1.5" /> Leave group
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add members</DialogTitle>
            <DialogDescription>Only your friends can be added.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Search friends"
            value={addSearch}
            onChange={(e) => setAddSearch(e.target.value)}
          />
          <div className="text-xs text-muted-foreground">{addSelected.size} selected</div>
          <ScrollArea className="h-64 rounded-md border">
            {friendsLoading ? (
              <div className="flex items-center justify-center h-full py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredFriends.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {friends.length === 0 ? "No friends left to add." : "No matches."}
              </div>
            ) : (
              <div className="p-1">
                {filteredFriends.map((f) => {
                  const checked = addSelected.has(f.id);
                  return (
                    <label
                      key={f.id}
                      className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-accent cursor-pointer"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          setAddSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(f.id)) next.delete(f.id);
                            else next.add(f.id);
                            return next;
                          })
                        }
                      />
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={f.avatar_url || undefined} />
                        <AvatarFallback>
                          {(f.display_name || f.username)[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-medium truncate">
                          {f.display_name || f.username}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">@{f.username}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAdd(false)} disabled={adding}>
              Cancel
            </Button>
            <Button onClick={handleAddMembers} disabled={adding || addSelected.size === 0}>
              {adding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add {addSelected.size > 0 ? `(${addSelected.size})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this group?</AlertDialogTitle>
            <AlertDialogDescription>
              {isOwner
                ? "You're the owner — ownership will pass to the longest-standing admin (or member) before you leave."
                : "You can be re-added later by any owner or admin."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeave}
              disabled={leaving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {leaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
