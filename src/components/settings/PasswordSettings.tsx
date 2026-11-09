import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { KeyRound, Eye, EyeOff, Mail } from "lucide-react";
import { useCooldown, formatCooldown } from "@/lib/cooldown";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import TwoFactorChallengeDialog from "@/components/settings/TwoFactorChallengeDialog";
import { hasVerifiedMfa } from "@/lib/mfa";

const RESET_EMAIL_COOLDOWN_MS = 60 * 1000; // 1 minute between reset emails
const CHANGE_PASSWORD_COOLDOWN_MS = 30 * 1000; // 30s between change attempts

export default function PasswordSettings() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<HCaptcha>(null);
  const siteKey = import.meta.env.VITE_HCAPTCHA_SITE_KEY;

  const resetCooldown = useCooldown(user ? `rl:pwreset:${user.id}` : "rl:pwreset:anon");
  const changeCooldown = useCooldown(user ? `rl:pwchange:${user.id}` : "rl:pwchange:anon");

  const handleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;

    if (changeCooldown.remaining > 0) {
      toast({
        title: "Please wait",
        description: `You can try again in ${formatCooldown(changeCooldown.remaining)}.`,
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({ title: "Password too short", description: "At least 6 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (newPassword === currentPassword) {
      toast({ title: "New password must be different", variant: "destructive" });
      return;
    }

    setLoading(true);
    // Re-verify the current password by signing in again.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verifyError) {
      setLoading(false);
      // Start cooldown on failed attempt to slow brute-force guessing.
      changeCooldown.trigger(CHANGE_PASSWORD_COOLDOWN_MS);
      toast({ title: "Current password is incorrect", variant: "destructive" });
      return;
    }

    // If the user has 2FA enabled, ask for a code before applying the change.
    const needsMfa = await hasVerifiedMfa();
    setLoading(false);
    if (needsMfa) {
      setMfaOpen(true);
      return;
    }

    await performUpdate();
  };

  const performUpdate = async () => {
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) {
      toast({ title: "Could not update password", description: error.message, variant: "destructive" });
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    toast({ title: "Password updated" });
  };

  const sendResetEmail = async () => {
    if (!user?.email) return;
    if (resetCooldown.remaining > 0) {
      toast({
        title: "Please wait",
        description: `You can request another reset email in ${formatCooldown(resetCooldown.remaining)}.`,
        variant: "destructive",
      });
      return;
    }
    if (siteKey && !captchaToken) {
      toast({
        title: "Captcha required",
        description: "Please complete the captcha challenge before requesting a reset email.",
        variant: "destructive",
      });
      return;
    }
    setResetting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
      captchaToken: captchaToken ?? undefined,
    });
    setResetting(false);
    captchaRef.current?.resetCaptcha();
    setCaptchaToken(null);
    if (error) {
      toast({ title: "Could not send email", description: error.message, variant: "destructive" });
      return;
    }
    resetCooldown.trigger(RESET_EMAIL_COOLDOWN_MS);
    toast({ title: "Email sent", description: `Check ${user.email} for a reset link.` });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Password
        </CardTitle>
        <CardDescription>
          Change your password by entering your current one, or have a reset link sent to your email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleChange} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current">Current password</Label>
            <div className="relative">
              <Input
                id="current"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new">New password</Label>
            <div className="relative">
              <Input
                id="new"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pr-10"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new">Confirm new password</Label>
            <Input
              id="confirm-new"
              type={showNew ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <div className="space-y-1">
            <Button
              type="submit"
              disabled={
                loading ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword ||
                changeCooldown.remaining > 0
              }
            >
              {loading
                ? "Updating..."
                : changeCooldown.remaining > 0
                ? `Try again in ${formatCooldown(changeCooldown.remaining)}`
                : "Update password"}
            </Button>
          </div>
        </form>

        <div className="border-t pt-4">
          <p className="text-sm font-medium mb-1">Forgot your current password?</p>
          <p className="text-xs text-muted-foreground mb-3">
            We'll email a reset link to <span className="font-mono">{user?.email}</span>. You can request one
            email per minute.
          </p>
          {siteKey && (
            <div className="flex justify-start mb-3">
              <HCaptcha
                ref={captchaRef}
                sitekey={siteKey}
                theme="dark"
                onVerify={(token) => setCaptchaToken(token)}
                onExpire={() => setCaptchaToken(null)}
              />
            </div>
          )}
          <Button
            variant="outline"
            onClick={sendResetEmail}
            disabled={resetting || resetCooldown.remaining > 0 || (!!siteKey && !captchaToken)}
            className="gap-2"
          >
            <Mail className="h-4 w-4" />
            {resetting
              ? "Sending..."
              : resetCooldown.remaining > 0
              ? `Wait ${formatCooldown(resetCooldown.remaining)}`
              : "Send password reset email"}
          </Button>
        </div>
      </CardContent>

      <TwoFactorChallengeDialog
        open={mfaOpen}
        onOpenChange={setMfaOpen}
        description="Enter the 6-digit code from your authenticator app to confirm your password change."
        onVerified={performUpdate}
      />
    </Card>
  );
}
