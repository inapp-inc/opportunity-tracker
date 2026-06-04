import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ExternalLink, Pencil, Search, Trash2 } from "lucide-react";
import { PageHeader, Toolbar, LoadingDisplay } from "../components/shared";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/Table";
import { catalogValueList } from "../lib/lookupOptions";
import { apiFetch } from "../lib/api";
import { useCatalogLookups } from "../lib/serverState";
import { lowerFirst, useTerminology } from "../lib/terminology";
import { useCanWriteArtifacts } from "../lib/roles";

type ArtifactRow = {
  id: string;
  opportunityId: string;
  opportunityProspect: string;
  opportunityArchived?: boolean;
  type: string;
  url: string;
  title?: string | null;
  addedBy?: string;
  addedOn?: string;
};

export function ArtifactLinks() {
  const terminology = useTerminology();
  const canWriteArtifacts = useCanWriteArtifacts();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ArtifactRow[]>([]);
  const [q, setQ] = useState("");

  const { lookups: catalogLookups } = useCatalogLookups();
  const artifactTypeOptions = useMemo(
    () => catalogValueList(catalogLookups?.artifactTypes),
    [catalogLookups]
  );
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ArtifactRow | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState<{ type: string; url: string; title: string }>({
    type: "",
    url: "",
    title: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      // Use non-conflicting list endpoint. Fall back to legacy alias if needed.
      const res = await apiFetch<{ items: ArtifactRow[] }>(`/artifact-links${qs}`).catch(() =>
        apiFetch<{ items: ArtifactRow[] }>(`/records/artifact-links${qs}`)
      );
      setItems(res.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load artifact links");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => items, [items]);

  const openEdit = (row: ArtifactRow) => {
    setEditing(row);
    setEditForm({
      type: row.type || artifactTypeOptions[0] || "",
      url: row.url || "",
      title: String(row.title || ""),
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!canWriteArtifacts) {
      setError("You do not have permission for this action.");
      return;
    }
    setEditSaving(true);
    try {
      await apiFetch(`/records/${editing.opportunityId}/artifacts/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          artifactType: editForm.type,
          url: editForm.url,
          title: editForm.title.trim() || undefined,
        }),
      });
      setEditOpen(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setEditSaving(false);
    }
  };

  const deleteRow = async (row: ArtifactRow) => {
    if (!canWriteArtifacts) {
      setError("You do not have permission for this action.");
      return;
    }
    if (!confirm("Remove this artifact link?")) return;
    try {
      await apiFetch(`/records/${row.opportunityId}/artifacts/${row.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
      <PageHeader
        title="Artifact Links"
        description={`All links across ${lowerFirst(terminology.recordPlural)} in this workspace`}
      />

      <Toolbar>
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by record, type, title, or URL..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-input-background rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </Toolbar>

      {error ? (
        <p className="text-sm text-destructive border border-destructive/40 rounded-lg p-3">{error}</p>
      ) : null}

      {loading ? (
        <LoadingDisplay message="Loading artifact links..." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{terminology.recordSingular}</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>URL</TableHead>
              <TableHead className="w-[110px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(filtered || []).map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  <Link to={`/app/opportunities/${row.opportunityId}`} className="hover:underline text-primary">
                    {row.opportunityProspect || row.opportunityId}
                  </Link>
                  {row.opportunityArchived ? (
                    <span className="ml-2 text-xs text-muted-foreground">(archived)</span>
                  ) : null}
                </TableCell>
                <TableCell>{row.type}</TableCell>
                <TableCell className="max-w-[260px] truncate">{row.title || "—"}</TableCell>
                <TableCell className="max-w-[360px] truncate">
                  <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    {row.url}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </TableCell>
                <TableCell>
                  {!canWriteArtifacts ? null : (
                    <div className="flex items-center gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => openEdit(row)} aria-label="Edit link">
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void deleteRow(row)} aria-label="Delete link">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <p className="py-6 text-center text-sm text-muted-foreground">No artifact links found.</p>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      )}

      <Modal
        isOpen={editOpen}
        onClose={() => {
          if (!editSaving) setEditOpen(false);
        }}
        title={editing ? "Edit artifact link" : "Edit artifact link"}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving}>
              Close
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={editSaving || !editForm.url.trim()}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select
            label="Type"
            value={editForm.type}
            onChange={(e) => setEditForm((p) => ({ ...p, type: e.target.value }))}
            options={(artifactTypeOptions.length ? artifactTypeOptions : [editForm.type || "Artifact"]).map((t) => ({
              value: t,
              label: t,
            }))}
          />
          <Input
            label="URL"
            value={editForm.url}
            onChange={(e) => setEditForm((p) => ({ ...p, url: e.target.value }))}
          />
          <Input
            label="Title (optional)"
            value={editForm.title}
            onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
          />
        </div>
      </Modal>
    </div>
  );
}

