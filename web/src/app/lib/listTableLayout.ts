export const LIST_TABLE_COLUMN_KEYS = [
  "prospect",
  "description",
  "owner",
  "dueDate",
  "stage",
  "status",
  "value",
  "winLoss",
] as const;

export type ListTableColumnKey = (typeof LIST_TABLE_COLUMN_KEYS)[number];

export type ListTableLayout = {
  columns: ListTableColumnKey[];
};

export const DEFAULT_LIST_TABLE_LAYOUT: ListTableLayout = {
  columns: [...LIST_TABLE_COLUMN_KEYS],
};

export const LIST_TABLE_COLUMN_LABELS: Record<ListTableColumnKey, string> = {
  prospect: "Prospect",
  description: "Description",
  owner: "Owner",
  dueDate: "Due date",
  stage: "Stage",
  status: "Status",
  value: "Value",
  winLoss: "Win / Loss",
};

export function normalizeListTableLayout(input: unknown): ListTableLayout {
  const defaults = DEFAULT_LIST_TABLE_LAYOUT;
  if (!input || typeof input !== "object") return defaults;
  const raw = (input as { columns?: unknown }).columns;
  if (!Array.isArray(raw)) return defaults;
  const columns = raw
    .map(String)
    .filter((key): key is ListTableColumnKey =>
      (LIST_TABLE_COLUMN_KEYS as readonly string[]).includes(key)
    );
  return { columns: columns.length ? columns : defaults.columns };
}

export function isListColumnVisible(
  layout: ListTableLayout,
  key: ListTableColumnKey
) {
  return layout.columns.includes(key);
}
