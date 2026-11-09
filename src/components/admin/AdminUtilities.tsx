import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";
import {
  BarChart3,
  Users,
  MessageSquare,
  UserCheck,
  TrendingUp,
  Globe,
  Megaphone,
  Activity,
  Calendar,
  Trophy,
  Crown,
} from "lucide-react";
import { format } from "date-fns";

interface Stats {
  totalMembers: number;
  totalMessages: number;
  totalConversations: number;
  totalFriendships: number;
  totalGlobalMessages: number;
  totalAnnouncements: number;
  admins: number;
  superAdmins: number;
}

interface DailyStats {
  date: string;
  messages: number;
  globalMessages: number;
  newUsers: number;
}

interface MessageTypeData {
  name: string;
  value: number;
}

interface TopUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  messageCount: number;
}

// Type for RPC response
interface AnalyticsResponse {
  totalMessages: number;
  totalGlobalMessages: number;
  totalAnnouncements: number;
  totalConversations: number;
  totalFriendships: number;
}

interface DailyStatsRow {
  day: string;
  messages: number;
  global_messages: number;
  new_users: number;
}

interface TopUserRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  message_count: number;
}

export function AdminUtilities() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDaily, setLoadingDaily] = useState(true);
  const [loadingTopUsers, setLoadingTopUsers] = useState(true);

  useEffect(() => {
    fetchStats();
    fetchDailyStats();
    fetchTopUsers();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      // Fetch counts using secure admin function + public data
      const [
        { count: totalMembers },
        { data: analyticsData, error: analyticsError },
        { data: roles },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.rpc("get_admin_analytics_counts"),
        supabase.from("user_roles").select("role"),
      ]);

      if (analyticsError) {
        console.error("Error fetching analytics:", analyticsError);
        throw analyticsError;
      }

      const admins = (roles || []).filter((r) => r.role === "admin").length;
      const superAdmins = (roles || []).filter((r) => r.role === "super_admin").length;

      const analytics = analyticsData as unknown as AnalyticsResponse | null;

      setStats({
        totalMembers: totalMembers || 0,
        totalMessages: analytics?.totalMessages || 0,
        totalConversations: analytics?.totalConversations || 0,
        totalFriendships: analytics?.totalFriendships || 0,
        totalGlobalMessages: analytics?.totalGlobalMessages || 0,
        totalAnnouncements: analytics?.totalAnnouncements || 0,
        admins,
        superAdmins,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDailyStats = async () => {
    setLoadingDaily(true);
    try {
      const { data, error } = await supabase.rpc("get_admin_daily_stats", { days_count: 7 });

      if (error) {
        console.error("Error fetching daily stats:", error);
        throw error;
      }

      // Transform the data to match our expected format
      const dailyData = (data as unknown as DailyStatsRow[]) || [];
      const daily = dailyData.map((d) => ({
        date: format(new Date(d.day), "MMM d"),
        messages: d.messages || 0,
        globalMessages: d.global_messages || 0,
        newUsers: d.new_users || 0,
      }));

      setDailyStats(daily);
    } catch (error) {
      console.error("Error fetching daily stats:", error);
    } finally {
      setLoadingDaily(false);
    }
  };

  const fetchTopUsers = async () => {
    setLoadingTopUsers(true);
    try {
      const { data, error } = await supabase.rpc("get_admin_top_users", { limit_count: 10 });

      if (error) {
        console.error("Error fetching top users:", error);
        throw error;
      }

      const topUserData = (data as unknown as TopUserRow[]) || [];
      const usersWithCounts: TopUser[] = topUserData.map((u) => ({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        avatar_url: u.avatar_url,
        messageCount: u.message_count || 0,
      }));

      setTopUsers(usersWithCounts);
    } catch (error) {
      console.error("Error fetching top users:", error);
    } finally {
      setLoadingTopUsers(false);
    }
  };

  const StatCard = ({
    title,
    value,
    icon: Icon,
    description,
    trend,
  }: {
    title: string;
    value: number | string;
    icon: React.ElementType;
    description?: string;
    trend?: number;
  }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
        {trend !== undefined && trend !== 0 && (
          <p className={`text-xs mt-1 ${trend > 0 ? "text-green-500" : "text-red-500"}`}>
            {trend > 0 ? "+" : ""}{trend}% from last week
          </p>
        )}
      </CardContent>
    </Card>
  );

  const COLORS = ["hsl(var(--primary))", "hsl(var(--secondary))", "hsl(var(--destructive))", "hsl(var(--muted))"];

  const messageTypeData: MessageTypeData[] = stats
    ? [
        { name: "DM Messages", value: stats.totalMessages },
        { name: "Global", value: stats.totalGlobalMessages },
        { name: "Announcements", value: stats.totalAnnouncements },
      ]
    : [];

  const roleDistribution = stats
    ? [
        { name: "Users", value: stats.totalMembers - stats.admins - stats.superAdmins },
        { name: "Mods", value: stats.admins },
        { name: "Admins", value: stats.superAdmins },
      ]
    : [];

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  if (!stats) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Failed to load statistics
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Members"
              value={stats.totalMembers}
              icon={Users}
              description="Registered users"
            />
            <StatCard
              title="DM Messages"
              value={stats.totalMessages}
              icon={MessageSquare}
              description="Private messages"
            />
            <StatCard
              title="Global Messages"
              value={stats.totalGlobalMessages}
              icon={Globe}
              description="Public chat messages"
            />
            <StatCard
              title="Announcements"
              value={stats.totalAnnouncements}
              icon={Megaphone}
              description="Admin announcements"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard
              title="Conversations"
              value={stats.totalConversations}
              icon={TrendingUp}
              description="Active DM threads"
            />
            <StatCard
              title="Friendships"
              value={stats.totalFriendships}
              icon={UserCheck}
              description="Connected users"
            />
            <StatCard
              title="Messages Today"
              value={dailyStats[dailyStats.length - 1]?.messages || 0}
              icon={Activity}
              description="Last 24 hours"
            />
          </div>

          {/* Message Distribution Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Message Distribution</CardTitle>
                <CardDescription>Breakdown by message type</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={messageTypeData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, percent }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
                        }
                      >
                        {messageTypeData.map((_, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Role Distribution</CardTitle>
                <CardDescription>User roles breakdown</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={roleDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {roleDistribution.map((_, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="space-y-6 mt-6">
          {/* Activity Over Time */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Message Activity (Last 7 Days)</CardTitle>
              </div>
              <CardDescription>
                Daily message count across all channels
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingDaily ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyStats}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Bar
                        dataKey="messages"
                        name="DM Messages"
                        fill="hsl(var(--primary))"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="globalMessages"
                        name="Global Messages"
                        fill="hsl(var(--secondary))"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Engagement Line Chart */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Engagement Trends</CardTitle>
              </div>
              <CardDescription>
                Combined message activity trend
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingDaily ? (
                <Skeleton className="h-[250px] w-full" />
              ) : (
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyStats}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="messages"
                        name="DM Messages"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ fill: "hsl(var(--primary))" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="globalMessages"
                        name="Global Messages"
                        stroke="hsl(var(--secondary))"
                        strokeWidth={2}
                        dot={{ fill: "hsl(var(--secondary))" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="space-y-6 mt-6">
          {/* User Growth */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                <CardTitle>New User Registrations (Last 7 Days)</CardTitle>
              </div>
              <CardDescription>
                Daily new user signups
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingDaily ? (
                <Skeleton className="h-[250px] w-full" />
              ) : (
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyStats}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Bar
                        dataKey="newUsers"
                        name="New Users"
                        fill="hsl(var(--primary))"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Admin Team Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Admins</CardTitle>
                <CardDescription>Full platform access</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Badge variant="destructive" className="text-xl px-4 py-2">
                    {stats.superAdmins}
                  </Badge>
                  <span className="text-muted-foreground text-sm">
                    users with admin privileges
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Mods</CardTitle>
                <CardDescription>Moderation access</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="text-xl px-4 py-2">
                    {stats.admins}
                  </Badge>
                  <span className="text-muted-foreground text-sm">
                    users with mod privileges
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Most Active Users */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Most Active Users</CardTitle>
              </div>
              <CardDescription>
                Top 10 users by total messages sent
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingTopUsers ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : topUsers.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  No message activity yet
                </p>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {topUsers.map((user, index) => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted font-bold text-sm">
                            {index === 0 ? (
                              <Crown className="h-4 w-4 text-primary" />
                            ) : (
                              `#${index + 1}`
                            )}
                          </div>
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={user.avatar_url || undefined} />
                            <AvatarFallback>
                              {user.username[0]?.toUpperCase() || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">
                              {user.display_name || user.username}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              @{user.username}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          <span className="font-bold text-lg">{user.messageCount}</span>
                          <span className="text-sm text-muted-foreground">messages</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
