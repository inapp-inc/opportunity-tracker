import { useCallback, useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { apiFetch } from "../../../lib/api";
import {
  DEFAULT_LIST_TABLE_LAYOUT,
  LIST_TABLE_COLUMN_KEYS,
  LIST_TABLE_COLUMN_LABELS,
  normalizeListTableLayout,
  type ListTableLayout,
  type ListTableColumnKey,
} from "../../../lib/listTableLayout";
import { useTenantSchema } from "../../../lib/serverState";
import type { TenantFieldDefinition } from "../../../lib/opportunity";
import { emitWorkspaceLayoutUpdated } from "../../../lib/pageLayoutEvents";

export function OpportunitiesTableColumnsPanel() {
  const { fields: schemaFields, reload: reloadSchema } = useTenantSchema();
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [layout, setLayout] = useState<ListTableLayout>(DEFAULT_LIST_TABLE_LAYOUT);
  const [fieldTableFlags, setFieldTableFlags] = useState<Record<string, boolean>>(
    {}
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ listTableLayout?: ListTableLayout }>("/settings");
      setLayout(normalizeListTableLayout(res.listTableLayout));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flags: Record<string, boolean> = {};
    for (const field of schemaFields) {
      if (field.status === "INACTIVE") continue;
      flags[field.id] = Boolean(field.showInTable);
    }
    setFieldTableFlags(flags);
  }, [schemaFields]);

  const toggleSystemColumn = (key: ListTableColumnKey) => {
    setLayout((prev) => {
      const has = prev.columns.includes(key);
      const columns = has
        ? prev.columns.filter((c) => c !== key)
        : [...prev.columns, key];
      return { columns };
    });
  };

  const toggleFieldInTable = (field: TenantFieldDefinition) => {
    setFieldTableFlags((prev) => ({
      ...prev,
      [field.id]: !prev[field.id],
    }));
  };

  const handleSave = async () => {
    setSaveMsg(null);
    try {
      await apiFetch("/settings", {
        method: "PATCH",
        body: JSON.stringify({ listTableLayout: layout }),
      });

      const activeFields = schemaFields.filter((f) => f.status !== "INACTIVE");
      for (const field of activeFields) {
        const nextShow = Boolean(fieldTableFlags[field.id]);
        if (nextShow === Boolean(field.showInTable)) continue;
        await apiFetch(`/settings/schema/${field.id}`, {
          method: "PATCH",
          body: JSON.stringify({ showInTable: nextShow }),
        });
      }

      await reloadSchema();
      setSaveMsg("Table columns saved for this workspace.");
      emitWorkspaceLayoutUpdated({ page: "opportunities" });
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading column settings…</p>;
  }

  const schemaForTable = schemaFields.filter((f) => f.status !== "INACTIVE");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-2">Standard columns</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {LIST_TABLE_COLUMN_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={layout.columns.includes(key)}
                onChange={() => toggleSystemColumn(key)}
              />
              {LIST_TABLE_COLUMN_LABELS[key]}
            </label>
          ))}
        </div>
      </div>

      {schemaForTable.length > 0 ? (
        <div>
          <p className="text-sm font-medium mb-2">Schema fields in table</p>
          <p className="text-sm text-muted-foreground mb-3">
            Custom and optional system fields shown as extra columns in the list view.
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto rounded-lg border border-border p-3">
            {schemaForTable.map((field) => (
              <label key={field.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(fieldTableFlags[field.id])}
                  onChange={() => toggleFieldInTable(field)}
                />
                <span>{field.label}</span>
                {field.source === "system" ? (
                  <span className="text-xs text-muted-foreground">(system)</span>
                ) : null}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        {saveMsg ? <p className="text-sm text-muted-foreground">{saveMsg}</p> : <span />}
        <Button type="button" onClick={() => void handleSave()}>
          Save table layout
        </Button>
      </div>
    </div>
  );
}
