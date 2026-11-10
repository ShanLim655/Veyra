import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { authRequest, notifyAuthChanged } from "@/lib/authApi";
import { isNativeVeyraApp, openSystemBrowser, setNativeSessionToken } from "@/lib/nativeSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Mail, Lock, User, Eye, EyeOff } from "lucide-react";
import { useCooldown, formatCooldown } from "@/lib/cooldown";
import HCaptcha from "@hcaptcha/react-hcaptcha";

type Mode = "login" | "signup" | "forgot";

const RESET_EMAIL_COOLDOWN_MS = 60 * 1000;

export default function Auth() {
  const [mode, setMode] = useState<Mode>("login");
  const isLogin = mode === "login";
  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleProgress, setGoogleProgress] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<HCaptcha>(null);
  const navigate = useNavigate();
  const siteKey = import.meta.env.VITE_HCAPTCHA_SITE_KEY;
  const requestedReturnTo = new URLSearchParams(window.location.search).get('returnTo') || '/';
  const returnTo = requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//') ? requestedReturnTo : '/';

  // Reset the captcha widget when switching auth modes so the token cannot be reused across flows.
  useEffect(() => {
    captchaRef.current?.resetCaptcha();
    setCaptchaToken(null);
  }, [mode]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");
    const oauthError = url.searchParams.get("error");
    const oauthMessages: Record<string, string> = {
      google_not_configured: "Google sign-in needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API server.",
      google_access_denied: "Google sign-in was cancelled.",
      google_state_invalid: "The Google sign-in session expired. Please try again.",
      google_email_not_supported: "Use a Gmail or Google Workspace address to sign in with Google.",
      google_auth_failed: "Google could not sign you in. Please try again.",
    };
    if (oauthError) {
      toast({ title: "Google sign-in failed", description: oauthMessages[oauthError] || "Google could not sign you in. Please try again.", variant: "destructive" });
      url.searchParams.delete("error");
    }
    if (!token) {
      if (oauthError) window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      return;
    }
    authRequest("verify", { token })
      .then(() => toast({ title: "Email confirmed", description: "Your account is ready. Sign in to continue." }))
      .catch((error: unknown) => toast({ title: "Could not confirm email", description: error instanceof Error ? error.message : "Request a new confirmation email.", variant: "destructive" }))
      .finally(() => {
        url.searchParams.delete("token");
        window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      });
  }, []);

  // Per-email cooldown so spamming the form for one address doesn't block others.
  const normalizedEmail = email.trim().toLowerCase();
  const resetCooldown = useCooldown(
    normalizedEmail ? `rl:pwreset:${normalizedEmail}` : "rl:pwreset:empty"
  );

  const resetCaptcha = () => {
    captchaRef.current?.resetCaptcha();
    setCaptchaToken(null);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isForgot) {
      if (resetCooldown.remaining > 0) {
        toast({
          title: "Please wait",
          description: `You can request another reset email for this address in ${formatCooldown(
            resetCooldown.remaining
          )}.`,
          variant: "destructive",
        });
        return;
      }
      setLoading(true);
      try {
        await authRequest("forgot", { email, captchaToken });
        resetCooldown.trigger(RESET_EMAIL_COOLDOWN_MS);
        toast({
          title: "Check your email",
          description: "If an account exists for this email, a reset link has been sent.",
        });
        resetCaptcha();
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        resetCaptcha();
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure your passwords match.",
        variant: "destructive",
      });
      resetCaptcha();
      return;
    }

    if (!isLogin && password.length < 8) {
      toast({
        title: "Password too short",
        description: "Password must be at least 8 characters.",
        variant: "destructive",
      });
      resetCaptcha();
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        await authRequest("login", { email, password, captchaToken });
        notifyAuthChanged();
        toast({ title: "Welcome back!", description: "Successfully logged in." });
        navigate(returnTo);
      } else {
        const result = await authRequest<{ ok: boolean; message: string }>("signup", {
          email, password, captchaToken, username: username || email.split("@")[0], display_name: username || email.split("@")[0],
        });
        toast({
          title: "Account created!",
          description: result.message,
        });
        resetCaptcha();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setGoogleProgress('');
    try {
      if (!isNativeVeyraApp()) {
        const query = returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
        window.location.assign(`/api/auth/google${query}`);
        return;
      }

      const clientId = window.veyraDesktop ? 'desktop' : 'android';
      const pairing = await authRequest<{ code: string; approveUrl: string; expiresIn: number }>(
        'native/pair/start', { clientId },
      );
      setGoogleProgress('Finish sign-in in your browser, then approve this device.');
      await openSystemBrowser(pairing.approveUrl);

      const expiresAt = Date.now() + pairing.expiresIn * 1000;
      while (Date.now() < expiresAt) {
        const result = await authRequest<{ pending?: boolean; token?: string; clientId?: string }>(
          'native/exchange', { code: pairing.code, clientId },
        );
        if (result.token) {
          if (result.clientId !== clientId) throw new Error('This pairing request belongs to a different Veyra app.');
          await setNativeSessionToken(result.token);
          notifyAuthChanged();
          toast({ title: 'Signed in', description: 'This app is now connected to your Veyra account.' });
          navigate('/');
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      throw new Error('Device approval expired. Please try signing in again.');
    } catch (error) {
      toast({
        title: 'Google sign-in failed',
        description: error instanceof Error ? error.message : 'Could not complete sign-in.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setGoogleProgress('');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <h1 className="sr-only">Sign in to Veyra</h1>
          <CardTitle className="text-2xl font-bold">
            {isForgot ? "Reset your password" : isLogin ? "Welcome Back" : "Create Account"}
          </CardTitle>
          <CardDescription>
            {isForgot
              ? "Enter your email and we'll send you a reset link."
              : isLogin
              ? "Sign in to continue chatting"
              : "Sign up to start chatting with friends"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAuth} className="space-y-4">
            {isSignup && (
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="Choose a username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>
            {!isForgot && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {isLogin && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode("forgot");
                        setPassword("");
                        setConfirmPassword("");
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )}
            {isSignup && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10 pr-10"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )}
            {siteKey && (
              <div className="flex justify-center">
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
              type="submit"
              className="w-full"
              disabled={loading || (isForgot && resetCooldown.remaining > 0) || !captchaToken}
            >
              {loading
                ? "Loading..."
                : isForgot
                ? resetCooldown.remaining > 0
                  ? `Try again in ${formatCooldown(resetCooldown.remaining)}`
                  : "Send reset link"
                : isLogin
                ? "Sign In"
                : "Sign Up"}
            </Button>
          </form>
          {!isForgot && (
            <>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={loading}
                onClick={() => void handleGoogleSignIn()}
              >
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path fill="#4285F4" d="M14.9 8.161c0-.476-.039-.954-.121-1.422h-6.64v2.695h3.802a3.24 3.24 0 01-1.407 2.127v1.75h2.269c1.332-1.22 2.097-3.02 2.097-5.15z"/>
                  <path fill="#34A853" d="M8.14 15c1.898 0 3.499-.62 4.665-1.69l-2.268-1.749c-.631.427-1.446.669-2.395.669-1.836 0-3.393-1.232-3.952-2.888H1.85v1.803A7.044 7.044 0 008.14 15z"/>
                  <path fill="#FBBC04" d="M4.187 9.342a4.17 4.17 0 010-2.68V4.859H1.849a6.97 6.97 0 000 6.286l2.338-1.803z"/>
                  <path fill="#EA4335" d="M8.14 3.77a3.837 3.837 0 012.7 1.05l2.01-1.999a6.786 6.786 0 00-4.71-1.82 7.042 7.042 0 00-6.29 3.858L4.186 6.66c.556-1.658 2.116-2.89 3.952-2.89z"/>
                </svg>
                {googleProgress ? 'Waiting for approval…' : 'Continue with Google'}
              </Button>
              {googleProgress && <p className="mt-2 text-center text-xs text-muted-foreground">{googleProgress}</p>}
            </>
          )}
          <div className="mt-4 text-center space-y-2">
            {isForgot ? (
              <button
                type="button"
                onClick={() => setMode("login")}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Back to sign in
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode(isLogin ? "signup" : "login");
                  setConfirmPassword("");
                }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {isLogin
                  ? "Don't have an account? Sign up"
                  : "Already have an account? Sign in"}
              </button>
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
