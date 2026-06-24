import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { getConfigValue, setConfigValue } from './configStorage.js';

export const PROTECTED_LOOKUP_CATEGORIES = new Set([
  'DEAL_STAGE',
  'DELIVERABLES',
  'ENGAGEMENT_TYPE',
  'PROSPECT_TYPE',
  'WIN_LOSS',
  'ARTIFACT_TYPE',
  'CURRENCY',
]);

export function getDealStageValues(tenantId = DEFAULT_TENANT_ID) {
  const rows = db
    .prepare(
      `SELECT value FROM lookup_entries WHERE tenant_id = ? AND category = 'DEAL_STAGE' ORDER BY sort_order, value`
    )
    .all(tenantId);
  if (rows.length) return rows.map((r) => r.value);
  return [
    'Discovery',
    'Qualification',
    'Solutioning',
    'Proposal',
    'Negotiation',
    'Closed',
  ];
}

export function lookupCategoryKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function lookupCategoryLabel(category) {
  return String(category || '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function defaultLookupCategories() {
  return [
    'DEAL_STAGE',
    'DELIVERABLES',
    'ENGAGEMENT_TYPE',
    'PROSPECT_TYPE',
    'WIN_LOSS',
    'ARTIFACT_TYPE',
    'CURRENCY',
  ].map((category) => ({
    category,
    label: lookupCategoryLabel(category),
  }));
}

export function ensureLookupEntriesForTenant(tenantId, category, defaults) {
  const count = db
    .prepare(
      `SELECT COUNT(*) AS c FROM lookup_entries WHERE tenant_id = ? AND category = ?`
    )
    .get(tenantId, category).c;
  if (count > 0) return;
  const ins = db.prepare(
    `INSERT INTO lookup_entries (id, tenant_id, category, value, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  for (const [val, ord] of defaults) {
    ins.run(randomUUID(), tenantId, category, val, ord);
  }
}

export function ensureStandardLookupCategories(tenantId) {
  const categories = getLookupCategoryConfigs(tenantId);
  const merged = new Map(categories.map((item) => [item.category, item]));
  for (const category of ['ARTIFACT_TYPE', 'CURRENCY', 'WIN_LOSS']) {
    if (!merged.has(category)) {
      merged.set(category, {
        category,
        label: lookupCategoryLabel(category),
      });
    }
  }
  setConfigValue(tenantId, 'lookup_categories', [...merged.values()]);
  ensureLookupEntriesForTenant(tenantId, 'ARTIFACT_TYPE', [
    ['Proposal', 0],
    ['SOW', 1],
    ['Presentation Deck', 2],
  ]);
  ensureLookupEntriesForTenant(tenantId, 'CURRENCY', [
    ['USD', 0],
    ['EUR', 1],
    ['GBP', 2],
    ['CAD', 3],
  ]);
  ensureLookupEntriesForTenant(tenantId, 'WIN_LOSS', [
    ['Open', 0],
    ['Win', 1],
    ['Loss', 2],
  ]);
}

export function getArtifactTypeEntries(tenantId) {
  ensureStandardLookupCategories(tenantId);
  return db
    .prepare(
      `SELECT value FROM lookup_entries WHERE tenant_id = ? AND category = 'ARTIFACT_TYPE' ORDER BY sort_order, value`
    )
    .all(tenantId);
}

export function artifactLabelToCode(label) {
  const known = {
    Proposal: 'PROPOSAL',
    SOW: 'SOW',
    'Presentation Deck': 'PRESENTATION_DECK',
  };
  if (known[label]) return known[label];
  return lookupCategoryKey(label);
}

export function artifactCodeToLabel(code, tenantId) {
  const entries = getArtifactTypeEntries(tenantId);
  for (const row of entries) {
    if (artifactLabelToCode(row.value) === String(code).toUpperCase()) {
      return row.value;
    }
  }
  switch (String(code).toUpperCase()) {
    case 'PROPOSAL':
      return 'Proposal';
    case 'SOW':
      return 'SOW';
    case 'PRESENTATION_DECK':
      return 'Presentation Deck';
    default:
      return String(code || '');
  }
}

export function resolveArtifactTypeInput(tenantId, input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, message: 'artifact type required' };
  const entries = getArtifactTypeEntries(tenantId);
  for (const row of entries) {
    const label = row.value;
    const code = artifactLabelToCode(label);
    if (
      raw.toLowerCase() === label.toLowerCase() ||
      raw.toUpperCase() === code.toUpperCase()
    ) {
      return { ok: true, label, code };
    }
  }
  return { ok: false, message: 'Invalid artifact type' };
}

export function getLookupCategoryConfigs(tenantId) {
  const saved = getConfigValue(tenantId, 'lookup_categories', []);
  const normalized = Array.isArray(saved)
    ? saved
        .map((item) => {
          const category = lookupCategoryKey(item?.category || item?.label || item);
          return category ? { category, label: String(item?.label || lookupCategoryLabel(category)) } : null;
        })
        .filter(Boolean)
    : [];
  const merged = new Map();
  for (const item of [...defaultLookupCategories(), ...normalized]) {
    merged.set(item.category, item);
  }
  return [...merged.values()];
}

export function getLookupsPayload(tenantId = DEFAULT_TENANT_ID) {
  const rows = db
    .prepare(
      `SELECT id, category, value, sort_order FROM lookup_entries WHERE tenant_id = ? ORDER BY category, sort_order, value`
    )
    .all(tenantId);
  const byCategory = new Map();
  for (const r of rows) {
    const entry = { id: r.id, value: r.value, sortOrder: r.sort_order };
    if (!byCategory.has(r.category)) {
      byCategory.set(r.category, {
        category: r.category,
        label: lookupCategoryLabel(r.category),
        items: [],
      });
    }
    byCategory.get(r.category).items.push(entry);
  }
  for (const item of getLookupCategoryConfigs(tenantId)) {
    if (!byCategory.has(item.category)) {
      byCategory.set(item.category, { ...item, items: [] });
    }
  }
  const categories = [...byCategory.values()].sort((a, b) => a.label.localeCompare(b.label));
  const get = (category) => byCategory.get(category)?.items || [];
  return {
    categories,
    deliverables: get('DELIVERABLES'),
    prospectTypes: get('PROSPECT_TYPE'),
    engagementTypes: get('ENGAGEMENT_TYPE'),
    dealStages: get('DEAL_STAGE'),
    winLoss: get('WIN_LOSS'),
    artifactTypes: get('ARTIFACT_TYPE'),
    currencies: get('CURRENCY'),
  };
}

