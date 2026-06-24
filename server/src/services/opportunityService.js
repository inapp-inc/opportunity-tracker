import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { nowIso } from '../utils/time.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import { getDealStageValues, artifactLabelToCode } from './lookupService.js';
import {
  getRecordSchemaDefinitions,
  normalizeCustomFields,
  validateRecordSchemaChoiceFields,
  validateRecordSchemaRequiredForPublish,
  isRecordSchemaFieldActive,
} from './schemaService.js';
import {
  getActiveUsersMap,
  normalizeOwnerIds,
  syncRecordOwners,
  resolveOwnersFromJson,
  ownerDisplayNames,
} from './ownerService.js';

export function defaultDealStage(tenantId = DEFAULT_TENANT_ID) {
  const stages = getDealStageValues(tenantId);
  return stages[0] || 'Discovery';
}

export function logActivity({ opportunityId, req, kind, body, meta }) {
  const id = randomUUID();
  const now = nowIso();
  const tenantId = tenantIdFromReq(req);
  db.prepare(
    `INSERT INTO opportunity_activities (id, tenant_id, opportunity_id, kind, actor_id, actor_email, body, meta_json, created_at)
     VALUES (@id, @tenant_id, @opportunity_id, @kind, @actor_id, @actor_email, @body, @meta_json, @created_at)`
  ).run({
    id,
    tenant_id: tenantId,
    opportunity_id: opportunityId,
    kind,
    actor_id: req.user?.sub ? String(req.user.sub) : null,
    actor_email: String(req.user?.email || 'system'),
    body: body || null,
    meta_json: meta ? JSON.stringify(meta) : null,
    created_at: now,
  });
  return db
    .prepare('SELECT * FROM opportunity_activities WHERE id = ? AND tenant_id = ?')
    .get(id, tenantId);
}

export function mapActivityRow(r) {
  let meta = null;
  if (r.meta_json) {
    try {
      meta = JSON.parse(r.meta_json);
    } catch {
      meta = null;
    }
  }
  return {
    id: r.id,
    kind: r.kind,
    actorId: r.actor_id || undefined,
    actorEmail: r.actor_email,
    body: r.body || '',
    meta,
    createdAt: r.created_at,
  };
}

export function recordOpportunityFieldChanges(before, after, req) {
  const fields = [
    ['status', 'status', 'Status'],
    ['deal_stage', 'deal_stage', 'Deal stage'],
    ['due_date', 'due_date', 'Due date'],
    ['win_or_loss', 'win_or_loss', 'Win/Loss'],
    ['archived', 'archived', 'Archived'],
    ['prospect', 'prospect', 'Prospect'],
    ['value', 'value', 'Value'],
  ];
  for (const [col, , label] of fields) {
    const a = before[col];
    const b = after[col];
    if (String(a) !== String(b)) {
      logActivity({
        opportunityId: after.id,
        req,
        kind: col === 'archived' ? (Number(b) ? 'ARCHIVED' : 'RESTORED') : 'UPDATED',
        body: `${label} changed from "${a}" to "${b}"`,
        meta: { field: col, from: a, to: b },
      });
    }
  }
  if (before.owner_json !== after.owner_json) {
    const fromNames = ownerDisplayNames(before.owner_json, after.tenant_id).join(', ');
    const toNames = ownerDisplayNames(after.owner_json, after.tenant_id).join(', ');
    logActivity({
      opportunityId: after.id,
      req,
      kind: 'UPDATED',
      body: `Owners changed from "${fromNames}" to "${toNames}"`,
      meta: { field: 'owner_json' },
    });
  }
}

export function normalizeOwners(ownerIds, tenantId = DEFAULT_TENANT_ID) {
  return normalizeOwnerIds(ownerIds, tenantId);
}

export function formatDeliverables(d) {
  if (d === undefined || d === null) return '';
  if (Array.isArray(d)) return d.map(String).join(', ');
  return String(d);
}

export function mapOpportunityRow(r, usersMap) {
  const { ownerIds, owners } = resolveOwnersFromJson(r.owner_json, r.tenant_id, usersMap);
  const deliverables = String(r.deliverables || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let customFields = {};
  try {
    customFields = JSON.parse(r.custom_data_json || '{}');
  } catch {
    customFields = {};
  }

  return {
    id: r.id,
    tenantId: r.tenant_id || DEFAULT_TENANT_ID,
    prospect: r.prospect,
    opportunityDescription: r.opportunity_description,
    ownerIds,
    owners,
    deliverables: deliverables.length ? deliverables : [String(r.deliverables || '')].filter(Boolean),
    dueDate: r.due_date,
    status: r.status,
    notes: r.notes,
    winOrLoss: r.win_or_loss,
    firstPresalesCall: r.first_presales_call,
    closedDate: r.closed_date,
    prospectType: r.prospect_type,
    engagementType: r.engagement_type,
    value: r.value,
    currency: r.currency,
    dealStage: r.deal_stage || defaultDealStage(r.tenant_id || DEFAULT_TENANT_ID),
    customFields,
    version: r.version,
    archived: !!Number(r.archived),
    isDraft: !!Number(r.is_draft),
  };
}

export function mapOpportunityRows(rows, tenantId = DEFAULT_TENANT_ID) {
  const userMap = getActiveUsersMap(tenantId);
  return rows.map((row) => mapOpportunityRow(row, userMap));
}

export function validateOpportunityRowForPublish(row, tenantId = DEFAULT_TENANT_ID) {
  const requiredErr = validateRecordSchemaRequiredForPublish(tenantId, row, true);
  if (requiredErr) return requiredErr;
  const choiceErr = validateRecordSchemaChoiceFields(tenantId, row, true);
  if (choiceErr) return choiceErr;
  if (row.value !== undefined && !Number.isFinite(Number(row.value))) return 'value must be a number';
  if (row.value !== undefined && Number(row.value) < 0) return 'value must be >= 0';
  return '';
}

export function createOpportunityRecord(body, tenantId = DEFAULT_TENANT_ID, req) {
  const isDraft = Boolean(body.isDraft);
  if (!isDraft) {
    const err = validateOpportunityCreate(body, tenantId);
    if (err) throw new Error(err);
  }

  let customFields = {};
  try {
    customFields = normalizeCustomFields(body.customFields, tenantId);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'invalid customFields');
  }

  const id = randomUUID();
  const now = nowIso();
  const ownerJson = JSON.stringify(isDraft ? (body.ownerIds || []) : normalizeOwnerIds(body.ownerIds, tenantId));
  const row = {
    id,
    tenant_id: tenantId,
    prospect: String(body.prospect || ''),
    opportunity_description: String(body.opportunityDescription || ''),
    owner_json: ownerJson,
    deliverables: formatDeliverables(body.deliverables),
    due_date: String(body.dueDate || ''),
    status: String(body.status || 'Not Started'),
    notes: String(body.notes || ''),
    win_or_loss: String(body.winOrLoss || 'Open'),
    first_presales_call: body.firstPresalesCall || null,
    closed_date: body.closedDate || null,
    prospect_type: String(body.prospectType || ''),
    engagement_type: String(body.engagementType || ''),
    value: Number(body.value || 0),
    currency: String(body.currency || 'USD'),
    deal_stage: String(body.dealStage || defaultDealStage(tenantId)),
    custom_data_json: JSON.stringify(customFields),
    is_draft: isDraft ? 1 : 0,
    version: 1,
    archived: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO opportunities (
      id, tenant_id, prospect, opportunity_description, owner_json, deliverables, due_date, status, notes,
      win_or_loss, first_presales_call, closed_date, prospect_type, engagement_type,
      value, currency, deal_stage, custom_data_json, is_draft, version, archived, created_at, updated_at
    ) VALUES (
      @id, @tenant_id, @prospect, @opportunity_description, @owner_json, @deliverables, @due_date, @status, @notes,
      @win_or_loss, @first_presales_call, @closed_date, @prospect_type, @engagement_type,
      @value, @currency, @deal_stage, @custom_data_json, @is_draft, @version, @archived, @created_at, @updated_at
    )`
  ).run(row);
  syncRecordOwners(id, tenantId, JSON.parse(ownerJson));
  const saved = db
    .prepare('SELECT * FROM opportunities WHERE id = ? AND tenant_id = ?')
    .get(id, tenantId);
  if (req) {
    logActivity({
      opportunityId: id,
      req,
      kind: 'CREATED',
      body: `Created record for ${saved.prospect}`,
    });
  }
  return saved;
}

export function mapArtifactRow(r, tenantId = DEFAULT_TENANT_ID) {
  return {
    id: r.id,
    artifactType: artifactLabelToCode(r.artifact_type),
    type: r.artifact_type,
    url: r.url,
    title: r.title || undefined,
    addedBy: r.created_by,
    addedOn: r.created_at?.split?.('T')?.[0] || r.created_at,
  };
}

export function validateOpportunityCreate(body, tenantId = DEFAULT_TENANT_ID) {
  const requiredErr = validateRecordSchemaRequiredForPublish(tenantId, body, false);
  if (requiredErr) return requiredErr;
  const choiceErr = validateRecordSchemaChoiceFields(tenantId, body, false);
  if (choiceErr) return choiceErr;
  if (body.value !== undefined && !Number.isFinite(Number(body.value))) return 'value must be a number';
  if (body.value !== undefined && Number(body.value) < 0) return 'value must be >= 0';
  return '';
}

export function validateOpportunityPartial(r) {
  const tenantId = r.tenant_id || DEFAULT_TENANT_ID;
  const choiceErr = validateRecordSchemaChoiceFields(tenantId, r, true);
  if (choiceErr) return choiceErr;
  if (isRecordSchemaFieldActive(tenantId, 'ownerIds')) {
    try {
      const ids = JSON.parse(r.owner_json || '[]');
      if (
        Array.isArray(ids) &&
        ids.length &&
        !normalizeOwnerIds(ids, tenantId).length
      ) {
        return 'invalid ownerIds';
      }
    } catch {
      return 'invalid ownerIds';
    }
  }
  if (r.value !== undefined && r.value !== null && Number(r.value) < 0) {
    return 'value must be >= 0';
  }
  return '';
}

export {
  normalizeOwnerIds,
  syncRecordOwners,
  resolveOwnersFromJson,
  ownerDisplayNames,
  getActiveUsersMap,
} from './ownerService.js';
