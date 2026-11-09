import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Smile, Loader2, Trash2 } from "lucide-react";
import { LazyFullEmojiPicker } from "@/components/chat/LazyFullEmojiPicker";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  CustomStatusData,
  DURATION_PRESETS,
  DurationPreset,
  formatClearAt,
  isStatusActive,
} from "@/lib/customStatus";
import { cn } from "@/lib/utils";

interface Props {
  initial: CustomStatusData | null;
  onClose: () => void;
  onSaved: (next: CustomStatusData) => void;
}

export function CustomStatusEditor({ initial, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const active = isStatusActive(initial);
  const [emoji, setEmoji] = useState<string>(initial?.custom_status_emoji || "");
  const [text, setText] = useState<string>(initial?.custom_status_text || "");
  const [duration, setDuration] = useState<DurationPreset>(active ? "never" : "24h");
  const [customDate, setCustomDate] = useState<Date | undefined>(
    initial?.custom_status_expires_at ? new Date(initial.custom_status_expires_at) : undefined
  );
  const [customTime, setCustomTime] = useState<string>(() => {
    const d = initial?.custom_status_expires_at ? new Date(initial.custom_status_expires_at) : new Date(Date.now() + 60 * 60 * 1000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const computedExpiresAt = useMemo<Date | null>(() => {
    const preset = DURATION_PRESETS.find((p) => p.value === duration)!;
    if (duration === "never") return null;
    if (duration === "custom") {
      if (!customDate) return null;
      const [hh, mm] = customTime.split(":").map((n) => parseInt(n, 10));
      const d = new Date(customDate);
      d.setHours(hh || 0, mm || 0, 0, 0);
      return d;
    }
    return new Date(Date.now() + (preset.ms || 0));
  }, [duration, customDate, customTime]);

  const handleSave = async () => {
    if (!user) return;
    if (!text.trim()) {
      toast({ title: "Status text is required", variant: "destructive" });
      return;
    }
    if (duration === "custom" && (!computedExpiresAt || computedExpiresAt.getTime() <= Date.now())) {
      toast({ title: "Choose a future date and time", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      custom_status_text: text.trim().slice(0, 80),
      custom_status_emoji: emoji || null,
      custom_status_expires_at: computedExpiresAt ? computedExpiresAt.toISOString() : null,
      custom_status_set_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("profiles").update(payload).eq("id", user.id);
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save status", description: error.message, variant: "destructive" });
      return;
    }
    const next = {
      custom_status_text: payload.custom_status_text,
      custom_status_emoji: payload.custom_status_emoji,
      custom_status_expires_at: payload.custom_status_expires_at,
    };
    onSaved(next);
    window.dispatchEvent(
      new CustomEvent("custom-status-updated", { detail: { userId: user.id, ...next } }),
    );
    onClose();
  };

  const handleClear = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        custom_status_text: null,
        custom_status_emoji: null,
        custom_status_expires_at: null,
        custom_status_set_at: null,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't clear status", description: error.message, variant: "destructive" });
      return;
    }
    const cleared = { custom_status_text: null, custom_status_emoji: null, custom_status_expires_at: null };
    onSaved(cleared);
    window.dispatchEvent(
      new CustomEvent("custom-status-updated", { detail: { userId: user.id, ...cleared } }),
    );
    onClose();
  };

  return (
    <div className="w-80 p-3 space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Set a custom status</p>
        <p className="text-xs text-muted-foreground">Visible to everyone you chat with.</p>
      </div>

      <div className="relative flex items-center w-full border border-input rounded-lg bg-background px-2.5 h-11 focus-within:ring-1 focus-within:ring-ring focus-within:border-primary transition-all">
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0 flex-shrink-0 hover:bg-muted" type="button">
              {emoji ? <span className="text-lg leading-none">{emoji}</span> : <Smile className="h-5 w-5 text-muted-foreground" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <LazyFullEmojiPicker
              onSelect={(e) => {
                setEmoji(e);
                setEmojiOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <Input
          autoFocus
          maxLength={80}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's happening?"
          className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-2 bg-transparent flex-1 h-full text-sm"
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          {emoji && (
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-muted"
              onClick={() => setEmoji("")}
              aria-label="Remove emoji"
              title="Remove emoji"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {text && (
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-muted"
              onClick={() => setText("")}
              aria-label="Clear text"
              title="Clear text"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Clear after</p>
        <Select value={duration} onValueChange={(v) => setDuration(v as DurationPreset)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATION_PRESETS.map((p) => {
              let suffix = "";
              if (p.value !== "never" && p.value !== "custom") {
                suffix = ` (${formatClearAt(new Date(Date.now() + (p.ms || 0)))})`;
              } else if (p.value === "custom" && customDate) {
                const [hh, mm] = customTime.split(":").map((n) => parseInt(n, 10));
                const d = new Date(customDate);
                d.setHours(hh || 0, mm || 0, 0, 0);
                suffix = ` (${formatClearAt(d)})`;
              }
              return (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                  {suffix}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {duration === "custom" && (
          <div className="space-y-2 rounded-md border border-border p-2">
            <Calendar
              mode="single"
              selected={customDate}
              onSelect={setCustomDate}
              disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
              className={cn("p-0 pointer-events-auto")}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Time</span>
              <Input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className="h-8"
              />
            </div>
            {computedExpiresAt && (
              <p className="text-xs text-muted-foreground">
                Clears at {formatClearAt(computedExpiresAt)}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        {active ? (
          <Button variant="ghost" size="sm" onClick={handleClear} disabled={saving}>
            <Trash2 className="h-4 w-4 mr-1" /> Clear
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !text.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
