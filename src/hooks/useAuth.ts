import { useEffect, useState } from "react";
import { authRequest, getAuthChangeVersion, notifyAuthChanged, type VeyraUser } from "@/lib/authApi";
import { setMariaDbRealtimeUserId } from "@/integrations/supabase/mariadb-realtime";

let currentUser: VeyraUser | null | undefined;
let loadedAuthVersion = -1;
let currentUserRequest: Promise<void> | null = null;
const authListeners = new Set<(user: VeyraUser | null) => void>();

function setCurrentUser(user: VeyraUser | null, version = getAuthChangeVersion()) {
  const wasAuthenticated = !!currentUser;
  currentUser = user;
  loadedAuthVersion = version;
  if (user || wasAuthenticated) {
    setMariaDbRealtimeUserId(user?.id ?? null);
  }
  authListeners.forEach((listener) => listener(user));
}

function loadCurrentUser(force = false) {
  if (!force && currentUser !== undefined && loadedAuthVersion === getAuthChangeVersion()) return Promise.resolve();
  if (currentUserRequest) return currentUserRequest;
  const requestVersion = getAuthChangeVersion();
  currentUserRequest = authRequest<{ user: VeyraUser }>("me")
    .then(({ user }) => setCurrentUser(user, requestVersion))
    .catch(() => setCurrentUser(null, requestVersion))
    .then(() => undefined)
    .finally(() => {
      currentUserRequest = null;
      if (loadedAuthVersion !== getAuthChangeVersion()) void loadCurrentUser(true);
    });
  return currentUserRequest;
}

export function useAuth() {
  const [user, setUser] = useState<VeyraUser | null>(currentUser ?? null);
  const [loading, setLoading] = useState(currentUser === undefined);

  useEffect(() => {
    let active = true;
    const listener = (nextUser: VeyraUser | null) => {
      if (!active) return;
      setUser(nextUser);
      setLoading(false);
    };
    const handleAuthChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ resolved?: boolean; user?: VeyraUser | null }>).detail;
      if (detail?.resolved) setCurrentUser(detail.user ?? null);
      else void loadCurrentUser(true);
    };
    authListeners.add(listener);
    window.addEventListener("veyra-auth-changed", handleAuthChanged);
    if (currentUser === undefined || loadedAuthVersion !== getAuthChangeVersion()) {
      setLoading(true);
      void loadCurrentUser(true);
    }
    else setLoading(false);
    return () => {
      active = false;
      authListeners.delete(listener);
      window.removeEventListener("veyra-auth-changed", handleAuthChanged);
    };
  }, []);

  const signOut = async () => {
    await authRequest("logout", {});
    notifyAuthChanged(null);
    setCurrentUser(null);
  };

  return { user, session: user ? { user } : null, loading, signOut };
}
