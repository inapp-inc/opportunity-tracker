import { useEffect, useMemo, useState } from "react";
import { PageLayoutEditor } from "../components/page-layout/PageLayoutEditor";
import { DashboardLayoutPanel } from "../components/page-layout/panels/DashboardLayoutPanel";
import { SummaryCardsPanel } from "../components/page-layout/panels/SummaryCardsPanel";
import { WORKSPACE_LAYOUT_EVENT } from "../lib/pageLayoutEvents";
import { Link, useNavigate } from "react-router";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { AlertCircle, CheckCircle2, Briefcase, Plus, TrendingUp, BarChart3, Download } from "lucide-react";
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
  ResponsiveContainer,
} from "recharts";
import {
  TenantPermissions,
  useCanEdit,
  useCanManageTenantSettings,
  useIsPlatformAdmin,
  useTenantPermission,
} from "../lib/roles";
import { PageHeader, StatCard } from "../components/shared";
import { apiFetch } from "../lib/api";
import {
  fieldLabelsForDashboard,
  formatDashboardMetric,
  groupRecordsByField,
  recordFieldValue,
  type DashboardWidget,
} from "../lib/dashboard";
import { useDashboardData } from "../lib/serverState";
import { downloadWithAuth } from "../lib/download";
import { formatMoney } from "../lib/format";
import { opportunitiesDrilldownUrl, reportsDrilldownUrl } from "../lib/drilldown";
import type { ApiOpportunity } from "../lib/opportunity";
import { useAuthUser } from "../contexts/AuthUserContext";
import { computeSummaryCards } from "../lib/summaryCards";
import { LoadingDisplay, ErrorDisplay } from "../components/shared/StateDisplay";

type DashboardScope = "me" | "workspace";

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function primaryCurrency(records: ApiOpportunity[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const code = String(record.currency || "USD").toUpperCase();
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  let best = "USD";
  let max = 0;
  for (const [code, count] of counts) {
    if (count > max) {
      max = count;
      best = code;
    }
  }
  return best;
}

export function Dashboard() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const canManageTenantSettings = useCanManageTenantSettings();
  const isPlatformAdmin = useIsPlatformAdmin();
  const { user } = useAuthUser();
  const canEditLayouts = canManageTenantSettings || isPlatformAdmin;
  // Toggling between "workspace" and "me" is safe for any user who can read records.
  // Previously this was limited to admins, which caused viewers to be stuck on "me"
  // and see 0 records if they weren’t set as owners.
  const canToggleScope = useTenantPermission(TenantPermissions.recordsRead);
  const dashboardScopeKey = `pt_dashboard_scope:${user?.sub || "anon"}:${
    user?.activeTenantId || user?.tenantId || "tenant"
  }`;

  const [scope, setScope] = useState<DashboardScope>(() => {
    if (!canToggleScope) return "workspace";
    try {
      const saved = localStorage.getItem(dashboardScopeKey);
      return saved === "workspace" ? "workspace" : "me";
    } catch {
      return "workspace";
    }
  });

  useEffect(() => {
    if (!canToggleScope) {
      setScope("workspace");
      return;
    }
    try {
      localStorage.setItem(dashboardScopeKey, scope);
    } catch {
      // ignore storage failures
    }
  }, [canToggleScope, dashboardScopeKey, scope]);

  const [layoutReloadToken, setLayoutReloadToken] = useState(0);

  useEffect(() => {
    const onLayout = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: string }>).detail;
      if (!detail?.page || detail.page === "dashboard" || detail.page === "summary-cards") {
        setLayoutReloadToken((t) => t + 1);
      }
    };
    window.addEventListener(WORKSPACE_LAYOUT_EVENT, onLayout);
    return () => window.removeEventListener(WORKSPACE_LAYOUT_EVENT, onLayout);
  }, []);

  const {
    opportunities,
    schemaFields,
    dashboardConfig,
    terminology,
    summaryCards,
    loading,
    error: loadError,
  } = useDashboardData({ scope, reloadToken: layoutReloadToken });

  const activeRecords = useMemo(
    () => opportunities.filter((record) => !record.archived),
    [opportunities]
  );

  const currencyCode = useMemo(
    () => primaryCurrency(activeRecords),
    [activeRecords]
  );

  const dashboardSummaryCards = useMemo(
    () =>
      computeSummaryCards({
        config: summaryCards,
        records: activeRecords,
        currencyCode,
        schemaFields,
      }),
    [summaryCards, activeRecords, currencyCode, schemaFields]
  );

  const fieldLabels = useMemo(() => {
    return fieldLabelsForDashboard(schemaFields);
  }, [schemaFields]);

  const [analyticsByWidget, setAnalyticsByWidget] = useState<
    Record<string, { rows: any[]; totals?: Record<string, any> }>
  >({});
  const [analyticsLoadError, setAnalyticsLoadError] = useState<string | null>(null);

  function analyticsDimensionKey(field: string | undefined): string | null {
    if (!field) return null;
    if (field === "dueDate") return "dueMonth";
    if (field.startsWith("custom:")) return field;
    const allowed = [
      "status",
      "dealStage",
      "winOrLoss",
      "prospectType",
      "engagementType",
      "owner",
      "currency",
    ];
    return allowed.includes(field) ? field : null;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAnalyticsLoadError(null);
      setAnalyticsByWidget({});

      try {
        const analyticsBaseFilters: Record<string, unknown> = { archived: "exclude" };
        if (scope === "me" && user?.sub) {
          analyticsBaseFilters.ownerId = user.sub;
        }
        const supported = dashboardConfig.widgets
          .map((widget) => {
            if (widget.type === "bar" || widget.type === "pie") {
              const dim = analyticsDimensionKey(widget.field);
              if (!dim) return null;
              return {
                widgetId: widget.id,
                promise: apiFetch<{ rows: any[]; totals?: Record<string, any> }>(
                  "/analytics/query",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      filters: analyticsBaseFilters,
                      groupBy: [dim],
                      measures: ["count"],
                      limit: widget.limit || 8,
                    }),
                  }
                ),
              };
            }

            if (widget.type === "metric_count") {
              return {
                widgetId: widget.id,
                promise: apiFetch<{ rows: any[]; totals?: Record<string, any> }>(
                  "/analytics/query",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      filters: analyticsBaseFilters,
                      groupBy: ["status"],
                      measures: ["count"],
                      limit: 50,
                    }),
                  }
                ),
              };
            }

            if (
              (widget.type === "metric_sum" || widget.type === "metric_avg") &&
              widget.field === "value"
            ) {
              const measures =
                widget.type === "metric_sum"
                  ? ["sumValue"]
                  : ["count", "sumValue", "avgValue"];
              return {
                widgetId: widget.id,
                promise: apiFetch<{ rows: any[]; totals?: Record<string, any> }>(
                  "/analytics/query",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      filters: analyticsBaseFilters,
                      groupBy: ["status"],
                      measures,
                      limit: 50,
                    }),
                  }
                ),
              };
            }

            return null;
          })
          .filter(Boolean) as { widgetId: string; promise: Promise<any> }[];

        const results = await Promise.all(supported.map((s) => s.promise));
        if (cancelled) return;

        const next: typeof analyticsByWidget = {};
        for (let i = 0; i < supported.length; i++) {
          next[supported[i].widgetId] = results[i];
        }
        setAnalyticsByWidget(next);
      } catch (e) {
        if (!cancelled) {
          setAnalyticsLoadError(
            e instanceof Error ? e.message : "Failed to load analytics"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dashboardConfig, schemaFields, scope, user?.sub]);

  const dashboardStats = useMemo(() => {
    const totalValue = activeRecords.reduce(
      (sum, record) => sum + Number(record.value || 0),
      0
    );
    const completed = activeRecords.filter(
      (record) => record.status === "Completed"
    ).length;
    const overdue = activeRecords.filter((record) => {
      if (record.status === "Completed" || !record.dueDate) return false;
      return (
        startOfDay(new Date(`${record.dueDate}T12:00:00`)) < startOfDay(new Date())
      );
    }).length;
    return {
      activeCount: activeRecords.length,
      totalValue,
      completed,
      overdue,
    };
  }, [activeRecords]);

  const handleDrilldown = (field: string | undefined, bucket: string) => {
    navigate(
      opportunitiesDrilldownUrl(field, bucket, {
        mine: scope === "me",
        ownerId: scope === "me" ? user?.sub : undefined,
      })
    );
  };

  const renderWidget = (widget: DashboardWidget) => {
    if (widget.type === "metric_count") {
      const count =
        analyticsByWidget[widget.id]?.totals?.count ?? dashboardStats.activeCount;
      return (
        <Card
          key={widget.id}
          className="overflow-hidden hover:shadow-md cursor-pointer"
          onClick={() =>
            navigate(scope === "me" ? "/app/opportunities?mine=1" : "/app/opportunities")
          }
        >
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {widget.title}
              </p>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Briefcase className="w-5 h-5 text-blue-600" />
              </div>
            </div>
            <p className="text-3xl font-bold tabular-nums mb-1">
              {count.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">
              Active {terminology.recordPlural.toLowerCase()} in this workspace
            </p>
          </CardContent>
        </Card>
      );
    }

    if (widget.type === "metric_sum" || widget.type === "metric_avg") {
      const analyticsRes = analyticsByWidget[widget.id]?.totals;
      const value =
        widget.field === "value"
          ? widget.type === "metric_sum"
            ? Number(analyticsRes?.sumValue ?? 0)
            : Number(analyticsRes?.avgValue ?? 0)
          : (() => {
              const nums = activeRecords
                .map((o) => Number(recordFieldValue(o, widget.field)))
                .filter((n) => !Number.isNaN(n));
              const sum = nums.reduce((a, b) => a + b, 0);
              return widget.type === "metric_avg"
                ? sum / (nums.length || 1)
                : sum;
            })();
      return (
        <Card
          key={widget.id}
          className="overflow-hidden hover:shadow-md cursor-pointer"
          onClick={() => navigate("/app/reports")}
        >
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {widget.title}
              </p>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
            <p className="text-3xl font-bold tabular-nums mb-1">
              {formatDashboardMetric(value, widget.field, currencyCode)}
            </p>
            <p className="text-xs text-muted-foreground">
              {widget.type === "metric_avg" ? "Average" : "Sum"} of{" "}
              {fieldLabels[widget.field || ""] || widget.field}
            </p>
          </CardContent>
        </Card>
      );
    }

    const dimKey = analyticsDimensionKey(widget.field);
    const analyticsRows = analyticsByWidget[widget.id]?.rows;
    const data =
      dimKey && Array.isArray(analyticsRows) && analyticsRows.length
        ? analyticsRows.map((r) => ({
            name: String(r[dimKey] ?? "Unspecified"),
            count: Number(r.count || 0),
          }))
        : groupRecordsByField(activeRecords, widget.field, widget.limit || 8);
    return (
      <Card key={widget.id} className="overflow-hidden hover:shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{widget.title}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {fieldLabels[widget.field || ""] || widget.field || "Breakdown"} — click a segment to view matching records
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : widget.type === "pie" ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.count}`}
                  outerRadius={80}
                  dataKey="count"
                  className="cursor-pointer"
                  onClick={(_, index) => {
                    const entry = data[index];
                    if (entry) handleDrilldown(widget.field, entry.name);
                  }}
                >
                  {data.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar
                  dataKey="count"
                  fill={COLORS[0]}
                  radius={[6, 6, 0, 0]}
                  className="cursor-pointer"
                  onClick={(bar) => {
                    const name = String(bar?.payload?.name || "");
                    if (name) handleDrilldown(widget.field, name);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={reportsDrilldownUrl(widget.field, "all")}>
              <Button variant="outline" size="sm">
                <BarChart3 className="w-4 h-4" />
                Open report
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
        <PageHeader title="Dashboard" description="Loading your workspace overview…" />
        <LoadingDisplay />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
        <PageHeader title="Dashboard" description="Workspace overview" />
        <ErrorDisplay title="Failed to load dashboard" description={loadError} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
      {analyticsLoadError ? (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-100">
          {analyticsLoadError}
        </div>
      ) : null}

      <PageHeader
        eyebrow="Overview"
        title={dashboardConfig.title}
        description={dashboardConfig.subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!canToggleScope ? null : (
              <div className="flex items-center rounded-xl border border-border bg-card p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={scope === "me" ? "primary" : "ghost"}
                  onClick={() => setScope("me")}
                >
                  Me
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={scope === "workspace" ? "primary" : "ghost"}
                  onClick={() => setScope("workspace")}
                >
                  Workspace
                </Button>
              </div>
            )}
            {!canEditLayouts ? null : (
              <>
                <PageLayoutEditor
                  title="Summary cards"
                  buttonLabel="Card configuration"
                  description="Configure the four summary cards shown at the top of this page and Records."
                >
                  <SummaryCardsPanel />
                </PageLayoutEditor>
                <PageLayoutEditor
                  title={`${terminology.dashboardLabel || "Dashboard"} layout`}
                  description="Configure widgets and titles for this workspace. Changes apply to everyone in the workspace unless you save a personal dashboard."
                >
                  <DashboardLayoutPanel />
                </PageLayoutEditor>
              </>
            )}
            <Link to="/app/reports">
              <Button variant="outline" size="sm">
                <BarChart3 className="w-4 h-4" />
                Reports
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void downloadWithAuth(
                  "/export/opportunities.xlsx?archived=exclude",
                  `${terminology.recordPlural}.xlsx`
                ).catch((e) => alert(e instanceof Error ? e.message : "Export failed"))
              }
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
            {canEdit ? (
              <Link to="/app/opportunities/new">
                <Button size="sm">
                  <Plus className="w-4 h-4" />
                  New {terminology.recordSingular}
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardSummaryCards.map((card) => (
          <StatCard
            key={card.id}
            label={card.label}
            value={card.value}
            description={card.description}
            icon={card.icon}
            iconClassName={card.iconClassName}
            accentClassName={card.accentClassName}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {dashboardConfig.widgets.map(renderWidget)}
      </div>
    </div>
  );
}
