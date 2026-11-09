import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

/**
 * Shows a blocking dialog for users (typically new Google signups) who haven't
 * picked their own username yet. Once they confirm one, profiles.username_set
 * is flipped to true so the dialog never re-appears.
 */
export default function UsernameSetupGate() {
  const { user, loading } = useAuth();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (loading || !user) {
      setChecked(false);
      setNeedsSetup(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username, display_name, username_set" as any)
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const profile = data as any;
      if (profile && profile.username_set === false) {
        setUsername(profile.username || "");
        setDisplayName(profile.display_name || profile.username || "");
        setNeedsSetup(true);
      }
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  const handleSave = async () => {
    if (!user) return;
    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 20) {
      toast({ title: "Invalid username", description: "Must be 3-20 characters.", variant: "destructive" });
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      toast({ title: "Invalid username", description: "Only letters, numbers, and underscores.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // Make sure it's not taken (case-insensitive)
      const { data: existing } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", trimmed)
        .neq("id", user.id)
        .maybeSingle();
      if (existing) {
        toast({ title: "Username taken", description: "Please pick another one.", variant: "destructive" });
        setSaving(false);
        return;
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          username: trimmed,
          display_name: displayName.trim() || trimmed,
          username_set: true,
        } as any)
        .eq("id", user.id);
      if (error) throw error;
      toast({ title: "Welcome!", description: "Your username has been set." });
      setNeedsSetup(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!checked || !needsSetup) return null;

  return (
    <Dialog open={needsSetup} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Choose your username</DialogTitle>
          <DialogDescription>
            Pick a username to finish setting up your account. You'll be known by this across the app.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="setup-username">Username</Label>
            <Input
              id="setup-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your_username"
              maxLength={20}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-display">Display name</Label>
            <Input
              id="setup-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              maxLength={40}
            />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? "Saving..." : "Continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
