import { useState, useEffect, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router";
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
  Trash2,
  AlertCircle,
  Calendar,
  DollarSign,
  User,
  Clock,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useCanEdit, useIsAdmin } from "../lib/roles";

type ArtifactUi = {
  id: string;
  type: "Proposal" | "SOW" | "Presentation Deck";
  url: string;
  title?: string;
  addedBy: string;
  addedOn: string;
};

type ApiArtifact = ArtifactUi & { artifactType: string };

type ApiOpportunity = {
  id: string;
  prospect: string;
  opportunityDescription: string;
  ownerIds: string[];
  deliverables: string[];
  dueDate: string;
  status: string;
  notes: string;
  winOrLoss: string;
  firstPresalesCall?: string | null;
  closedDate?: string | null;
  prospectType: string;
  engagementType: string;
  value: number;
  currency: string;
  version: number;
  archived?: boolean;
};

function uiTypeToCode(t: ArtifactUi["type"]) {
  if (t === "Proposal") return "PROPOSAL";
  if (t === "SOW") return "SOW";
  return "PRESENTATION_DECK";
}

function mapArtifact(a: ApiArtifact): ArtifactUi {
  return {
    id: String(a.id),
    type:
      (a.type as ArtifactUi["type"]) ||
      (a.artifactType === "PROPOSAL"
        ? "Proposal"
        : a.artifactType === "SOW"
          ? "SOW"
          : "Presentation Deck"),
    url: a.url,
    title: a.title,
    addedBy: a.addedBy,
    addedOn: a.addedOn,
  };
}

type NotifRow = {
  id: string;
  type: string;
  message: string;
  timestamp: string;
};

export function OpportunityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const isAdmin = useIsAdmin();
  const [opp, setOpp] = useState<ApiOpportunity | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactUi[]>([]);
  const [activity, setActivity] = useState<NotifRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isArtifactModalOpen, setIsArtifactModalOpen] = useState(false);
  const [newArtifact, setNewArtifact] = useState<{
    type: ArtifactUi["type"];
    url: string;
    title: string;
  }>({ type: "Proposal", url: "", title: "" });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [o, arts, notes] = await Promise.all([
          apiFetch<ApiOpportunity>(`/opportunities/${id}`),
          apiFetch<{ items: ApiArtifact[] }>(
            `/opportunities/${id}/artifact-links`
          ),
          apiFetch<{ items: { id: string; type: string; message: string; timestamp: string; opportunityId: string }[] }>(
            `/notifications`
          ),
        ]);
        if (cancelled) return;
        setOpp(o);
        setArtifacts((arts.items || []).map(mapArtifact));
        setActivity(
          (notes.items || [])
            .filter((n) => n.opportunityId === id)
            .map((n) => ({
              id: n.id,
              type: n.type,
              message: n.message,
              timestamp: n.timestamp,
            }))
        );
        setLoadError(null);
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            e instanceof Error ? e.message : "Failed to load opportunity"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const reloadArtifacts = async () => {
    if (!id) return;
    const arts = await apiFetch<{ items: ApiArtifact[] }>(
      `/opportunities/${id}/artifact-links`
    );
    setArtifacts((arts.items || []).map(mapArtifact));
  };

  const handleAddArtifact = async () => {
    if (!newArtifact.url || !id) return;

    await apiFetch(`/opportunities/${id}/artifact-links`, {
      method: "POST",
      body: JSON.stringify({
        artifactType: uiTypeToCode(newArtifact.type),
        url: newArtifact.url,
        title: newArtifact.title || undefined,
      }),
    });

    await reloadArtifacts();

    const notes = await apiFetch<{ items: { id: string; type: string; message: string; timestamp: string; opportunityId: string }[] }>(
      `/notifications`
    );
    setActivity(
      (notes.items || [])
        .filter((n) => n.opportunityId === id)
        .map((n) => ({
          id: n.id,
          type: n.type,
          message: n.message,
          timestamp: n.timestamp,
        }))
    );

    setNewArtifact({ type: "Proposal", url: "", title: "" });
    setIsArtifactModalOpen(false);
  };

  const handleDeleteArtifact = async (linkId: string) => {
    if (!id) return;
    await apiFetch(`/opportunities/${id}/artifact-links/${linkId}`, {
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

  const deliverablesText = opp
    ? Array.isArray(opp.deliverables)
      ? opp.deliverables.join(", ")
      : String(opp.deliverables || "")
    : "";

  const handleArchiveToggle = async () => {
    if (!opp || !id) return;
    const next = !opp.archived;
    if (!confirm(next ? "Archive this opportunity?" : "Restore this opportunity?")) return;
    try {
      await apiFetch(`/opportunities/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: next, version: opp.version }),
      });
      const o = await apiFetch<ApiOpportunity>(`/opportunities/${id}`);
      setOpp(o);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const handleDeleteForever = async () => {
    if (!opp || !id) return;
    if (!confirm("Permanently delete this opportunity? This cannot be undone.")) return;
    try {
      await apiFetch(`/opportunities/${id}`, { method: "DELETE" });
      navigate("/app/opportunities");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (!id) return null;

  if (loadError || !opp) {
    return (
      <div className="p-6">
        <p className="text-destructive">{loadError || "Loading…"}</p>
        <Link to="/app/opportunities" className="text-primary underline mt-4 inline-block">
          Back to list
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs
        items={[
          { label: "Opportunities", href: "/app/opportunities" },
          { label: opp.prospect },
        ]}
      />

      <div className="flex items-start justify-between">
        <div>
          <h1 className="mb-2">{opp.prospect}</h1>
          <p className="text-muted-foreground">{opp.opportunityDescription}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {opp.archived ? (
            <Badge variant="default">Archived</Badge>
          ) : null}
          {canEdit ? (
            <Link to={`/app/opportunities/${id}/edit`}>
              <Button variant="outline">
                <Edit className="w-4 h-4" />
                Edit
              </Button>
            </Link>
          ) : null}
          {canEdit ? (
            <Button variant="outline" type="button" onClick={() => void handleArchiveToggle()}>
              {opp.archived ? "Restore" : "Archive"}
            </Button>
          ) : null}
          {isAdmin ? (
            <Button variant="destructive" type="button" onClick={() => void handleDeleteForever()}>
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-5 h-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Due Date</p>
            </div>
            <p className={isOverdue ? "text-destructive" : ""}>{opp.dueDate}</p>
            {isOverdue && (
              <p className="text-sm text-destructive mt-1">Overdue</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-5 h-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Value</p>
            </div>
            <p>
              {opp.currency} ${opp.value.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Status</p>
            </div>
            {getStatusBadge(opp.status)}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <User className="w-5 h-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Win/Loss</p>
            </div>
            {getWinLossBadge(opp.winOrLoss)}
          </CardContent>
        </Card>
      </div>

      {isOverdue && (
        <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-red-900 dark:text-red-200 mb-1">
              Overdue Opportunity
            </h4>
            <p className="text-sm text-red-800 dark:text-red-300">
              This opportunity is past its due date. Please update the status or
              extend the deadline.
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="artifacts">Artifact Links</TabsTrigger>
          <TabsTrigger value="activity">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Opportunity Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Owner</p>
                  <div className="flex flex-wrap gap-2">
                    {(opp.ownerIds?.length ? opp.ownerIds : ["Unassigned"]).map(
                      (owner, i) => (
                        <Badge key={`${owner}-${i}`}>{owner}</Badge>
                      )
                    )}
                  </div>
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">
                  {opp.notes || "—"}
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
                {canEdit ? (
                  <Button type="button" onClick={() => setIsArtifactModalOpen(true)}>
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
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => handleDeleteArtifact(artifact.id)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
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
              <CardTitle>Notifications for this opportunity</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No notification records yet for this opportunity.
                </p>
              ) : (
                <div className="space-y-4">
                  {activity.map((item) => (
                    <div key={item.id} className="flex gap-4">
                      <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm mb-1">{item.message}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.timestamp}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Modal
        isOpen={isArtifactModalOpen}
        onClose={() => setIsArtifactModalOpen(false)}
        title="Add Artifact Link"
        footer={
          <>
            <Button
              variant="outline"
              type="button"
              onClick={() => setIsArtifactModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleAddArtifact}>
              Add Link
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
                type: e.target.value as ArtifactUi["type"],
              })
            }
            options={[
              { value: "Proposal", label: "Proposal" },
              { value: "SOW", label: "SOW" },
              { value: "Presentation Deck", label: "Presentation Deck" },
            ]}
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
