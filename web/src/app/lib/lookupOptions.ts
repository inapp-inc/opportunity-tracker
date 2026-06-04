type CatalogLookupSlices = {
  prospectTypes?: { value: string }[];
  engagementTypes?: { value: string }[];
  deliverables?: { value: string }[];
  dealStages?: { value: string }[];
  winLoss?: { value: string }[];
  currencies?: { value: string }[];
  artifactTypes?: { value: string }[];
};

/** Ensure a controlled <select> value always has a matching <option> (avoids browser "invalid" styling). */
export function selectOptionsWithCurrentValue(
  options: { value: string; label: string }[],
  currentValue?: string
): { value: string; label: string }[] {
  const value = String(currentValue ?? "").trim();
  if (!value) return options;
  if (options.some((opt) => opt.value === value)) return options;
  return [{ value, label: value }, ...options];
}

export function lookupEntriesToSelectOptions(
  entries: { value: string }[] | undefined,
  placeholder?: string
): { value: string; label: string }[] {
  const items = (entries || [])
    .map((entry) => String(entry.value || "").trim())
    .filter(Boolean)
    .map((value) => ({ value, label: value }));
  if (!placeholder) return items;
  return [{ value: "", label: placeholder }, ...items];
}

export function stringsToSelectOptions(
  values: string[],
  placeholder?: string
): { value: string; label: string }[] {
  return lookupEntriesToSelectOptions(
    values.map((value) => ({ value })),
    placeholder
  );
}

export function catalogValueList(entries: { value: string }[] | undefined): string[] {
  return (entries || [])
    .map((entry) => String(entry.value || "").trim())
    .filter(Boolean);
}

const LOOKUP_CATEGORY_TO_CATALOG: Record<string, keyof CatalogLookupSlices> = {
  PROSPECT_TYPE: "prospectTypes",
  ENGAGEMENT_TYPE: "engagementTypes",
  DEAL_STAGE: "dealStages",
  WIN_LOSS: "winLoss",
  CURRENCY: "currencies",
  DELIVERABLES: "deliverables",
  ARTIFACT_TYPE: "artifactTypes",
};

export function catalogEntriesForCategory(
  lookups: CatalogLookupSlices | null | undefined,
  lookupCategory?: string
): { value: string }[] | undefined {
  const key = LOOKUP_CATEGORY_TO_CATALOG[String(lookupCategory || "").trim()];
  if (!key || !lookups) return undefined;
  return lookups[key] as { value: string }[] | undefined;
}

export function filterSelectOptions(
  values: string[],
  allLabel: string
): { value: string; label: string }[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  return [{ value: "all", label: allLabel }, ...unique.map((value) => ({ value, label: value }))];
}

function hasSelectableValues(options: { value: string; label: string }[]): boolean {
  return options.some((opt) => String(opt.value).trim() !== "");
}

function mergeSelectOptionLists(
  ...lists: { value: string; label: string }[][]
): { value: string; label: string }[] {
  const merged: { value: string; label: string }[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    for (const option of list) {
      const key = option.value;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(option);
    }
  }

  return merged;
}

/**
 * Build dropdown options: merge live catalog + schema options (union), then fall back.
 * Avoids stale single-source lists after lookup edits.
 */
export function resolveFieldSelectOptions(
  field: { options?: string[] } | undefined,
  catalogEntries: { value: string }[] | undefined,
  fallback: { value: string; label: string }[],
  placeholder?: string
): { value: string; label: string }[] {
  const catalogOptions = lookupEntriesToSelectOptions(catalogEntries, placeholder);
  const schemaOptions = stringsToSelectOptions(field?.options || [], placeholder);
  const merged = mergeSelectOptionLists(catalogOptions, schemaOptions);
  if (hasSelectableValues(merged)) return merged;
  return fallback;
}
