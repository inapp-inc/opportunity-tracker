import type { LucideIcon } from "lucide-react";
import { AlertCircle, Briefcase, CheckCircle2, DollarSign } from "lucide-react";
import type { ApiOpportunity } from "./opportunity";
import { formatMoney } from "./format";
import { formatDashboardMetric, recordFieldValue } from "./dashboard";
import { isNumericFieldType } from "./fields";
import type { TenantFieldDefinition } from "./opportunity";

export type SummaryAggregation = "count" | "sum" | "avg" | "min" | "max";

export type SummaryCardFilterPreset = "all" | "completed" | "overdue";

export type SummaryCardFilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "is_empty"
  | "is_not_empty";

export type SummaryCardFilter =
  | { mode: "preset"; preset: SummaryCardFilterPreset }
  | { mode: "field"; field: string; op: SummaryCardFilterOp; value?: string };

export type SummaryCardConfig = {
  id: string;
  aggregation: SummaryAggregation;
  /** Field for aggregations other than count. Accepts core keys (e.g. `value`) or `custom:<key>`. */
  field?: string;
  filter?: SummaryCardFilter;
  label: string;
  description?: string;
};

export type SummaryCardsConfig = {
  cards: SummaryCardConfig[];
};

export const DEFAULT_SUMMARY_CARDS: SummaryCardsConfig = {
  cards: [
    { id: "records-count", aggregation: "count", label: "Visible Records", description: "After filters" },
    { id: "records-value", aggregation: "sum", field: "value", label: "Total Value", description: "Sum of record values" },
    { id: "records-completed", aggregation: "count", filter: { mode: "preset", preset: "completed" }, label: "Completed", description: "Done records" },
    { id: "records-overdue", aggregation: "count", filter: { mode: "preset", preset: "overdue" }, label: "Overdue", description: "Needs attention" },
  ],
};

export function normalizeSummaryCardsConfig(input: unknown): SummaryCardsConfig {
  const src = input && typeof input === "object" ? (input as SummaryCardsConfig) : null;
  const raw = Array.isArray(src?.cards) ? src!.cards : [];
  const allowedAggs = new Set<SummaryAggregation>(["count", "sum", "avg", "min", "max"]);
  const allowedPresets = new Set<SummaryCardFilterPreset>(["all", "completed", "overdue"]);
  const allowedOps = new Set<SummaryCardFilterOp>([
    "eq",
    "neq",
    "contains",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "is_empty",
    "is_not_empty",
  ]);

  const normalizeFilter = (value: unknown, fallback?: SummaryCardFilter): SummaryCardFilter | undefined => {
    if (value === undefined || value === null || value === "") return fallback;
    // Legacy preset string.
    if (typeof value === "string") {
      const preset = value as SummaryCardFilterPreset;
      return allowedPresets.has(preset) ? { mode: "preset", preset } : fallback;
    }
    if (typeof value !== "object") return fallback;
    const v = value as any;
    const mode = String(v.mode || "").trim();
    if (mode === "field") {
      const field = String(v.field || "").trim();
      const op = String(v.op || "eq") as SummaryCardFilterOp;
      const val = v.value !== undefined ? String(v.value) : undefined;
      if (!field) return fallback;
      if (!allowedOps.has(op)) return fallback;
      return { mode: "field", field, op, value: val };
    }
    const preset = String(v.preset || v.filter || "").trim() as SummaryCardFilterPreset;
    if (allowedPresets.has(preset)) return { mode: "preset", preset };
    return fallback;
  };

  const cards = raw
    .filter(Boolean)
    .map((c, idx) => {
      const fallback = DEFAULT_SUMMARY_CARDS.cards[idx] || DEFAULT_SUMMARY_CARDS.cards[0];
      const legacyType = String((c as any).type || "");
      const legacyMetric = String((c as any).metric || "");
      const fromLegacy =
        legacyType === "metric_sum" || legacyMetric === "sumValue"
          ? ("sum" as SummaryAggregation)
          : legacyType === "metric_avg"
            ? ("avg" as SummaryAggregation)
            : legacyMetric === "countCompleted" || legacyMetric === "countOverdue" || legacyType === "metric_count"
              ? ("count" as SummaryAggregation)
              : null;
      const aggregationRaw = String((c as any).aggregation || fromLegacy || fallback.aggregation);
      const aggregation = aggregationRaw as SummaryAggregation;
      return {
        id: String((c as any).id || `card-${idx}`),
        aggregation: allowedAggs.has(aggregation) ? aggregation : fallback.aggregation,
        field: (c as any).field !== undefined ? String((c as any).field) : fallback.field,
        filter: normalizeFilter((c as any).filter, fallback.filter),
        label: String((c as any).label || fallback.label).slice(0, 60),
        description: String((c as any).description || fallback.description || "").slice(0, 120) || undefined,
      } satisfies SummaryCardConfig;
    });
  const trimmed = cards.slice(0, 20);
  return { cards: trimmed.length ? trimmed : DEFAULT_SUMMARY_CARDS.cards };
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isOverdue(opp: ApiOpportunity): boolean {
  if (opp.status === "Completed") return false;
  if (!opp.dueDate) return false;
  return startOfDay(new Date(`${opp.dueDate}T12:00:00`)) < startOfDay(new Date());
}

export type SummaryCardComputed = {
  id: string;
  label: string;
  description?: string;
  value: string;
  icon: LucideIcon;
  iconClassName: string;
  accentClassName: string;
};

function metricMeta(card: SummaryCardConfig) {
  if (card.aggregation !== "count") {
    return { icon: DollarSign, iconClassName: "text-emerald-600", accentClassName: "bg-emerald-500" };
  }
  if (card.filter?.mode === "preset" && card.filter.preset === "completed") {
    return { icon: CheckCircle2, iconClassName: "text-violet-600", accentClassName: "bg-violet-500" };
  }
  if (card.filter?.mode === "preset" && card.filter.preset === "overdue") {
    return { icon: AlertCircle, iconClassName: "text-red-600", accentClassName: "bg-red-500" };
  }
  return { icon: Briefcase, iconClassName: "text-blue-600", accentClassName: "bg-blue-500" };
}

export function computeSummaryCards(args: {
  config: SummaryCardsConfig | null | undefined;
  records: ApiOpportunity[];
  currencyCode: string;
  schemaFields?: TenantFieldDefinition[];
}): SummaryCardComputed[] {
  const cfg = normalizeSummaryCardsConfig(args.config);
  const schemaFields = args.schemaFields || [];

  const applyFilter = (records: ApiOpportunity[], filter?: SummaryCardFilter) => {
    if (!filter) return records;
    if (filter.mode === "preset") {
      if (!filter.preset || filter.preset === "all") return records;
      if (filter.preset === "completed") return records.filter((r) => r.status === "Completed");
      return records.filter(isOverdue);
    }
    const op = filter.op;
    const value = (filter.value ?? "").trim();
    const rawList = op === "in" ? value.split(/[;,|]/).map((s) => s.trim()).filter(Boolean) : [];
    const toNum = (v: unknown) => {
      const n = typeof v === "number" ? v : Number(String(v ?? ""));
      return Number.isFinite(n) ? n : null;
    };
    const toDate = (v: unknown) => {
      const s = String(v ?? "").trim();
      if (!s) return null;
      // Common stored shape is yyyy-mm-dd.
      const d = new Date(s.length <= 10 ? `${s}T12:00:00` : s);
      return Number.isNaN(d.getTime()) ? null : d.getTime();
    };
    const toStr = (v: unknown) => String(v ?? "").trim();

    return records.filter((record) => {
      const v = recordFieldValue(record, filter.field);
      const isEmpty =
        v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (op === "is_empty") return isEmpty;
      if (op === "is_not_empty") return !isEmpty;

      if (Array.isArray(v)) {
        const joined = v.map((x) => String(x ?? "")).join(", ");
        const a = joined.toLowerCase();
        const b = value.toLowerCase();
        if (op === "contains") return a.includes(b);
        if (op === "eq") return joined === value;
        if (op === "neq") return joined !== value;
        if (op === "in") return rawList.includes(joined);
        return false;
      }

      // Try numeric compare for gt/gte/lt/lte.
      if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
        const a = toNum(v);
        const b = toNum(value);
        if (a !== null && b !== null) {
          if (op === "gt") return a > b;
          if (op === "gte") return a >= b;
          if (op === "lt") return a < b;
          return a <= b;
        }
        const da = toDate(v);
        const db = toDate(value);
        if (da !== null && db !== null) {
          if (op === "gt") return da > db;
          if (op === "gte") return da >= db;
          if (op === "lt") return da < db;
          return da <= db;
        }
        return false;
      }

      const a = toStr(v);
      if (op === "contains") return a.toLowerCase().includes(value.toLowerCase());
      if (op === "eq") return a === value;
      if (op === "neq") return a !== value;
      if (op === "in") return rawList.includes(a);
      return false;
    });
  };

  const numericOk = (field?: string) => {
    if (!field) return false;
    if (field === "value") return true;
    if (field.startsWith("custom:")) {
      const key = field.slice(7);
      const def = schemaFields.find((f) => f.key === key);
      return def ? isNumericFieldType(def.fieldType) : false;
    }
    return false;
  };

  const valueFor = (card: SummaryCardConfig) => {
    const records = applyFilter(args.records, card.filter);
    if (card.aggregation === "count") return records.length.toLocaleString();

    const field = card.field || "value";
    if (!numericOk(field)) return "—";
    const nums = records
      .map((r) => Number(recordFieldValue(r, field)))
      .filter((n) => Number.isFinite(n));
    const sum = nums.reduce((a, b) => a + b, 0);
    const min = nums.length ? Math.min(...nums) : 0;
    const max = nums.length ? Math.max(...nums) : 0;
    const val =
      card.aggregation === "avg"
        ? sum / (nums.length || 1)
        : card.aggregation === "min"
          ? min
          : card.aggregation === "max"
            ? max
            : sum;
    // Use existing formatting logic for dashboard widgets.
    return field === "value" ? formatMoney(val, args.currencyCode) : formatDashboardMetric(val, field, args.currencyCode);
  };

  return cfg.cards.map((card) => {
    const meta = metricMeta(card);
    return {
      id: card.id,
      label: card.label,
      description: card.description,
      value: valueFor(card),
      ...meta,
    };
  });
}

