import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AppRole = "user" | "admin" | "super_admin";

interface UserRoleState {
  role: AppRole | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  loading: boolean;
}

export function useUserRole(): UserRoleState {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    // Don't fetch role until auth is done loading
    if (authLoading) {
      setRoleLoading(true);
      return;
    }

    if (!user) {
      setRole(null);
      setRoleLoading(false);
      return;
    }

    let isMounted = true;

    const fetchRole = async () => {
      setRoleLoading(true);
      try {
        console.log("[useUserRole] Fetching role for user:", user.id);
        const { data, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!isMounted) return;

        console.log("[useUserRole] Response:", { data, error });

        if (error) {
          console.error("[useUserRole] Error fetching user role:", error);
          setRole(null);
        } else if (data) {
          console.log("[useUserRole] Role found:", data.role);
          setRole(data.role as AppRole);
        } else {
          console.log("[useUserRole] No role found, defaulting to user");
          setRole("user"); // Default to user if no role assigned
        }
      } catch (err) {
        console.error("[useUserRole] Error fetching user role:", err);
        if (isMounted) setRole(null);
      } finally {
        if (isMounted) setRoleLoading(false);
      }
    };

    fetchRole();

    return () => {
      isMounted = false;
    };
  }, [user, authLoading]);

  // Loading is true if either auth is loading OR role is loading
  const loading = authLoading || roleLoading;

  return {
    role,
    isAdmin: role === "admin" || role === "super_admin",
    isSuperAdmin: role === "super_admin",
    loading,
  };
}
