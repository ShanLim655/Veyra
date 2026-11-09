import { useEffect, useState } from "react";
import { authRequest, notifyAuthChanged, type VeyraUser } from "@/lib/authApi";

export function useAuth() {
  const [user, setUser] = useState<VeyraUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const refresh = () => authRequest<{ user: VeyraUser }>("me")
      .then(({ user: currentUser }) => { if (active) setUser(currentUser); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setLoading(false); });
    refresh();
    window.addEventListener("veyra-auth-changed", refresh);
    return () => { active = false; window.removeEventListener("veyra-auth-changed", refresh); };
  }, []);

  const signOut = async () => {
    await authRequest("logout", {});
    setUser(null);
    notifyAuthChanged();
  };

  return { user, session: user ? { user } : null, loading, signOut };
}
