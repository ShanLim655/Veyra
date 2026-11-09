import { useState, useEffect } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, History, Filter, RefreshCw } from "lucide-react";

interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface AdminLog {
  id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: unknown;
  created_at: string;
  admin?: Profile;
}

const ACTION_COLORS: Record<string, string> = {
  role_change: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  user_ban: "bg-red-500/10 text-red-500 border-red-500/20",
  user_unban: "bg-green-500/10 text-green-500 border-green-500/20",
  message_delete: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  announcement: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  default: "bg-muted text-muted-foreground border-muted",
};

export function AdminLogs() {
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [uniqueActions, setUniqueActions] = useState<string[]>([]);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("admin_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      // Fetch admin profiles
      const adminIds = [...new Set((data || []).map((l) => l.admin_id))];
      const { data: profiles } =
        adminIds.length > 0
          ? await supabase.from("profiles").select("*").in("id", adminIds)
          : { data: [] };

      const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
      const logsWithAdmins = (data || []).map((log) => ({
        ...log,
        admin: profileMap.get(log.admin_id),
      }));

      // Get unique actions for filter
      const actions = [...new Set((data || []).map((l) => l.action))];
      setUniqueActions(actions);

      setLogs(logsWithAdmins);
    } catch (error) {
      console.error("Error fetching admin logs:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      !searchQuery.trim() ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.target_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.admin?.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.admin?.display_name?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesAction = actionFilter === "all" || log.action === actionFilter;

    return matchesSearch && matchesAction;
  });

  const getActionColor = (action: string) => {
    return ACTION_COLORS[action] || ACTION_COLORS.default;
  };

  const formatDetails = (details: unknown) => {
    if (!details || typeof details !== 'object') return null;
    const obj = details as Record<string, unknown>;
    return Object.entries(obj)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(", ");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>Admin Activity Logs</CardTitle>
              <CardDescription>
                Track all administrative actions
              </CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLogs}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <div className="flex gap-2 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {uniqueActions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12">
              <History className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">
                {searchQuery || actionFilter !== "all"
                  ? "No matching logs found"
                  : "No admin logs yet"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="border rounded-lg p-4 bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={log.admin?.avatar_url || undefined} />
                      <AvatarFallback className="text-sm">
                        {log.admin?.username?.[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {log.admin?.display_name || log.admin?.username || "Unknown Admin"}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-xs ${getActionColor(log.action)}`}
                        >
                          {log.action.replace(/_/g, " ")}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {log.target_type}
                        </Badge>
                      </div>
                      {log.target_id && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Target: {log.target_id}
                        </p>
                      )}
                      {log.details && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {formatDetails(log.details)}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.created_at), "MMM d, h:mm a")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
