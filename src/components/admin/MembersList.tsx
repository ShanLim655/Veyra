import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Users, SortAsc, SortDesc, Filter } from "lucide-react";
import { MemberCard } from "./MemberCard";
import { Button } from "@/components/ui/button";

export interface MemberProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string | null;
  created_at: string;
}

export interface MemberStats {
  messageCount: number;
  friendCount: number;
  friends: MemberProfile[];
  role: string;
}

type SortField = "username" | "created_at" | "messages";
type SortOrder = "asc" | "desc";

export function MembersList() {
  const { isSuperAdmin } = useUserRole();
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [memberStats, setMemberStats] = useState<Record<string, MemberStats>>({});
  const [loadingStats, setLoadingStats] = useState<Record<string, boolean>>({});
  
  // New filter states
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setMembers(data || []);
    } catch (error) {
      console.error("Error fetching members:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMemberStats = async (memberId: string) => {
    if (memberStats[memberId] || loadingStats[memberId]) return;

    setLoadingStats((prev) => ({ ...prev, [memberId]: true }));

    try {
      // Fetch message count - for super admin, get all messages, otherwise just count
      const { count: messageCount } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("sender_id", memberId);

      // Also count global messages
      const { count: globalMessageCount } = await supabase
        .from("global_messages")
        .select("*", { count: "exact", head: true })
        .eq("sender_id", memberId);

      // Fetch friends
      const { data: friendRequests } = await supabase
        .from("friend_requests")
        .select("sender_id, receiver_id")
        .eq("status", "accepted")
        .or(`sender_id.eq.${memberId},receiver_id.eq.${memberId}`);

      const friendIds = (friendRequests || []).map((fr) =>
        fr.sender_id === memberId ? fr.receiver_id : fr.sender_id
      );

      let friends: MemberProfile[] = [];
      if (friendIds.length > 0) {
        const { data: friendProfiles } = await supabase
          .from("profiles")
          .select("*")
          .in("id", friendIds);
        friends = friendProfiles || [];
      }

      // Fetch role using admin function
      const { data: roleData } = await supabase
        .rpc("get_user_role_for_admin", { _target_user_id: memberId });

      setMemberStats((prev) => ({
        ...prev,
        [memberId]: {
          messageCount: (messageCount || 0) + (globalMessageCount || 0),
          friendCount: friendIds.length,
          friends,
          role: roleData || "user",
        },
      }));
    } catch (error) {
      console.error("Error fetching member stats:", error);
    } finally {
      setLoadingStats((prev) => ({ ...prev, [memberId]: false }));
    }
  };

  const toggleExpand = (memberId: string) => {
    if (expandedMemberId === memberId) {
      setExpandedMemberId(null);
    } else {
      setExpandedMemberId(memberId);
      fetchMemberStats(memberId);
    }
  };

  // Advanced filtering and sorting
  const filteredAndSortedMembers = useMemo(() => {
    let result = [...members];

    // Text search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (member) =>
          member.username.toLowerCase().includes(query) ||
          member.display_name?.toLowerCase().includes(query)
      );
    }

    // Role filter
    if (roleFilter !== "all") {
      result = result.filter((member) => {
        const stats = memberStats[member.id];
        if (roleFilter === "user") {
          return !stats || stats.role === "user";
        }
        return stats?.role === roleFilter;
      });
    }

    // Status filter
    if (statusFilter !== "all") {
      result = result.filter((member) => {
        if (statusFilter === "online") {
          return member.status === "online";
        }
        return member.status !== "online";
      });
    }

    // Sorting
    result.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case "username":
          comparison = a.username.localeCompare(b.username);
          break;
        case "created_at":
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case "messages": {
          const aMessages = memberStats[a.id]?.messageCount || 0;
          const bMessages = memberStats[b.id]?.messageCount || 0;
          comparison = aMessages - bMessages;
          break;
        }
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [members, searchQuery, roleFilter, statusFilter, sortField, sortOrder, memberStats]);

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <CardTitle>All Members</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{members.length} total</Badge>
            {searchQuery || roleFilter !== "all" || statusFilter !== "all" ? (
              <Badge variant="outline">
                {filteredAndSortedMembers.length} shown
              </Badge>
            ) : null}
          </div>
        </div>
        
        {/* Search and Filters */}
        <div className="space-y-3 mt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by username or display name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          
          <div className="flex flex-wrap gap-2">
            {/* Sort Field */}
            <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at">Join Date</SelectItem>
                <SelectItem value="username">Username</SelectItem>
                <SelectItem value="messages">Messages</SelectItem>
              </SelectContent>
            </Select>
            
            {/* Sort Order */}
            <Button
              variant="outline"
              size="icon"
              onClick={toggleSortOrder}
              title={sortOrder === "asc" ? "Ascending" : "Descending"}
            >
              {sortOrder === "asc" ? (
                <SortAsc className="h-4 w-4" />
              ) : (
                <SortDesc className="h-4 w-4" />
              )}
            </Button>
            
            {/* Role Filter */}
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[130px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="super_admin">Admin</SelectItem>
                <SelectItem value="admin">Mod</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
            
            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
              </SelectContent>
            </Select>
            
            {/* Clear Filters */}
            {(searchQuery || roleFilter !== "all" || statusFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setRoleFilter("all");
                  setStatusFilter("all");
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] pr-4">
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : filteredAndSortedMembers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {searchQuery || roleFilter !== "all" || statusFilter !== "all"
                ? "No members match your filters"
                : "No members yet"}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredAndSortedMembers.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  stats={memberStats[member.id]}
                  isExpanded={expandedMemberId === member.id}
                  isLoading={loadingStats[member.id]}
                  onToggle={() => toggleExpand(member.id)}
                  isSuperAdmin={isSuperAdmin}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
