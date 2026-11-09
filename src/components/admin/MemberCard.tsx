import { useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown,
  ChevronUp,
  Calendar,
  MessageSquare,
  Users,
  Shield,
  ShieldAlert,
  User,
} from "lucide-react";
import { MemberProfile, MemberStats } from "./MembersList";
import { getRoleLabel } from "@/lib/roleUtils";

interface MemberCardProps {
  member: MemberProfile;
  stats?: MemberStats;
  isExpanded: boolean;
  isLoading: boolean;
  onToggle: () => void;
  isSuperAdmin: boolean;
}

export function MemberCard({
  member,
  stats,
  isExpanded,
  isLoading,
  onToggle,
  isSuperAdmin,
}: MemberCardProps) {
  

  const getRoleBadge = (role: string) => {
    const label = getRoleLabel(role);
    switch (role) {
      case "super_admin":
        return (
          <Badge variant="destructive" className="gap-1">
            <ShieldAlert className="h-3 w-3" />
            {label}
          </Badge>
        );
      case "admin":
        return (
          <Badge variant="secondary" className="gap-1">
            <Shield className="h-3 w-3" />
            {label}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1">
            <User className="h-3 w-3" />
            {label}
          </Badge>
        );
    }
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className="border rounded-lg bg-card overflow-hidden">
        <CollapsibleTrigger asChild>
          <button className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={member.avatar_url || undefined} />
                <AvatarFallback>
                  {member.username[0]?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="text-left">
                <p className="font-medium text-foreground">
                  {member.display_name || member.username}
                </p>
                <p className="text-sm text-muted-foreground">@{member.username}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {stats && getRoleBadge(stats.role)}
              {isExpanded ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t px-4 py-4 space-y-4">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : stats ? (
              <>
                {/* Basic Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Joined:</span>
                    <span className="font-medium">
                      {format(new Date(member.created_at), "MMM d, yyyy")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Messages:</span>
                    <span className="font-medium">{stats.messageCount}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Friends:</span>
                    <span className="font-medium">{stats.friendCount}</span>
                  </div>
                </div>

                {/* Friends List */}
                {stats.friends.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Friends</p>
                    <div className="flex flex-wrap gap-2">
                      {stats.friends.map((friend) => (
                        <div
                          key={friend.id}
                          className="flex items-center gap-2 bg-muted rounded-full pl-1 pr-3 py-1"
                        >
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={friend.avatar_url || undefined} />
                            <AvatarFallback className="text-xs">
                              {friend.username[0]?.toUpperCase() || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm">
                            {friend.display_name || friend.username}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Failed to load stats</p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
