import { useState, useEffect, useMemo, useCallback } from "react";
import { PageLayoutEditor } from "../components/page-layout/PageLayoutEditor";
import { ReportsLayoutPanel } from "../components/page-layout/panels/ReportsLayoutPanel";
import {
  DEFAULT_REPORTS_LAYOUT,
  isReportSectionVisible,
  normalizeReportsLayout,
  type ReportsLayout,
} from "../lib/reportsLayout";
import { WORKSPACE_LAYOUT_EVENT } from "../lib/pageLayoutEvents";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Select } from "../components/ui/Select";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Download, Printer } from "lucide-react";
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
import { formatMoney } from "../lib/format";
import { printReportDocument } from "../lib/printReports";
import type { ApiOpportunity } from "../lib/opportunity";
import { lowerFirst, useTerminology } from "../lib/terminology";
import { catalogValueList, filterSelectOptions } from "../lib/lookupOptions";
import { useAssignableUsers, useCatalogLookups } from "../lib/serverState";
import { PageHeader, Toolbar, LoadingDisplay } from "../components/shared";
import { useCanManageTenantSettings, useIsPlatformAdmin } from "../lib/roles";

type PipelineSummary = {
  totalsByStatus: { status: string; count: number; totalValue: number }[];
  countsByOwner: { ownerId: string; count: number; totalValue: number }[];
};

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#82ca9d"];

function monthBucketLabel(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

export function Reports() {
  const terminology = useTerminology();
  const canManageTenantSettings = useCanManageTenantSettings();
  const isPlatformAdmin = useIsPlatformAdmin();
  const canEditLayouts = canManageTenantSettings || isPlatformAdmin;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [dateFrom, setDateFrom] = useState(
    searchParams.get("fromDate") || ""
  );
  const [dateTo, setDateTo] = useState(searchParams.get("toDate") || "");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get("status") || "all"
  );
  const [dealStageFilter, setDealStageFilter] = useState(
    searchParams.get("dealStage") || "all"
  );
  const [prospectTypeFilter, setProspectTypeFilter] = useState(
    searchParams.get("prospectType") || "all"
  );
  const [engagementTypeFilter, setEngagementTypeFilter] = useState(
    searchParams.get("engagementType") || "all"
  );
  const [winOrLossFilter, setWinOrLossFilter] = useState(
    searchParams.get("winOrLoss") || "all"
  );
  const [customFieldFilter, setCustomFieldFilter] = useState(
    searchParams.get("customField") || ""
  );
  const [customValueFilter, setCustomValueFilter] = useState(
    searchParams.get("customValue") || ""
  );
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [opps, setOpps] = useState<ApiOpportunity[]>([]);
  const { users: assignableUsers } = useAssignableUsers();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { lookups: catalogLookups } = useCatalogLookups();
  const [reportsLayout, setReportsLayout] = useState<ReportsLayout>(
    DEFAULT_REPORTS_LAYOUT
  );

  const loadReportsLayout = useCallback(async () => {
    try {
      const res = await apiFetch<{ reportsLayout?: ReportsLayout }>("/settings");
      setReportsLayout(normalizeReportsLayout(res.reportsLayout));
    } catch {
      setReportsLayout(DEFAULT_REPORTS_LAYOUT);
    }
  }, []);

  useEffect(() => {
    void loadReportsLayout();
    const onLayout = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: string }>).detail;
      if (!detail?.page || detail.page === "reports") void loadReportsLayout();
    };
    window.addEventListener(WORKSPACE_LAYOUT_EVENT, onLayout);
    return () => window.removeEventListener(WORKSPACE_LAYOUT_EVENT, onLayout);
  }, [loadReportsLayout]);

  const showSection = (key: Parameters<typeof isReportSectionVisible>[1]) =>
    isReportSectionVisible(reportsLayout, key);

  const currencyCode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of opps) {
      const code = String(o.currency || "USD").toUpperCase();
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    let best = "USD";
    let max = 0;
    for (const [code, count] of counts) {
      if (count > max) {
        best = code;
        max = count;
      }
    }
    return best;
  }, [opps]);

  const dealStageOptions = useMemo(
    () => catalogValueList(catalogLookups?.dealStages),
    [catalogLookups]
  );
  const prospectTypeOptions = useMemo(
    () => catalogValueList(catalogLookups?.prospectTypes),
    [catalogLookups]
  );
  const engagementTypeOptions = useMemo(
    () => catalogValueList(catalogLookups?.engagementTypes),
    [catalogLookups]
  );
  const winLossFilterOptions = useMemo(() => {
    const values = catalogValueList(catalogLookups?.winLoss);
    return filterSelectOptions(
      values.length ? values : ["Win", "Loss", "Open"],
      "All outcomes"
    );
  }, [catalogLookups]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams();
        q.set("archived", "exclude");
        if (dateFrom) q.set("fromDueDate", dateFrom);
        if (dateTo) q.set("toDueDate", dateTo);
        if (statusFilter !== "all") q.set("status", statusFilter);
        if (dealStageFilter !== "all") q.set("dealStage", dealStageFilter);
        if (winOrLossFilter !== "all") q.set("winOrLoss", winOrLossFilter);
        if (prospectTypeFilter !== "all") q.set("prospectType", prospectTypeFilter);
        if (engagementTypeFilter !== "all") q.set("engagementType", engagementTypeFilter);
        if (ownerFilter !== "all") q.set("ownerId", ownerFilter);
        if (customFieldFilter && customValueFilter) {
          q.set("customField", customFieldFilter);
          q.set("customValue", customValueFilter);
        }

        const analyticsFilters: Record<string, unknown> = {
          archived: "exclude",
        };
        if (dateFrom) analyticsFilters.dueDateFrom = dateFrom;
        if (dateTo) analyticsFilters.dueDateTo = dateTo;
        if (statusFilter !== "all") analyticsFilters.status = statusFilter;
        if (dealStageFilter !== "all") analyticsFilters.dealStage = dealStageFilter;
        if (winOrLossFilter !== "all") analyticsFilters.winOrLoss = winOrLossFilter;
        if (prospectTypeFilter !== "all") analyticsFilters.prospectType = prospectTypeFilter;
        if (engagementTypeFilter !== "all") analyticsFilters.engagementType = engagementTypeFilter;
        if (ownerFilter !== "all") analyticsFilters.ownerId = ownerFilter;
        if (customFieldFilter && customValueFilter) {
          analyticsFilters.customField = customFieldFilter;
          analyticsFilters.customValue = customValueFilter;
        }

        const [statusAnalytics, ownerAnalytics, list] = await Promise.all([
          apiFetch<{ rows: any[] }>(`/analytics/query`, {
            method: "POST",
            body: JSON.stringify({
              filters: analyticsFilters,
              groupBy: ["status"],
              measures: ["count", "sumValue"],
              limit: 50,
            }),
          }),
          apiFetch<{ rows: any[] }>(`/analytics/query`, {
            method: "POST",
            body: JSON.stringify({
              filters: analyticsFilters,
              groupBy: ["ownerId"],
              measures: ["count", "sumValue"],
              limit: 50,
            }),
          }),
          apiFetch<{ items: ApiOpportunity[] }>(`/records?${q}`),
        ]);
        if (cancelled) return;

        const nextSummary: PipelineSummary = {
          totalsByStatus: (statusAnalytics.rows || []).map((r) => ({
            status: String(r.status ?? "Unspecified"),
            count: Number(r.count || 0),
            totalValue: Number(r.sumValue || 0),
          })),
          countsByOwner: (ownerAnalytics.rows || []).map((r) => ({
            ownerId: String(r.ownerId ?? ""),
            count: Number(r.count || 0),
            totalValue: Number(r.sumValue || 0),
          })),
        };
        setSummary(nextSummary);
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
  }, [
    dateFrom,
    dateTo,
    ownerFilter,
    statusFilter,
    dealStageFilter,
    winOrLossFilter,
    prospectTypeFilter,
    engagementTypeFilter,
    customFieldFilter,
    customValueFilter,
  ]);

  const ownerOptions = useMemo(() => {
    const opts = [{ value: "all", label: "All owners" }];
    for (const u of assignableUsers) {
      opts.push({ value: u.id, label: u.name || u.email });
    }
    return opts;
  }, [assignableUsers]);

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

  const ownerLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of assignableUsers) {
      m.set(String(u.id), String(u.name || u.email || u.id));
    }
    return m;
  }, [assignableUsers]);

  const opportunityCountByOwner = useMemo(() => {
    return opportunityCountData.map((row) => ({
      ...row,
      ownerId: row.name,
      name: ownerLabelById.get(String(row.name)) || String(row.name || "Unassigned"),
    }));
  }, [opportunityCountData, ownerLabelById]);

  const dueDateTimelineData = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const byMonth = new Map<string, { upcoming: number; overdue: number }>();
    for (const o of opps) {
      const bucket = String(o.dueDate || "").slice(0, 7);
      const label = bucket ? monthBucketLabel(`${bucket}-15`) : "Unspecified";
      const key = bucket || "Unspecified";
      const prev = byMonth.get(label) || { upcoming: 0, overdue: 0 };
      if (o.dueDate < today) prev.overdue += 1;
      else prev.upcoming += 1;
      byMonth.set(label, { ...prev, key } as any);
    }
    return [...byMonth.entries()]
      .map(([month, v]) => ({ month, ...(v as any) }))
      .sort((a, b) => {
        const da = new Date(`${a.month} 1`).getTime();
        const db = new Date(`${b.month} 1`).getTime();
        return da - db;
      });
  }, [opps]);

  const openRecordsWithFilters = (overrides: Record<string, string>) => {
    const q = new URLSearchParams();
    q.set("archived", "exclude");
    if (dateFrom) q.set("fromDueDate", dateFrom);
    if (dateTo) q.set("toDueDate", dateTo);
    if (statusFilter !== "all") q.set("status", statusFilter);
    if (dealStageFilter !== "all") q.set("dealStage", dealStageFilter);
    if (winOrLossFilter !== "all") q.set("winOrLoss", winOrLossFilter);
    if (prospectTypeFilter !== "all") q.set("prospectType", prospectTypeFilter);
    if (engagementTypeFilter !== "all") q.set("engagementType", engagementTypeFilter);
    if (ownerFilter !== "all") q.set("ownerId", ownerFilter);
    if (customFieldFilter && customValueFilter) {
      q.set("customField", customFieldFilter);
      q.set("customValue", customValueFilter);
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    navigate(`/app/opportunities?${q.toString()}`);
  };

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

  const handlePrintPdf = () => {
    if (loading) return;

    const filterLabel = (value: string, allLabel: string) =>
      value && value !== "all" ? value : allLabel;

    const ownerName =
      ownerFilter !== "all"
        ? ownerLabelById.get(ownerFilter) || ownerFilter
        : "All owners";

    const filters = [
      { label: "From date", value: dateFrom || "Any" },
      { label: "To date", value: dateTo || "Any" },
      { label: "Owner", value: ownerName },
      { label: "Status", value: filterLabel(statusFilter, "All statuses") },
      { label: "Deal stage", value: filterLabel(dealStageFilter, "All stages") },
      { label: "Win / loss", value: filterLabel(winOrLossFilter, "All outcomes") },
      { label: "Prospect type", value: filterLabel(prospectTypeFilter, "All types") },
      {
        label: "Engagement type",
        value: filterLabel(engagementTypeFilter, "All engagements"),
      },
      {
        label: "Records in report",
        value: `${opps.length.toLocaleString()} ${lowerFirst(terminology.recordPlural)}`,
      },
    ];

    const sections = [];

    if (showSection("pipelineByStatus")) {
      sections.push({
        title: "Pipeline value by status",
        table: pipelineValueData.length
          ? {
              headers: ["Status", "Record count", `Pipeline value (${currencyCode})`],
              rows: pipelineValueData.map((row) => [
                row.name,
                String(row.count),
                formatMoney(row.value, currencyCode),
              ]),
            }
          : undefined,
        emptyMessage: `No ${lowerFirst(terminology.recordSingular)} data for the selected filters.`,
      });
    }

    if (showSection("countByOwner")) {
      sections.push({
        title: `${terminology.recordSingular} count by owner`,
        table: opportunityCountByOwner.length
          ? {
              headers: ["Owner", "Record count", `Total value (${currencyCode})`],
              rows: opportunityCountByOwner.map((row) => [
                row.name,
                String(row.count),
                formatMoney(row.value, currencyCode),
              ]),
            }
          : undefined,
        emptyMessage: "No owner breakdown for the selected filters.",
      });
    }

    if (showSection("dueDateTimeline")) {
      sections.push({
        title: "Due date timeline",
        table: dueDateTimelineData.length
          ? {
              headers: ["Month", "Upcoming", "Overdue"],
              rows: dueDateTimelineData.map((row) => [
                row.month,
                String(row.upcoming ?? 0),
                String(row.overdue ?? 0),
              ]),
            }
          : undefined,
        emptyMessage: "No due dates in range.",
      });
    }

    if (showSection("winLoss")) {
      sections.push({
        title: "Win / loss / open",
        table: {
          headers: ["Outcome", "Record count"],
          rows: winLossSnapshot.map((row) => [row.name, String(row.count)]),
        },
      });
    }

    if (showSection("engagementType")) {
      sections.push({
        title: "Engagement type distribution",
        table: engagementTypeData.length
          ? {
              headers: [
                "Engagement type",
                "Record count",
                `Value (${currencyCode})`,
                "Share",
              ],
              rows: engagementTypeData.map((row) => [
                row.name,
                String(row.value),
                formatMoney(row.amount, currencyCode),
                `${((row.value / totalEng) * 100).toFixed(1)}%`,
              ]),
            }
          : undefined,
        emptyMessage: "No engagements in filtered data.",
      });
    }

    if (!sections.length) {
      alert("No report sections are enabled. Configure the reports layout to include at least one section.");
      return;
    }

    try {
      printReportDocument({
        title: "Reports & Analytics",
        subtitle: `Insights into ${lowerFirst(terminology.recordPlural)} and workspace performance`,
        generatedAt: new Date().toLocaleString(),
        filters,
        sections,
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Unable to open print view");
    }
  };

  const handleExport = () => {
    const q = new URLSearchParams();
    if (dateFrom) q.set("fromDate", dateFrom);
    if (dateTo) q.set("toDate", dateTo);
    if (statusFilter !== "all") q.set("status", statusFilter);
    if (winOrLossFilter !== "all") q.set("winOrLoss", winOrLossFilter);
    if (ownerFilter !== "all") q.set("owner", ownerFilter);
    if (dealStageFilter !== "all") q.set("dealStage", dealStageFilter);
    if (prospectTypeFilter !== "all") q.set("prospectType", prospectTypeFilter);
    if (engagementTypeFilter !== "all")
      q.set("engagementType", engagementTypeFilter);
    if (customFieldFilter && customValueFilter) {
      q.set("customField", customFieldFilter);
      q.set("customValue", customValueFilter);
    }
    void downloadWithAuth(
      `/export/reports/pipeline-summary.csv?${q}`,
      "pipeline-summary.csv"
    ).catch((e) => alert(e instanceof Error ? e.message : "Export failed"));
  };

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
      <PageHeader
        eyebrow={`${terminology.dashboardLabel || "Dashboard"} drill-down`}
        title="Reports & Analytics"
        description={`Insights into ${lowerFirst(terminology.recordPlural)} and workspace performance`}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            {!canEditLayouts ? null : (
              <PageLayoutEditor
                title="Reports layout"
                description="Choose which charts and sections appear on this page for the workspace."
              >
                <ReportsLayoutPanel />
              </PageLayoutEditor>
            )}
            <Link to="/app">
              <Button variant="outline" type="button">
                Back to dashboard
              </Button>
            </Link>
            <Button
              variant="outline"
              type="button"
              disabled={loading}
              onClick={handlePrintPdf}
            >
              <Printer className="w-4 h-4" />
              Print / Save PDF
            </Button>
            <Button variant="outline" type="button" onClick={handleExport}>
              <Download className="w-4 h-4" />
              Export Report
            </Button>
          </div>
        }
      />

      {error && (
        <p className="text-sm text-destructive border border-destructive/40 rounded-lg p-3">
          {error}
        </p>
      )}
      {loading && <LoadingDisplay message="Loading report data..." />}

      <Toolbar className="no-print">
          <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-4">
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

            <Select
              label="Deal stage"
              value={dealStageFilter}
              onChange={(e) => setDealStageFilter(e.target.value)}
              options={filterSelectOptions(dealStageOptions, "All stages")}
            />

            <Select
              label="Win / Loss"
              value={winOrLossFilter}
              onChange={(e) => setWinOrLossFilter(e.target.value)}
              options={winLossFilterOptions}
            />

            <Select
              label="Prospect type"
              value={prospectTypeFilter}
              onChange={(e) => setProspectTypeFilter(e.target.value)}
              options={filterSelectOptions(prospectTypeOptions, "All types")}
            />

            <Select
              label="Engagement type"
              value={engagementTypeFilter}
              onChange={(e) => setEngagementTypeFilter(e.target.value)}
              options={filterSelectOptions(engagementTypeOptions, "All engagements")}
            />
          </div>
      </Toolbar>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {showSection("pipelineByStatus") ? (
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Value by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {pipelineValueData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No {lowerFirst(terminology.recordSingular)} data for the selected filters.
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
                        `${currencyCode} ${(value / 1000000).toFixed(2)}M`
                      }
                    />
                    <Legend />
                    <Bar
                      dataKey="value"
                      fill="#0088FE"
                      name="Pipeline Value"
                      className="cursor-pointer"
                      onClick={(bar) => {
                        const status = String(bar?.payload?.name || "");
                        if (status) openRecordsWithFilters({ status });
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                  {pipelineValueData.map((item) => (
                    <div key={item.name}>
                      <p className="text-sm text-muted-foreground">{item.name}</p>
                      <p className="text-lg">
                        {currencyCode} {(item.value / 1000000).toFixed(1)}M
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.count} {lowerFirst(terminology.recordPlural)}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        ) : null}

        {showSection("countByOwner") ? (
        <Card>
          <CardHeader>
            <CardTitle>{terminology.recordSingular} Count by Owner</CardTitle>
          </CardHeader>
          <CardContent>
            {opportunityCountData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No owner breakdown for the selected filters.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={opportunityCountByOwner} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={100} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="count"
                    fill="#00C49F"
                    name={terminology.recordPlural}
                    className="cursor-pointer"
                    onClick={(bar) => {
                      const ownerId = String(bar?.payload?.ownerId || "");
                      if (ownerId) openRecordsWithFilters({ ownerId });
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        ) : null}

        {showSection("dueDateTimeline") ? (
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
                    className="cursor-pointer"
                    onClick={(bar) => {
                      const key = String(bar?.payload?.key || "");
                      if (!/^\d{4}-\d{2}$/.test(key)) return;
                      const [y, m] = key.split("-").map(Number);
                      const from = `${key}-01`;
                      const to = new Date(y, m, 0).toISOString().slice(0, 10);
                      openRecordsWithFilters({ fromDueDate: from, toDueDate: to });
                    }}
                  />
                  <Bar
                    dataKey="overdue"
                    stackId="a"
                    fill="#FF8042"
                    name="Overdue"
                    className="cursor-pointer"
                    onClick={(bar) => {
                      const key = String(bar?.payload?.key || "");
                      if (!/^\d{4}-\d{2}$/.test(key)) return;
                      const [y, m] = key.split("-").map(Number);
                      const from = `${key}-01`;
                      const to = new Date(y, m, 0).toISOString().slice(0, 10);
                      openRecordsWithFilters({ fromDueDate: from, toDueDate: to });
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        ) : null}

        {showSection("winLoss") ? (
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
                <Bar
                  dataKey="count"
                  fill="#8884d8"
                  name={terminology.recordPlural}
                  className="cursor-pointer"
                  onClick={(bar) => {
                    const winOrLoss = String(bar?.payload?.name || "");
                    if (winOrLoss) openRecordsWithFilters({ winOrLoss });
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        ) : null}

        {showSection("engagementType") ? (
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
                      className="cursor-pointer"
                      onClick={(_, index) => {
                        const entry = engagementTypeData[index];
                        if (entry?.name) openRecordsWithFilters({ engagementType: String(entry.name) });
                      }}
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
                            {item.value} {lowerFirst(terminology.recordPlural)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p>
                          {currencyCode} {(item.amount / 1000000).toFixed(2)}M
                        </p>
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
        ) : null}
      </div>
    </div>
  );
}
