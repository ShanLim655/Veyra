import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Search, Shield, ShieldAlert, User, UserCog, Trash2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { getRoleLabel } from "@/lib/roleUtils";
import { logAdminAction } from "@/lib/adminLogger";

type AppRole = Database["public"]["Enums"]["app_role"];

interface UserWithRole {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role: AppRole | null;
  role_id: string | null;
}

export function RoleManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [confirmDialog, setConfirmDialog] = useState<{
    user: UserWithRole;
    newRole: AppRole | "remove";
  } | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    fetchUsersWithRoles();
  }, []);

  const fetchUsersWithRoles = async () => {
    setLoading(true);
    try {
      // Fetch all profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .order("username");

      if (profilesError) throw profilesError;

      // Fetch all roles
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("id, user_id, role");

      if (rolesError) throw rolesError;

      // Merge profiles with roles
      const usersWithRoles: UserWithRole[] = (profiles || []).map((profile) => {
        const userRole = roles?.find((r) => r.user_id === profile.id);
        return {
          ...profile,
          role: userRole?.role || null,
          role_id: userRole?.id || null,
        };
      });

      setUsers(usersWithRoles);
    } catch (error) {
      console.error("Error fetching users:", error);
      toast({ title: "Error loading users", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async () => {
    if (!confirmDialog) return;
    setUpdating(true);

    const { user, newRole } = confirmDialog;
    const previousRole = user.role;

    try {
      if (newRole === "remove") {
        // Remove the role
        if (user.role_id) {
          const { error } = await supabase
            .from("user_roles")
            .delete()
            .eq("id", user.role_id);
          if (error) throw error;
        }
        
        // Log the action
        await logAdminAction("role_remove", "user", user.id, {
          username: user.username,
          previous_role: previousRole,
        });
        
        toast({ title: `Removed role from ${user.username}` });
      } else if (user.role_id) {
        // Update existing role
        const { error } = await supabase
          .from("user_roles")
          .update({ role: newRole })
          .eq("id", user.role_id);
        if (error) throw error;
        
        // Log the action
        await logAdminAction("role_change", "user", user.id, {
          username: user.username,
          previous_role: previousRole,
          new_role: newRole,
        });
        
        toast({ title: `Updated ${user.username} to ${getRoleLabel(newRole)}` });
      } else {
        // Insert new role
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: user.id, role: newRole });
        if (error) throw error;
        
        // Log the action
        await logAdminAction("role_change", "user", user.id, {
          username: user.username,
          previous_role: "user",
          new_role: newRole,
        });
        
        toast({ title: `Assigned ${getRoleLabel(newRole)} to ${user.username}` });
      }

      fetchUsersWithRoles();
    } catch (error: any) {
      console.error("Error updating role:", error);
      toast({
        title: "Error updating role",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
      setConfirmDialog(null);
    }
  };

  const getRoleIcon = (role: AppRole | null) => {
    switch (role) {
      case "super_admin":
        return <ShieldAlert className="h-4 w-4 text-destructive" />;
      case "admin":
        return <Shield className="h-4 w-4 text-primary" />;
      default:
        return <User className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getRoleBadge = (role: AppRole | null) => {
    const label = getRoleLabel(role);
    switch (role) {
      case "super_admin":
        return <Badge variant="destructive">{label}</Badge>;
      case "admin":
        return <Badge variant="secondary">{label}</Badge>;
      default:
        return <Badge variant="outline">{label}</Badge>;
    }
  };

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      !searchQuery.trim() ||
      user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.display_name?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRole =
      filterRole === "all" ||
      (filterRole === "user" && !user.role) ||
      user.role === filterRole;

    return matchesSearch && matchesRole;
  });

  const roleStats = {
    super_admin: users.filter((u) => u.role === "super_admin").length,
    admin: users.filter((u) => u.role === "admin").length,
    user: users.filter((u) => !u.role || u.role === "user").length,
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-destructive/10 rounded-lg">
                <ShieldAlert className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{roleStats.super_admin}</p>
                <p className="text-sm text-muted-foreground">Admins</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{roleStats.admin}</p>
                <p className="text-sm text-muted-foreground">Mods</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg">
                <User className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{roleStats.user}</p>
                <p className="text-sm text-muted-foreground">Regular Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-muted-foreground" />
            <CardTitle>User Roles</CardTitle>
          </div>
          <CardDescription>
            Manage user roles and permissions. Super Admins have full access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterRole} onValueChange={setFilterRole}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="super_admin">Admins</SelectItem>
                <SelectItem value="admin">Mods</SelectItem>
                <SelectItem value="user">Users</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* User List */}
          <ScrollArea className="h-[500px]">
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : filteredUsers.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No users found
              </p>
            ) : (
              <div className="space-y-2">
                {filteredUsers.map((user) => {
                  const isCurrentUser = user.id === currentUser?.id;
                  return (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={user.avatar_url || undefined} />
                          <AvatarFallback>
                            {user.username[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">
                              {user.display_name || user.username}
                            </p>
                            {isCurrentUser && (
                              <Badge variant="outline" className="text-[10px]">
                                You
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            @{user.username}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {getRoleBadge(user.role)}
                        <Select
                          value={user.role || "user"}
                          onValueChange={(value) =>
                            setConfirmDialog({
                              user,
                              newRole: value as AppRole,
                            })
                          }
                          disabled={isCurrentUser}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4" />
                                User
                              </div>
                            </SelectItem>
                            <SelectItem value="admin">
                              <div className="flex items-center gap-2">
                                <Shield className="h-4 w-4" />
                                Mod
                              </div>
                            </SelectItem>
                            <SelectItem value="super_admin">
                              <div className="flex items-center gap-2">
                                <ShieldAlert className="h-4 w-4" />
                                Admin
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {user.role && !isCurrentUser && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() =>
                              setConfirmDialog({ user, newRole: "remove" })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog
        open={!!confirmDialog}
        onOpenChange={() => setConfirmDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Role Change</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.newRole === "remove" ? (
                <>
                  Are you sure you want to remove{" "}
                  <strong>{confirmDialog?.user.username}</strong>'s role? They
                  will become a regular user.
                </>
              ) : (
                <>
                  Are you sure you want to change{" "}
                  <strong>{confirmDialog?.user.username}</strong>'s role to{" "}
                  <strong>{confirmDialog?.newRole}</strong>?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updating}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRoleChange} disabled={updating}>
              {updating ? "Updating..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
