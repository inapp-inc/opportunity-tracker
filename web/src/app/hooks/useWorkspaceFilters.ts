import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useAuthUser } from "../contexts/AuthUserContext";

export type ArchiveScope = "active" | "archived" | "all";
export type DueFilter = "all" | "overdue" | "dueWeek";

export function useWorkspaceFilters() {
  const { user } = useAuthUser();
  const [searchParams] = useSearchParams();

  const initialSearch = searchParams.get("search") || searchParams.get("q") || "";
  const initialFilter = searchParams.get("filter") || "";

  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all");
  const [dealStageFilter, setDealStageFilter] = useState(searchParams.get("dealStage") || "all");
  const [winOrLossFilter, setWinOrLossFilter] = useState(searchParams.get("winOrLoss") || "all");
  const [prospectTypeFilter, setProspectTypeFilter] = useState(
    searchParams.get("prospectType") || "all"
  );
  const [engagementTypeFilter, setEngagementTypeFilter] = useState(
    searchParams.get("engagementType") || "all"
  );
  const [customFieldKey, setCustomFieldKey] = useState(searchParams.get("customField") || "");
  const [customFieldValue, setCustomFieldValue] = useState(
    searchParams.get("customValue") || ""
  );
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState<DueFilter>(
    initialFilter === "overdue" ? "overdue" : initialFilter === "dueWeek" ? "dueWeek" : "all"
  );
  const [archiveScope, setArchiveScope] = useState<ArchiveScope>("active");

  const mineFromUrl = searchParams.get("mine") === "1";

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

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

  const buildListQuery = useCallback(() => {
    const q = new URLSearchParams();
    const archivedParam =
      archiveScope === "active" ? "exclude" : archiveScope === "archived" ? "only" : "all";
    q.set("archived", archivedParam);
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

  return {
    searchQuery,
    setSearchQuery,
    debouncedSearch,
    statusFilter,
    setStatusFilter,
    dealStageFilter,
    setDealStageFilter,
    winOrLossFilter,
    setWinOrLossFilter,
    prospectTypeFilter,
    setProspectTypeFilter,
    engagementTypeFilter,
    setEngagementTypeFilter,
    customFieldKey,
    setCustomFieldKey,
    customFieldValue,
    setCustomFieldValue,
    ownerFilter,
    setOwnerFilter,
    dueFilter,
    setDueFilter,
    archiveScope,
    setArchiveScope,
    mineFromUrl,
    buildListQuery,
  };
}
