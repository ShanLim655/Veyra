import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { toast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful TOTP verification (session is elevated to AAL2). */
  onVerified: () => void;
  /** Optional callback when the user cancels the challenge. */
  onCancel?: () => void;
  title?: string;
  description?: string;
};

export default function TwoFactorChallengeDialog({
  open,
  onOpenChange,
  onVerified,
  onCancel,
  title = "Two-factor authentication",
  description = "Enter the 6-digit code from your authenticator app to continue.",
}: Props) {
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!open) {
      setCode("");
      setFactorId(null);
      setChallengeId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setPreparing(true);
      try {
        const { data: factorData, error: fErr } = await supabase.auth.mfa.listFactors();
        if (fErr) throw fErr;
        const totp = (factorData?.totp || []).find((f) => f.status === "verified");
        if (!totp) throw new Error("No authenticator app is set up.");
        const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({
          factorId: totp.id,
        });
        if (cErr) throw cErr;
        if (cancelled) return;
        setFactorId(totp.id);
        setChallengeId(challenge.id);
      } catch (e: any) {
        if (!cancelled) {
          toast({ title: "Couldn't start verification", description: e.message, variant: "destructive" });
          onOpenChange(false);
        }
      } finally {
        if (!cancelled) setPreparing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, onOpenChange]);

  const verify = async () => {
    if (!factorId || !challengeId || code.length !== 6) return;
    setVerifying(true);
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code,
      });
      if (error) throw error;
      onOpenChange(false);
      onVerified();
    } catch (e: any) {
      toast({ title: "Invalid code", description: e.message, variant: "destructive" });
      setCode("");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel?.();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {preparing ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing…
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2">
            <Label className="sr-only">Verification code</Label>
            <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus>
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
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onCancel?.();
              onOpenChange(false);
            }}
            disabled={verifying}
          >
            Cancel
          </Button>
          <Button onClick={verify} disabled={preparing || verifying || code.length !== 6}>
            {verifying ? "Verifying…" : "Verify"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
