import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Check, Activity, Shield } from "lucide-react";

interface DashboardStats {
  totalAdmins: number;
  pendingApprovals: number;
  activeSessions: number;
  systemHealth: string;
}

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/admin/stats"],
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="mb-8">
          <h1 className="text-3xl font-light text-foreground mb-2">Dashboard</h1>
          <p className="text-muted-foreground">Loading dashboard data...</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse">
                  <div className="h-4 bg-muted rounded w-1/2 mb-2"></div>
                  <div className="h-8 bg-muted rounded w-1/3"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const dashboardCards = [
    {
      title: "Total Admins",
      value: stats?.totalAdmins || 0,
      icon: Users,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "Pending Approvals", 
      value: stats?.pendingApprovals || 0,
      icon: Check,
      color: "text-amber-600",
      bgColor: "bg-amber-500/10",
    },
    {
      title: "Active Sessions",
      value: stats?.activeSessions || 0, 
      icon: Activity,
      color: "text-green-600",
      bgColor: "bg-green-500/10",
    },
    {
      title: "System Health",
      value: stats?.systemHealth || "Unknown",
      icon: Shield,
      color: "text-green-600",
      bgColor: "bg-green-500/10",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-dashboard-title">
          Dashboard
        </h1>
        <p className="text-muted-foreground">
          Welcome back! Here's what's happening on your platform.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {dashboardCards.map((card, index) => (
          <Card key={index} data-testid={`card-${card.title.toLowerCase().replace(' ', '-')}`}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{card.title}</p>
                  <p className="text-2xl font-semibold text-foreground" data-testid={`text-${card.title.toLowerCase().replace(' ', '-')}-value`}>
                    {card.value}
                  </p>
                </div>
                <div className={`p-3 rounded-full ${card.bgColor}`}>
                  <card.icon className={`h-5 w-5 ${card.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-recent-activity-title">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-muted-foreground" data-testid="text-activity-placeholder">
              Recent activity will be displayed here once implemented.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
