import { supabase } from "@/integrations/supabase/client";

export async function markAnnouncementsRead(userId: string) {
  const { data: latestAnnouncement, error: latestError } = await supabase
    .from("announcement_messages")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) throw latestError;

  const readAt = latestAnnouncement?.created_at ?? new Date().toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({ announcements_last_read_at: readAt })
    .eq("id", userId);

  if (error) throw error;

  return readAt;
}