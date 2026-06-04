export type CaseStudyValueFormat =
  | "auto"
  | "text"
  | "number"
  | "money"
  | "days"
  | "percent";

export type CaseStudyEntryType = "field" | "text" | "expression";

export type CaseStudyEntry = {
  id: string;
  type: CaseStudyEntryType;
  /** Row label (field / expression) or section heading for text blocks */
  label?: string;
  fieldKey?: string;
  text?: string;
  expression?: string;
  format?: CaseStudyValueFormat;
};

export type CaseStudyColumn = {
  id: string;
  title?: string;
  entries: CaseStudyEntry[];
};

export type CaseStudyLayout = {
  columns: CaseStudyColumn[];
};

export function newCaseStudyId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultCaseStudyLayout(): CaseStudyLayout {
  return {
    columns: [
      {
        id: "col-project",
        title: "",
        entries: [
          {
            id: "e-prospect",
            type: "field",
            fieldKey: "prospect",
            label: "Project name",
          },
          {
            id: "e-description",
            type: "field",
            fieldKey: "opportunityDescription",
            label: "Project description",
          },
          {
            id: "e-value",
            type: "field",
            fieldKey: "value",
            label: "SOW value",
            format: "money",
          },
        ],
      },
      {
        id: "col-tech",
        title: "",
        entries: [
          {
            id: "e-tech",
            type: "field",
            fieldKey: "techStack",
            label: "Tech stack",
            format: "text",
          },
        ],
      },
    ],
  };
}

function normalizeEntry(raw: unknown): CaseStudyEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = String(o.type || "");
  if (!["field", "text", "expression"].includes(type)) return null;
  const id = String(o.id || "").trim() || newCaseStudyId("entry");
  const entry: CaseStudyEntry = {
    id,
    type: type as CaseStudyEntryType,
    label: o.label !== undefined ? String(o.label) : undefined,
    format: o.format as CaseStudyValueFormat | undefined,
  };
  if (entry.type === "field") {
    const fieldKey = String(o.fieldKey || "").trim();
    if (!fieldKey) return null;
    entry.fieldKey = fieldKey;
  } else if (entry.type === "text") {
    entry.text = String(o.text ?? "");
  } else if (entry.type === "expression") {
    entry.expression = String(o.expression ?? "").trim();
    if (!entry.expression) return null;
  }
  return entry;
}

const RETIRED_CASE_STUDY_FIELD_KEYS = new Set([
  "buildDays",
  "tokenUsage",
  "aiCostUsd",
  "token_usage",
  "ai_cost",
]);

function entryUsesRetiredField(entry: CaseStudyEntry): boolean {
  if (entry.type === "field") {
    return RETIRED_CASE_STUDY_FIELD_KEYS.has(String(entry.fieldKey || ""));
  }
  if (entry.type === "expression" || entry.type === "text") {
    const haystack = `${entry.expression || ""} ${entry.text || ""}`.toLowerCase();
    for (const key of RETIRED_CASE_STUDY_FIELD_KEYS) {
      if (haystack.includes(key.toLowerCase())) return true;
    }
  }
  return false;
}

/** True when the API returned a persisted workspace layout object. */
export function isPersistedCaseStudyLayout(input: unknown): input is CaseStudyLayout {
  return (
    Boolean(input) &&
    typeof input === "object" &&
    Array.isArray((input as CaseStudyLayout).columns)
  );
}

/**
 * Resolve layout for display on records and in settings after load/save.
 * Uses the built-in template only when the server did not return a saved layout.
 */
export function layoutFromWorkspaceConfig(saved: unknown): CaseStudyLayout {
  if (!isPersistedCaseStudyLayout(saved)) {
    return defaultCaseStudyLayout();
  }
  return normalizeCaseStudyLayout(saved);
}

export function normalizeCaseStudyLayout(input: unknown): CaseStudyLayout {
  const defaults = defaultCaseStudyLayout();
  if (!input || typeof input !== "object") return defaults;
  const rawCols = (input as { columns?: unknown }).columns;
  if (!Array.isArray(rawCols) || !rawCols.length) return defaults;

  const columns: CaseStudyColumn[] = [];
  for (const colRaw of rawCols) {
    if (!colRaw || typeof colRaw !== "object") continue;
    const c = colRaw as Record<string, unknown>;
    const entries: CaseStudyEntry[] = [];
    if (Array.isArray(c.entries)) {
      for (const entryRaw of c.entries) {
        const entry = normalizeEntry(entryRaw);
        if (entry && !entryUsesRetiredField(entry)) entries.push(entry);
      }
    }
    if (!entries.length) continue;
    columns.push({
      id: String(c.id || "").trim() || newCaseStudyId("col"),
      title: c.title !== undefined ? String(c.title) : undefined,
      entries,
    });
  }

  return columns.length ? { columns } : defaults;
}
