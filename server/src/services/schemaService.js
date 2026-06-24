import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { slugify } from '../utils/slug.js';
import { nowIso } from '../utils/time.js';
import {
  assertChoiceValue,
  importColumnTypeForField,
  isSchemaChoiceFieldType,
  isSchemaMultiChoiceFieldType,
  schemaKeyToSnakeColumn,
  validateChoiceValue,
} from '../schemaChoices.js';
import { getConfigValue, setConfigValue } from './configStorage.js';
import { getDealStageValues, lookupCategoryKey } from './lookupService.js';
import { normalizeOwnerIds } from './ownerService.js';

export const RECORD_IMPORT_FIELD_EXCLUDE = new Set(['techStack']);

export function recordFieldDbColumn(key) {
  const explicit = {
    prospect: 'prospect',
    opportunityDescription: 'opportunity_description',
    deliverables: 'deliverables',
    dueDate: 'due_date',
    status: 'status',
    prospectType: 'prospect_type',
    engagementType: 'engagement_type',
    dealStage: 'deal_stage',
    winOrLoss: 'win_or_loss',
    firstPresalesCall: 'first_presales_call',
    closedDate: 'closed_date',
    value: 'value',
    currency: 'currency',
    notes: 'notes',
  };
  return explicit[key] || schemaKeyToSnakeColumn(key);
}

export function activeSystemRecordFields(tenantId) {
  return getRecordSchemaDefinitions(tenantId).filter(
    (field) => field.source === 'system' && field.status !== 'INACTIVE'
  );
}

export function readRecordFieldFromSource(source, key, useDbColumns = false) {
  if (!source || typeof source !== 'object') return undefined;
  if (!useDbColumns) {
    if (source[key] !== undefined) return source[key];
    const column = recordFieldDbColumn(key);
    if (source[column] !== undefined) return source[column];
    return undefined;
  }
  const column = recordFieldDbColumn(key);
  if (source[column] !== undefined) return source[column];
  if (source[key] !== undefined) return source[key];
  return undefined;
}

export function validateRecordSchemaChoiceFields(tenantId, source, useDbColumns = false) {
  for (const field of activeSystemRecordFields(tenantId)) {
    if (!isSchemaChoiceFieldType(field.fieldType)) continue;
    const raw = readRecordFieldFromSource(source, field.key, useDbColumns);
    const multi = isSchemaMultiChoiceFieldType(field.fieldType);
    const err = validateLookupValue(
      field.key,
      raw,
      recordSchemaFieldOptions(tenantId, field.key),
      multi
    );
    if (err) return err;
  }
  return '';
}

export function validateRecordSchemaRequiredForPublish(tenantId, source, useDbColumns = false) {
  for (const field of activeSystemRecordFields(tenantId)) {
    if (!field.required) continue;
    if (field.key === 'ownerIds') {
      let ownerIds = [];
      if (useDbColumns) {
        try {
          ownerIds = JSON.parse(source.owner_json || '[]');
        } catch {
          return 'invalid ownerIds';
        }
      } else {
        ownerIds = source.ownerIds || [];
      }
      if (!normalizeOwnerIds(ownerIds, tenantId).length) {
        return 'ownerIds required (active users)';
      }
      continue;
    }
    const raw = readRecordFieldFromSource(source, field.key, useDbColumns);
    const empty =
      raw === undefined ||
      raw === null ||
      raw === '' ||
      (Array.isArray(raw) && raw.length === 0);
    if (empty) return `${field.key} required`;
  }
  return '';
}

export function allowedFieldTypes() {
  return [
    'text',
    'textarea',
    'number',
    'currency',
    'percent',
    'date',
    'select',
    'multi_select',
    'lookup_select',
    'lookup_multi_select',
    'boolean',
    'url',
    'email',
    'phone',
  ];
}

export function fieldKeyFromLabel(label) {
  return slugify(label).replace(/-/g, '_');
}

export function normalizeFieldOptions(input) {
  if (Array.isArray(input)) {
    return input.map(String).map((s) => s.trim()).filter(Boolean);
  }
  return String(input || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function defaultSystemFieldDefinitions() {
  return [
    { key: 'prospect', label: 'Prospect', fieldType: 'text', required: true, showInTable: true },
    { key: 'ownerIds', label: 'Owners', fieldType: 'user_multi_select', required: true, showInTable: true },
    { key: 'opportunityDescription', label: 'Description', fieldType: 'textarea', required: true, showInTable: true },
    { key: 'deliverables', label: 'Deliverables', fieldType: 'lookup_multi_select', lookupCategory: 'DELIVERABLES', required: false, showInTable: false },
    { key: 'prospectType', label: 'Prospect Type', fieldType: 'lookup_select', lookupCategory: 'PROSPECT_TYPE', required: true, showInTable: false },
    { key: 'engagementType', label: 'Type of Engagement', fieldType: 'lookup_select', lookupCategory: 'ENGAGEMENT_TYPE', required: true, showInTable: false },
    { key: 'dueDate', label: 'Due Date', fieldType: 'date', required: true, showInTable: true },
    { key: 'firstPresalesCall', label: 'First Presales Call', fieldType: 'date', required: false, showInTable: false },
    { key: 'closedDate', label: 'Closed Date', fieldType: 'date', required: false, showInTable: false },
    { key: 'dealStage', label: 'Deal stage', fieldType: 'lookup_select', lookupCategory: 'DEAL_STAGE', required: true, showInTable: true },
    { key: 'status', label: 'Status', fieldType: 'select', options: ['Not Started', 'In Progress', 'Completed'], required: true, showInTable: true },
    { key: 'winOrLoss', label: 'Win or Loss', fieldType: 'lookup_select', lookupCategory: 'WIN_LOSS', required: true, showInTable: true },
    { key: 'value', label: 'Value', fieldType: 'currency', required: false, showInTable: true },
    { key: 'currency', label: 'Currency', fieldType: 'lookup_select', lookupCategory: 'CURRENCY', required: true, showInTable: false },
    { key: 'notes', label: 'Notes', fieldType: 'textarea', required: false, showInTable: false },
    { key: 'techStack', label: 'Tech stack', fieldType: 'textarea', required: false, showInTable: false },
  ].map((field, index) => ({
    id: `system:${field.key}`,
    entity: 'opportunity',
    source: 'system',
    status: 'ACTIVE',
    sortOrder: index,
    options: field.options || [],
    lookupCategory: field.lookupCategory || '',
    ...field,
  }));
}

export function getRecordFormFieldConfig(tenantId) {
  return getConfigValue(tenantId, 'record_form_fields', {}, (parsed) =>
    parsed && typeof parsed === 'object' ? parsed : {}
  );
}

export function setRecordFormFieldConfig(tenantId, config) {
  setConfigValue(tenantId, 'record_form_fields', config);
}

export function resolveLookupOptions(tenantId, lookupCategory) {
  const category = lookupCategoryKey(lookupCategory);
  if (!category) return [];
  return db
    .prepare(
      `SELECT value FROM lookup_entries WHERE tenant_id = ? AND category = ? ORDER BY sort_order, value`
    )
    .all(tenantId, category)
    .map((row) => row.value);
}

/** Allowed values for a system record field — same source as GET /catalog/schema and the form editor. */
export function recordSchemaFieldOptions(tenantId, key) {
  const def = getRecordSchemaDefinitions(tenantId).find((item) => item.key === key);
  if (!def || def.status === 'INACTIVE') return [];
  return Array.isArray(def.options) ? def.options.map(String) : [];
}

export function dealStageValuesForTenant(tenantId) {
  const fromSchema = recordSchemaFieldOptions(tenantId, 'dealStage');
  return fromSchema.length ? fromSchema : getDealStageValues(tenantId);
}

export function systemFieldLookupCategory(field, override) {
  if (Object.prototype.hasOwnProperty.call(override, 'lookupCategory')) {
    return lookupCategoryKey(override.lookupCategory);
  }
  return lookupCategoryKey(field.lookupCategory);
}

export function isRecordSchemaFieldActive(tenantId, key) {
  const def = getRecordSchemaDefinitions(tenantId).find((item) => item.key === key);
  return !def || def.status !== 'INACTIVE';
}

export function getRecordSchemaDefinitions(tenantId) {
  const overrides = getRecordFormFieldConfig(tenantId);
  const systemFields = defaultSystemFieldDefinitions().map((field) => {
    const override = overrides[field.key] || {};
    let fieldType = String(override.fieldType || field.fieldType);
    if (field.key === 'winOrLoss' && fieldType === 'select') {
      fieldType = 'lookup_select';
    }
    let lookupCategory = systemFieldLookupCategory(field, override);
    if (field.key === 'winOrLoss' && fieldType === 'lookup_select' && !lookupCategory) {
      lookupCategory = 'WIN_LOSS';
    }
    const inlineOptions = Array.isArray(override.options) ? override.options : field.options || [];
    return {
      ...field,
      fieldType,
      label: String(override.label || field.label),
      required: Boolean(override.required ?? field.required),
      showInTable: Boolean(override.showInTable ?? field.showInTable),
      status: String(override.status || field.status),
      sortOrder: Number(override.sortOrder ?? field.sortOrder),
      lookupCategory,
      options: lookupCategory ? resolveLookupOptions(tenantId, lookupCategory) : inlineOptions,
      locked: false,
    };
  });
  return [...systemFields, ...getTenantFieldDefinitions(tenantId, true)].sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
  );
}

export function updateSystemFieldDefinition(tenantId, key, patch) {
  const defaults = defaultSystemFieldDefinitions();
  const field = defaults.find((item) => item.key === key);
  if (!field) return null;
  const config = getRecordFormFieldConfig(tenantId);
  const existing = config[key] || {};
  const requestedFieldType =
    patch.fieldType !== undefined ? String(patch.fieldType) : existing.fieldType || field.fieldType;
  const fieldType = requestedFieldType;
  if (!allowedFieldTypes().includes(fieldType)) {
    throw new Error('invalid fieldType');
  }
  const lookupCategory =
    patch.lookupCategory !== undefined
      ? lookupCategoryKey(patch.lookupCategory)
      : systemFieldLookupCategory(field, existing);
  const options =
    patch.options !== undefined
      ? normalizeFieldOptions(patch.options)
      : lookupCategory
        ? []
        : Array.isArray(existing.options)
          ? existing.options
          : field.options || [];
  if (
    ['select', 'multi_select', 'lookup_select', 'lookup_multi_select'].includes(fieldType) &&
    !options.length &&
    !lookupCategory
  ) {
    throw new Error('choice fields require options or lookup source');
  }
  const next = {
    ...existing,
    label: patch.label !== undefined ? String(patch.label).trim() || field.label : existing.label,
    fieldType,
    options,
    required:
      patch.required !== undefined
        ? Boolean(patch.required)
        : Boolean(existing.required ?? field.required),
    showInTable: Boolean(patch.showInTable ?? existing.showInTable ?? field.showInTable),
    status:
      patch.status !== undefined
        ? String(patch.status)
        : String(existing.status || field.status),
    sortOrder: patch.sortOrder !== undefined ? Number(patch.sortOrder) : Number(existing.sortOrder ?? field.sortOrder),
    lookupCategory,
  };
  config[key] = next;
  setRecordFormFieldConfig(tenantId, config);
  return getRecordSchemaDefinitions(tenantId).find((item) => item.id === `system:${key}`);
}

export function parseFieldDefinitionInput(body) {
  const label = String(body.label || '').trim();
  const key = fieldKeyFromLabel(body.key || label);
  const fieldType = String(body.fieldType || 'text');
  if (!label) return { error: 'label required' };
  if (!key) return { error: 'key required' };
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    return { error: 'key must start with a letter and contain lowercase letters, numbers, or underscores' };
  }
  if (!allowedFieldTypes().includes(fieldType)) {
    return { error: 'invalid fieldType' };
  }
  const options = normalizeFieldOptions(body.options);
  const lookupCategory = lookupCategoryKey(body.lookupCategory);
  if (['select', 'multi_select', 'lookup_select', 'lookup_multi_select'].includes(fieldType) && !options.length && !lookupCategory) {
    return { error: 'choice fields require options' };
  }
  return {
    field: {
      key,
      label,
      field_type: fieldType,
      options_json: JSON.stringify(options),
      lookup_category: lookupCategory || null,
      required: body.required ? 1 : 0,
      show_in_table: body.showInTable ? 1 : 0,
    },
  };
}

export function mapFieldDefinitionRow(r) {
  let options = [];
  try {
    options = JSON.parse(r.options_json || '[]');
  } catch {
    options = [];
  }
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    fieldType: r.field_type,
    options: r.lookup_category ? resolveLookupOptions(r.tenant_id, r.lookup_category) : options,
    lookupCategory: r.lookup_category || '',
    required: !!r.required,
    showInTable: !!r.show_in_table,
    sortOrder: r.sort_order,
    status: r.status,
    source: 'custom',
  };
}

export function getTenantFieldDefinitions(tenantId, includeInactive = false) {
  const rows = db
    .prepare(
      `SELECT * FROM tenant_field_definitions
       WHERE tenant_id = ? AND entity = 'opportunity'
       ${includeInactive ? '' : `AND status = 'ACTIVE'`}
       ORDER BY sort_order, label`
    )
    .all(tenantId);
  return rows.map(mapFieldDefinitionRow);
}

export function getTenantFieldDefinition(tenantId, id) {
  const row = db
    .prepare(
      `SELECT * FROM tenant_field_definitions
       WHERE id = ? AND tenant_id = ? AND entity = 'opportunity'`
    )
    .get(id, tenantId);
  return row ? mapFieldDefinitionRow(row) : null;
}

export function normalizeCustomFields(input, tenantId = DEFAULT_TENANT_ID) {
  // customFields are stored in `opportunities.custom_data_json`.
  // Validate against the same schema definitions exposed to the form editor.
  const systemCaseStudyKeys = new Set(['techStack']);
  const defs = getRecordSchemaDefinitions(tenantId).filter(
    (def) =>
      def.status !== 'INACTIVE' &&
      (def.source === 'custom' || systemCaseStudyKeys.has(def.key))
  );
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  const allowedKeys = new Set(defs.map((def) => def.key));
  for (const key of Object.keys(src)) {
    if (!allowedKeys.has(key)) {
      // Backwards compatibility: old builds stored an "asset_link" field. If it
      // still exists on older records, ignore it (treat missing/unknown as "-").
      if (key === 'asset_link' || key === 'assetLink') continue;
      throw new Error(`unknown custom field: ${key}`);
    }
  }
  for (const def of defs) {
    const raw = src[def.key];
    if (
      raw === undefined ||
      raw === null ||
      raw === '' ||
      (Array.isArray(raw) && raw.length === 0)
    ) {
      if (def.required) throw new Error(`custom field required: ${def.label}`);
      continue;
    }
    if (['number', 'currency', 'percent'].includes(def.fieldType)) {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new Error(`custom field must be a number: ${def.label}`);
      out[def.key] = n;
    } else if (def.fieldType === 'boolean') {
      out[def.key] = Boolean(raw);
    } else if (def.fieldType === 'multi_select' || def.fieldType === 'lookup_multi_select') {
      const values = Array.isArray(raw)
        ? raw.map(String)
        : String(raw)
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);
      const invalid = values.find((value) => !def.options.includes(value));
      if (invalid) throw new Error(`invalid option for ${def.label}`);
      out[def.key] = values;
    } else if (def.fieldType === 'select' || def.fieldType === 'lookup_select') {
      const value = String(raw);
      if (def.options.length && !def.options.includes(value)) {
        throw new Error(`invalid option for ${def.label}`);
      }
      out[def.key] = value;
    } else if (def.fieldType === 'date') {
      const value = String(raw);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
        throw new Error(`custom field must be a date: ${def.label}`);
      }
      out[def.key] = value;
    } else if (def.fieldType === 'url') {
      const value = String(raw);
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
      } catch {
        throw new Error(`custom field must be a URL: ${def.label}`);
      }
      out[def.key] = value;
    } else if (def.fieldType === 'email') {
      const value = String(raw);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new Error(`custom field must be an email: ${def.label}`);
      }
      out[def.key] = value;
    } else if (def.fieldType === 'phone') {
      const value = String(raw);
      if (!/^[+()\-.\s0-9]{7,}$/.test(value)) {
        throw new Error(`custom field must be a phone number: ${def.label}`);
      }
      out[def.key] = value;
    } else {
      out[def.key] = String(raw);
    }
  }
  return out;
}

function validateLookupValue(label, raw, options, multi = false) {
  return validateChoiceValue(label, raw, options, multi);
}

export function validateImportLookupValue(label, raw, options, multi = false) {
  assertChoiceValue(label, raw, options, multi);
}

export { validateLookupValue };

