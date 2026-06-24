import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { apiFetch } from "../lib/api";
import type { ApiOpportunity } from "../lib/opportunity";
import {
  DEFAULT_REPORTS_LAYOUT,
  isReportSectionVisible,
  normalizeReportsLayout,
  type ReportsLayout,
} from "../lib/reportsLayout";
import { WORKSPACE_LAYOUT_EVENT } from "../lib/pageLayoutEvents";
import type { PipelineSummary } from "./opportunity/types";

function monthBucketLabel(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

export function useReportsData() {
  const [searchParams] = useSearchParams();

  const [dateFrom, setDateFrom] = useState(searchParams.get("fromDate") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("toDate") || "");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all");
  const [dealStageFilter, setDealStageFilter] = useState(searchParams.get("dealStage") || "all");
  const [prospectTypeFilter, setProspectTypeFilter] = useState(
    searchParams.get("prospectType") || "all"
  );
  const [engagementTypeFilter, setEngagementTypeFilter] = useState(
    searchParams.get("engagementType") || "all"
  );
  const [winOrLossFilter, setWinOrLossFilter] = useState(searchParams.get("winOrLoss") || "all");
  const [customFieldFilter, setCustomFieldFilter] = useState(
    searchParams.get("customField") || ""
  );
  const [customValueFilter, setCustomValueFilter] = useState(
    searchParams.get("customValue") || ""
  );
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [opps, setOpps] = useState<ApiOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportsLayout, setReportsLayout] = useState<ReportsLayout>(DEFAULT_REPORTS_LAYOUT);

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

        const analyticsFilters: Record<string, unknown> = { archived: "exclude" };
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
          apiFetch<{ rows: Record<string, unknown>[] }>(`/analytics/query`, {
            method: "POST",
            body: JSON.stringify({
              filters: analyticsFilters,
              groupBy: ["status"],
              measures: ["count", "sumValue"],
              limit: 50,
            }),
          }),
          apiFetch<{ rows: Record<string, unknown>[] }>(`/analytics/query`, {
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

        setSummary({
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
        });
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
    const byMonth = new Map<string, { upcoming: number; overdue: number; key?: string }>();
    for (const o of opps) {
      const bucket = String(o.dueDate || "").slice(0, 7);
      const label = bucket ? monthBucketLabel(`${bucket}-15`) : "Unspecified";
      const prev = byMonth.get(label) || { upcoming: 0, overdue: 0 };
      if (o.dueDate < today) prev.overdue += 1;
      else prev.upcoming += 1;
      byMonth.set(label, { ...prev, key: bucket || "Unspecified" });
    }
    return [...byMonth.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => {
        const da = new Date(`${a.month} 1`).getTime();
        const db = new Date(`${b.month} 1`).getTime();
        return da - db;
      });
  }, [opps]);

  const buildFilterQuery = useCallback(
    (overrides: Record<string, string> = {}) => {
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
      return q;
    },
    [
      dateFrom,
      dateTo,
      statusFilter,
      dealStageFilter,
      winOrLossFilter,
      prospectTypeFilter,
      engagementTypeFilter,
      ownerFilter,
      customFieldFilter,
      customValueFilter,
    ]
  );

  return {
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
  };
}
