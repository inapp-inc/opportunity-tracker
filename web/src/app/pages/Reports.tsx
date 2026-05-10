import { useState, useEffect, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Select } from "../components/ui/Select";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Download } from "lucide-react";
import {
  BarChart,
  Bar,
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
import { downloadWithAuth } from "../lib/download";

type PipelineSummary = {
  totalsByStatus: { status: string; count: number; totalValue: number }[];
  countsByOwner: { ownerId: string; count: number; totalValue: number }[];
};

type ApiOpp = {
  id: string;
  dueDate: string;
  engagementType: string;
  value: number;
  winOrLoss: string;
};

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#82ca9d"];

function monthBucketLabel(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

export function Reports() {
  const [dateFrom, setDateFrom] = useState("2026-01-01");
  const [dateTo, setDateTo] = useState("2026-12-31");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [opps, setOpps] = useState<ApiOpp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams();
        q.set("fromDueDate", dateFrom);
        q.set("toDueDate", dateTo);
        if (statusFilter !== "all") q.set("status", statusFilter);
        if (ownerFilter !== "all") q.set("ownerId", ownerFilter);

        const sq = new URLSearchParams();
        sq.set("fromDate", dateFrom);
        sq.set("toDate", dateTo);
        if (statusFilter !== "all") sq.set("status", statusFilter);
        if (ownerFilter !== "all") sq.set("owner", ownerFilter);

        const [sum, list] = await Promise.all([
          apiFetch<PipelineSummary>(`/reports/pipeline-summary?${sq}`),
          apiFetch<{ items: ApiOpp[] }>(`/opportunities?${q}`),
        ]);
        if (cancelled) return;
        setSummary(sum);
        setOpps(list.items || []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load reports");
          setSummary(null);
          setOpps([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, ownerFilter, statusFilter]);

  const ownerOptions = useMemo(() => {
    const names = new Set<string>();
    (summary?.countsByOwner || []).forEach((o) => names.add(o.ownerId));
    const opts = [{ value: "all", label: "All Owners" }];
    [...names].sort().forEach((n) =>
      opts.push({ value: n, label: n })
    );
    return opts;
  }, [summary]);

  const pipelineValueData = useMemo(() => {
    if (!summary?.totalsByStatus?.length) return [];
    return summary.totalsByStatus.map((r) => ({
      name: r.status,
      value: r.totalValue,
      count: r.count,
    }));
  }, [summary]);

  const opportunityCountData = useMemo(() => {
    if (!summary?.countsByOwner?.length) return [];
    return summary.countsByOwner.map((r) => ({
      name: r.ownerId,
      count: r.count,
      value: r.totalValue,
    }));
  }, [summary]);

  const dueDateTimelineData = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const byMonth = new Map<string, { upcoming: number; overdue: number }>();
    for (const o of opps) {
      const label = monthBucketLabel(o.dueDate);
      const prev = byMonth.get(label) || { upcoming: 0, overdue: 0 };
      if (o.dueDate < today) prev.overdue += 1;
      else prev.upcoming += 1;
      byMonth.set(label, prev);
    }
    return [...byMonth.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => {
        const da = new Date(`${a.month} 1`).getTime();
        const db = new Date(`${b.month} 1`).getTime();
        return da - db;
      });
  }, [opps]);

  const engagementTypeData = useMemo(() => {
    const m = new Map<string, { value: number; amount: number }>();
    for (const o of opps) {
      const k = o.engagementType?.trim() || "Other";
      const cur = m.get(k) || { value: 0, amount: 0 };
      cur.value += 1;
      cur.amount += Number(o.value) || 0;
      m.set(k, cur);
    }
    return [...m.entries()].map(([name, v]) => ({
      name,
      value: v.value,
      amount: v.amount,
    }));
  }, [opps]);

  const winLossSnapshot = useMemo(() => {
    let wins = 0;
    let losses = 0;
    let open = 0;
    for (const o of opps) {
      if (o.winOrLoss === "Win") wins += 1;
      else if (o.winOrLoss === "Loss") losses += 1;
      else open += 1;
    }
    return [
      { name: "Win", count: wins },
      { name: "Loss", count: losses },
      { name: "Open", count: open },
    ];
  }, [opps]);

  const totalEng = engagementTypeData.reduce((s, x) => s + x.value, 0) || 1;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1>Reports & Analytics</h1>
          <p className="text-muted-foreground">
            Comprehensive insights into presales performance
          </p>
        </div>
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            const q = new URLSearchParams();
            q.set("fromDate", dateFrom);
            q.set("toDate", dateTo);
            if (statusFilter !== "all") q.set("status", statusFilter);
            if (ownerFilter !== "all") q.set("owner", ownerFilter);
            void downloadWithAuth(
              `/export/reports/pipeline-summary.csv?${q}`,
              "pipeline-summary.csv"
            ).catch((e) =>
              alert(e instanceof Error ? e.message : "Export failed")
            );
          }}
        >
          <Download className="w-4 h-4" />
          Export Report
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive border border-destructive/40 rounded-lg p-3">
          {error}
        </p>
      )}
      {loading && (
        <p className="text-sm text-muted-foreground">Loading report data…</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Input
              label="From Date"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />

            <Input
              label="To Date"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />

            <Select
              label="Owner"
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              options={ownerOptions}
            />

            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: "all", label: "All Statuses" },
                { value: "Not Started", label: "Not Started" },
                { value: "In Progress", label: "In Progress" },
                { value: "Completed", label: "Completed" },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Value by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {pipelineValueData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No opportunity data for the selected filters.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={pipelineValueData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip
                      formatter={(value: number) =>
                        `$${(value / 1000000).toFixed(2)}M`
                      }
                    />
                    <Legend />
                    <Bar dataKey="value" fill="#0088FE" name="Pipeline Value" />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                  {pipelineValueData.map((item) => (
                    <div key={item.name}>
                      <p className="text-sm text-muted-foreground">{item.name}</p>
                      <p className="text-lg">
                        ${(item.value / 1000000).toFixed(1)}M
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.count} opps
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Opportunity Count by Owner</CardTitle>
          </CardHeader>
          <CardContent>
            {opportunityCountData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No owner breakdown for the selected filters.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={opportunityCountData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={100} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="count" fill="#00C49F" name="Opportunities" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Due Date Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {dueDateTimelineData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No due dates in range.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dueDateTimelineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="upcoming"
                    stackId="a"
                    fill="#00C49F"
                    name="Upcoming"
                  />
                  <Bar
                    dataKey="overdue"
                    stackId="a"
                    fill="#FF8042"
                    name="Overdue"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Win / Loss / Open (filtered set)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={winLossSnapshot}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill="#8884d8" name="Opportunities" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Engagement Type Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {engagementTypeData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No engagements in filtered data.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={engagementTypeData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry) =>
                        `${entry.name}: ${entry.value}`
                      }
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {engagementTypeData.map((_entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>

                <div className="space-y-4">
                  {engagementTypeData.map((item, index) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between p-3 border border-border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-4 h-4 rounded"
                          style={{
                            backgroundColor: COLORS[index % COLORS.length],
                          }}
                        />
                        <div>
                          <p>{item.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.value} opportunities
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p>${(item.amount / 1000000).toFixed(2)}M</p>
                        <p className="text-sm text-muted-foreground">
                          {((item.value / totalEng) * 100).toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
