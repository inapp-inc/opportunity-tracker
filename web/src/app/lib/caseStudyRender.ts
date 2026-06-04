import type { ApiOpportunity, TenantFieldDefinition } from "./opportunity";
import {
  formatCustomValue,
  isNumericFieldType,
  type CustomFieldValue,
} from "./fields";
import { formatMoney } from "./format";
import type {
  CaseStudyEntry,
  CaseStudyLayout,
  CaseStudyValueFormat,
} from "./caseStudyLayout";
import { defaultCaseStudyLayout, normalizeCaseStudyLayout } from "./caseStudyLayout";

export { defaultCaseStudyLayout, normalizeCaseStudyLayout };

export type FieldCatalogItem = {
  key: string;
  label: string;
  source: "system" | "custom";
  fieldType?: string;
};

export function buildFieldCatalog(
  schemaFields: TenantFieldDefinition[]
): FieldCatalogItem[] {
  const retired = new Set([
    "buildDays",
    "tokenUsage",
    "aiCostUsd",
    "token_usage",
    "ai_cost",
  ]);
  const items = schemaFields
    .filter((f) => f.status !== "INACTIVE" && !retired.has(f.key))
    .map((f) => ({
      key: f.key,
      label: f.label,
      source: f.source === "custom" ? "custom" : "system",
      fieldType: f.fieldType,
    }));
  // Defensive: if the schema ever includes duplicate keys (e.g. a legacy custom field
  // created with a system key like "currency"), prefer the custom definition.
  const byKey = new Map<string, FieldCatalogItem>();
  for (const item of items) {
    const existing = byKey.get(item.key);
    if (!existing || (existing.source === "system" && item.source === "custom")) {
      byKey.set(item.key, item);
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const SYSTEM_ROW_KEYS = new Set([
  "prospect",
  "opportunityDescription",
  "dueDate",
  "firstPresalesCall",
  "closedDate",
  "notes",
  "value",
  "currency",
  "status",
  "winOrLoss",
  "dealStage",
  "prospectType",
  "engagementType",
]);

/** System fields stored in custom_data_json rather than dedicated columns. */
const CUSTOM_JSON_SYSTEM_KEYS = new Set(["techStack", "tech_stack"]);

function normalizeFieldKey(key: string) {
  const raw = String(key || "").trim();
  if (raw.startsWith("custom.")) return raw.slice(7);
  return raw;
}

function isEmptyFieldValue(value: CustomFieldValue | undefined): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function getTopLevelValue(
  opportunity: ApiOpportunity,
  key: string
): CustomFieldValue | undefined {
  switch (key) {
    case "prospect":
      return opportunity.prospect;
    case "opportunityDescription":
      return opportunity.opportunityDescription;
    case "dueDate":
      return opportunity.dueDate;
    case "firstPresalesCall":
      return opportunity.firstPresalesCall ?? undefined;
    case "closedDate":
      return opportunity.closedDate ?? undefined;
    case "notes":
      return opportunity.notes;
    case "value":
      return opportunity.value;
    case "currency":
      return opportunity.currency;
    case "status":
      return opportunity.status;
    case "winOrLoss":
      return opportunity.winOrLoss;
    case "dealStage":
      return opportunity.dealStage;
    case "prospectType":
      return opportunity.prospectType;
    case "engagementType":
      return opportunity.engagementType;
    case "deliverables": {
      const items = opportunity.deliverables || [];
      const text = items.map(String).map((s) => s.trim()).filter(Boolean).join(", ");
      return text || undefined;
    }
    default:
      return undefined;
  }
}

function readCustomFieldValue(
  opportunity: ApiOpportunity,
  key: string
): CustomFieldValue | undefined {
  const cf = opportunity.customFields || {};
  if (!Object.prototype.hasOwnProperty.call(cf, key)) return undefined;
  const value = cf[key];
  return isEmptyFieldValue(value) ? undefined : value;
}

export function resolveFieldRaw(
  opportunity: ApiOpportunity,
  schemaFields: TenantFieldDefinition[],
  key: string
): CustomFieldValue | undefined {
  const fieldKey = normalizeFieldKey(key);
  if (!fieldKey) return undefined;

  const field = schemaFields.find((f) => f.key === fieldKey);
  const fromCustom = () => readCustomFieldValue(opportunity, fieldKey);
  const fromRow = () => {
    const value = getTopLevelValue(opportunity, fieldKey);
    return isEmptyFieldValue(value) ? undefined : value;
  };

  // Tenant-defined fields live in custom_data_json only.
  if (field?.source === "custom") {
    return fromCustom();
  }

  // Tech stack is a system field stored alongside custom data.
  if (CUSTOM_JSON_SYSTEM_KEYS.has(fieldKey)) {
    return fromCustom() ?? fromRow();
  }

  // Standard opportunity columns (prospect, value, dates, etc.).
  if (field?.source === "system" || SYSTEM_ROW_KEYS.has(fieldKey)) {
    return fromRow() ?? fromCustom();
  }

  // Layout references an unknown key: prefer custom data, then row.
  return fromCustom() ?? fromRow();
}

function inferFormat(
  key: string,
  schemaFields: TenantFieldDefinition[],
  explicit?: CaseStudyValueFormat
): CaseStudyValueFormat {
  const fieldKey = normalizeFieldKey(key);
  if (explicit && explicit !== "auto") return explicit;
  if (fieldKey === "value" || fieldKey === "currency") {
    return fieldKey === "value" ? "money" : "text";
  }
  const field = schemaFields.find((f) => f.key === fieldKey);
  if (!field) return "text";
  if (field.fieldType === "currency") return "money";
  if (isNumericFieldType(field.fieldType)) return "number";
  if (field.fieldType === "percent") return "percent";
  return "text";
}

export function formatCaseStudyValue(
  raw: CustomFieldValue | undefined,
  format: CaseStudyValueFormat,
  currencyCode: string
): string {
  if (raw === undefined || raw === null || raw === "") return "—";
  if (format === "days") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return "—";
    return `${n} day${n === 1 ? "" : "s"}`;
  }
  if (format === "money") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return "—";
    return formatMoney(n, currencyCode);
  }
  if (format === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString();
  }
  if (format === "percent") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return "—";
    return `${n}%`;
  }
  return formatCustomValue(raw);
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

const DATE_FIELD_KEYS = new Set(["dueDate", "firstPresalesCall", "closedDate"]);

function isDateFieldKey(key: string, schemaFields: TenantFieldDefinition[]): boolean {
  const fieldKey = normalizeFieldKey(key);
  if (DATE_FIELD_KEYS.has(fieldKey)) return true;
  const field = schemaFields.find((f) => f.key === fieldKey);
  return field?.fieldType === "date";
}

function parseExpressionDate(
  raw: CustomFieldValue | undefined,
  key: string,
  schemaFields: TenantFieldDefinition[]
): Date | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const str = String(raw).trim();
  if (!str) return undefined;

  const treatAsDate = isDateFieldKey(key, schemaFields) || /^\d{4}-\d{2}-\d{2}/.test(str);
  if (!treatAsDate) return undefined;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const parsed = new Date(year, month, day);
    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month &&
      parsed.getDate() === day
    ) {
      return parsed;
    }
  }

  const fallback = new Date(str);
  if (Number.isNaN(fallback.getTime())) return undefined;
  return startOfLocalDay(fallback);
}

/** Inclusive Mon–Fri count from `start` through `end` (requires start <= end). */
function networkDaysInclusive(start: Date, end: Date): number {
  const from = startOfLocalDay(start);
  const to = startOfLocalDay(end);
  if (from.getTime() > to.getTime()) return 0;

  let count = 0;
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/** Working days for `minuend - subtrahend` (signed, Mon–Fri inclusive). */
export function workingDaysBetween(minuend: Date, subtrahend: Date): number {
  const left = startOfLocalDay(minuend);
  const right = startOfLocalDay(subtrahend);
  if (left.getTime() === right.getTime()) return 0;
  if (left.getTime() > right.getTime()) {
    return networkDaysInclusive(right, left);
  }
  return -networkDaysInclusive(left, right);
}

function preprocessDateSubtractions(
  expression: string,
  opportunity: ApiOpportunity,
  schemaFields: TenantFieldDefinition[]
): string {
  return expression.replace(
    /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\s*-\s*\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
    (_match, leftKey: string, rightKey: string) => {
      const leftRaw = resolveFieldRaw(opportunity, schemaFields, leftKey);
      const rightRaw = resolveFieldRaw(opportunity, schemaFields, rightKey);
      const leftDate = parseExpressionDate(leftRaw, leftKey, schemaFields);
      const rightDate = parseExpressionDate(rightRaw, rightKey, schemaFields);
      if (!leftDate || !rightDate) return "0";
      return String(workingDaysBetween(leftDate, rightDate));
    }
  );
}

function prepareNumericExpression(
  expression: string,
  opportunity: ApiOpportunity,
  schemaFields: TenantFieldDefinition[]
): string {
  const withDateDiffs = preprocessDateSubtractions(
    expression,
    opportunity,
    schemaFields
  );
  return substituteExpressionTokens(withDateDiffs, opportunity, schemaFields);
}

function substituteExpressionTokens(
  expression: string,
  opportunity: ApiOpportunity,
  schemaFields: TenantFieldDefinition[]
): string {
  return expression.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key: string) => {
    const raw = resolveFieldRaw(opportunity, schemaFields, key);
    if (raw === undefined || raw === null || raw === "") return "0";
    const n = Number(raw);
    if (Number.isFinite(n)) return String(n);
    return "0";
  });
}

type NumericEvalResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

function evaluateNumericExpression(expr: string): NumericEvalResult {
  const sanitized = expr.replace(/\s+/g, "");
  if (!sanitized) return { ok: false, error: "Expression is empty." };
  if (!/^[\d.+\-*/()]+$/.test(sanitized)) {
    return {
      ok: false,
      error:
        "Expression contains unsupported characters. Only numbers, + - * / and parentheses are allowed.",
    };
  }
  try {
    const tokens: string[] = [];
    let i = 0;
    while (i < sanitized.length) {
      const ch = sanitized[i];
      if ("+-*/()".includes(ch)) {
        tokens.push(ch);
        i += 1;
        continue;
      }
      if (/[\d.]/.test(ch)) {
        let j = i + 1;
        while (j < sanitized.length && /[\d.]/.test(sanitized[j])) j += 1;
        tokens.push(sanitized.slice(i, j));
        i = j;
        continue;
      }
      return { ok: false, error: "Expression contains an invalid token." };
    }

    let pos = 0;
    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];

    function parsePrimary(): number {
      const t = peek();
      if (t === "(") {
        consume();
        const v = parseAddSub();
        if (consume() !== ")") throw new Error("Missing ')'.");
        return v;
      }
      if (t === undefined || !/^-?\d/.test(t)) throw new Error("Expected a number.");
      const n = Number(consume());
      if (!Number.isFinite(n)) throw new Error("Invalid number.");
      return n;
    }

    function parseMulDiv(): number {
      let v = parsePrimary();
      while (peek() === "*" || peek() === "/") {
        const op = consume();
        const rhs = parsePrimary();
        v = op === "*" ? v * rhs : rhs === 0 ? NaN : v / rhs;
      }
      return v;
    }

    function parseAddSub(): number {
      let v = parseMulDiv();
      while (peek() === "+" || peek() === "-") {
        const op = consume();
        const rhs = parseMulDiv();
        v = op === "+" ? v + rhs : v - rhs;
      }
      return v;
    }

    const result = parseAddSub();
    if (pos !== tokens.length) {
      return { ok: false, error: "Unexpected token in expression." };
    }
    if (!Number.isFinite(result)) {
      return { ok: false, error: "Expression evaluated to an invalid number." };
    }
    return { ok: true, value: result };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message
          ? err.message
          : "Unable to parse expression. Check parentheses and operators.",
    };
  }
}

/** Best-effort validation without record data (tokens become 1). */
export function validateCaseStudyExpression(expression: string): NumericEvalResult {
  const withDateDiffsAsOne = String(expression || "").replace(
    /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\s*-\s*\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
    "1"
  );
  const withTokensAsOne = withDateDiffsAsOne.replace(
    /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
    "1"
  );
  return evaluateNumericExpression(withTokensAsOne);
}

function renderTemplate(
  template: string,
  opportunity: ApiOpportunity,
  schemaFields: TenantFieldDefinition[],
  currencyCode: string
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key: string) => {
    const raw = resolveFieldRaw(opportunity, schemaFields, key);
    const fmt = inferFormat(key, schemaFields, "auto");
    const display = formatCaseStudyValue(raw, fmt === "money" ? "text" : fmt, currencyCode);
    return display === "—" ? "" : display;
  });
}

export type RenderedCaseStudyRow = {
  id: string;
  label: string;
  value: string;
  multiline?: boolean;
};

export type RenderedCaseStudyColumn = {
  id: string;
  title?: string;
  rows: RenderedCaseStudyRow[];
  blocks: { id: string; html: string }[];
};

export function renderCaseStudyEntry(
  entry: CaseStudyEntry,
  opportunity: ApiOpportunity,
  schemaFields: TenantFieldDefinition[]
): { rows: RenderedCaseStudyRow[]; blocks: { id: string; html: string }[] } {
  const currencyCode = String(opportunity.currency || "USD").toUpperCase();
  const rows: RenderedCaseStudyRow[] = [];
  const blocks: { id: string; html: string }[] = [];

  if (entry.type === "field" && entry.fieldKey) {
    const fieldKey = normalizeFieldKey(entry.fieldKey);
    const raw = resolveFieldRaw(opportunity, schemaFields, fieldKey);
    const field = schemaFields.find((f) => f.key === fieldKey);
    const label =
      entry.label?.trim() ||
      field?.label ||
      fieldKey;
    const format = inferFormat(fieldKey, schemaFields, entry.format);
    const multiline =
      field?.fieldType === "textarea" ||
      fieldKey === "opportunityDescription" ||
      fieldKey === "techStack";
    rows.push({
      id: entry.id,
      label,
      value: formatCaseStudyValue(raw, format, currencyCode),
      multiline,
    });
    return { rows, blocks };
  }

  if (entry.type === "text") {
    const text = renderTemplate(entry.text || "", opportunity, schemaFields, currencyCode);
    if (entry.label?.trim()) {
      rows.push({
        id: entry.id,
        label: entry.label.trim(),
        value: text || "—",
        multiline: true,
      });
    } else if (text.trim()) {
      blocks.push({ id: entry.id, html: text });
    }
    return { rows, blocks };
  }

  if (entry.type === "expression" && entry.expression) {
    const substituted = prepareNumericExpression(
      entry.expression,
      opportunity,
      schemaFields
    );
    const numeric = evaluateNumericExpression(substituted);
    const format = entry.format || "number";
    const label = entry.label?.trim() || "Calculated";
    rows.push({
      id: entry.id,
      label,
      value:
        numeric.ok
          ? formatCaseStudyValue(numeric.value, format, currencyCode)
          : `Expression error: ${numeric.error}`,
    });
  }

  return { rows, blocks };
}

export function renderCaseStudyLayout(
  layout: CaseStudyLayout,
  opportunity: ApiOpportunity,
  schemaFields: TenantFieldDefinition[]
): RenderedCaseStudyColumn[] {
  const columns = Array.isArray(layout?.columns) ? layout.columns : [];
  return columns.map((column) => {
    const rows: RenderedCaseStudyRow[] = [];
    const blocks: { id: string; html: string }[] = [];
    for (const entry of column.entries || []) {
      const rendered = renderCaseStudyEntry(entry, opportunity, schemaFields);
      rows.push(...rendered.rows);
      blocks.push(...rendered.blocks);
    }
    return {
      id: column.id,
      title: column.title?.trim() || undefined,
      rows,
      blocks,
    };
  });
}
