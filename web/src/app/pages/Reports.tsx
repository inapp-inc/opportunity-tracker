import { useMemo } from "react";
import { PageLayoutEditor } from "../components/page-layout/PageLayoutEditor";
import { ReportsLayoutPanel } from "../components/page-layout/panels/ReportsLayoutPanel";
import { Link, useNavigate } from "react-router";
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
import { downloadWithAuth } from "../lib/download";
import { formatMoney } from "../lib/format";
import { printReportDocument } from "../lib/printReports";
import { lowerFirst, useTerminology } from "../lib/terminology";
import { catalogValueList, filterSelectOptions } from "../lib/lookupOptions";
import { useAssignableUsers, useCatalogLookups } from "../lib/serverState";
import { PageHeader, Toolbar, LoadingDisplay } from "../components/shared";
import { useCanManageTenantSettings, useIsPlatformAdmin } from "../lib/roles";
import { useReportsData } from "../hooks/useReportsData";

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#82ca9d"];

export function Reports() {
  const terminology = useTerminology();
  const canManageTenantSettings = useCanManageTenantSettings();
  const isPlatformAdmin = useIsPlatformAdmin();
  const canEditLayouts = canManageTenantSettings || isPlatformAdmin;
  const navigate = useNavigate();
  const { users: assignableUsers } = useAssignableUsers();
  const { lookups: catalogLookups } = useCatalogLookups();

  const {
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    ownerFilter,
    setOwnerFilter,
    statusFilter,
    setStatusFilter,
    dealStageFilter,
    setDealStageFilter,
    prospectTypeFilter,
    setProspectTypeFilter,
    engagementTypeFilter,
    setEngagementTypeFilter,
    winOrLossFilter,
    setWinOrLossFilter,
    customFieldFilter,
    setCustomFieldFilter,
    customValueFilter,
    setCustomValueFilter,
    summary,
    opps,
    loading,
    error,
    reportsLayout,
    showSection,
    currencyCode,
    pipelineValueData,
    opportunityCountData,
    dueDateTimelineData,
    buildFilterQuery,
  } = useReportsData();

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

  const ownerOptions = useMemo(() => {
    const opts = [{ value: "all", label: "All owners" }];
    for (const u of assignableUsers) {
      opts.push({ value: u.id, label: u.name || u.email });
    }
    return opts;
  }, [assignableUsers]);

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

  const openRecordsWithFilters = (overrides: Record<string, string>) => {
    navigate(`/app/opportunities?${buildFilterQuery(overrides).toString()}`);
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
