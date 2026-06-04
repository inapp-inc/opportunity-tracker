import { useState, useMemo, useEffect, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { Badge } from "../components/ui/Badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/Table";
import { EmptyState } from "../components/ui/EmptyState";
import { Card, CardContent } from "../components/ui/Card";
import { PageHeader, StatCard, Toolbar, LoadingDisplay } from "../components/shared";
import {
  Plus,
  Search,
  Download,
  Upload,
  ArrowUpDown,
  Eye,
  Edit,
  Archive,
  Link as LinkIcon,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  DollarSign,
  Grid2X2,
  Table2,
  AlertCircle,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { downloadWithAuth } from "../lib/download";
import {
  useCanArchiveRecords,
  useCanCreateRecords,
  useCanEdit,
  useCanManageTenantSettings,
  useIsPlatformAdmin,
} from "../lib/roles";
import { PageLayoutEditor } from "../components/page-layout/PageLayoutEditor";
import { OpportunitiesTableColumnsPanel } from "../components/page-layout/panels/OpportunitiesTableColumnsPanel";
import { SummaryCardsPanel } from "../components/page-layout/panels/SummaryCardsPanel";
import { fieldLabelsForDashboard } from "../lib/dashboard";
import {
  DEFAULT_LIST_TABLE_LAYOUT,
  isListColumnVisible,
  normalizeListTableLayout,
  type ListTableColumnKey,
  type ListTableLayout,
} from "../lib/listTableLayout";
import { WORKSPACE_LAYOUT_EVENT } from "../lib/pageLayoutEvents";
import { useAuthUser } from "../contexts/AuthUserContext";
import {
  ownerLabels,
  type ApiOpportunity,
} from "../lib/opportunity";
import { lowerFirst, useTerminology } from "../lib/terminology";
import { formatCustomValue, type CustomFieldValue } from "../lib/fields";
import { catalogValueList, filterSelectOptions } from "../lib/lookupOptions";
import { useAssignableUsers, useCatalogLookups, useTenantSchema } from "../lib/serverState";
import { formatMoney } from "../lib/format";
import { Modal } from "../components/ui/Modal";
import { computeSummaryCards, normalizeSummaryCardsConfig, type SummaryCardsConfig } from "../lib/summaryCards";

interface Opportunity {
  id: string;
  prospect: string;
  description: string;
  owner: string[];
  ownerIds: string[];
  deliverables: string;
  dueDate: string;
  status: "Not Started" | "In Progress" | "Completed";
  winLoss: "Win" | "Loss" | "Open";
  dealStage: string;
  value: number;
  currency: string;
  prospectType: string;
  engagementType: string;
  customFields: Record<string, CustomFieldValue>;
  version: number;
  archived: boolean;
  isDraft: boolean;
}

function mapApi(o: ApiOpportunity): Opportunity {
  return {
    id: o.id,
    prospect: o.prospect,
    description: o.opportunityDescription,
    owner: ownerLabels(o),
    ownerIds: o.ownerIds || [],
    deliverables: Array.isArray(o.deliverables)
      ? o.deliverables.join(", ")
      : String(o.deliverables || ""),
    dueDate: o.dueDate,
    status: o.status,
    winLoss: o.winOrLoss,
    dealStage: o.dealStage || "Discovery",
    value: Number(o.value || 0),
    currency: o.currency || "USD",
    prospectType: o.prospectType,
    engagementType: o.engagementType,
    customFields: o.customFields || {},
    version: o.version,
    archived: !!o.archived,
    isDraft: !!o.isDraft,
  };
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export function OpportunitiesWorkspace() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const canCreate = useCanCreateRecords();
  const canArchive = useCanArchiveRecords();
  const canManageTenantSettings = useCanManageTenantSettings();
  const isPlatformAdmin = useIsPlatformAdmin();
  const canEditLayouts = canManageTenantSettings || isPlatformAdmin;
  const { user } = useAuthUser();
  const terminology = useTerminology();
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("search") || searchParams.get("q") || "";
  const initialFilter = searchParams.get("filter") || "";
  const initialDealStage = searchParams.get("dealStage") || "all";
  const initialStatus = searchParams.get("status") || "all";
  const initialWinOrLoss = searchParams.get("winOrLoss") || "all";
  const initialProspectType = searchParams.get("prospectType") || "all";
  const initialEngagementType = searchParams.get("engagementType") || "all";
  const initialCustomField = searchParams.get("customField") || "";
  const initialCustomValue = searchParams.get("customValue") || "";

  const [items, setItems] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { users: assignableUsers } = useAssignableUsers();
  const { fields: schemaFields } = useTenantSchema();

  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [dealStageFilter, setDealStageFilter] = useState(initialDealStage);
  const [winOrLossFilter, setWinOrLossFilter] = useState(initialWinOrLoss);
  const [prospectTypeFilter, setProspectTypeFilter] = useState(initialProspectType);
  const [engagementTypeFilter, setEngagementTypeFilter] = useState(initialEngagementType);
  const [customFieldKey, setCustomFieldKey] = useState(initialCustomField);
  const [customFieldValue, setCustomFieldValue] = useState(initialCustomValue);
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState(
    initialFilter === "overdue"
      ? "overdue"
      : initialFilter === "dueWeek"
        ? "dueWeek"
        : "all"
  );
  const [archiveScope, setArchiveScope] = useState<"active" | "archived" | "all">("active");
  const [sortField, setSortField] = useState<keyof Opportunity>("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<{ row: number; message: string }[]>([]);
  const { lookups: catalogLookups } = useCatalogLookups();
  const [summaryCardsConfig, setSummaryCardsConfig] = useState<SummaryCardsConfig | null>(null);
  const [listTableLayout, setListTableLayout] = useState<ListTableLayout>(
    DEFAULT_LIST_TABLE_LAYOUT
  );
  const itemsPerPage = 10;

  const showCol = (key: ListTableColumnKey) =>
    isListColumnVisible(listTableLayout, key);

  const loadListLayout = useCallback(async () => {
    try {
      const res = await apiFetch<{ listTableLayout?: ListTableLayout; summaryCards?: SummaryCardsConfig }>(
        "/settings"
      );
      setListTableLayout(normalizeListTableLayout(res.listTableLayout));
      setSummaryCardsConfig(normalizeSummaryCardsConfig(res.summaryCards));
    } catch {
      setListTableLayout(DEFAULT_LIST_TABLE_LAYOUT);
      setSummaryCardsConfig(null);
    }
  }, []);

  useEffect(() => {
    void loadListLayout();
    const onLayout = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: string }>).detail;
      if (!detail?.page || detail.page === "opportunities") void loadListLayout();
    };
    window.addEventListener(WORKSPACE_LAYOUT_EVENT, onLayout);
    return () => window.removeEventListener(WORKSPACE_LAYOUT_EVENT, onLayout);
  }, [loadListLayout]);

  const catalogDealStages = useMemo(
    () => catalogValueList(catalogLookups?.dealStages),
    [catalogLookups]
  );
  const catalogWinLoss = useMemo(
    () => catalogValueList(catalogLookups?.winLoss),
    [catalogLookups]
  );
  const catalogProspectTypes = useMemo(
    () => catalogValueList(catalogLookups?.prospectTypes),
    [catalogLookups]
  );
  const catalogEngagementTypes = useMemo(
    () => catalogValueList(catalogLookups?.engagementTypes),
    [catalogLookups]
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const mineFromUrl = searchParams.get("mine") === "1";

  const buildListQuery = useCallback(() => {
    const q = new URLSearchParams();
    const archivedParam =
      archiveScope === "active" ? "exclude" : archiveScope === "archived" ? "only" : "all";
    q.set("archived", archivedParam);
    // Always include drafts in the workspace list; dashboards/analytics still exclude drafts by default.
    q.set("draft", "include");
    if (mineFromUrl && user?.sub) q.set("mine", "1");
    else if (ownerFilter !== "all") q.set("ownerId", ownerFilter);
    if (debouncedSearch.trim()) q.set("q", debouncedSearch.trim());
    if (statusFilter !== "all") q.set("status", statusFilter);
    if (dealStageFilter !== "all") q.set("dealStage", dealStageFilter);
    if (winOrLossFilter !== "all") q.set("winOrLoss", winOrLossFilter);
    return q.toString();
  }, [
    archiveScope,
    mineFromUrl,
    user?.sub,
    ownerFilter,
    debouncedSearch,
    statusFilter,
    dealStageFilter,
    winOrLossFilter,
  ]);

  useEffect(() => {
    const search = searchParams.get("search") || searchParams.get("q") || "";
    const filter = searchParams.get("filter") || "";
    setSearchQuery(search);
    setStatusFilter(searchParams.get("status") || "all");
    setDealStageFilter(searchParams.get("dealStage") || "all");
    setWinOrLossFilter(searchParams.get("winOrLoss") || "all");
    setProspectTypeFilter(searchParams.get("prospectType") || "all");
    setEngagementTypeFilter(searchParams.get("engagementType") || "all");
    setCustomFieldKey(searchParams.get("customField") || "");
    setCustomFieldValue(searchParams.get("customValue") || "");
    setDueFilter(
      filter === "overdue" ? "overdue" : filter === "dueWeek" ? "dueWeek" : "all"
    );
  }, [searchParams]);

  const loadRecords = useCallback(async (cancelledRef?: { cancelled: boolean }) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ApiOpportunity[] }>(
        `/records?${buildListQuery()}`
      );
      if (!cancelledRef?.cancelled) {
        setItems(res.items.map(mapApi));
        setLoadError(null);
      }
    } catch (e) {
      if (!cancelledRef?.cancelled) {
        setLoadError(e instanceof Error ? e.message : "Failed to load");
      }
    } finally {
      if (!cancelledRef?.cancelled) setLoading(false);
    }
  }, [buildListQuery]);

  useEffect(() => {
    const cancelledRef = { cancelled: false };
    void loadRecords(cancelledRef);
    return () => {
      cancelledRef.cancelled = true;
    };
  }, [loadRecords]);

  const handleExport = () => {
    void downloadWithAuth(
      `/export/opportunities.xlsx?${buildListQuery()}`,
      `${lowerFirst(terminology.recordPlural)}.xlsx`
    ).catch((e) => alert(e instanceof Error ? e.message : "Export failed"));
  };

  const handleTemplateDownload = () => {
    void downloadWithAuth(
      "/records/template.xlsx",
      `${lowerFirst(terminology.recordPlural)}-import-template.xlsx`
    ).catch((e) => setImportMsg(e instanceof Error ? e.message : "Template download failed"));
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    setImportErrors([]);
    try {
      if (!/\.xlsx$/i.test(file.name)) {
        throw new Error("Upload the XLSX template file.");
      }
      const result = await apiFetch<{
        created: number;
        errors: { row: number; message: string }[];
      }>("/records/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: await file.arrayBuffer(),
      });
      setImportErrors(result.errors || []);
      setImportMsg(
        `Imported ${result.created} ${lowerFirst(terminology.recordPlural)}${
          result.errors?.length ? ` with ${result.errors.length} row errors.` : "."
        }`
      );
      await loadRecords();
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleArchiveRow = async (opp: Opportunity, archived: boolean) => {
    if (!canArchive) {
      alert("You do not have permission for this action.");
      return;
    }
    const verb = archived ? "Hide" : "Restore";
    if (!confirm(`${verb} this ${lowerFirst(terminology.recordSingular)}?`)) return;
    try {
      await apiFetch(`/records/${opp.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived, version: opp.version }),
      });
      const res = await apiFetch<{ items: ApiOpportunity[] }>(
        `/records?${buildListQuery()}`
      );
      setItems(res.items.map(mapApi));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  };

  const ownerOptions = useMemo(() => {
    return [
      { value: "all", label: "All owners" },
      ...assignableUsers.map((u) => ({
        value: u.id,
        label: u.name || u.email,
      })),
    ];
  }, [assignableUsers]);

  const stageFilterOptions = useMemo(() => {
    const fromRecords = items.map((opp) => opp.dealStage).filter(Boolean);
    return [...new Set([...catalogDealStages, ...fromRecords])].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [catalogDealStages, items]);

  const winLossFilterOptions = useMemo(() => {
    const fromRecords = items.map((opp) => opp.winLoss).filter(Boolean);
    const values = [...new Set([...catalogWinLoss, ...fromRecords])];
    return filterSelectOptions(
      values.length ? values : ["Win", "Loss", "Open"],
      "All outcomes"
    );
  }, [catalogWinLoss, items]);

  const prospectTypeFilterOptions = useMemo(() => {
    const fromRecords = items.map((opp) => opp.prospectType).filter(Boolean);
    return filterSelectOptions(
      [...new Set([...catalogProspectTypes, ...fromRecords])],
      "All types"
    );
  }, [catalogProspectTypes, items]);

  const engagementTypeFilterOptions = useMemo(() => {
    const fromRecords = items.map((opp) => opp.engagementType).filter(Boolean);
    return filterSelectOptions(
      [...new Set([...catalogEngagementTypes, ...fromRecords])],
      "All engagements"
    );
  }, [catalogEngagementTypes, items]);

  const filteredAndSorted = useMemo(() => {
    let result = [...items];

    if (!mineFromUrl && ownerFilter !== "all") {
      result = result.filter((opp) => opp.ownerIds.includes(ownerFilter));
    }

    if (dealStageFilter !== "all") {
      result = result.filter((opp) => opp.dealStage === dealStageFilter);
    }

    if (statusFilter !== "all") {
      result = result.filter((opp) => opp.status === statusFilter);
    }

    if (winOrLossFilter !== "all") {
      result = result.filter((opp) => opp.winLoss === winOrLossFilter);
    }

    if (prospectTypeFilter !== "all") {
      result = result.filter((opp) => opp.prospectType === prospectTypeFilter);
    }

    if (engagementTypeFilter !== "all") {
      result = result.filter((opp) => opp.engagementType === engagementTypeFilter);
    }

    if (customFieldKey && customFieldValue) {
      result = result.filter((opp) => {
        const raw = opp.customFields[customFieldKey];
        if (Array.isArray(raw)) {
          return raw.map(String).includes(customFieldValue);
        }
        return String(raw ?? "") === customFieldValue;
      });
    }

    if (dueFilter === "overdue") {
      result = result.filter(
        (o) =>
          o.status !== "Completed" &&
          startOfDay(new Date(o.dueDate + "T12:00:00")) <
            startOfDay(new Date())
      );
    }

    if (dueFilter === "dueWeek") {
      const today = startOfDay(new Date());
      result = result.filter((o) => {
        if (o.status === "Completed") return false;
        const due = startOfDay(new Date(o.dueDate + "T12:00:00"));
        const days = Math.round((due - today) / 86400000);
        return days >= 0 && days <= 7;
      });
    }

    result.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const modifier = sortDirection === "asc" ? 1 : -1;

      if (typeof aVal === "string" && typeof bVal === "string") {
        return aVal.localeCompare(bVal) * modifier;
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return (aVal - bVal) * modifier;
      }
      return 0;
    });

    return result;
  }, [
    items,
    ownerFilter,
    mineFromUrl,
    dealStageFilter,
    statusFilter,
    winOrLossFilter,
    prospectTypeFilter,
    engagementTypeFilter,
    customFieldKey,
    customFieldValue,
    dueFilter,
    sortField,
    sortDirection,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    statusFilter,
    dealStageFilter,
    winOrLossFilter,
    prospectTypeFilter,
    engagementTypeFilter,
    customFieldKey,
    customFieldValue,
    ownerFilter,
    dueFilter,
    archiveScope,
  ]);

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredAndSorted.slice(start, start + itemsPerPage);
  }, [filteredAndSorted, currentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / itemsPerPage));

  const handleSort = (field: keyof Opportunity) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const getStatusBadge = (status: Opportunity["status"]) => {
    const variants: Record<Opportunity["status"], "default" | "info" | "success"> = {
      "Not Started": "default",
      "In Progress": "info",
      Completed: "success",
    };
    return <Badge variant={variants[status]}>{status}</Badge>;
  };

  const getWinLossBadge = (winLoss: Opportunity["winLoss"]) => {
    const variants: Record<Opportunity["winLoss"], "success" | "danger" | "warning"> = {
      Win: "success",
      Loss: "danger",
      Open: "warning",
    };
    return <Badge variant={variants[winLoss]}>{winLoss}</Badge>;
  };

  const tableSchemaFields = schemaFields.filter(
    (field) => field.source !== "system" && field.showInTable
  );
  const fieldLabels = useMemo(() => fieldLabelsForDashboard(schemaFields), [schemaFields]);

  const isOverdue = (dueDate: string, status: string) => {
    if (status === "Completed") return false;
    return startOfDay(new Date(dueDate + "T12:00:00")) < startOfDay(new Date());
  };

  const summaryStats = useMemo(() => {
    const totalValue = filteredAndSorted.reduce((sum, opp) => sum + Number(opp.value || 0), 0);
    const currencyCounts = new Map<string, number>();
    for (const opp of filteredAndSorted) {
      const code = (opp.currency || "USD").toUpperCase();
      currencyCounts.set(code, (currencyCounts.get(code) || 0) + 1);
    }
    let currency = "USD";
    let max = 0;
    for (const [code, count] of currencyCounts) {
      if (count > max) {
        max = count;
        currency = code;
      }
    }
    return {
      total: filteredAndSorted.length,
      completed: filteredAndSorted.filter((opp) => opp.status === "Completed").length,
      overdue: filteredAndSorted.filter((opp) => isOverdue(opp.dueDate, opp.status)).length,
      totalValue,
      currency,
    };
  }, [filteredAndSorted]);

  const summaryCards = useMemo(
    () =>
      computeSummaryCards({
        config: summaryCardsConfig,
        records: filteredAndSorted,
        currencyCode: summaryStats.currency,
        schemaFields,
      }),
    [filteredAndSorted, summaryCardsConfig, summaryStats.currency, schemaFields]
  );

  const renderRecordCard = (opp: Opportunity) => (
    <Card key={opp.id} className="group hover:border-primary/40 hover:shadow-md">
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {opp.dealStage || "Stage not set"}
            </p>
            <Link
              to={`/app/opportunities/${opp.id}`}
              className="mt-1 block truncate text-base font-bold text-foreground hover:text-primary"
            >
              {opp.prospect}
            </Link>
            <p className="mt-1 text-sm text-muted-foreground">{opp.description}</p>
          </div>
          {getStatusBadge(opp.status)}
        </div>
        {opp.isDraft ? (
          <Badge variant="warning">Draft</Badge>
        ) : null}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Value</p>
            <p className="font-semibold tabular-nums">{formatMoney(opp.value, opp.currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Date</p>
            <p className={isOverdue(opp.dueDate, opp.status) ? "font-semibold text-destructive" : "font-semibold"}>
              {opp.dueDate}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {opp.owner.map((owner, i) => (
            <Badge key={`${owner}-${i}`} variant="default">
              {owner}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          {getWinLossBadge(opp.winLoss)}
          <div className="flex items-center gap-1">
            <Link to={`/app/opportunities/${opp.id}`}>
              <Button variant="ghost" size="sm">
                <Eye className="w-4 h-4" />
              </Button>
            </Link>
            {canEdit ? (
              <Link to={`/app/opportunities/${opp.id}/edit`}>
                <Button variant="ghost" size="sm" title="Edit record">
                  <Edit className="w-4 h-4" />
                </Button>
              </Link>
            ) : null}
            <Link to={`/app/opportunities/${opp.id}?tab=artifacts`}>
              <Button variant="ghost" size="sm" title="Artifact links">
                <LinkIcon className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-6">
      {loadError ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {loadError}
        </div>
      ) : null}

      <PageHeader
        title={terminology.recordPlural}
        description={terminology.recordDescription}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!canEditLayouts ? null : (
              <>
                <PageLayoutEditor
                  title="Summary cards"
                  buttonLabel="Card configuration"
                  description="Configure the four summary cards shown at the top of this page and Dashboard."
                >
                  <SummaryCardsPanel />
                </PageLayoutEditor>
                <PageLayoutEditor
                  title="List layout"
                  description="Choose which columns appear in the table view for this workspace."
                >
                  <OpportunitiesTableColumnsPanel />
                </PageLayoutEditor>
              </>
            )}
            {canCreate ? (
            <>
            <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4" />
              Import
            </Button>
            <Link to="/app/opportunities/new">
              <Button>
                <Plus className="w-4 h-4" />
                New {terminology.recordSingular}
              </Button>
            </Link>
            </>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
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

      <Toolbar>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={`Search ${lowerFirst(terminology.recordPlural)}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-input-background rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <Select
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
          value={dealStageFilter}
          onChange={(e) => setDealStageFilter(e.target.value)}
          options={filterSelectOptions(stageFilterOptions, "All stages")}
        />

        <Select
          value={winOrLossFilter}
          onChange={(e) => setWinOrLossFilter(e.target.value)}
          options={winLossFilterOptions}
        />

        <Select
          value={prospectTypeFilter}
          onChange={(e) => setProspectTypeFilter(e.target.value)}
          options={prospectTypeFilterOptions}
        />

        <Select
          value={engagementTypeFilter}
          onChange={(e) => setEngagementTypeFilter(e.target.value)}
          options={engagementTypeFilterOptions}
        />

        <Select
          value={dueFilter}
          onChange={(e) => setDueFilter(e.target.value)}
          options={[
            { value: "all", label: "All date states" },
            { value: "overdue", label: "Overdue only" },
            { value: "dueWeek", label: "Within 7 days" },
          ]}
        />

        <Select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          options={ownerOptions}
          disabled={mineFromUrl}
        />

        <Select
          value={archiveScope}
          onChange={(e) =>
            setArchiveScope(e.target.value as "active" | "archived" | "all")
          }
          options={[
            { value: "active", label: "Active only" },
            { value: "archived", label: "Hidden only" },
            { value: "all", label: "All" },
          ]}
        />

        <Button variant="outline" type="button" onClick={handleExport}>
          <Download className="w-4 h-4" />
          Export
        </Button>
        <div className="flex rounded-lg bg-muted p-1">
          <Button
            type="button"
            size="sm"
            variant={viewMode === "table" ? "secondary" : "ghost"}
            onClick={() => setViewMode("table")}
            aria-label="Table view"
          >
            <Table2 className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === "cards" ? "secondary" : "ghost"}
            onClick={() => setViewMode("cards")}
            aria-label="Card view"
          >
            <Grid2X2 className="w-4 h-4" />
          </Button>
        </div>
      </Toolbar>

      <Modal
        isOpen={importOpen}
        onClose={() => {
          if (!importing) setImportOpen(false);
        }}
        title={`Import ${terminology.recordPlural}`}
        footer={
          <>
            <Button type="button" variant="outline" onClick={handleTemplateDownload}>
              <Download className="w-4 h-4" />
              Download Template
            </Button>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>
              Close
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download the XLSX template for this workspace schema, fill one row per {lowerFirst(terminology.recordSingular)}, then upload it here. Use the dropdowns where provided; the server validates uploaded lookup values again before importing.
          </p>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Upload completed template</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={importing}
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                event.currentTarget.value = "";
                void handleImportFile(file);
              }}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-foreground"
            />
          </label>
          {importing ? (
            <p className="text-sm text-muted-foreground">Importing rows...</p>
          ) : null}
          {importMsg ? (
            <p className="text-sm text-muted-foreground">{importMsg}</p>
          ) : null}
          {importErrors.length ? (
            <div className="max-h-48 overflow-auto rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium">Rows that were not imported</p>
              <ul className="space-y-1 text-sm text-destructive">
                {importErrors.slice(0, 20).map((error) => (
                  <li key={`${error.row}-${error.message}`}>
                    Row {error.row}: {error.message}
                  </li>
                ))}
              </ul>
              {importErrors.length > 20 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing first 20 of {importErrors.length} errors.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      {loading ? (
        <LoadingDisplay message={`Loading ${lowerFirst(terminology.recordPlural)}...`} />
      ) : paginatedData.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={`No ${lowerFirst(terminology.recordPlural)} found`}
          description={`Try adjusting your filters or create a new ${lowerFirst(terminology.recordSingular)}`}
          actionLabel={canCreate ? `Create ${terminology.recordSingular}` : undefined}
          onAction={canCreate ? () => navigate("/app/opportunities/new") : undefined}
        />
      ) : (
        <>
          {viewMode === "cards" ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {paginatedData.map(renderRecordCard)}
            </div>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {showCol("prospect") ? (
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => handleSort("prospect")}
                      className="flex items-center gap-1 hover:text-foreground"
                    >
                      Prospect
                      <ArrowUpDown className="w-4 h-4" />
                    </button>
                  </TableHead>
                ) : null}
                {showCol("description") ? (
                  <TableHead>{fieldLabels?.opportunityDescription || "Description"}</TableHead>
                ) : null}
                {showCol("owner") ? <TableHead>{fieldLabels?.ownerIds || "Owners"}</TableHead> : null}
                {showCol("dueDate") ? (
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => handleSort("dueDate")}
                      className="flex items-center gap-1 hover:text-foreground"
                    >
                      {fieldLabels?.dueDate || "Due Date"}
                      <ArrowUpDown className="w-4 h-4" />
                    </button>
                  </TableHead>
                ) : null}
                {showCol("stage") ? <TableHead>{fieldLabels?.dealStage || "Deal stage"}</TableHead> : null}
                {tableSchemaFields.map((field) => (
                  <TableHead key={field.id} title={field.label}>
                    {field.label}
                  </TableHead>
                ))}
                {showCol("status") ? <TableHead>{fieldLabels?.status || "Status"}</TableHead> : null}
                {showCol("value") ? (
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => handleSort("value")}
                      className="flex items-center gap-1 hover:text-foreground"
                    >
                      {fieldLabels?.value || "Value"}
                      <ArrowUpDown className="w-4 h-4" />
                    </button>
                  </TableHead>
                ) : null}
                {showCol("winLoss") ? (
                  <TableHead>{fieldLabels?.winOrLoss || "Win / Loss"}</TableHead>
                ) : null}
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.map((opp) => (
                <TableRow key={opp.id}>
                  {showCol("prospect") ? (
                    <TableCell>
                      <Link
                        to={`/app/opportunities/${opp.id}`}
                        className="hover:text-primary hover:underline"
                      >
                        {opp.prospect}
                      </Link>
                    </TableCell>
                  ) : null}
                  {showCol("description") ? (
                    <TableCell className="max-w-xs truncate">
                      {opp.description}
                    </TableCell>
                  ) : null}
                  {showCol("owner") ? (
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {opp.owner.map((owner, i) => (
                          <Badge key={`${owner}-${i}`} variant="default">
                            {owner}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  ) : null}
                  {showCol("dueDate") ? (
                    <TableCell>
                      <span
                        className={
                          isOverdue(opp.dueDate, opp.status)
                            ? "text-destructive"
                            : ""
                        }
                      >
                        {opp.dueDate}
                      </span>
                    </TableCell>
                  ) : null}
                  {showCol("stage") ? (
                    <TableCell>
                      <Badge variant="info">{opp.dealStage}</Badge>
                    </TableCell>
                  ) : null}
                  {tableSchemaFields.map((field) => (
                    <TableCell key={field.id}>
                      {formatCustomValue(opp.customFields[field.key])}
                    </TableCell>
                  ))}
                  {showCol("status") ? (
                    <TableCell>{getStatusBadge(opp.status)}</TableCell>
                  ) : null}
                  {showCol("value") ? (
                    <TableCell>
                      {formatMoney(opp.value, opp.currency)}
                    </TableCell>
                  ) : null}
                  {showCol("winLoss") ? (
                    <TableCell>{getWinLossBadge(opp.winLoss)}</TableCell>
                  ) : null}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link to={`/app/opportunities/${opp.id}`}>
                        <Button variant="ghost" size="sm">
                          <Eye className="w-4 h-4" />
                        </Button>
                      </Link>
                      {canEdit ? (
                        <Link to={`/app/opportunities/${opp.id}/edit`}>
                          <Button variant="ghost" size="sm" title="Edit record">
                            <Edit className="w-4 h-4" />
                          </Button>
                        </Link>
                      ) : null}
                      <Link to={`/app/opportunities/${opp.id}?tab=artifacts`}>
                        <Button variant="ghost" size="sm" title="Artifact links">
                          <LinkIcon className="w-4 h-4" />
                        </Button>
                      </Link>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          title={opp.archived ? "Restore" : "Hide"}
                          onClick={() =>
                            void handleArchiveRow(opp, !opp.archived)
                          }
                        >
                          <Archive className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" disabled title="View only">
                          <Archive className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}

          {filteredAndSorted.length > itemsPerPage && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
                {Math.min(currentPage * itemsPerPage, filteredAndSorted.length)} of{" "}
                {filteredAndSorted.length} {lowerFirst(terminology.recordPlural)}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>
                <span className="text-sm">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
