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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/hooks/use-toast";
import { Loader2, Users } from "lucide-react";

interface FriendProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (conversationId: string) => void;
}

export function CreateGroupDialog({ open, onOpenChange, onCreated }: CreateGroupDialogProps) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setName("");
    setSelected(new Set());
    setSearch("");
    setLoading(true);

    (async () => {
      const { data: rows, error } = await supabase
        .from("friend_requests")
        .select("sender_id, receiver_id")
        .eq("status", "accepted")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);

      if (error) {
        toast({ title: "Couldn't load friends", description: error.message, variant: "destructive" });
        setLoading(false);
        return;
      }

      const otherIds = Array.from(
        new Set(
          (rows ?? [])
            .map((r) => (r.sender_id === user.id ? r.receiver_id : r.sender_id))
            .filter((id): id is string => !!id),
        ),
      );

      if (otherIds.length === 0) {
        setFriends([]);
        setLoading(false);
        return;
      }

      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", otherIds);

      if (pErr) {
        toast({ title: "Couldn't load profiles", description: pErr.message, variant: "destructive" });
      }

      setFriends((profiles ?? []) as FriendProfile[]);
      setLoading(false);
    })();
  }, [open, user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
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
  }, [friends, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit = name.trim().length > 0 && selected.size >= 1 && !creating;

  const handleCreate = async () => {
    if (!canSubmit) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.rpc("create_group_chat", {
        _name: name.trim(),
        _member_ids: Array.from(selected),
      });
      if (error) throw error;
      const newId = data as unknown as string;
      toast({ title: "Group created" });
      onOpenChange(false);
      if (newId) onCreated(newId);
    } catch (err: any) {
      toast({ title: "Couldn't create group", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            New group
          </DialogTitle>
          <DialogDescription>
            Pick a name and invite friends. You can add more people later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Group name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoFocus
          />
          <Input
            placeholder="Search friends"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="text-xs text-muted-foreground">
            {selected.size} selected
          </div>

          <ScrollArea className="h-64 rounded-md border">
            {loading ? (
              <div className="flex items-center justify-center h-full py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {friends.length === 0 ? "Add friends first to create a group." : "No matches."}
              </div>
            ) : (
              <div className="p-1">
                {filtered.map((f) => {
                  const checked = selected.has(f.id);
                  return (
                    <label
                      key={f.id}
                      className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-accent cursor-pointer"
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggle(f.id)} />
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
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
