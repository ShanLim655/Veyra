import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeMariaDbChanges } from "@/integrations/supabase/mariadb-realtime";
import { serverDateMs } from "@/lib/dates";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/hooks/use-toast";
import { BarChart3, CheckCircle2, Circle, Lock, Users } from "lucide-react";

type Poll = {
  id: string;
  question: string;
  multiple_choice: boolean;
  ends_at: string;
  closed_at: string | null;
  created_by: string;
  result_message_id: string | null;
  message_id: string | null;
  channel: string;
  conversation_id: string | null;
};
type Option = { id: string; text: string; position: number };
type Vote = { id: string; option_id: string; user_id: string };
type VoterProfile = { id: string; username: string | null; display_name: string | null; avatar_url: string | null };

function formatTimeLeft(endsAt: string, closedAt: string | null) {
  if (closedAt) return "Closed";
  const endMs = serverDateMs(endsAt);
  if (Number.isNaN(endMs)) return "";
  const ms = endMs - Date.now();
  if (ms <= 0) return "Ended";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function PollCard({ pollId }: { pollId: string }) {
  const { user } = useAuth();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [busy, setBusy] = useState(false);
  const [votersOpen, setVotersOpen] = useState<{ optionId: string; text: string } | null>(null);
  const [voterProfiles, setVoterProfiles] = useState<VoterProfile[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const finalizeAttempted = useRef(false);
  const [, force] = useState(0);

  // Tick clock every 30s for countdown
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 30000);
    return () => clearInterval(i);
  }, []);

  // Load + realtime
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [{ data: p }, { data: o }, { data: v }] = await Promise.all([
        (supabase as any).from("polls").select("*").eq("id", pollId).maybeSingle(),
        (supabase as any).from("poll_options").select("*").eq("poll_id", pollId).order("position"),
        (supabase as any).from("poll_votes").select("*").eq("poll_id", pollId),
      ]);
      if (cancelled) return;
      setPoll(p);
      setOptions(o || []);
      setVotes(v || []);
      setLoadFailed(!p);
    };
    load();

    // Live updates come through the MariaDB realtime bridge (the old
    // postgres_changes subscriptions never fired after the Supabase
    // migration). Any change just triggers a refetch.
    const unsubscribes = [
      subscribeMariaDbChanges({ event: "*", schema: "public", table: "polls", filter: `id=eq.${pollId}` }, load),
      subscribeMariaDbChanges({ event: "*", schema: "public", table: "poll_options", filter: `poll_id=eq.${pollId}` }, load),
      subscribeMariaDbChanges({ event: "*", schema: "public", table: "poll_votes", filter: `poll_id=eq.${pollId}` }, load),
    ];

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [pollId]);

  // Auto-finalize when expired. result_message_id is never populated by the
  // current backend, so guard with a ref to avoid calling the RPC on every
  // render/tick forever.
  useEffect(() => {
    if (!poll || finalizeAttempted.current) return;
    const endMs = serverDateMs(poll.ends_at);
    const ended = !!poll.closed_at || (!Number.isNaN(endMs) && endMs <= Date.now());
    if (ended && !poll.result_message_id) {
      finalizeAttempted.current = true;
      Promise.resolve((supabase as any).rpc("finalize_poll", { _poll_id: pollId })).catch(() => {});
    }
  }, [poll, pollId]);

  const totals = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of options) counts[o.id] = 0;
    for (const v of votes) counts[v.option_id] = (counts[v.option_id] || 0) + 1;
    return counts;
  }, [options, votes]);

  const total = votes.length;
  const myVotes = useMemo(
    () => new Set(votes.filter((v) => v.user_id === user?.id).map((v) => v.option_id)),
    [votes, user?.id]
  );
  const endMs = poll ? serverDateMs(poll.ends_at) : Number.NaN;
  const ended = !!poll?.closed_at || (!Number.isNaN(endMs) && endMs <= Date.now());
  const isCreator = poll?.created_by === user?.id;

  const toggleVote = async (optionId: string) => {
    if (!poll || !user || ended || busy) return;
    setBusy(true);
    try {
      if (myVotes.has(optionId)) {
        const { error } = await (supabase as any)
          .from("poll_votes")
          .delete()
          .eq("poll_id", pollId)
          .eq("user_id", user.id)
          .eq("option_id", optionId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("poll_votes")
          .insert({ poll_id: pollId, option_id: optionId, user_id: user.id });
        if (error) throw error;
      }
      // Refetch votes immediately — realtime DELETE events can be unreliable
      const { data: v } = await (supabase as any)
        .from("poll_votes")
        .select("*")
        .eq("poll_id", pollId);
      setVotes(v || []);
    } catch (e: any) {
      toast({ title: "Vote failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const closePoll = async () => {
    if (!poll) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any)
        .from("polls")
        .update({ closed_at: new Date().toISOString() })
        .eq("id", pollId);
      if (error) throw error;
      await (supabase as any).rpc("finalize_poll", { _poll_id: pollId });
    } catch (e: any) {
      toast({ title: "Couldn't close poll", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const openVoters = async (option: Option) => {
    setVotersOpen({ optionId: option.id, text: option.text });
    const userIds = votes.filter((v) => v.option_id === option.id).map((v) => v.user_id);
    if (userIds.length === 0) { setVoterProfiles([]); return; }
    const { data } = await (supabase as any)
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", userIds);
    setVoterProfiles((data as VoterProfile[]) || []);
  };

  if (!poll) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-3 mt-1 text-xs text-muted-foreground">
        {loadFailed ? "This poll is unavailable." : "Loading poll…"}
      </div>
    );
  }

  const timeLeft = formatTimeLeft(poll.ends_at, poll.closed_at);

  return (
    <>
      <div className="rounded-xl border border-border bg-card/70 backdrop-blur-sm p-3 mt-1 w-full max-w-md">
        <div className="flex items-start gap-2 mb-2">
          <BarChart3 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug break-words">{poll.question}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {poll.multiple_choice ? "Multiple choice" : "Single choice"}
              {timeLeft ? ` • ${timeLeft}` : ""}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          {options.map((o) => {
            const count = totals[o.id] || 0;
            const pct = total ? Math.round((count / total) * 100) : 0;
            const picked = myVotes.has(o.id);
            return (
              <div key={o.id} className="space-y-0.5">
                <button
                  type="button"
                  disabled={ended || busy}
                  onClick={() => toggleVote(o.id)}
                  className={`relative w-full text-left rounded-lg border px-3 py-2 text-sm overflow-hidden transition-colors ${
                    picked ? "border-primary bg-primary/10" : "border-border hover:bg-muted/60"
                  } ${ended ? "cursor-default" : "cursor-pointer"}`}
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/15"
                    style={{ width: `${pct}%` }}
                    aria-hidden
                  />
                  <div className="relative flex items-center gap-2">
                    {picked ? (
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="flex-1 break-words">{o.text}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => openVoters(o)}
                  className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 ml-1"
                >
                  <Users className="h-3 w-3" />
                  {count} {count === 1 ? "voter" : "voters"}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
          <span>{total} total vote{total === 1 ? "" : "s"}</span>
          {isCreator && !ended && (
            <Button size="sm" variant="ghost" onClick={closePoll} disabled={busy} className="h-7 gap-1 text-[11px]">
              <Lock className="h-3 w-3" /> End poll
            </Button>
          )}
        </div>
      </div>

      <Dialog open={!!votersOpen} onOpenChange={(o) => !o && setVotersOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Voters · {votersOpen?.text}</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {voterProfiles.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No voters yet.</p>
            ) : (
              voterProfiles.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={p.avatar_url || undefined} />
                    <AvatarFallback>{(p.display_name || p.username || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm truncate">{p.display_name || p.username || "User"}</p>
                    {p.username && <p className="text-xs text-muted-foreground truncate">@{p.username}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PollResultCard({
  pollId,
  onJump,
}: {
  pollId: string;
  onJump?: (messageId: string) => void;
}) {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: p }, { data: o }, { data: v }] = await Promise.all([
        (supabase as any).from("polls").select("*").eq("id", pollId).maybeSingle(),
        (supabase as any).from("poll_options").select("*").eq("poll_id", pollId).order("position"),
        (supabase as any).from("poll_votes").select("*").eq("poll_id", pollId),
      ]);
      if (cancelled) return;
      setPoll(p);
      setOptions(o || []);
      setVotes(v || []);
    })();
    return () => { cancelled = true; };
  }, [pollId]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of options) m[o.id] = 0;
    for (const v of votes) m[v.option_id] = (m[v.option_id] || 0) + 1;
    return m;
  }, [options, votes]);
  const max = Math.max(0, ...Object.values(counts));
  const winners = options.filter((o) => max > 0 && counts[o.id] === max);

  if (!poll) return null;

  return (
    <div className="rounded-xl border border-border bg-card/70 backdrop-blur-sm p-3 mt-1 w-full max-w-md">
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="h-4 w-4 text-primary shrink-0" />
        <p className="font-semibold text-sm">Poll ended</p>
      </div>
      <p className="text-sm break-words mb-2">{poll.question}</p>
      <div className="space-y-1">
        {options.map((o) => {
          const c = counts[o.id] || 0;
          const pct = votes.length ? Math.round((c / votes.length) * 100) : 0;
          const win = winners.some((w) => w.id === o.id);
          return (
            <div key={o.id} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${win ? "bg-primary/15 text-foreground font-medium" : "text-muted-foreground"}`}>
              <span className="truncate">{win ? "🏆 " : ""}{o.text}</span>
              <span className="tabular-nums ml-2">{c} · {pct}%</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px] text-muted-foreground">{votes.length} vote{votes.length === 1 ? "" : "s"}</span>
        {poll.message_id && onJump && (
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => onJump(poll.message_id!)}>
            Jump to poll
          </Button>
        )}
      </div>
    </div>
  );
}
