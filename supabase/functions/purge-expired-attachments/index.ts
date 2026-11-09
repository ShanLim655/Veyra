import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPIRED_PLACEHOLDER = "/expired-attachment.png";
const CHAT_BUCKETS = ["chat-images", "chat-videos", "chat-voice"];
const TABLES = ["messages", "global_messages", "announcement_messages"];

function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(
      /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/]+)\/(.+)$/,
    );
    if (!m) return null;
    const bucket = decodeURIComponent(m[1]);
    if (!CHAT_BUCKETS.includes(bucket)) return null;
    const path = decodeURIComponent(m[2]).split("?")[0];
    return { bucket, path };
  } catch {
    return null;
  }
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function extractUrl(item: string): string | null {
  if (item.startsWith("video:")) return item.slice(6);
  if (item.startsWith("audio:")) {
    const without = item.slice(6);
    const lc = without.lastIndexOf(":");
    return lc > 0 ? without.slice(0, lc) : without;
  }
  if (item.startsWith("music:") || item.startsWith("file:")) {
    try {
      const payload = item.startsWith("music:") ? item.slice(6) : item.slice(5);
      const meta = JSON.parse(b64urlDecode(payload));
      return meta?.url ?? null;
    } catch {
      return null;
    }
  }
  if (item.startsWith("expired:")) return null;
  return item;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // --- Authorization gate -------------------------------------------------
  // Accept either:
  //   (a) a shared cron secret in `x-cron-secret` (used by pg_cron / external schedulers), or
  //   (b) a signed-in super_admin JWT in the Authorization header.
  const cronSecret = Deno.env.get("PURGE_CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  let authorized = false;

  if (cronSecret && providedSecret && providedSecret === cronSecret) {
    authorized = true;
  } else {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: authHeader } },
        });
        const token = authHeader.replace("Bearer ", "");
        const { data: claimsData } = await userClient.auth.getClaims(token);
        const uid = claimsData?.claims?.sub as string | undefined;
        if (uid) {
          const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
          const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: uid });
          if (isSuper === true) authorized = true;
        }
      } catch (e) {
        console.warn("Auth check failed:", (e as Error).message);
      }
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // ------------------------------------------------------------------------

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Collect admin/super_admin user ids to exempt
  const { data: adminRows } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["admin", "super_admin"]);
  const exemptIds = new Set((adminRows || []).map((r: any) => r.user_id));

  const summary: Record<string, { scanned: number; purged: number; objectsDeleted: number }> = {};

  for (const table of TABLES) {
    summary[table] = { scanned: 0, purged: 0, objectsDeleted: 0 };
    let lastDate: string | null = null;
    // Page through old messages with attachments
    while (true) {
      let q = supabase
        .from(table)
        .select("id, sender_id, image_url, created_at")
        .lt("created_at", cutoff)
        .not("image_url", "is", null)
        .order("created_at", { ascending: true })
        .limit(500);
      if (lastDate) q = q.gt("created_at", lastDate);
      const { data, error } = await q;
      if (error) {
        console.error(`Error scanning ${table}:`, error.message);
        break;
      }
      if (!data || data.length === 0) break;
      summary[table].scanned += data.length;

      for (const row of data as any[]) {
        lastDate = row.created_at;
        if (row.sender_id && exemptIds.has(row.sender_id)) continue;

        let items: string[];
        try {
          const parsed = JSON.parse(row.image_url);
          items = Array.isArray(parsed) ? parsed : [row.image_url];
        } catch {
          items = [row.image_url];
        }
        const hasLive = items.some((i) => !i.startsWith("expired:"));
        if (!hasLive) continue;

        // Group object paths by bucket
        const byBucket: Record<string, string[]> = {};
        for (const item of items) {
          const url = extractUrl(item);
          if (!url) continue;
          const parsed = parseStorageUrl(url);
          if (!parsed) continue;
          (byBucket[parsed.bucket] ||= []).push(parsed.path);
        }
        for (const [bucket, paths] of Object.entries(byBucket)) {
          if (paths.length === 0) continue;
          const { error: delErr } = await supabase.storage.from(bucket).remove(paths);
          if (delErr) {
            console.warn(`Storage delete failed (${bucket}):`, delErr.message);
          } else {
            summary[table].objectsDeleted += paths.length;
          }
        }

        const replacement = JSON.stringify([`expired:${EXPIRED_PLACEHOLDER}`]);
        const { error: upErr } = await supabase
          .from(table)
          .update({ image_url: replacement })
          .eq("id", row.id);
        if (upErr) {
          console.error(`Update failed (${table}/${row.id}):`, upErr.message);
        } else {
          summary[table].purged++;
        }
      }

      if (data.length < 500) break;
    }
  }

  return new Response(JSON.stringify({ ok: true, cutoff, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
