import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { ArrowLeft, Shield, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MembersList } from "@/components/admin/MembersList";
import { AdminUtilities } from "@/components/admin/AdminUtilities";
import { RoleManagement } from "@/components/admin/RoleManagement";
import { AdminLogs } from "@/components/admin/AdminLogs";

export default function AdminDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isSuperAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  // Wait for BOTH auth and role to be loaded before redirecting non-admins
  const isFullyLoaded = !authLoading && !roleLoading;

  useEffect(() => {
    // Only redirect non-admins after both auth and role are fully loaded
    if (isFullyLoaded && user && !isAdmin) {
      navigate("/");
    }
  }, [isAdmin, isFullyLoaded, user, navigate]);

  // Show loading while either auth or role is still loading
  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <div className="text-muted-foreground">Loading admin panel...</div>
        </div>
      </div>
    );
  }

  // Don't render anything if not admin (will redirect)
  if (!user || !isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              {isSuperAdmin ? (
                <ShieldAlert className="h-6 w-6 text-destructive" />
              ) : (
                <Shield className="h-6 w-6 text-primary" />
              )}
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  {isSuperAdmin ? "Admin" : "Mod"} Dashboard
                </h1>
                <p className="text-sm text-muted-foreground">
                  Manage members and moderate content
                </p>
              </div>
            </div>
          </div>
          <Badge variant={isSuperAdmin ? "destructive" : "secondary"} className="text-sm">
            {isSuperAdmin ? "Admin" : "Mod"}
          </Badge>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs defaultValue="members" className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            {isSuperAdmin && (
              <>
                <TabsTrigger value="roles">Role Management</TabsTrigger>
                <TabsTrigger value="logs">Admin Logs</TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="members">
            <MembersList />
          </TabsContent>

          <TabsContent value="analytics">
            <AdminUtilities />
          </TabsContent>

          {isSuperAdmin && (
            <>
              <TabsContent value="roles">
                <RoleManagement />
              </TabsContent>

              <TabsContent value="logs">
                <AdminLogs />
              </TabsContent>
            </>
          )}
        </Tabs>
      </main>
    </div>
  );
}