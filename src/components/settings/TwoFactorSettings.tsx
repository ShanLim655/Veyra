import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldOff, Loader2 } from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

type Factor = { id: string; friendly_name: string | null; status: string };

export default function TwoFactorSettings() {
  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");

  const verified = factors.filter((f) => f.status === "verified");

  const loadFactors = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      toast({ title: "Couldn't load 2FA", description: error.message, variant: "destructive" });
    } else {
      setFactors((data?.all as Factor[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadFactors();
  }, []);

  const startEnroll = async () => {
    setEnrolling(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${Date.now()}`,
      });
      if (error) throw error;
      setPending({
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setCode("");
    } catch (e: any) {
      toast({ title: "Couldn't start setup", description: e.message, variant: "destructive" });
      setEnrolling(false);
    }
  };

  const cancelEnroll = async () => {
    if (pending) {
      await supabase.auth.mfa.unenroll({ factorId: pending.factorId }).catch(() => {});
    }
    setPending(null);
    setEnrolling(false);
    setCode("");
    loadFactors();
  };

  const verifyEnroll = async () => {
    if (!pending || code.length !== 6) return;
    setBusy(true);
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({
        factorId: pending.factorId,
      });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: pending.factorId,
        challengeId: challenge.id,
        code,
      });
      if (vErr) throw vErr;
      toast({ title: "Two-factor authentication enabled" });
      setPending(null);
      setEnrolling(false);
      setCode("");
      loadFactors();
    } catch (e: any) {
      toast({ title: "Invalid code", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const removeFactor = async (factorId: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      toast({ title: "Two-factor authentication disabled" });
      loadFactors();
    } catch (e: any) {
      toast({ title: "Couldn't disable 2FA", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Two-Factor Authentication
        </CardTitle>
        <CardDescription>
          Add an extra layer of security using an authenticator app (TOTP).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : pending ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password…),
              then enter the 6-digit code to confirm.
            </p>
            <div className="flex flex-col items-center gap-3">
              <img
                src={pending.qr}
                alt="2FA QR code"
                className="h-44 w-44 rounded-lg border border-border bg-white p-2"
              />
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Or enter this key manually:</p>
                <code className="text-xs break-all font-mono">{pending.secret}</code>
              </div>
            </div>
            <div className="flex flex-col items-center gap-3">
              <Label>Verification code</Label>
              <InputOTP maxLength={6} value={code} onChange={setCode}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={cancelEnroll} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={verifyEnroll} disabled={busy || code.length !== 6}>
                {busy ? "Verifying…" : "Enable 2FA"}
              </Button>
            </div>
          </div>
        ) : verified.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-emerald-500">
              <ShieldCheck className="h-4 w-4" />
              Two-factor authentication is enabled.
            </div>
            {verified.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div className="text-sm">
                  <p className="font-medium">{f.friendly_name || "Authenticator app"}</p>
                  <p className="text-xs text-muted-foreground">TOTP</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => removeFactor(f.id)}
                  disabled={busy}
                >
                  <ShieldOff className="h-4 w-4" />
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You don't have two-factor authentication set up yet.
            </p>
            <Button onClick={startEnroll} disabled={enrolling} className="gap-2">
              {enrolling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              Set up authenticator app
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
