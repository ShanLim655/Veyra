import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Users, Loader2 } from "lucide-react";

export default function PrivacySettings() {
  const { user } = useAuth();
  const [allow, setAllow] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("allow_friend_requests")
        .eq("id", user.id)
        .maybeSingle();
      if (data) setAllow((data as any).allow_friend_requests ?? true);
      setLoading(false);
    })();
  }, [user]);

  const toggle = async (next: boolean) => {
    if (!user) return;
    setAllow(next);
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ allow_friend_requests: next } as any)
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      setAllow(!next);
      toast({ title: "Couldn't update setting", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: next ? "Friend requests enabled" : "Friend requests disabled",
      description: next
        ? "Other people can send you friend requests again."
        : "New friend requests are now blocked. Existing friends are unaffected.",
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Friend Requests
        </CardTitle>
        <CardDescription>
          Control who can reach out to you and reduce unwanted social interactions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="allow-friend-requests" className="text-sm font-medium">
              Allow friend requests
            </Label>
            <p className="text-xs text-muted-foreground">
              When off, no one can send you new friend requests.
            </p>
          </div>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              id="allow-friend-requests"
              checked={allow}
              onCheckedChange={toggle}
              disabled={saving}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
