/** Shared choice-field helpers for record schema validation (import + API). */

export function isSchemaChoiceFieldType(fieldType) {
  return ['select', 'multi_select', 'lookup_select', 'lookup_multi_select'].includes(
    String(fieldType || '')
  );
}

export function isSchemaMultiChoiceFieldType(fieldType) {
  return fieldType === 'multi_select' || fieldType === 'lookup_multi_select';
}

export function schemaKeyToSnakeColumn(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

export function splitChoiceList(value) {
  return String(value || '')
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @returns {string} empty if valid, otherwise `invalid {label}` or `invalid {label}: {value}`
 */
export function validateChoiceValue(label, raw, options, multi = false) {
  if (raw === undefined || raw === null || raw === '') return '';
  const allowed = new Set((options || []).map(String));
  if (!allowed.size) return '';
  const values = multi
    ? Array.isArray(raw)
      ? raw.map(String)
      : splitChoiceList(raw)
    : [String(raw).trim()];
  const invalid = values.find((value) => value && !allowed.has(value));
  return invalid ? `invalid ${label}${invalid ? `: ${invalid}` : ''}` : '';
}

/** Throws like legacy import validation. */
export function assertChoiceValue(label, raw, options, multi = false) {
  const err = validateChoiceValue(label, raw, options, multi);
  if (err) throw new Error(err);
}

export function importColumnTypeForField(fieldType) {
  if (isSchemaMultiChoiceFieldType(fieldType)) return 'lookup_multi';
  if (isSchemaChoiceFieldType(fieldType)) return 'lookup';
  if (fieldType === 'date') return 'date';
  if (['number', 'currency', 'percent'].includes(fieldType)) return 'number';
  return 'text';
}
