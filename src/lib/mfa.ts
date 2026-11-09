import { supabase } from "@/integrations/supabase/client";

/** Returns true if the current user has at least one verified TOTP factor. */
export async function hasVerifiedMfa(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return false;
  return (data?.totp || []).some((f) => f.status === "verified");
}
