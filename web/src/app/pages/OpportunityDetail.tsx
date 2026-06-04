import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/Tabs";
import { Modal } from "../components/ui/Modal";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import {
  Edit,
  ExternalLink,
  Plus,
  FileText,
  Presentation,
  File,
  Pencil,
  Trash2,
  AlertCircle,
  Calendar,
  DollarSign,
  User,
  Clock,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import {
  useCanArchiveRecords,
  useCanDeleteRecords,
  useCanEdit,
  useCanWriteArtifacts,
  useCanWriteComments,
  useIsAdmin,
} from "../lib/roles";
import {
  ownerLabels,
  type ApiOpportunity,
  type OpportunityActivity,
  type TenantFieldDefinition,
} from "../lib/opportunity";
import { lowerFirst, useTerminology } from "../lib/terminology";
import { formatCustomValue } from "../lib/fields";
import type { CaseStudyLayout } from "../lib/caseStudyLayout";
import { renderCaseStudyLayout } from "../lib/caseStudyRender";
import { useCaseStudySession } from "../lib/caseStudyConfig";
import { downloadCaseStudyPng, waitForDomPaint } from "../lib/caseStudyDownload";
import { catalogValueList } from "../lib/lookupOptions";
import { useCatalogLookups, useOnTenantLookupsUpdated, useTenantSchema } from "../lib/serverState";
import { PageHeader, StatCard, LoadingDisplay } from "../components/shared";
import { formatDateTimeInZone, formatMoney } from "../lib/format";

type ArtifactUi = {
  id: string;
  type: string;
  url: string;
  title?: string;
  addedBy: string;
  addedOn: string;
};

type ApiArtifact = ArtifactUi & { artifactType: string };

function mapArtifact(a: ApiArtifact): ArtifactUi {
  return {
    id: String(a.id),
    type: String(a.type || a.artifactType || "Artifact"),
    url: a.url,
    title: a.title,
    addedBy: a.addedBy,
    addedOn: a.addedOn,
  };
}

function activityLabel(kind: string) {
  if (kind === "COMMENT") return "Note";
  if (kind === "CREATED") return "Created";
  if (kind === "ARCHIVED") return "Archived";
  if (kind === "RESTORED") return "Restored";
  return "Update";
}

function CaseStudyView({
  opportunity,
  schemaFields,
  layout,
}: {
  opportunity: ApiOpportunity;
  schemaFields: TenantFieldDefinition[];
  layout: CaseStudyLayout;
}) {
  const columns = renderCaseStudyLayout(layout, opportunity, schemaFields);
  const colCount = Math.max(columns.length, 1);

  return (
    <div
      className="grid w-full gap-4"
      style={{
        gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
      }}
    >
      {columns.map((column) => (
        <div
          key={column.id}
          className="min-w-0 space-y-3 rounded-lg border border-border p-4 h-full"
        >
          {column.title ? (
            <h3 className="text-sm font-semibold text-foreground border-b border-border pb-2">
              {column.title}
            </h3>
          ) : null}
          {column.blocks.map((block) => (
            <p key={block.id} className="text-sm whitespace-pre-wrap text-foreground">
              {block.html}
            </p>
          ))}
          <div className="space-y-2">
            {column.rows.map((row) => (
              <Metric
                key={row.id}
                label={row.label}
                value={row.value}
                multiline={row.multiline}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Metric({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div
      className={
        multiline
          ? "space-y-1"
          : "flex items-start justify-between gap-4"
      }
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={`text-sm font-semibold text-foreground ${
          multiline
            ? "whitespace-pre-wrap"
            : "text-right whitespace-nowrap"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function OpportunityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canEdit = useCanEdit();
  const canArchive = useCanArchiveRecords();
  const canDelete = useCanDeleteRecords();
  const canWriteArtifacts = useCanWriteArtifacts();
  const canWriteComments = useCanWriteComments();
  const isAdmin = useIsAdmin();
  const terminology = useTerminology();
  const [opp, setOpp] = useState<ApiOpportunity | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactUi[]>([]);
  const [activity, setActivity] = useState<OpportunityActivity[]>([]);
  const { fields: schemaFields } = useTenantSchema();
  const [caseStudyDownloading, setCaseStudyDownloading] = useState(false);
  const caseStudyRef = useRef<HTMLDivElement | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isArtifactModalOpen, setIsArtifactModalOpen] = useState(false);
  const { lookups: catalogLookups } = useCatalogLookups();
  const artifactTypeOptions = useMemo(() => {
    const types = catalogValueList(catalogLookups?.artifactTypes);
    return types.length ? types : ["Proposal", "SOW", "Presentation Deck"];
  }, [catalogLookups]);
  const displayTimezone = catalogLookups?.displayTimezone || "UTC";
  const [activeTab, setActiveTab] = useState(
    searchParams.get("tab") === "artifacts"
      ? "artifacts"
      : searchParams.get("tab") === "case-study"
        ? "case-study"
      : searchParams.get("tab") === "activity"
        ? "activity"
        : "overview"
  );
  const caseStudyTabActive = activeTab === "case-study";
  const {
    enabled: caseStudyEnabled,
    layout: caseStudyLayout,
    layoutPersisted: caseStudyLayoutPersisted,
    loading: caseStudyConfigLoading,
    configError: caseStudyConfigError,
    epoch: caseStudyEpoch,
    readyToCapture: caseStudyReadyToCapture,
    setReadyToCapture,
  } = useCaseStudySession({
    recordId: id,
    tabActive: caseStudyTabActive,
  });
  const [newArtifact, setNewArtifact] = useState<{
    type: string;
    url: string;
    title: string;
  }>({ type: "", url: "", title: "" });
  const [editingArtifactId, setEditingArtifactId] = useState<string | null>(null);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "artifacts" || tab === "activity" || tab === "case-study" || tab === "overview") {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!caseStudyEnabled && activeTab === "case-study") setActiveTab("overview");
  }, [caseStudyEnabled, activeTab]);

  useEffect(() => {
    if (!caseStudyTabActive || !id) return;
    let cancelled = false;
    setReadyToCapture(false);
    void apiFetch<ApiOpportunity>(`/records/${id}?ts=${Date.now()}`, { cache: "no-store" })
      .then((record) => {
        if (!cancelled) setOpp(record);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(
            e instanceof Error
              ? e.message
              : `Failed to refresh ${lowerFirst(terminology.recordSingular)}`
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [caseStudyTabActive, id, setReadyToCapture]);

  useEffect(() => {
    if (!caseStudyTabActive || caseStudyConfigLoading || !opp) {
      setReadyToCapture(false);
      return;
    }
    let cancelled = false;
    void waitForDomPaint().then(() => {
      if (!cancelled) setReadyToCapture(true);
    });
    return () => {
      cancelled = true;
      setReadyToCapture(false);
    };
  }, [
    caseStudyTabActive,
    caseStudyConfigLoading,
    opp,
    caseStudyEpoch,
    setReadyToCapture,
  ]);

  const loadOpportunity = useCallback(async () => {
    if (!id) return;
    try {
      const [o, arts, acts] = await Promise.all([
        apiFetch<ApiOpportunity>(`/records/${id}`),
        apiFetch<{ items: ApiArtifact[] }>(`/records/${id}/artifacts`),
        apiFetch<{ items: OpportunityActivity[] }>(`/records/${id}/activities`),
      ]);
      setOpp(o);
      setArtifacts((arts.items || []).map(mapArtifact));
      setActivity(acts.items || []);
      setLoadError(null);
    } catch (e) {
      setLoadError(
        e instanceof Error
          ? e.message
          : `Failed to load ${lowerFirst(terminology.recordSingular)}`
      );
    }
  }, [id, terminology.recordSingular]);

  useEffect(() => {
    void loadOpportunity();
  }, [loadOpportunity]);

  useOnTenantLookupsUpdated(() => {
    void loadOpportunity();
  });

  useEffect(() => {
    if (!artifactTypeOptions.length) return;
    setNewArtifact((prev) => ({ ...prev, type: prev.type || artifactTypeOptions[0] }));
  }, [artifactTypeOptions]);

  const reloadArtifacts = async () => {
    if (!id) return;
    const arts = await apiFetch<{ items: ApiArtifact[] }>(
      `/records/${id}/artifacts`
    );
    setArtifacts((arts.items || []).map(mapArtifact));
  };

  const handleAddArtifact = async () => {
    if (!canWriteArtifacts) {
      alert("You do not have permission for this action.");
      return;
    }
    if (!newArtifact.url || !id) return;

    const payload = {
      artifactType: newArtifact.type,
      url: newArtifact.url,
      title: newArtifact.title || undefined,
    };
    if (editingArtifactId) {
      await apiFetch(`/records/${id}/artifacts/${editingArtifactId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await apiFetch(`/records/${id}/artifacts`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    await reloadArtifacts();

    setNewArtifact({
      type: artifactTypeOptions[0] || "",
      url: "",
      title: "",
    });
    setEditingArtifactId(null);
    setIsArtifactModalOpen(false);
  };

  const handleDeleteArtifact = async (linkId: string) => {
    if (!canWriteArtifacts) {
      alert("You do not have permission for this action.");
      return;
    }
    if (!id) return;
    await apiFetch(`/records/${id}/artifacts/${linkId}`, {
      method: "DELETE",
    });
    await reloadArtifacts();
  };

  const getArtifactIcon = (type: string) => {
    switch (type) {
      case "Proposal":
        return <FileText className="w-5 h-5" />;
      case "SOW":
        return <File className="w-5 h-5" />;
      case "Presentation Deck":
        return <Presentation className="w-5 h-5" />;
      default:
        return <File className="w-5 h-5" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "info" | "success"> = {
      "Not Started": "default",
      "In Progress": "info",
      Completed: "success",
    };
    return (
      <Badge variant={variants[status] || "default"}>{status}</Badge>
    );
  };

  const getWinLossBadge = (winLoss: string) => {
    const variants: Record<string, "success" | "danger" | "warning"> = {
      Win: "success",
      Loss: "danger",
      Open: "warning",
    };
    return (
      <Badge variant={variants[winLoss] || "warning"}>{winLoss}</Badge>
    );
  };

  const isOverdue = useMemo(() => {
    if (!opp || opp.status === "Completed") return false;
    const due = new Date(opp.dueDate + "T12:00:00");
    const today = new Date();
    due.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return due < today;
  }, [opp]);

  const reloadActivity = async () => {
    if (!id) return;
    const acts = await apiFetch<{ items: OpportunityActivity[] }>(
      `/records/${id}/activities`
    );
    setActivity(acts.items || []);
  };

  const handleAddComment = async () => {
    if (!canWriteComments) {
      alert("You do not have permission for this action.");
      return;
    }
    if (!id || !commentText.trim()) return;
    setCommentSaving(true);
    try {
      await apiFetch(`/records/${id}/activities`, {
        method: "POST",
        body: JSON.stringify({ body: commentText.trim() }),
      });
      setCommentText("");
      await reloadActivity();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to post comment");
    } finally {
      setCommentSaving(false);
    }
  };

  const ownerNames = opp ? ownerLabels(opp) : [];

  const deliverablesText = opp
    ? Array.isArray(opp.deliverables)
      ? opp.deliverables.join(", ")
      : String(opp.deliverables || "")
    : "";

  const handleArchiveToggle = async () => {
    if (!canArchive) {
      alert("You do not have permission for this action.");
      return;
    }
    if (!opp || !id) return;
    const next = !opp.archived;
    if (
      !confirm(
        next
          ? `Archive this ${lowerFirst(terminology.recordSingular)}?`
          : `Restore this ${lowerFirst(terminology.recordSingular)}?`
      )
    ) return;
    try {
      await apiFetch(`/records/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: next, version: opp.version }),
      });
      const o = await apiFetch<ApiOpportunity>(`/records/${id}`);
      setOpp(o);
      await reloadActivity();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const handleDeleteForever = async () => {
    if (!canDelete) {
      alert("You do not have permission for this action.");
      return;
    }
    if (!opp || !id) return;
    if (
      !confirm(
        `Permanently delete this ${lowerFirst(terminology.recordSingular)}? This cannot be undone.`
      )
    ) return;
    try {
      await apiFetch(`/records/${id}`, { method: "DELETE" });
      navigate("/app/opportunities");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (!id) return null;

  if (loadError || !opp) {
    return (
      <div className="mx-auto max-w-screen-2xl p-6">
        {loadError ? (
          <>
            <p className="text-destructive">{loadError}</p>
            <Link to="/app/opportunities" className="text-primary underline mt-4 inline-block">
              Back to list
            </Link>
          </>
        ) : (
          <LoadingDisplay message={`Loading ${lowerFirst(terminology.recordSingular)}...`} />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
      <Breadcrumbs
        items={[
          { label: terminology.recordPlural, href: "/app/opportunities" },
          { label: opp.prospect },
        ]}
      />

      <PageHeader
        eyebrow={terminology.recordSingular}
        title={opp.prospect}
        description={opp.opportunityDescription}
        actions={
          <div className="flex flex-wrap items-center gap-2 justify-end">
          {opp.archived ? (
            <Badge variant="default">Archived</Badge>
          ) : null}
          {canEdit ? (
            <Link to={`/app/opportunities/${id}/edit`}>
              <Button variant="outline" type="button">
                <Edit className="w-4 h-4" />
                Edit record
              </Button>
            </Link>
          ) : null}
          {canWriteArtifacts ? (
            <Button
              variant="outline"
              type="button"
              onClick={() => setActiveTab("artifacts")}
            >
              <ExternalLink className="w-4 h-4" />
              Artifact links
            </Button>
          ) : null}
          {canArchive ? (
            <Button variant="outline" type="button" onClick={() => void handleArchiveToggle()}>
              {opp.archived ? "Restore" : "Archive"}
            </Button>
          ) : null}
          {isAdmin && canDelete ? (
            <Button variant="destructive" type="button" onClick={() => void handleDeleteForever()}>
              Delete
            </Button>
          ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard
          label="Due Date"
          value={opp.dueDate}
          description={isOverdue ? "Overdue" : "On track"}
          icon={Calendar}
          iconClassName={isOverdue ? "text-red-600" : "text-blue-600"}
          accentClassName={isOverdue ? "bg-red-500" : "bg-blue-500"}
        />
        <StatCard
          label="Value"
          value={formatMoney(Number(opp.value || 0), opp.currency)}
          description="Commercial estimate"
          icon={DollarSign}
          iconClassName="text-emerald-600"
          accentClassName="bg-emerald-500"
        />
        <StatCard
          label="Status"
          value={opp.status}
          description={opp.dealStage || "Current stage"}
          icon={Clock}
          iconClassName="text-violet-600"
          accentClassName="bg-violet-500"
        />
        <StatCard
          label="Win/Loss"
          value={opp.winOrLoss}
          description="Outcome state"
          icon={User}
          iconClassName="text-amber-600"
          accentClassName="bg-amber-500"
        />
      </div>

      {isOverdue && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:bg-red-900/20 dark:border-red-800">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-red-900 dark:text-red-200 mb-1">
              Overdue {terminology.recordSingular}
            </h4>
            <p className="text-sm text-red-800 dark:text-red-300">
              This {lowerFirst(terminology.recordSingular)} is past its due date.
              Please update the status or extend the deadline.
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="artifacts">Artifact Links</TabsTrigger>
          <TabsTrigger value="activity">Notes &amp; activity</TabsTrigger>
          {caseStudyEnabled ? <TabsTrigger value="case-study">Case Study</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>{terminology.recordSingular} Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Owner</p>
                  <div className="flex flex-wrap gap-2">
                    {ownerNames.map((owner, i) => (
                      <Badge key={`${owner}-${i}`}>{owner}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Deal stage</p>
                  <Badge variant="info">{opp.dealStage || "Discovery"}</Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Deliverables
                  </p>
                  <p>{deliverablesText}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Prospect Type
                  </p>
                  <p>{opp.prospectType}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Engagement Type
                  </p>
                  <p>{opp.engagementType}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    First Presales Call
                  </p>
                  <p>{opp.firstPresalesCall || "—"}</p>
                </div>
                {schemaFields.filter((field) => field.source !== "system").length > 0 ? (
                  <div className="pt-2 border-t border-border">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {schemaFields.filter((field) => field.source !== "system").map((field) => (
                        <div key={field.id}>
                          <p className="text-sm text-muted-foreground mb-1">
                            {field.label}
                          </p>
                          <p>{formatCustomValue(opp.customFields?.[field.key])}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Static notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {opp.notes || "No summary notes on this record."}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  For live tracking updates, use the Notes &amp; activity tab.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="artifacts">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Artifact Links</CardTitle>
                {canWriteArtifacts ? (
                  <Button
                    type="button"
                    onClick={() => {
                      setEditingArtifactId(null);
                      setNewArtifact({
                        type: artifactTypeOptions[0] || "",
                        url: "",
                        title: "",
                      });
                      setIsArtifactModalOpen(true);
                    }}
                  >
                    <Plus className="w-4 h-4" />
                    Add Link
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {artifacts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No artifact links added yet
                </div>
              ) : (
                <div className="space-y-3">
                  {artifacts.map((artifact) => (
                    <div
                      key={artifact.id}
                      className="flex items-start justify-between p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-start gap-3 flex-1">
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                          {getArtifactIcon(artifact.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="truncate">
                              {artifact.title || artifact.type}
                            </h4>
                            <Badge variant="default">{artifact.type}</Badge>
                          </div>
                          <a
                            href={artifact.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline flex items-center gap-1 mb-2 truncate"
                          >
                            {artifact.url}
                            <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          </a>
                          <p className="text-xs text-muted-foreground">
                            Added by {artifact.addedBy} on {artifact.addedOn}
                          </p>
                        </div>
                      </div>
                      {canWriteArtifacts ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            onClick={() => {
                              setEditingArtifactId(artifact.id);
                              setNewArtifact({
                                type: artifact.type || artifactTypeOptions[0] || "",
                                url: artifact.url,
                                title: artifact.title || "",
                              });
                              setIsArtifactModalOpen(true);
                            }}
                            aria-label="Edit artifact link"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            onClick={() => handleDeleteArtifact(artifact.id)}
                            aria-label="Delete artifact link"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Notes &amp; activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {canWriteComments ? (
                <div className="space-y-2">
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 bg-input-background rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Add a chronological note for live tracking…"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={commentSaving || !commentText.trim()}
                    onClick={() => void handleAddComment()}
                  >
                    {commentSaving ? "Saving…" : "Add note"}
                  </Button>
                </div>
              ) : null}

              {activity.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No notes or activity yet. Updates appear in chronological order.
                </p>
              ) : (
                <div className="space-y-4">
                  {[...activity]
                    .sort(
                      (a, b) =>
                        new Date(b.createdAt).getTime() -
                        new Date(a.createdAt).getTime()
                    )
                    .map((item) => (
                    <div key={item.id} className="flex gap-4 border-b border-border pb-4 last:border-0">
                      <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <Badge variant="default">{activityLabel(item.kind)}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {item.actorEmail}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{item.body}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDateTimeInZone(item.createdAt, displayTimezone)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="case-study">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Case Study</CardTitle>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    caseStudyDownloading ||
                    !opp ||
                    caseStudyConfigLoading ||
                    !caseStudyReadyToCapture
                  }
                  onClick={async () => {
                    if (!opp || !caseStudyRef.current) return;
                    try {
                      setCaseStudyDownloading(true);
                      await downloadCaseStudyPng(
                        caseStudyRef.current,
                        `Case-Study-${opp.id}.png`
                      );
                    } catch (e) {
                      alert(
                        e instanceof Error
                          ? e.message
                          : "Unable to download case study as an image"
                      );
                    } finally {
                      setCaseStudyDownloading(false);
                    }
                  }}
                >
                  {caseStudyDownloading ? "Rendering…" : "Download as Image"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {caseStudyConfigError ? (
                <p className="text-sm text-destructive">{caseStudyConfigError}</p>
              ) : null}
              {!caseStudyLayoutPersisted && !caseStudyConfigLoading && !caseStudyConfigError ? (
                <p className="text-sm text-muted-foreground">
                  Showing the built-in case study template. Save a layout under Settings →
                  Case Study for this workspace to use your configuration here.
                </p>
              ) : null}
              <div ref={caseStudyRef} className="bg-white p-6 rounded-xl border border-border">
                {opp && !caseStudyConfigLoading && !caseStudyConfigError ? (
                  <CaseStudyView
                    key={`case-study-${id}-${caseStudyEpoch}`}
                    opportunity={opp}
                    schemaFields={schemaFields}
                    layout={caseStudyLayout}
                  />
                ) : caseStudyConfigLoading ? (
                  <LoadingDisplay />
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Modal
        isOpen={isArtifactModalOpen}
        onClose={() => {
          setIsArtifactModalOpen(false);
          setEditingArtifactId(null);
        }}
        title={editingArtifactId ? "Edit Artifact Link" : "Add Artifact Link"}
        footer={
          <>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setIsArtifactModalOpen(false);
                setEditingArtifactId(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleAddArtifact}>
              {editingArtifactId ? "Save changes" : "Add Link"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Artifact Type"
            value={newArtifact.type}
            onChange={(e) =>
              setNewArtifact({
                ...newArtifact,
                type: e.target.value,
              })
            }
            options={artifactTypeOptions.map((type) => ({
              value: type,
              label: type,
            }))}
            required
          />

          <Input
            label="URL"
            type="url"
            value={newArtifact.url}
            onChange={(e) =>
              setNewArtifact({ ...newArtifact, url: e.target.value })
            }
            placeholder="https://docs.example.com/..."
            required
          />

          <Input
            label="Title (Optional)"
            value={newArtifact.title}
            onChange={(e) =>
              setNewArtifact({ ...newArtifact, title: e.target.value })
            }
            placeholder="e.g., Cloud Migration Proposal v2.1"
          />
        </div>
      </Modal>
    </div>
  );
}
