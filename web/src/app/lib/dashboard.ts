import type { ApiOpportunity, TenantFieldDefinition } from "./opportunity";
import { isNumericFieldType } from "./fields";

export type DashboardWidgetType =
  | "metric_count"
  | "metric_sum"
  | "metric_avg"
  | "bar"
  | "pie";

export type DashboardWidget = {
  id: string;
  title: string;
  type: DashboardWidgetType;
  field?: string;
  limit?: number;
};

export type DashboardConfig = {
  title: string;
  subtitle: string;
  widgets: DashboardWidget[];
};

export type DashboardFieldOption = {
  value: string;
  label: string;
  numeric?: boolean;
};

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  title: "Overview",
  subtitle: "Welcome back! Here's your workspace overview.",
  widgets: [
    { id: "total-records", title: "Visible Records", type: "metric_count" },
    { id: "total-value", title: "Total Value", type: "metric_sum", field: "value" },
    { id: "by-status", title: "Records by Status", type: "bar", field: "status" },
    { id: "by-stage", title: "Records by Stage", type: "pie", field: "dealStage" },
  ],
};

export const DASHBOARD_WIDGET_TYPE_OPTIONS: {
  value: DashboardWidgetType;
  label: string;
}[] = [
  { value: "metric_count", label: "Record count" },
  { value: "metric_sum", label: "Sum metric" },
  { value: "metric_avg", label: "Average metric" },
  { value: "bar", label: "Bar breakdown" },
  { value: "pie", label: "Pie breakdown" },
];

export const CORE_DASHBOARD_FIELDS: DashboardFieldOption[] = [
  { value: "value", label: "Value", numeric: true },
  { value: "status", label: "Delivery status" },
  { value: "winOrLoss", label: "Win/Loss" },
  { value: "dealStage", label: "Deal stage" },
  { value: "prospectType", label: "Prospect type" },
  { value: "engagementType", label: "Engagement type" },
  { value: "owner", label: "Owner" },
  { value: "dueDate", label: "Due date" },
];

export function buildDashboardFieldOptions(
  schemaFields: TenantFieldDefinition[]
): DashboardFieldOption[] {
  return [
    ...CORE_DASHBOARD_FIELDS,
    ...schemaFields
      .filter((field) => field.source !== "system")
      .map((field) => ({
        value: `custom:${field.key}`,
        label: field.label,
        numeric: isNumericFieldType(field.fieldType),
      })),
  ];
}

export function dashboardOptionsForWidgetType(
  type: DashboardWidgetType,
  fields: DashboardFieldOption[]
) {
  return type === "metric_sum" || type === "metric_avg"
    ? fields.filter((field) => field.numeric)
    : fields;
}

export function dashboardFieldForType(
  type: DashboardWidgetType,
  fields: DashboardFieldOption[],
  current?: string
) {
  const options = dashboardOptionsForWidgetType(type, fields);
  return current && options.some((field) => field.value === current)
    ? current
    : options[0]?.value || "";
}

export function fieldLabelsForDashboard(schemaFields: TenantFieldDefinition[]) {
  const labels: Record<string, string> = {};
  for (const field of buildDashboardFieldOptions(schemaFields)) {
    labels[field.value] = field.label;
  }
  return labels;
}

export function recordFieldValue(
  record: ApiOpportunity,
  field?: string
): string | number | boolean | string[] | undefined {
  if (!field) return undefined;
  if (field.startsWith("custom:")) return record.customFields?.[field.slice(7)];
  if (field === "owner") {
    return (
      record.owners?.map((owner) => owner.name || owner.email).join(", ") ||
      "Unassigned"
    );
  }
  return (record as unknown as Record<string, string | number | boolean | string[] | undefined>)[field];
}

export { formatDashboardMetric } from "./format";

export function groupRecordsByField(
  records: ApiOpportunity[],
  field?: string,
  limit = 8
) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const raw = recordFieldValue(record, field);
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      const key =
        value === undefined || value === null || value === ""
          ? "Unspecified"
          : String(value);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
