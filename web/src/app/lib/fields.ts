import type { TenantFieldDefinition } from "./opportunity";

export type CustomFieldValue = string | number | boolean | string[];

export const FIELD_TYPE_OPTIONS: {
  value: TenantFieldDefinition["fieldType"];
  label: string;
}[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "percent", label: "Percent" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
  { value: "multi_select", label: "Multi-select" },
  { value: "lookup_select", label: "Lookup dropdown" },
  { value: "lookup_multi_select", label: "Lookup multi-select" },
  { value: "boolean", label: "Checkbox" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
];

export function isNumericFieldType(fieldType: TenantFieldDefinition["fieldType"]) {
  return ["number", "currency", "percent"].includes(fieldType);
}

export function inputTypeForFieldType(fieldType: TenantFieldDefinition["fieldType"]) {
  if (isNumericFieldType(fieldType)) return "number";
  if (fieldType === "date") return "date";
  if (fieldType === "url") return "url";
  if (fieldType === "email") return "email";
  if (fieldType === "phone") return "tel";
  return "text";
}

export function formatCustomValue(value: CustomFieldValue | undefined) {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function isEmptyCustomValue(value: CustomFieldValue | undefined) {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function isChoiceFieldType(fieldType: TenantFieldDefinition["fieldType"]) {
  return ["select", "multi_select", "lookup_select", "lookup_multi_select"].includes(
    fieldType
  );
}

export function isMultiChoiceFieldType(fieldType: TenantFieldDefinition["fieldType"]) {
  return fieldType === "multi_select" || fieldType === "lookup_multi_select";
}

/** Client-side guard aligned with server `validateChoiceValue` / schema options. */
export function validateChoiceAgainstOptions(
  label: string,
  raw: CustomFieldValue | string | undefined,
  options: string[],
  multi = false
): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (!options.length) return null;
  const allowed = new Set(options.map(String));
  const values = multi
    ? Array.isArray(raw)
      ? raw.map(String)
      : String(raw)
          .split(/[;,|]/)
          .map((part) => part.trim())
          .filter(Boolean)
    : [String(raw).trim()];
  const invalid = values.find((value) => value && !allowed.has(value));
  return invalid ? `Choose a valid value for ${label}.` : null;
}
