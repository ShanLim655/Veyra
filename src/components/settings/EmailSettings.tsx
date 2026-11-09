import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Mail } from "lucide-react";
import { useCooldown, formatCooldown } from "@/lib/cooldown";
import TwoFactorChallengeDialog from "@/components/settings/TwoFactorChallengeDialog";
import { hasVerifiedMfa } from "@/lib/mfa";

const CHANGE_EMAIL_COOLDOWN_MS = 60 * 1000;

export default function EmailSettings() {
  const { user } = useAuth();
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const cooldown = useCooldown(user ? `rl:emailchange:${user.id}` : "rl:emailchange:anon");

  const performUpdate = async () => {
    const target = newEmail.trim().toLowerCase();
    setLoading(true);
    const { error } = await supabase.auth.updateUser(
      { email: target },
      { emailRedirectTo: window.location.origin },
    );
    setLoading(false);

    if (error) {
      toast({ title: "Could not change email", description: error.message, variant: "destructive" });
      return;
    }

    cooldown.trigger(CHANGE_EMAIL_COOLDOWN_MS);
    setNewEmail("");
    toast({
      title: "Confirm your new email",
      description:
        "We've sent a confirmation link to your new email address. The change takes effect once you click it.",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;

    const target = newEmail.trim().toLowerCase();
    if (!target) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      toast({ title: "Invalid email", description: "Enter a valid email address.", variant: "destructive" });
      return;
    }
    if (target === user.email.toLowerCase()) {
      toast({ title: "That's already your email", variant: "destructive" });
      return;
    }
    if (cooldown.remaining > 0) {
      toast({
        title: "Please wait",
        description: `You can try again in ${formatCooldown(cooldown.remaining)}.`,
        variant: "destructive",
      });
      return;
    }

    // If the user has 2FA enabled, ask for a code before applying the change.
    setLoading(true);
    const needsMfa = await hasVerifiedMfa();
    setLoading(false);
    if (needsMfa) {
      setMfaOpen(true);
      return;
    }

    await performUpdate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Address
        </CardTitle>
        <CardDescription>
          Change the email you use to sign in. You'll need to confirm the change from a link sent to
          your new address.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-email">Current email</Label>
            <Input id="current-email" value={user?.email ?? ""} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-email">New email</Label>
            <Input
              id="new-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={loading || cooldown.remaining > 0}>
            {loading
              ? "Sending..."
              : cooldown.remaining > 0
                ? `Try again in ${formatCooldown(cooldown.remaining)}`
                : "Send confirmation link"}
          </Button>
        </form>
      </CardContent>

      <TwoFactorChallengeDialog
        open={mfaOpen}
        onOpenChange={setMfaOpen}
        description="Enter the 6-digit code from your authenticator app to confirm your email change."
        onVerified={performUpdate}
      />
    </Card>
  );
}
