// Role display label mapping
// Database values: super_admin, admin, user
// Display labels: Admin, Mod, User

export type DbRole = "super_admin" | "admin" | "user";

export const ROLE_LABELS: Record<DbRole, string> = {
  super_admin: "Admin",
  admin: "Mod", 
  user: "User",
};

export const getRoleLabel = (role: string | null): string => {
  if (!role) return ROLE_LABELS.user;
  return ROLE_LABELS[role as DbRole] || ROLE_LABELS.user;
};

export const ROLE_DESCRIPTIONS: Record<DbRole, string> = {
  super_admin: "Full access to all features and settings",
  admin: "Can moderate content and manage users",
  user: "Standard user access",
};
