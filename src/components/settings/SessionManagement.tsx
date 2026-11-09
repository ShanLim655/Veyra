import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Loader2, LogOut, Monitor, Smartphone, Tablet, ShieldAlert } from "lucide-react";

type Session = {
  id: string;
  created_at: string;
  updated_at: string;
  user_agent: string | null;
  ip: string | null;
  aal: string | null;
};

function decodeSessionId(accessToken: string | undefined): string | null {
  if (!accessToken) return null;
  try {
    const payload = JSON.parse(atob(accessToken.split(".")[1]));
    return payload.session_id ?? null;
  } catch {
    return null;
  }
}

function parseDevice(ua: string | null) {
  if (!ua) return { label: "Unknown device", icon: Monitor };
  const lower = ua.toLowerCase();
  let icon = Monitor;
  if (/ipad|tablet/.test(lower)) icon = Tablet;
  else if (/mobile|iphone|android/.test(lower)) icon = Smartphone;

  let os = "Unknown OS";
  if (/windows/.test(lower)) os = "Windows";
  else if (/iphone|ipad|ios/.test(lower)) os = "iOS";
  else if (/mac os|macintosh/.test(lower)) os = "macOS";
  else if (/android/.test(lower)) os = "Android";
  else if (/linux/.test(lower)) os = "Linux";

  let browser = "";
  if (/edg\//.test(lower)) browser = "Edge";
  else if (/chrome\//.test(lower) && !/edg\//.test(lower)) browser = "Chrome";
  else if (/firefox\//.test(lower)) browser = "Firefox";
  else if (/safari\//.test(lower) && !/chrome\//.test(lower)) browser = "Safari";

  return { label: browser ? `${browser} on ${os}` : os, icon };
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function SessionManagement() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    setCurrentId(decodeSessionId(sessionData.session?.access_token));
    const { data, error } = await supabase.rpc("get_user_sessions");
    if (error) {
      toast({ title: "Couldn't load sessions", description: error.message, variant: "destructive" });
    } else {
      setSessions((data as Session[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      const { error } = await supabase.rpc("revoke_user_session", { _session_id: id });
      if (error) throw error;
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast({ title: "Device signed out" });
    } catch (e: any) {
      toast({ title: "Couldn't sign out device", description: e.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const logoutOthers = async () => {
    setLoggingOutAll(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      toast({ title: "Signed out everywhere else" });
      await load();
    } catch (e: any) {
      toast({ title: "Couldn't sign out other sessions", description: e.message, variant: "destructive" });
    } finally {
      setLoggingOutAll(false);
    }
  };

  const hasOthers = sessions.some((s) => s.id !== currentId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor className="h-5 w-5" />
          Devices &amp; Sessions
        </CardTitle>
        <CardDescription>
          See where your account is signed in and remotely sign out any device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions found.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => {
              const { label, icon: Icon } = parseDevice(s.user_agent);
              const isCurrent = s.id === currentId;
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="rounded-md bg-muted p-2 shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium flex items-center gap-2">
                        <span className="truncate">{label}</span>
                        {isCurrent && (
                          <span className="rounded-full bg-primary/15 text-primary text-[10px] px-2 py-0.5 shrink-0">
                            This device
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {s.ip ? `IP ${s.ip}` : "Unknown location"} · Active {timeAgo(s.updated_at)}
                      </p>
                    </div>
                  </div>
                  {!isCurrent && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 shrink-0"
                      onClick={() => revoke(s.id)}
                      disabled={busyId === s.id}
                    >
                      {busyId === s.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <LogOut className="h-4 w-4" />
                      )}
                      Sign out
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {hasOthers && (
          <div className="border-t pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="gap-2" disabled={loggingOutAll}>
                  <ShieldAlert className="h-4 w-4" />
                  {loggingOutAll ? "Signing out…" : "Sign out all other sessions"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sign out all other sessions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will sign you out of every device except this one. You'll stay logged in here.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={logoutOthers}>Sign out others</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
