import { useState, useMemo, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { Badge } from "../components/ui/Badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/Table";
import { EmptyState } from "../components/ui/EmptyState";
import {
  Plus,
  Search,
  Download,
  ArrowUpDown,
  Eye,
  Edit,
  Archive,
  Briefcase,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { downloadWithAuth } from "../lib/download";
import { useCanEdit } from "../lib/roles";

interface Opportunity {
  id: string;
  prospect: string;
  description: string;
  owner: string[];
  deliverables: string;
  dueDate: string;
  status: "Not Started" | "In Progress" | "Completed";
  winLoss: "Win" | "Loss" | "Open";
  value: number;
  currency: string;
  prospectType: string;
  engagementType: string;
  version: number;
  archived: boolean;
}

type ApiOpp = {
  id: string;
  prospect: string;
  opportunityDescription: string;
  ownerIds: string[];
  deliverables: string[];
  dueDate: string;
  status: Opportunity["status"];
  winOrLoss: Opportunity["winLoss"];
  value: number;
  currency: string;
  prospectType: string;
  engagementType: string;
  version: number;
  archived?: boolean;
};

function mapApi(o: ApiOpp): Opportunity {
  return {
    id: o.id,
    prospect: o.prospect,
    description: o.opportunityDescription,
    owner: o.ownerIds?.length ? o.ownerIds : ["Unassigned"],
    deliverables: Array.isArray(o.deliverables)
      ? o.deliverables.join(", ")
      : String(o.deliverables || ""),
    dueDate: o.dueDate,
    status: o.status,
    winLoss: o.winOrLoss,
    value: Number(o.value || 0),
    currency: o.currency || "USD",
    prospectType: o.prospectType,
    engagementType: o.engagementType,
    version: o.version,
    archived: !!o.archived,
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
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("search") || "";
  const initialFilter = searchParams.get("filter") || "";

  const [items, setItems] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState(initialFilter === "overdue" ? "overdue" : "all");
  const [archiveScope, setArchiveScope] = useState<"active" | "archived" | "all">("active");
  const [sortField, setSortField] = useState<keyof Opportunity>("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    let cancelled = false;
    const archivedParam =
      archiveScope === "active" ? "exclude" : archiveScope === "archived" ? "only" : "all";
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{ items: ApiOpp[] }>(
          `/opportunities?archived=${encodeURIComponent(archivedParam)}`
        );
        if (!cancelled) {
          setItems(res.items.map(mapApi));
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [archiveScope]);

  const handleExport = () => {
    const archivedParam =
      archiveScope === "active" ? "exclude" : archiveScope === "archived" ? "only" : "all";
    const q = new URLSearchParams();
    q.set("archived", archivedParam);
    if (searchQuery.trim()) q.set("q", searchQuery.trim());
    void downloadWithAuth(`/export/opportunities.csv?${q}`, "opportunities.csv").catch((e) =>
      alert(e instanceof Error ? e.message : "Export failed")
    );
  };

  const handleArchiveRow = async (opp: Opportunity, archived: boolean) => {
    const verb = archived ? "Archive" : "Restore";
    if (!confirm(`${verb} this opportunity?`)) return;
    try {
      await apiFetch(`/opportunities/${opp.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived, version: opp.version }),
      });
      const archivedParam =
        archiveScope === "active" ? "exclude" : archiveScope === "archived" ? "only" : "all";
      const res = await apiFetch<{ items: ApiOpp[] }>(
        `/opportunities?archived=${encodeURIComponent(archivedParam)}`
      );
      setItems(res.items.map(mapApi));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  };

  const ownerOptions = useMemo(() => {
    const s = new Set<string>();
    for (const o of items) {
      for (const n of o.owner) s.add(n);
    }
    return ["all", ...[...s].sort()];
  }, [items]);

  const filteredAndSorted = useMemo(() => {
    let result = [...items];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (opp) =>
          opp.prospect.toLowerCase().includes(q) ||
          opp.description.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "all") {
      result = result.filter((opp) => opp.status === statusFilter);
    }

    if (ownerFilter !== "all") {
      result = result.filter((opp) => opp.owner.includes(ownerFilter));
    }

    if (dueFilter === "overdue") {
      result = result.filter(
        (o) =>
          o.status !== "Completed" &&
          startOfDay(new Date(o.dueDate + "T12:00:00")) <
            startOfDay(new Date())
      );
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
  }, [items, searchQuery, statusFilter, ownerFilter, dueFilter, sortField, sortDirection]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, ownerFilter, dueFilter]);

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

  const isOverdue = (dueDate: string, status: string) => {
    if (status === "Completed") return false;
    return startOfDay(new Date(dueDate + "T12:00:00")) < startOfDay(new Date());
  };

  return (
    <div className="p-6 space-y-6">
      {loadError ? (
        <div className="p-4 border border-red-300 rounded-lg bg-red-50 text-red-800">
          {loadError}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <h1>Opportunities</h1>
          <p className="text-muted-foreground">
            Manage and track all presales opportunities
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

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search opportunities..."
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
          label="Due"
          value={dueFilter}
          onChange={(e) => setDueFilter(e.target.value)}
          options={[
            { value: "all", label: "All due states" },
            { value: "overdue", label: "Overdue only" },
          ]}
        />

        <Select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          options={ownerOptions.map((o) =>
            o === "all"
              ? { value: "all", label: "All Owners" }
              : { value: o, label: o }
          )}
        />

        <Select
          label="Archive"
          value={archiveScope}
          onChange={(e) =>
            setArchiveScope(e.target.value as "active" | "archived" | "all")
          }
          options={[
            { value: "active", label: "Active only" },
            { value: "archived", label: "Archived only" },
            { value: "all", label: "All" },
          ]}
        />

        <Button variant="outline" type="button" onClick={handleExport}>
          <Download className="w-4 h-4" />
          Export
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading opportunities...</p>
      ) : paginatedData.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No opportunities found"
          description="Try adjusting your filters or create a new opportunity"
          actionLabel={canEdit ? "Create Opportunity" : undefined}
          onAction={canEdit ? () => navigate("/app/opportunities/new") : undefined}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
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
                <TableHead>Description</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => handleSort("dueDate")}
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    Due Date
                    <ArrowUpDown className="w-4 h-4" />
                  </button>
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => handleSort("value")}
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    Value
                    <ArrowUpDown className="w-4 h-4" />
                  </button>
                </TableHead>
                <TableHead>Win/Loss</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.map((opp) => (
                <TableRow key={opp.id}>
                  <TableCell>
                    <Link
                      to={`/app/opportunities/${opp.id}`}
                      className="hover:text-primary hover:underline"
                    >
                      {opp.prospect}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {opp.description}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {opp.owner.map((owner, i) => (
                        <Badge key={`${owner}-${i}`} variant="default">
                          {owner}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
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
                  <TableCell>{getStatusBadge(opp.status)}</TableCell>
                  <TableCell>
                    {opp.currency} ${opp.value.toLocaleString()}
                  </TableCell>
                  <TableCell>{getWinLossBadge(opp.winLoss)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link to={`/app/opportunities/${opp.id}`}>
                        <Button variant="ghost" size="sm">
                          <Eye className="w-4 h-4" />
                        </Button>
                      </Link>
                      {canEdit ? (
                        <Link to={`/app/opportunities/${opp.id}/edit`}>
                          <Button variant="ghost" size="sm">
                            <Edit className="w-4 h-4" />
                          </Button>
                        </Link>
                      ) : null}
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          title={opp.archived ? "Restore" : "Archive"}
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

          {filteredAndSorted.length > itemsPerPage && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
                {Math.min(currentPage * itemsPerPage, filteredAndSorted.length)} of{" "}
                {filteredAndSorted.length} opportunities
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
