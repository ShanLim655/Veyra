import { supabase } from "@/integrations/supabase/client";

export type AdminAction = 
  | "role_change"
  | "role_remove"
  | "message_delete"
  | "message_edit"
  | "user_ban"
  | "user_unban"
  | "announcement_create"
  | "announcement_delete";

export interface LogDetails {
  [key: string]: unknown;
}

export async function logAdminAction(
  action: AdminAction,
  targetType: string,
  targetId?: string,
  details?: LogDetails
): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error("No authenticated user for admin log");
      return false;
    }

    const insertData = {
      admin_id: user.id,
      action,
      target_type: targetType,
      target_id: targetId || null,
      details: details ? JSON.parse(JSON.stringify(details)) : null,
    };

    const { error } = await supabase.from("admin_logs").insert(insertData);

    if (error) {
      console.error("Error logging admin action:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Error logging admin action:", err);
    return false;
  }
}
