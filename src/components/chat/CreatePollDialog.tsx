import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";

type Props = {
  trigger: React.ReactNode;
  channel: "dm" | "global" | "announcements";
  conversationId?: string | null;
  messagesTable: "messages" | "global_messages" | "announcement_messages";
};

const MAX_OPTIONS = 10;

export function CreatePollDialog({ trigger, channel, conversationId, messagesTable }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [opts, setOpts] = useState<string[]>(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [days, setDays] = useState(1);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setQuestion("");
    setOpts(["", ""]);
    setMultiple(false);
    setDays(1);
  };

  const updateOpt = (i: number, v: string) => {
    setOpts((arr) => arr.map((o, idx) => (idx === i ? v : o)));
  };
  const addOpt = () => {
    if (opts.length >= MAX_OPTIONS) return;
    setOpts((arr) => [...arr, ""]);
  };
  const removeOpt = (i: number) => {
    if (opts.length <= 2) return;
    setOpts((arr) => arr.filter((_, idx) => idx !== i));
  };

  const submit = async () => {
    if (!user) return;
    const q = question.trim();
    const cleanOpts = opts.map((o) => o.trim()).filter(Boolean);
    if (!q) return toast({ title: "Question required", variant: "destructive" });
    if (cleanOpts.length < 2) return toast({ title: "At least 2 options required", variant: "destructive" });

    setBusy(true);
    try {
      const endsAt = new Date(Date.now() + days * 86400000).toISOString();
      const { data: poll, error: pErr } = await (supabase as any)
        .from("polls")
        .insert({
          created_by: user.id,
          channel,
          conversation_id: channel === "dm" ? conversationId : null,
          question: q,
          multiple_choice: multiple,
          ends_at: endsAt,
        })
        .select("id")
        .single();
      if (pErr) throw pErr;

      const { error: oErr } = await (supabase as any)
        .from("poll_options")
        .insert(cleanOpts.map((text, position) => ({ poll_id: poll.id, position, text })));
      if (oErr) throw oErr;

      const insertPayload: any = {
        sender_id: user.id,
        content: `[[poll:${poll.id}]]`,
      };
      if (channel === "dm") insertPayload.conversation_id = conversationId;

      const { data: msg, error: mErr } = await (supabase as any)
        .from(messagesTable)
        .insert(insertPayload)
        .select("id")
        .single();
      if (mErr) throw mErr;

      await (supabase as any).from("polls").update({ message_id: msg.id }).eq("id", poll.id);

      reset();
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Couldn't create poll", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create poll</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="poll-q">Question</Label>
            <Input
              id="poll-q"
              placeholder="Ask something..."
              maxLength={300}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Options ({opts.length}/{MAX_OPTIONS})</Label>
            <div className="space-y-2">
              {opts.map((o, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder={`Option ${i + 1}`}
                    maxLength={150}
                    value={o}
                    onChange={(e) => updateOpt(i, e.target.value)}
                  />
                  {opts.length > 2 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeOpt(i)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {opts.length < MAX_OPTIONS && (
              <Button type="button" variant="ghost" size="sm" onClick={addOpt} className="gap-1 mt-1">
                <Plus className="h-3 w-3" /> Add option
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="poll-multi">Allow multiple choices</Label>
              <p className="text-xs text-muted-foreground">Voters can pick more than one option</p>
            </div>
            <Switch id="poll-multi" checked={multiple} onCheckedChange={setMultiple} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Duration</Label>
              <span className="text-sm text-muted-foreground">{days} day{days === 1 ? "" : "s"}</span>
            </div>
            <Slider
              min={1}
              max={7}
              step={1}
              value={[days]}
              onValueChange={(v) => setDays(v[0])}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Creating..." : "Post poll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
