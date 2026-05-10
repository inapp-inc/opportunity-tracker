import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import {
  DollarSign,
  Briefcase,
  AlertTriangle,
  Plus,
  Clock,
  ArrowRight,
  BarChart3,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { apiFetch } from "../lib/api";
import { useCanEdit } from "../lib/roles";

type ApiOpp = {
  id: string;
  prospect: string;
  opportunityDescription: string;
  ownerIds: string[];
  deliverables: string[];
  dueDate: string;
  status: string;
  winOrLoss: string;
  value: number;
  currency: string;
  closedDate?: string | null;
};

type PipelineSummary = {
  totalsByStatus: { status: string; count: number; totalValue: number }[];
  countsByOwner: { ownerId: string; count: number; totalValue: number }[];
};

const COLORS = ["#0088FE", "#00C49F", "#FFBB28"];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function daysUntilDue(dueIso: string) {
  const due = new Date(dueIso + "T12:00:00");
  const today = new Date();
  return Math.round((startOfDay(due) - startOfDay(today)) / 86400000);
}

export function Dashboard() {
  const canEdit = useCanEdit();
  const [opportunities, setOpportunities] = useState<ApiOpp[]>([]);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [oppRes, sumRes] = await Promise.all([
          apiFetch<{ items: ApiOpp[] }>("/opportunities"),
          apiFetch<PipelineSummary>(
            "/reports/pipeline-summary?fromDate=2000-01-01&toDate=2099-12-31"
          ),
        ]);
        if (!cancelled) {
          setOpportunities(oppRes.items);
          setSummary(sumRes);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load dashboard");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const kpiData = useMemo(() => {
    const totalOpportunities = opportunities.length;
    const totalValue = opportunities.reduce((s, o) => s + (o.value || 0), 0);
    const overdueCount = opportunities.filter(
      (o) => o.status !== "Completed" && daysUntilDue(o.dueDate) < 0
    ).length;
    const wins = opportunities.filter((o) => o.winOrLoss === "Win").length;
    const losses = opportunities.filter((o) => o.winOrLoss === "Loss").length;
    const denom = wins + losses;
    const winRate =
      denom > 0 ? Math.round((wins / denom) * 1000) / 10 : 0;

    return { totalOpportunities, totalValue, overdueCount, winRate };
  }, [opportunities]);

  const alertsData = useMemo(() => {
    return [...opportunities]
      .filter((o) => o.status !== "Completed")
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 6)
      .map((o) => ({
        id: o.id,
        prospect: o.prospect,
        description: o.opportunityDescription,
        dueDate: o.dueDate,
        daysUntil: daysUntilDue(o.dueDate),
        status: o.status,
      }));
  }, [opportunities]);

  const valueByStatusData =
    summary?.totalsByStatus.map((t) => ({
      name: t.status,
      value: t.totalValue,
    })) ?? [];

  const countByOwnerData =
    summary?.countsByOwner.map((c) => ({
      name: c.ownerId,
      count: c.count,
    })) ?? [];

  const trendData = useMemo(() => {
    const buckets = new Map<string, { month: string; wins: number; losses: number }>();
    for (const o of opportunities) {
      if (!o.closedDate || o.winOrLoss === "Open") continue;
      const m = o.closedDate.slice(0, 7);
      if (!m) continue;
      if (!buckets.has(m)) {
        buckets.set(m, {
          month: m,
          wins: 0,
          losses: 0,
        });
      }
      const b = buckets.get(m)!;
      if (o.winOrLoss === "Win") b.wins++;
      else if (o.winOrLoss === "Loss") b.losses++;
    }
    return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [opportunities]);

  return (
    <div className="p-6 space-y-6">
      {loadError ? (
        <div className="p-4 border border-red-300 rounded-lg text-red-800 bg-red-50 dark:bg-red-900/30 dark:text-red-100">
          {loadError}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <h1>Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back! Here&apos;s your presales overview.
          </p>
        </div>
        {canEdit ? (
          <Link to="/app/opportunities/new">
            <Button>
              <Plus className="w-4 h-4" />
              New Opportunity
            </Button>
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Total Opportunities</p>
              <Briefcase className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-3xl mb-1">{kpiData.totalOpportunities}</p>
            <p className="text-sm text-muted-foreground">
              Loaded from SQLite
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Pipeline Value</p>
              <DollarSign className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-3xl mb-1">
              ${(kpiData.totalValue / 1000000).toFixed(2)}M
            </p>
            <p className="text-sm text-muted-foreground">
              Sum of opportunity.value
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Overdue</p>
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <p className="text-3xl mb-1">{kpiData.overdueCount}</p>
            <Link to="/app/opportunities?filter=overdue">
              <p className="text-sm text-primary hover:underline">View all</p>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">Win Rate</p>
            </div>
            <p className="text-3xl mb-1">
              {kpiData.winRate ? `${kpiData.winRate}%` : "–"}
            </p>
            <p className="text-sm text-muted-foreground">
              Wins ÷ (wins + losses) from current data
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Upcoming & Overdue Opportunities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {alertsData.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active opportunities loaded.
                </p>
              ) : (
              alertsData.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start justify-between p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4>{alert.prospect}</h4>
                      {alert.daysUntil < 0 ? (
                        <Badge variant="danger">Overdue</Badge>
                      ) : alert.daysUntil <= 3 ? (
                        <Badge variant="warning">Due Soon</Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {alert.description}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        Due {alert.dueDate}
                      </span>
                      <Badge variant="info">{alert.status}</Badge>
                    </div>
                  </div>
                  <Link to={`/app/opportunities/${alert.id}`}>
                    <Button variant="ghost" size="sm">
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              )))}
            </div>
            <Link to="/app/opportunities">
              <Button variant="outline" className="w-full mt-4">
                View All Opportunities
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {canEdit ? (
              <Link to="/app/opportunities/new" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <Plus className="w-4 h-4" />
                  New Opportunity
                </Button>
              </Link>
            ) : null}
            <Link to="/app/opportunities?filter=overdue" className="block">
              <Button variant="outline" className="w-full justify-start">
                <AlertTriangle className="w-4 h-4" />
                View Overdue ({kpiData.overdueCount})
              </Button>
            </Link>
            <Link to="/app/reports" className="block">
              <Button variant="outline" className="w-full justify-start">
                <BarChart3 className="w-4 h-4" />
                View Reports
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Value by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {valueByStatusData.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data yet.</p>
            ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={valueByStatusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) =>
                    `${entry.name}: $${((entry.value as number) / 1000000).toFixed(2)}M`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {valueByStatusData.map((entry, index) => (
                    <Cell key={`cell-${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => `$${(value / 1000000).toFixed(2)}M`} />
              </PieChart>
            </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Opportunities by Owner</CardTitle>
          </CardHeader>
          <CardContent>
            {countByOwnerData.length === 0 ? (
              <p className="text-muted-foreground text-sm">No owner rollups.</p>
            ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={countByOwnerData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#0088FE" />
              </BarChart>
            </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Win/Loss by Close Month</CardTitle>
          </CardHeader>
          <CardContent>
            {trendData.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Add closed dates and Win/Loss on opportunities to populate this chart.
              </p>
            ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="wins" stroke="#00C49F" strokeWidth={2} />
                <Line type="monotone" dataKey="losses" stroke="#FF8042" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
