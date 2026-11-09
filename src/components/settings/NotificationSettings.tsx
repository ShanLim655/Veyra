import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { Bell, AlertTriangle, BookOpen, Copy, ChevronDown } from "lucide-react";

const NTFY_SERVER_URL = "https://ntfy.chat-amani.xyz";

type Mode = "off" | "every" | "digest";

interface Prefs {
  user_id: string;
  ntfy_topic: string | null;
  ntfy_server: string;
  dm_mode: Mode;
  global_mode: Mode;
  announcement_mode: Mode;
  dm_title_template: string;
  dm_body_template: string;
  global_title_template: string;
  global_body_template: string;
  announcement_title_template: string;
  announcement_body_template: string;
  digest_cooldown_minutes: number;
  dm_custom_enabled: boolean;
  global_custom_enabled: boolean;
  announcement_custom_enabled: boolean;
}

const DEFAULTS: Omit<Prefs, "user_id"> = {
  ntfy_topic: "",
  ntfy_server: NTFY_SERVER_URL,
  dm_mode: "off",
  global_mode: "off",
  announcement_mode: "off",
  dm_title_template: "New message from {user}",
  dm_body_template: "{message}",
  global_title_template: "{user} in Global Chat",
  global_body_template: "{message}",
  announcement_title_template: "Announcement from {user}",
  announcement_body_template: "{message}",
  digest_cooldown_minutes: 10,
  dm_custom_enabled: false,
  global_custom_enabled: false,
  announcement_custom_enabled: false,
};

const modeOptions: { value: Mode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "every", label: "Every message" },
  { value: "digest", label: "One per cooldown" },
];

const ChannelBlock = ({
  label,
  mode,
  onMode,
  titleVal,
  bodyVal,
  onTitle,
  onBody,
  customEnabled,
  onCustomEnabled,
  defaultTitle,
  defaultBody,
}: {
  label: string;
  mode: Mode;
  onMode: (m: Mode) => void;
  titleVal: string;
  bodyVal: string;
  onTitle: (v: string) => void;
  onBody: (v: string) => void;
  customEnabled: boolean;
  onCustomEnabled: (v: boolean) => void;
  defaultTitle: string;
  defaultBody: string;
}) => (
  <div className="space-y-3 rounded-lg border p-4">
    <div className="flex items-center justify-between gap-3">
      <Label className="text-base font-semibold">{label}</Label>
      <Select value={mode} onValueChange={(v) => onMode(v as Mode)}>
        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          {modeOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
    {mode === "every" && (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
          <div>
            <Label className="text-sm">Customize notification content</Label>
            <p className="text-xs text-muted-foreground">
              Off uses the default title and body. On lets you write your own templates.
            </p>
          </div>
          <Switch checked={customEnabled} onCheckedChange={onCustomEnabled} />
        </div>
        {customEnabled ? (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Title template</Label>
              <Input value={titleVal} onChange={(e) => onTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Body template</Label>
              <Input value={bodyVal} onChange={(e) => onBody(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Available placeholders: <code>{"{user}"}</code> and <code>{"{message}"}</code>
            </p>
          </>
        ) : (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>Default title: <code className="px-1 rounded bg-muted">{defaultTitle}</code></div>
            <div>Default body: <code className="px-1 rounded bg-muted">{defaultBody}</code></div>
          </div>
        )}
      </div>
    )}
  </div>
);

export default function NotificationSettings() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      const loaded = (data as Prefs) ?? ({ user_id: user.id, ...DEFAULTS } as Prefs);
      // Force the server URL — it is not user-configurable anymore.
      loaded.ntfy_server = NTFY_SERVER_URL;
      setPrefs(loaded);
    })();
  }, [user]);

  const update = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
    setPrefs((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    if (!user || !prefs) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("notification_preferences")
      .upsert({ ...prefs, user_id: user.id });
    setSaving(false);
    if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    else toast({ title: "Notification settings saved" });
  };

  const sendTest = async () => {
    if (!prefs?.ntfy_topic) {
      toast({ title: "Set a topic first", variant: "destructive" });
      return;
    }
    try {
      // Save first so the edge function reads the latest topic.
      await (supabase as any)
        .from("notification_preferences")
        .upsert({ ...prefs, user_id: user!.id });

      const { data, error } = await supabase.functions.invoke("send-ntfy", {
        body: { test: true },
      });
      if (error || !data?.ok) {
        toast({
          title: "Test failed",
          description:
            data?.error ??
            error?.message ??
            "The ntfy server is unreachable (likely down). Check that ntfy.chat-amani.xyz is running.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Test sent", description: "Check your ntfy app." });
    } catch (e: any) {
      toast({
        title: "Could not send test",
        description: e?.message ?? "Unexpected error.",
        variant: "destructive",
      });
    }
  };

  const copyServerUrl = async () => {
    try {
      await navigator.clipboard.writeText(NTFY_SERVER_URL);
      toast({ title: "Copied", description: "Server URL copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  if (!prefs) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Push notifications (ntfy)
        </CardTitle>
        <CardDescription>
          Get notified about new messages even when this site isn't open in any browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Video tutorial */}
        <div className="rounded-lg border overflow-hidden">
          <div className="flex items-center gap-2 p-3 text-sm font-semibold border-b bg-muted/30">
            <BookOpen className="h-4 w-4" />
            Video tutorial: setting up notifications
          </div>
          <video
            controls
            preload="metadata"
            className="w-full bg-black"
            src="/notification-tutorial.mp4"
          >
            Your browser does not support the video tag.
          </video>
        </div>

        {/* Tutorial (collapsible, collapsed by default) */}
        <Collapsible>
          <div className="rounded-lg border">
            <CollapsibleTrigger className="flex w-full items-center justify-between p-4 text-sm font-semibold hover:bg-muted/30 transition-colors group">
              <span className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                How to turn on notifications (step by step)
              </span>
              <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 text-sm">
                <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
                  <li>
                    Install the <strong>ntfy</strong> app:{" "}
                    <a className="underline" href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noreferrer">Android</a>{" · "}
                    <a className="underline" href="https://apps.apple.com/us/app/ntfy/id1625396347" target="_blank" rel="noreferrer">iOS</a>{" · "}
                    <a className="underline" href="https://ntfy.sh/app" target="_blank" rel="noreferrer">Web / Desktop</a>.
                  </li>
                  <li>
                    In the ntfy app settings, set the <strong>Default server</strong> to our custom server URL below
                    (or, when subscribing, tap <strong>Use another server</strong> and paste this URL):
                    <div className="mt-2 flex items-center gap-2">
                      <code className="flex-1 px-2 py-1 rounded bg-muted text-foreground break-all">
                        {NTFY_SERVER_URL}
                      </code>
                      <Button type="button" size="sm" variant="outline" onClick={copyServerUrl}>
                        <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                      </Button>
                    </div>
                  </li>
                  <li>Open the app and tap <strong>Subscribe to topic</strong> (the “+” button), making sure the server is set to the URL above.</li>
                  <li>
                    Make up a long, random, unique topic name and paste the <em>exact same string</em> into the
                    "Your ntfy topic" field below.
                  </li>
                  <li>
                    On iOS, make sure notifications are <strong>allowed</strong> for the ntfy app
                    (Settings → Notifications → ntfy → Allow Notifications).
                  </li>
                  <li>
                    On Android, turn off <strong>battery optimization</strong> for ntfy so the app can run in the background
                    (Settings → Apps → ntfy → Battery → Unrestricted).
                  </li>
                  <li>Pick how you want to be notified for DMs, Global chat and Announcements below, then click <strong>Save settings</strong>.</li>
                  <li>Click <strong>Send test notification</strong>. If the test arrives, you're done.</li>
                </ol>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        {/* Why an app — short */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-muted-foreground">
            Websites can't push notifications when closed. We use{" "}
            <a href="https://ntfy.sh" target="_blank" rel="noreferrer" className="underline">ntfy</a>{" "}
            — install the app, subscribe to a private topic, and we'll post to it.
          </p>
        </div>

        {/* Disclaimer — short */}
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs flex gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-muted-foreground">
            <strong className="text-destructive">Use a hard-to-guess topic.</strong> ntfy topics are public —
            anyone who knows yours can read your notifications.
          </p>
        </div>

        {/* Topic + (locked) server */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Your ntfy topic (subscription name)</Label>
            <Input
              value={prefs.ntfy_topic ?? ""}
              onChange={(e) => update("ntfy_topic", e.target.value)}
              placeholder="e.g. myname-9f3a7b2c4d8e1-chat"
            />
          </div>
          <div className="space-y-1">
            <Label>ntfy server (fixed)</Label>
            <div className="flex items-center gap-2">
              <Input value={NTFY_SERVER_URL} readOnly disabled className="font-mono text-xs" />
              <Button type="button" size="sm" variant="outline" onClick={copyServerUrl}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This server is required and cannot be changed.
            </p>
          </div>
        </div>

        <ChannelBlock
          label="Direct messages"
          mode={prefs.dm_mode}
          onMode={(m) => update("dm_mode", m)}
          titleVal={prefs.dm_title_template}
          bodyVal={prefs.dm_body_template}
          onTitle={(v) => update("dm_title_template", v)}
          onBody={(v) => update("dm_body_template", v)}
          customEnabled={prefs.dm_custom_enabled}
          onCustomEnabled={(v) => update("dm_custom_enabled", v)}
          defaultTitle={DEFAULTS.dm_title_template}
          defaultBody={DEFAULTS.dm_body_template}
        />
        <ChannelBlock
          label="Global chat"
          mode={prefs.global_mode}
          onMode={(m) => update("global_mode", m)}
          titleVal={prefs.global_title_template}
          bodyVal={prefs.global_body_template}
          onTitle={(v) => update("global_title_template", v)}
          onBody={(v) => update("global_body_template", v)}
          customEnabled={prefs.global_custom_enabled}
          onCustomEnabled={(v) => update("global_custom_enabled", v)}
          defaultTitle={DEFAULTS.global_title_template}
          defaultBody={DEFAULTS.global_body_template}
        />
        <ChannelBlock
          label="Announcements"
          mode={prefs.announcement_mode}
          onMode={(m) => update("announcement_mode", m)}
          titleVal={prefs.announcement_title_template}
          bodyVal={prefs.announcement_body_template}
          onTitle={(v) => update("announcement_title_template", v)}
          onBody={(v) => update("announcement_body_template", v)}
          customEnabled={prefs.announcement_custom_enabled}
          onCustomEnabled={(v) => update("announcement_custom_enabled", v)}
          defaultTitle={DEFAULTS.announcement_title_template}
          defaultBody={DEFAULTS.announcement_body_template}
        />

        <div className="space-y-1 max-w-xs">
          <Label>Digest cooldown (minutes)</Label>
          <Input
            type="number"
            min={1}
            value={prefs.digest_cooldown_minutes}
            onChange={(e) => update("digest_cooldown_minutes", Math.max(1, Number(e.target.value) || 1))}
          />
          <p className="text-xs text-muted-foreground">
            How long to wait after a "one per cooldown" notification before sending another for the same channel/DM.
          </p>
        </div>

        <div className="flex gap-3">
          <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save settings"}</Button>
          <Button variant="outline" onClick={sendTest}>Send test notification</Button>
        </div>
      </CardContent>
    </Card>
  );
}
