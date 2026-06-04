import { useMemo, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import type { TenantFieldDefinition } from "../../lib/opportunity";
import {
  type CaseStudyColumn,
  type CaseStudyEntry,
  type CaseStudyEntryType,
  type CaseStudyLayout,
  type CaseStudyValueFormat,
  newCaseStudyId,
} from "../../lib/caseStudyLayout";
import { buildFieldCatalog, type FieldCatalogItem } from "../../lib/caseStudyRender";
import { validateCaseStudyExpression } from "../../lib/caseStudyRender";

const ENTRY_TYPE_OPTIONS: { value: CaseStudyEntryType; label: string }[] = [
  { value: "field", label: "Field" },
  { value: "text", label: "Free text" },
  { value: "expression", label: "Math / expression" },
];

const FORMAT_OPTIONS: { value: CaseStudyValueFormat; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "money", label: "Money (record currency)" },
  { value: "days", label: "Days" },
  { value: "percent", label: "Percent" },
];

type DragPayload =
  | { kind: "palette"; fieldKey: string }
  | { kind: "entry"; columnId: string; entryId: string };

function parseDragPayload(data: string): DragPayload | null {
  try {
    return JSON.parse(data) as DragPayload;
  } catch {
    return null;
  }
}

function entryFromPaletteField(field: FieldCatalogItem): CaseStudyEntry {
  const format: CaseStudyValueFormat =
    field.fieldType === "currency"
      ? "money"
      : field.fieldType === "number" || field.fieldType === "percent"
        ? "number"
        : "auto";
  return {
    id: newCaseStudyId("entry"),
    type: "field",
    fieldKey: field.key,
    label: field.label,
    format,
  };
}

function EntryEditor({
  entry,
  catalog,
  onChange,
  onRemove,
}: {
  entry: CaseStudyEntry;
  catalog: FieldCatalogItem[];
  onChange: (next: CaseStudyEntry) => void;
  onRemove: () => void;
}) {
  const expressionError = useMemo(() => {
    if (entry.type !== "expression") return null;
    const expr = String(entry.expression || "").trim();
    if (!expr) return "Expression is required.";
    const validated = validateCaseStudyExpression(expr);
    return validated.ok ? null : validated.error;
  }, [entry.type, entry.expression]);

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 mt-2 text-muted-foreground shrink-0 cursor-grab" />
        <div className="flex-1 space-y-3 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Type"
              value={entry.type}
              onChange={(e) => {
                const type = e.target.value as CaseStudyEntryType;
                if (type === "field") {
                  onChange({
                    id: entry.id,
                    type,
                    fieldKey: catalog[0]?.key || "prospect",
                    label: entry.label,
                    format: entry.format,
                  });
                } else if (type === "text") {
                  onChange({
                    id: entry.id,
                    type,
                    text: entry.text || "",
                    label: entry.label,
                  });
                } else {
                  onChange({
                    id: entry.id,
                    type,
                    expression: entry.expression || "{{value}}",
                    label: entry.label || "Calculated",
                    format: entry.format || "number",
                  });
                }
              }}
              options={ENTRY_TYPE_OPTIONS}
            />
            <Input
              label="Label (optional)"
              value={entry.label || ""}
              onChange={(e) => onChange({ ...entry, label: e.target.value })}
              placeholder="Display label"
            />
          </div>

          {entry.type === "field" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Field"
                value={entry.fieldKey || ""}
                onChange={(e) => onChange({ ...entry, fieldKey: e.target.value })}
                options={catalog.map((f) => ({
                  value: f.key,
                  label: `${f.label} (${f.key})`,
                }))}
              />
              <Select
                label="Format"
                value={entry.format || "auto"}
                onChange={(e) =>
                  onChange({
                    ...entry,
                    format: e.target.value as CaseStudyValueFormat,
                  })
                }
                options={FORMAT_OPTIONS}
              />
            </div>
          ) : null}

          {entry.type === "text" ? (
            <div>
              <label className="block text-sm mb-1">
                Text (use {"{{fieldKey}}"} for field values)
              </label>
              <textarea
                value={entry.text || ""}
                onChange={(e) => onChange({ ...entry, text: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-input-background rounded-lg border border-border text-sm"
                placeholder="e.g. Engagement: {{engagementType}}"
              />
            </div>
          ) : null}

          {entry.type === "expression" ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm mb-1">
                  Expression ({"{{fieldKey}}"}, + − × / and parentheses)
                </label>
                <Input
                  value={entry.expression || ""}
                  onChange={(e) => onChange({ ...entry, expression: e.target.value })}
                  placeholder="e.g. {{value}} * 1.1"
                />
                {expressionError ? (
                  <p className="mt-2 text-xs text-destructive">{expressionError}</p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Tip: <code className="text-xs">{"{{closedDate}} - {{firstPresalesCall}}"}</code>{" "}
                    returns working days (Mon–Fri).
                  </p>
                )}
              </div>
              <Select
                label="Result format"
                value={entry.format || "number"}
                onChange={(e) =>
                  onChange({
                    ...entry,
                    format: e.target.value as CaseStudyValueFormat,
                  })
                }
                options={FORMAT_OPTIONS.filter((o) => o.value !== "auto")}
              />
            </div>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Remove entry">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ColumnEditor({
  column,
  catalog,
  onChange,
  onRemove,
  onDropPayload,
  onEntryDragStart,
}: {
  column: CaseStudyColumn;
  catalog: FieldCatalogItem[];
  onChange: (next: CaseStudyColumn) => void;
  onRemove: () => void;
  onDropPayload: (payload: DragPayload, columnId: string, index?: number) => void;
  onEntryDragStart: (columnId: string, entryId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`rounded-xl border-2 border-dashed p-4 space-y-3 min-h-[200px] transition-colors ${
        dragOver ? "border-primary bg-primary/5" : "border-border"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const raw = e.dataTransfer.getData("application/x-case-study");
        const payload = parseDragPayload(raw);
        if (payload) onDropPayload(payload, column.id);
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          label="Column title (optional)"
          value={column.title || ""}
          onChange={(e) => onChange({ ...column, title: e.target.value })}
          placeholder="Column heading"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-6 shrink-0"
          onClick={onRemove}
          disabled={false}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3">
        {column.entries.map((entry, index) => (
          <div
            key={entry.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const raw = e.dataTransfer.getData("application/x-case-study");
              const payload = parseDragPayload(raw);
              if (payload) onDropPayload(payload, column.id, index);
            }}
          >
            <div
              draggable
              onDragStart={(e) => {
                onEntryDragStart(column.id, entry.id);
                e.dataTransfer.setData(
                  "application/x-case-study",
                  JSON.stringify({
                    kind: "entry",
                    columnId: column.id,
                    entryId: entry.id,
                  })
                );
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              <EntryEditor
                entry={entry}
                catalog={catalog}
                onChange={(next) => {
                  const entries = column.entries.map((item) =>
                    item.id === entry.id ? next : item
                  );
                  onChange({ ...column, entries });
                }}
                onRemove={() => {
                  onChange({
                    ...column,
                    entries: column.entries.filter((item) => item.id !== entry.id),
                  });
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          onChange({
            ...column,
            entries: [
              ...column.entries,
              {
                id: newCaseStudyId("entry"),
                type: "text",
                label: "",
                text: "",
              },
            ],
          });
        }}
      >
        <Plus className="h-4 w-4" />
        Add entry
      </Button>
    </div>
  );
}

export function CaseStudyConfigurator({
  layout,
  schemaFields,
  onChange,
}: {
  layout: CaseStudyLayout;
  schemaFields: TenantFieldDefinition[];
  onChange: (next: CaseStudyLayout) => void;
}) {
  const catalog = useMemo(() => buildFieldCatalog(schemaFields), [schemaFields]);
  const [dragEntry, setDragEntry] = useState<{
    columnId: string;
    entryId: string;
  } | null>(null);

  const updateColumns = (columns: CaseStudyColumn[]) => onChange({ columns });

  const handleDrop = (payload: DragPayload, targetColumnId: string, index?: number) => {
    if (payload.kind === "palette") {
      const field = catalog.find((f) => f.key === payload.fieldKey);
      if (!field) return;
      const entry = entryFromPaletteField(field);
      updateColumns(
        layout.columns.map((col) => {
          if (col.id !== targetColumnId) return col;
          const entries = [...col.entries];
          const at = index === undefined ? entries.length : index;
          entries.splice(at, 0, entry);
          return { ...col, entries };
        })
      );
      return;
    }

    if (payload.kind === "entry") {
      const sourceCol = layout.columns.find((c) =>
        c.entries.some((e) => e.id === payload.entryId)
      );
      if (!sourceCol) return;
      const entry = sourceCol.entries.find((e) => e.id === payload.entryId);
      if (!entry) return;

      let columns = layout.columns.map((col) => ({
        ...col,
        entries: col.entries.filter((e) => e.id !== payload.entryId),
      }));

      columns = columns.map((col) => {
        if (col.id !== targetColumnId) return col;
        const entries = [...col.entries];
        const at = index === undefined ? entries.length : index;
        entries.splice(at, 0, entry);
        return { ...col, entries };
      });

      updateColumns(columns);
      setDragEntry(null);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      <aside className="xl:col-span-3 space-y-3">
        <div>
          <p className="text-sm font-semibold">Field catalog</p>
          <p className="text-xs text-muted-foreground mt-1">
            Drag fields into a column. Use {"{{fieldKey}}"} in text and expressions.
          </p>
        </div>
        <div className="max-h-[520px] overflow-y-auto space-y-1 rounded-lg border border-border p-2 bg-muted/30">
          {catalog.map((field) => (
            <div
              key={field.key}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/x-case-study",
                  JSON.stringify({ kind: "palette", fieldKey: field.key })
                );
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm cursor-grab hover:border-primary/50"
            >
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{field.label}</p>
                <p className="text-xs text-muted-foreground truncate">{field.key}</p>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {field.source}
              </span>
            </div>
          ))}
        </div>
      </aside>

      <div className="xl:col-span-9 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {layout.columns.length} column{layout.columns.length === 1 ? "" : "s"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              updateColumns([
                ...layout.columns,
                { id: newCaseStudyId("col"), title: "", entries: [] },
              ])
            }
          >
            <Plus className="h-4 w-4" />
            Add column
          </Button>
        </div>

        <div className="flex flex-col gap-4 w-full">
          {layout.columns.map((column) => (
            <ColumnEditor
              key={column.id}
              column={column}
              catalog={catalog}
              onChange={(next) =>
                updateColumns(layout.columns.map((c) => (c.id === column.id ? next : c)))
              }
              onRemove={() => {
                if (layout.columns.length <= 1) return;
                updateColumns(layout.columns.filter((c) => c.id !== column.id));
              }}
              onDropPayload={handleDrop}
              onEntryDragStart={(columnId, entryId) =>
                setDragEntry({ columnId, entryId })
              }
            />
          ))}
        </div>

        {dragEntry ? (
          <p className="text-xs text-muted-foreground">
            Drag entry to another column or position to reorder.
          </p>
        ) : null}
      </div>
    </div>
  );
}
