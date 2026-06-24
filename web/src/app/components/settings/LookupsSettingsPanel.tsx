import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { apiFetch } from "../../lib/api";
import { notifyTenantLookupsUpdated } from "../../lib/serverState";
import { useCanManageTenantSettings } from "../../lib/roles";
import type { LookupCategory, LookupEntry } from "../../pages/settings/types";
import { PROTECTED_LOOKUP_CATEGORIES } from "./constants";

export function LookupsSettingsPanel() {
  const canManageSettings = useCanManageTenantSettings();
  const isAdmin = canManageSettings;

  const [lookups, setLookups] = useState<{
    categories: LookupCategory[];
    deliverables: LookupEntry[];
    prospectTypes: LookupEntry[];
    engagementTypes: LookupEntry[];
    dealStages: LookupEntry[];
  }>({ categories: [], deliverables: [], prospectTypes: [], engagementTypes: [], dealStages: [] });
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const [addOpen, setAddOpen] = useState<string | null>(null);
  const [addValue, setAddValue] = useState("");
  const [newLookupCategory, setNewLookupCategory] = useState("");
  const [editingLookupId, setEditingLookupId] = useState<string | null>(null);
  const [editingLookupValue, setEditingLookupValue] = useState("");

  const loadLookups = useCallback(async () => {
    if (!canManageSettings) {
      setLookupsLoading(false);
      return;
    }
    setLookupsLoading(true);
    try {
      const res = await apiFetch<{
        categories?: LookupCategory[];
        deliverables: LookupEntry[];
        prospectTypes: LookupEntry[];
        engagementTypes: LookupEntry[];
        dealStages?: LookupEntry[];
      }>("/settings/lookups");
      setLookups({
        categories: res.categories || [],
        deliverables: res.deliverables || [],
        prospectTypes: res.prospectTypes || [],
        engagementTypes: res.engagementTypes || [],
        dealStages: res.dealStages || [],
      });
    } finally {
      setLookupsLoading(false);
    }
  }, [canManageSettings]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  const deleteLookup = async (id: string) => {
    if (!confirm("Remove this lookup value?")) return;
    try {
      await apiFetch(`/settings/lookups/${id}`, { method: "DELETE" });
      await loadLookups();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const startEditLookup = (item: LookupEntry) => {
    setEditingLookupId(item.id);
    setEditingLookupValue(item.value);
  };

  const cancelEditLookup = () => {
    setEditingLookupId(null);
    setEditingLookupValue("");
  };

  const saveLookup = async (id: string) => {
    const value = editingLookupValue.trim();
    if (!value) return;
    try {
      await apiFetch(`/settings/lookups/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ value }),
      });
      cancelEditLookup();
      await loadLookups();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  };

  const addLookup = async (category: string | null) => {
    if (!category || !addValue.trim()) return;
    try {
      await apiFetch("/settings/lookups", {
        method: "POST",
        body: JSON.stringify({ category, value: addValue.trim() }),
      });
      setAddValue("");
      setAddOpen(null);
      await loadLookups();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Add failed");
    }
  };

  const addLookupCategory = async () => {
    if (!newLookupCategory.trim()) return;
    try {
      await apiFetch("/settings/lookups/categories", {
        method: "POST",
        body: JSON.stringify({ name: newLookupCategory.trim() }),
      });
      setNewLookupCategory("");
      await loadLookups();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create lookup category");
    }
  };

  const deleteLookupCategory = async (category: string, label: string) => {
    if (PROTECTED_LOOKUP_CATEGORIES.has(category)) {
      alert("This lookup category is required by the workspace and cannot be removed.");
      return;
    }
    if (
      !confirm(
        `Remove the "${label}" lookup category and all of its values? Existing record data that used these values is not changed.`
      )
    ) {
      return;
    }
    try {
      await apiFetch(`/settings/lookups/categories/${encodeURIComponent(category)}`, {
        method: "DELETE",
      });
      await loadLookups();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove lookup category");
    }
  };

  const renderLookupSection = (title: string, category: string, items: LookupEntry[]) => (
    <Card key={category}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          {isAdmin && (
            <div className="flex items-center gap-2">
              {!PROTECTED_LOOKUP_CATEGORIES.has(category) ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void deleteLookupCategory(category, title)}
                >
                  <Trash2 className="w-4 h-4" />
                  Remove category
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => {
                  setAddOpen(category);
                  setAddValue("");
                }}
              >
                <Plus className="w-4 h-4" />
                Add Value
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg"
            >
              {editingLookupId === item.id ? (
                <>
                  <input
                    value={editingLookupValue}
                    onChange={(e) => setEditingLookupValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveLookup(item.id);
                      if (e.key === "Escape") cancelEditLookup();
                    }}
                    className="h-7 w-40 rounded-md border border-border bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="hover:text-primary"
                    aria-label={`Save ${item.value}`}
                    onClick={() => void saveLookup(item.id)}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    className="hover:text-muted-foreground"
                    aria-label="Cancel edit"
                    onClick={cancelEditLookup}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <>
                  <span>{item.value}</span>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        className="hover:text-primary"
                        aria-label={`Edit ${item.value}`}
                        onClick={() => startEditLookup(item)}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        className="hover:text-destructive"
                        aria-label={`Remove ${item.value}`}
                        onClick={() => void deleteLookup(item.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
          {!items.length && (
            <p className="text-sm text-muted-foreground">No values yet.</p>
          )}
        </div>
        {isAdmin && addOpen === category && (
          <div className="flex gap-2 items-end flex-wrap">
            <Input
              label="New value"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              placeholder="Type and press Add"
            />
            <Button type="button" onClick={() => void addLookup(category)}>
              Add
            </Button>
            <Button type="button" variant="outline" onClick={() => setAddOpen(null)}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {lookupsLoading ? (
        <p className="text-sm text-muted-foreground">Loading lookups…</p>
      ) : (
        <>
          {isAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle>Add Lookup Field</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 items-end flex-wrap">
                  <Input
                    label="Lookup field name"
                    value={newLookupCategory}
                    onChange={(e) => setNewLookupCategory(e.target.value)}
                    placeholder="Priority, Region, Department..."
                  />
                  <Button type="button" onClick={() => void addLookupCategory()}>
                    Add Lookup Field
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
          {lookups.categories.map((category) =>
            renderLookupSection(category.label, category.category, category.items)
          )}
        </>
      )}
    </div>
  );
}
