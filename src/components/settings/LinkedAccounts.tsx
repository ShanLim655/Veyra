import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Link2, Unlink } from "lucide-react";

type Identity = {
  identity_id: string;
  id: string;
  user_id: string;
  provider: string;
  identity_data?: Record<string, any>;
};

const LINK_RESTORE_KEY = "veyra-link-restore-meta";
const LEGACY_LINK_RESTORE_KEY = "chatt-link-restore-meta";

export default function LinkedAccounts() {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    const { data } = await supabase.auth.getUserIdentities();
    setIdentities((data?.identities as Identity[]) || []);
  };

  useEffect(() => {
    refresh();

    // After returning from a Google link redirect, Supabase merges the Google
    // profile into auth.users metadata, which overwrites the user's chosen
    // display_name/username. Restore them from the snapshot we took pre-link.
    const raw = window.localStorage.getItem(LINK_RESTORE_KEY)
      ?? window.localStorage.getItem(LEGACY_LINK_RESTORE_KEY);
    if (raw) {
      window.localStorage.removeItem(LINK_RESTORE_KEY);
      window.localStorage.removeItem(LEGACY_LINK_RESTORE_KEY);
      try {
        const meta = JSON.parse(raw) as { display_name?: string; username?: string };
        supabase.auth
          .updateUser({ data: meta })
          .then(() => refresh())
          .catch(() => {});
      } catch {
        // ignore malformed snapshot
      }
    }
  }, []);

  const google = identities.find((i) => i.provider === "google");

  const handleLinkGoogle = async () => {
    setLoading(true);
    try {
      // Snapshot current metadata so we can restore it after the OAuth redirect.
      const { data: userRes } = await supabase.auth.getUser();
      const meta = userRes.user?.user_metadata || {};
      window.localStorage.setItem(
        LINK_RESTORE_KEY,
        JSON.stringify({
          display_name: meta.display_name,
          username: meta.username,
        })
      );

      const { error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/settings` },
      });
      if (error) throw error;
    } catch (error: any) {
      window.localStorage.removeItem(LINK_RESTORE_KEY);
      window.localStorage.removeItem(LEGACY_LINK_RESTORE_KEY);
      toast({ title: "Error linking Google", description: error.message, variant: "destructive" });
      setLoading(false);
    }
  };


  const handleUnlinkGoogle = async () => {
    if (!google) return;
    if (identities.length <= 1) {
      toast({
        title: "Cannot unlink",
        description: "You must have at least one sign-in method linked.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.unlinkIdentity(google as any);
      if (error) throw error;
      toast({ title: "Google account unlinked" });
      await refresh();
    } catch (error: any) {
      toast({ title: "Error unlinking", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Linked Accounts
        </CardTitle>
        <CardDescription>Connect social accounts to sign in faster</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 p-3 rounded-md border border-border">
          <div className="flex items-center gap-3 min-w-0">
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path fill="#4285F4" d="M14.9 8.161c0-.476-.039-.954-.121-1.422h-6.64v2.695h3.802a3.24 3.24 0 01-1.407 2.127v1.75h2.269c1.332-1.22 2.097-3.02 2.097-5.15z"/>
              <path fill="#34A853" d="M8.14 15c1.898 0 3.499-.62 4.665-1.69l-2.268-1.749c-.631.427-1.446.669-2.395.669-1.836 0-3.393-1.232-3.952-2.888H1.85v1.803A7.044 7.044 0 008.14 15z"/>
              <path fill="#FBBC04" d="M4.187 9.342a4.17 4.17 0 010-2.68V4.859H1.849a6.97 6.97 0 000 6.286l2.338-1.803z"/>
              <path fill="#EA4335" d="M8.14 3.77a3.837 3.837 0 012.7 1.05l2.01-1.999a6.786 6.786 0 00-4.71-1.82 7.042 7.042 0 00-6.29 3.858L4.186 6.66c.556-1.658 2.116-2.89 3.952-2.89z"/>
            </svg>
            <div className="min-w-0">
              <p className="font-medium">Google</p>
              <p className="text-xs text-muted-foreground truncate">
                {google ? google.identity_data?.email || "Linked" : "Not linked"}
              </p>
            </div>
          </div>
          {google ? (
            <Button variant="outline" size="sm" disabled={loading} onClick={handleUnlinkGoogle} className="gap-2">
              <Unlink className="h-4 w-4" />
              Unlink
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={loading} onClick={handleLinkGoogle} className="gap-2">
              <Link2 className="h-4 w-4" />
              Link
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
