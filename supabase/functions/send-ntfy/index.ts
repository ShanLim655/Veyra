// Sends ntfy.sh notifications when chat messages are inserted.
// Invoked by Postgres triggers via pg_net (no JWT).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Channel = "dm" | "global" | "announcement";
type Mode = "off" | "every" | "digest";

const NTFY_SERVER_UNAVAILABLE =
  "The ntfy server is currently unavailable.";

const DEFAULT_NTFY_SERVER = "https://ntfy.chat-amani.xyz";

const DEFAULT_TEMPLATES: Record<Channel, { title: string; body: string }> = {
  dm: { title: "New message from {user}", body: "{message}" },
  global: { title: "{user} in Global Chat", body: "{message}" },
  announcement: { title: "Announcement from {user}", body: "{message}" },
};

interface Payload {
  channel: Channel;
  message_id: string;
  sender_id: string | null;
  content: string;
  conversation_id: string | null;
  trigger_event_id?: string | null;
  trigger_token?: string | null;
}

function render(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

const ALLOWED_NTFY_HOSTS = ["ntfy.sh", "ntfy.chat-amani.xyz"];

function isAllowedNtfyServer(server: string | null | undefined): boolean {
  try {
    const url = new URL((server || DEFAULT_NTFY_SERVER).replace(/\/+$/, ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return ALLOWED_NTFY_HOSTS.some(
      (h) => url.hostname === h || url.hostname.endsWith("." + h),
    );
  } catch {
    return false;
  }
}

async function sendNtfy(server: string, topic: string, title: string, body: string): Promise<boolean> {
  if (!isAllowedNtfyServer(server)) {
    console.warn("Blocked ntfy server (not in allowlist):", server);
    return false;
  }
  const base = (server || DEFAULT_NTFY_SERVER).replace(/\/+$/, "");
  const cleanTopic = topic.trim();
  try {
    const response = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: cleanTopic, title, message: body }),
    });
    if (!response.ok) {
      console.error("ntfy publish failed", response.status, await response.text());
      return false;
    }
    console.log("ntfy publish ok", { topic: cleanTopic, status: response.status });
    return true;
  } catch (e) {
    console.error("ntfy send failed", e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Test-notification branch: authenticated user can send a test to their own topic.
  if ((payload as any).test === true) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("ntfy_server, ntfy_topic")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    const topic = (prefs?.ntfy_topic ?? "").trim();
    if (!topic) {
      return new Response(JSON.stringify({ error: "Set a topic first" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const server = prefs?.ntfy_server || DEFAULT_NTFY_SERVER;
    const ok = await sendNtfy(server, topic, "Test notification", "If you can see this, ntfy is set up correctly!");
    return new Response(JSON.stringify({ ok, error: ok ? null : NTFY_SERVER_UNAVAILABLE }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Authorize: only the Postgres trigger can call this, and only once per
  // message. The trigger writes a row to notification_trigger_events with a
  // random token; we delete-and-return it here. No row, no notification.
  if (!payload.trigger_event_id || !payload.trigger_token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: triggerEvent, error: triggerEventError } = await supabase
    .from("notification_trigger_events")
    .delete()
    .eq("id", payload.trigger_event_id)
    .eq("token", payload.trigger_token)
    .eq("message_id", payload.message_id)
    .eq("channel", payload.channel)
    .select("id")
    .maybeSingle();

  if (triggerEventError || !triggerEvent) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {

    // Sender display
    let senderName = "Someone";
    if (payload.sender_id) {
      const { data: sender } = await supabase
        .from("profiles")
        .select("username, display_name")
        .eq("id", payload.sender_id)
        .maybeSingle();
      senderName = sender?.display_name || sender?.username || senderName;
    }

    // Determine recipients
    let recipientIds: string[] = [];
    if (payload.channel === "dm" && payload.conversation_id) {
      const { data: members } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", payload.conversation_id);
      recipientIds = (members ?? [])
        .map((m: any) => m.user_id)
        .filter((id: string) => id !== payload.sender_id);
    } else {
      // global / announcement: every user with prefs except sender
      const { data: prefs } = await supabase
        .from("notification_preferences")
        .select("user_id");
      recipientIds = (prefs ?? [])
        .map((p: any) => p.user_id)
        .filter((id: string) => id !== payload.sender_id);
    }

    if (recipientIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: allPrefs } = await supabase
      .from("notification_preferences")
      .select("*")
      .in("user_id", recipientIds);

    let sent = 0;
    let failed = 0;
    const publishedTopics = new Set<string>();
    for (const p of allPrefs ?? []) {
      if (!p.ntfy_topic) continue;

      // Dedupe: if multiple users share the same ntfy server+topic,
      // only publish once per (server,topic) per message.
      const dedupeKey = `${(p.ntfy_server || DEFAULT_NTFY_SERVER).replace(/\/+$/, "")}|${p.ntfy_topic.trim()}`;
      if (publishedTopics.has(dedupeKey)) continue;
      publishedTopics.add(dedupeKey);

      const mode: Mode =
        payload.channel === "dm" ? p.dm_mode :
        payload.channel === "global" ? p.global_mode :
        p.announcement_mode;
      if (mode === "off") continue;

      const channelKey =
        payload.channel === "dm" ? `dm:${payload.conversation_id}` :
        payload.channel;

      if (mode === "digest") {
        const { data: state } = await supabase
          .from("notification_digest_state")
          .select("last_notified_at")
          .eq("user_id", p.user_id)
          .eq("channel_key", channelKey)
          .maybeSingle();
        const cooldownMs = (p.digest_cooldown_minutes ?? 10) * 60_000;
        if (state?.last_notified_at) {
          const age = Date.now() - new Date(state.last_notified_at).getTime();
          if (age < cooldownMs) continue;
        }
        await supabase
          .from("notification_digest_state")
          .upsert({
            user_id: p.user_id,
            channel_key: channelKey,
            last_notified_at: new Date().toISOString(),
          });

        const title =
          payload.channel === "dm" ? "New messages" :
          payload.channel === "global" ? "New global chat messages" :
          "New announcements";
        const body =
          payload.channel === "dm" ? "You have new direct messages." :
          payload.channel === "global" ? "There's new activity in Global Chat." :
          "There are new announcements.";
        if (await sendNtfy(p.ntfy_server, p.ntfy_topic, title, body)) sent++;
        else failed++;
        continue;
      }

      // mode === 'every': use templates
      const customEnabled =
        payload.channel === "dm" ? !!p.dm_custom_enabled :
        payload.channel === "global" ? !!p.global_custom_enabled :
        !!p.announcement_custom_enabled;
      const defaults = DEFAULT_TEMPLATES[payload.channel];
      const titleTpl = customEnabled
        ? (payload.channel === "dm" ? p.dm_title_template :
           payload.channel === "global" ? p.global_title_template :
           p.announcement_title_template)
        : defaults.title;
      const bodyTpl = customEnabled
        ? (payload.channel === "dm" ? p.dm_body_template :
           payload.channel === "global" ? p.global_body_template :
           p.announcement_body_template)
        : defaults.body;
      const vars = { user: senderName, message: payload.content || "(no text)" };
      if (await sendNtfy(p.ntfy_server, p.ntfy_topic, render(titleTpl, vars), render(bodyTpl, vars))) sent++;
      else failed++;
    }

    return new Response(JSON.stringify({ ok: failed === 0, sent, failed, error: failed > 0 ? NTFY_SERVER_UNAVAILABLE : null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message ?? "error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
