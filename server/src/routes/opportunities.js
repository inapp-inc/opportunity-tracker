import express from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import { nowIso } from '../utils/time.js';
import { csvEscape } from '../utils/csv.js';
import {
  mapOpportunityRow,
  mapOpportunityRows,
  createOpportunityRecord,
  normalizeOwnerIds,
  syncRecordOwners,
  formatDeliverables,
  validateOpportunityPartial,
  validateOpportunityRowForPublish,
  recordOpportunityFieldChanges,
  logActivity,
  mapActivityRow,
  mapArtifactRow,
} from '../services/opportunityService.js';
import { normalizeCustomFields } from '../services/schemaService.js';
import { resolveArtifactTypeInput } from '../services/lookupService.js';
import {
  recordImportHeaders,
  buildRecordImportWorkbook,
  rowsFromImportWorkbook,
  recordImportRowToPayload,
} from '../services/importExportService.js';

export function createOpportunitiesRouter({ analyticsApi }) {
  const router = express.Router();

router.get('/opportunities', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  let ownerId = req.query.ownerId ? String(req.query.ownerId) : '';
  if (req.query.mine === '1' || req.query.mine === 'true') {
    const sub = req.user?.sub ? String(req.user.sub) : '';
    if (sub) ownerId = sub;
  }
  const archivedMode = req.query.archived ? String(req.query.archived) : 'exclude';
  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : 0;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 0;
  const pageRaw = req.query.page !== undefined ? Number(req.query.page) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const sortBy = String(req.query.sortBy || 'dueDate');
  const sortDir = String(req.query.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const { where, params } = analyticsApi.buildRecordFilterWhere(tenantId, {
    archived: archivedMode,
    draft: req.query.draft,
    status: req.query.status,
    dealStage: req.query.dealStage,
    winOrLoss: req.query.winOrLoss,
    prospectType: req.query.prospectType,
    engagementType: req.query.engagementType,
    dueDateFrom: req.query.fromDueDate,
    dueDateTo: req.query.toDueDate,
    ownerId,
    q: req.query.q,
    customField: req.query.customField,
    customValue: req.query.customValue,
  });

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM opportunities ${where}`)
    .get(...params).c;
  const sortColumns = {
    dueDate: 'due_date',
    prospect: 'prospect',
    status: 'status',
    value: 'value',
    updatedAt: 'updated_at',
    createdAt: 'created_at',
  };
  let sql = `SELECT * FROM opportunities ${where} ORDER BY ${sortColumns[sortBy] || 'due_date'} ${sortDir}`;
  if (limit) {
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);
  }
  const rows = db.prepare(sql).all(...params);
  const items = mapOpportunityRows(rows, tenantId);
  res.json({ items, total, page, pageSize: limit || items.length });
});

router.get('/prospect-groups', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const q = String(req.query?.q || '').trim();
  const params = [tenantId];
  let sql = `SELECT
    prospect AS name,
    (SELECT opportunity_description
     FROM opportunities o2
     WHERE o2.prospect = o.prospect AND o2.tenant_id = o.tenant_id
       AND COALESCE(o2.archived, 0) = 0 AND COALESCE(o2.is_draft, 0) = 0
     ORDER BY o2.created_at ASC LIMIT 1) AS description,
    COUNT(*) AS deliverable_count,
    COALESCE(SUM(value), 0) AS total_value,
    MIN(currency) AS currency,
    (SELECT deal_stage
     FROM opportunities o3
     WHERE o3.prospect = o.prospect AND o3.tenant_id = o.tenant_id
       AND COALESCE(o3.archived, 0) = 0 AND COALESCE(o3.is_draft, 0) = 0
     ORDER BY o3.updated_at DESC LIMIT 1) AS deal_stage,
    CASE
      WHEN SUM(CASE WHEN win_or_loss = 'Win' THEN 1 ELSE 0 END) > 0 THEN 'Win'
      WHEN COUNT(*) = SUM(CASE WHEN win_or_loss = 'Loss' THEN 1 ELSE 0 END) THEN 'Loss'
      ELSE 'Open'
    END AS win_or_loss,
    MAX(updated_at) AS last_updated
  FROM opportunities o
  WHERE tenant_id = ?
    AND COALESCE(archived, 0) = 0
    AND COALESCE(is_draft, 0) = 0`;
  if (q) {
    sql += ` AND lower(prospect) LIKE ?`;
    params.push(`%${q.toLowerCase()}%`);
  }
  sql += ` GROUP BY prospect, tenant_id ORDER BY MAX(updated_at) DESC`;
  const rows = db.prepare(sql).all(...params);
  res.json({
    items: rows.map((row) => ({
      name: row.name,
      description: row.description || '',
      deliverableCount: row.deliverable_count,
      totalValue: row.total_value,
      currency: row.currency || 'USD',
      dealStage: row.deal_stage || 'Discovery',
      winOrLoss: row.win_or_loss || 'Open',
      lastUpdated: row.last_updated,
    })),
  });
});

router.get(
  '/prospect-groups/:prospect/records',
  requireTenantPermission(PERMISSIONS.RECORDS_READ),
  (req, res) => {
    const tenantId = tenantIdFromReq(req);
    const prospect = decodeURIComponent(req.params.prospect);
    const rows = db
      .prepare(
        `SELECT * FROM opportunities
         WHERE tenant_id = ?
           AND prospect = ?
           AND COALESCE(archived, 0) = 0
           AND COALESCE(is_draft, 0) = 0
         ORDER BY updated_at DESC`
      )
      .all(tenantId, prospect);
    res.json({ items: mapOpportunityRows(rows, tenantId) });
  }
);

router.get('/opportunities/template.csv', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const headers = recordImportHeaders(tenantId);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="records-template.csv"');
  res.send(`${headers.map(csvEscape).join(',')}\n`);
});

router.get('/opportunities/template.xlsx', requireTenantPermission(PERMISSIONS.RECORDS_READ), async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  try {
    const buffer = await buildRecordImportWorkbook(tenantId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="records-template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : 'Template generation failed' });
  }
});

router.post(
  '/opportunities/import',
  requireTenantPermission(PERMISSIONS.RECORDS_CREATE),
  express.raw({
    type: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
    ],
    limit: '10mb',
  }),
  async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  let rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (Buffer.isBuffer(req.body)) {
    try {
      rows = await rowsFromImportWorkbook(req.body, tenantId);
    } catch (e) {
      return res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid XLSX file' });
    }
  }
  if (!rows.length) return res.status(400).json({ message: 'rows required' });
  if (rows.length > 1000) return res.status(400).json({ message: 'Maximum import is 1000 rows' });

  const results = {
    created: 0,
    errors: [],
    items: [],
  };

  rows.forEach((rawRow, index) => {
    try {
      const payload = recordImportRowToPayload(rawRow, tenantId);
      const created = createOpportunityRecord(payload, tenantId, req);
      results.created += 1;
      results.items.push(mapOpportunityRow(created));
    } catch (e) {
      results.errors.push({
        row: index + 2,
        message: e instanceof Error ? e.message : 'Invalid row',
      });
    }
  });
  res.status(results.created ? 201 : 200).json(results);
});

router.get('/opportunities/artifact-links', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const q = String(req.query?.q || '').trim().toLowerCase();
  const params = [tenantId];
  let where = 'WHERE a.tenant_id = ?';
  if (q) {
    where += ` AND (
      lower(coalesce(a.title, '')) LIKE ? OR
      lower(a.url) LIKE ? OR
      lower(a.artifact_type) LIKE ? OR
      lower(o.prospect) LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const rows = db
    .prepare(
      `SELECT a.*, o.prospect AS opportunity_prospect, o.archived AS opportunity_archived
       FROM artifact_links a
       JOIN opportunities o ON o.id = a.opportunity_id AND o.tenant_id = a.tenant_id
       ${where}
       ORDER BY a.created_at DESC`
    )
    .all(...params);
  res.json({
    items: rows.map((row) => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      opportunityProspect: row.opportunity_prospect,
      opportunityArchived: Boolean(row.opportunity_archived),
      type: row.artifact_type,
      artifactType: row.artifact_type,
      url: row.url,
      title: row.title,
      addedBy: row.created_by,
      addedOn: row.created_at,
      createdAt: row.created_at,
    })),
  });
});

router.get('/opportunities/:id', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const row = db
    .prepare('SELECT * FROM opportunities WHERE id = ? AND tenant_id = ?')
    .get(req.params.id, tenantId);
  if (!row) return res.status(404).json({ message: 'Not found' });
  res.json(mapOpportunityRow(row));
});

router.post('/opportunities', requireTenantPermission(PERMISSIONS.RECORDS_CREATE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const body = req.body || {};
  try {
    const saved = createOpportunityRecord(body, tenantId, req);
    res.status(201).json(mapOpportunityRow(saved));
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : 'invalid record' });
  }
});

router.patch('/opportunities/:id', requireTenantPermission(PERMISSIONS.RECORDS_UPDATE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const id = req.params.id;
  const existing = db
    .prepare('SELECT * FROM opportunities WHERE id = ? AND tenant_id = ?')
    .get(id, tenantId);
  if (!existing) return res.status(404).json({ message: 'Not found' });

  const body = req.body || {};
  const clientVersion = body.version;
  if (clientVersion === undefined || clientVersion === null) {
    return res.status(400).json({ message: 'version is required for update' });
  }
  if (Number(clientVersion) !== Number(existing.version)) {
    return res.status(409).json({ message: 'Version conflict' });
  }

  const next = { ...existing };
  if (body.prospect !== undefined) next.prospect = String(body.prospect);
  if (body.opportunityDescription !== undefined)
    next.opportunity_description = String(body.opportunityDescription);
  if (body.ownerIds !== undefined)
    next.owner_json = JSON.stringify(normalizeOwnerIds(body.ownerIds, tenantId));
  if (body.deliverables !== undefined)
    next.deliverables = formatDeliverables(body.deliverables);
  if (body.dueDate !== undefined) next.due_date = String(body.dueDate);
  if (body.status !== undefined) next.status = String(body.status);
  if (body.notes !== undefined) next.notes = String(body.notes);
  if (body.winOrLoss !== undefined) next.win_or_loss = String(body.winOrLoss);
  if (body.firstPresalesCall !== undefined)
    next.first_presales_call = body.firstPresalesCall || null;
  if (body.closedDate !== undefined) next.closed_date = body.closedDate || null;
  if (body.prospectType !== undefined)
    next.prospect_type = String(body.prospectType);
  if (body.engagementType !== undefined)
    next.engagement_type = String(body.engagementType);
  if (body.value !== undefined) next.value = Number(body.value);
  if (body.currency !== undefined) next.currency = String(body.currency);
  if (body.archived !== undefined) next.archived = body.archived ? 1 : 0;
  if (body.dealStage !== undefined) next.deal_stage = String(body.dealStage);
  if (body.isDraft !== undefined) next.is_draft = body.isDraft ? 1 : 0;
  if (body.customFields !== undefined) {
    try {
      next.custom_data_json = JSON.stringify(
        normalizeCustomFields(body.customFields, tenantId)
      );
    } catch (e) {
      return res.status(400).json({ message: e instanceof Error ? e.message : 'invalid customFields' });
    }
  }
  // If client doesn't send isDraft, keep current flag.
  if (next.is_draft === undefined || next.is_draft === null) {
    next.is_draft = existing.is_draft || 0;
  }

  const verr = validateOpportunityPartial(next);
  if (verr) return res.status(400).json({ message: verr });
  // If leaving draft mode, enforce full required-field validation.
  if (Number(existing.is_draft || 0) === 1 && Number(next.is_draft || 0) === 0) {
    const publishErr = validateOpportunityRowForPublish(next, tenantId);
    if (publishErr) return res.status(400).json({ message: publishErr });
  }

  next.version = Number(existing.version) + 1;
  next.updated_at = nowIso();

  const r = db
    .prepare(
      `UPDATE opportunities SET
        prospect=@prospect,
        opportunity_description=@opportunity_description,
        owner_json=@owner_json,
        deliverables=@deliverables,
        due_date=@due_date,
        status=@status,
        notes=@notes,
        win_or_loss=@win_or_loss,
        first_presales_call=@first_presales_call,
        closed_date=@closed_date,
        prospect_type=@prospect_type,
        engagement_type=@engagement_type,
        value=@value,
        currency=@currency,
        deal_stage=@deal_stage,
        custom_data_json=@custom_data_json,
        is_draft=@is_draft,
        archived=@archived,
        version=@version,
        updated_at=@updated_at
      WHERE id=@id AND tenant_id=@tenant_id AND version=@prevVersion`
    )
    .run({
      ...next,
      archived: Number(next.archived || 0),
      is_draft: Number(next.is_draft || 0),
      prevVersion: Number(existing.version),
    });

  if (r.changes === 0) {
    return res.status(409).json({ message: 'Version conflict' });
  }
  syncRecordOwners(id, tenantId, JSON.parse(next.owner_json || '[]'));
  const saved = db
    .prepare('SELECT * FROM opportunities WHERE id = ? AND tenant_id = ?')
    .get(id, tenantId);
  recordOpportunityFieldChanges(existing, saved, req);
  res.json(mapOpportunityRow(saved));
});

router.delete('/opportunities/:id', requireTenantPermission(PERMISSIONS.RECORDS_DELETE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const id = req.params.id;
  const r = db
    .prepare('DELETE FROM opportunities WHERE id = ? AND tenant_id = ?')
    .run(id, tenantId);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

router.get('/artifact-links', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const q = String(req.query?.q || '').trim().toLowerCase();
  const params = [tenantId];
  let where = 'WHERE a.tenant_id = ?';
  if (q) {
    where += ` AND (
      lower(coalesce(a.title, '')) LIKE ? OR
      lower(a.url) LIKE ? OR
      lower(a.artifact_type) LIKE ? OR
      lower(o.prospect) LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const rows = db
    .prepare(
      `SELECT a.*, o.prospect AS opportunity_prospect, o.archived AS opportunity_archived
       FROM artifact_links a
       JOIN opportunities o ON o.id = a.opportunity_id AND o.tenant_id = a.tenant_id
       ${where}
       ORDER BY a.created_at DESC`
    )
    .all(...params);
  res.json({
    items: rows.map((row) => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      opportunityProspect: row.opportunity_prospect,
      opportunityArchived: Boolean(row.opportunity_archived),
      type: row.artifact_type,
      artifactType: row.artifact_type,
      url: row.url,
      title: row.title,
      addedBy: row.created_by,
      addedOn: row.created_at,
      createdAt: row.created_at,
    })),
  });
});

router.get('/opportunities/:id/artifact-links', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const oppId = req.params.id;
  const exists = db
    .prepare('SELECT id FROM opportunities WHERE id = ? AND tenant_id = ?')
    .get(oppId, tenantId);
  if (!exists) return res.status(404).json({ message: 'Not found' });
  const rows = db
    .prepare(
      'SELECT * FROM artifact_links WHERE opportunity_id = ? AND tenant_id = ? ORDER BY created_at DESC'
    )
    .all(oppId, tenantId);
  res.json({
    items: rows.map((row) => mapArtifactRow(row, tenantId)),
  });
});

router.post('/opportunities/:id/artifact-links', requireTenantPermission(PERMISSIONS.RECORDS_ARTIFACTS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const oppId = req.params.id;
  const exists = db
    .prepare('SELECT id FROM opportunities WHERE id = ? AND tenant_id = ?')
    .get(oppId, tenantId);
  if (!exists) return res.status(404).json({ message: 'Not found' });

  const { artifactType, url, title } = req.body || {};
  const resolvedType = resolveArtifactTypeInput(tenantId, artifactType);
  if (!resolvedType.ok) {
    return res.status(400).json({ message: resolvedType.message });
  }
  const u = String(url || '').trim();
  if (!u) return res.status(400).json({ message: 'URL required' });
  try {
    // eslint-disable-next-line no-new
    new URL(u);
  } catch {
    return res.status(400).json({ message: 'Invalid URL' });
  }

  const id = randomUUID();
  const now = nowIso();
  const displayType = resolvedType.label;
  db.prepare(
    `INSERT INTO artifact_links (id, tenant_id, opportunity_id, artifact_type, url, title, created_by, created_at)
     VALUES (@id, @tenant_id, @opportunity_id, @artifact_type, @url, @title, @created_by, @created_at)`
  ).run({
    id,
    tenant_id: tenantId,
    opportunity_id: oppId,
    artifact_type: displayType,
    url: u,
    title: title ? String(title) : null,
    created_by: String(req.user?.email || 'user'),
    created_at: now,
  });
  const row = db
    .prepare('SELECT * FROM artifact_links WHERE id = ? AND tenant_id = ?')
    .get(id, tenantId);
  res.status(201).json(mapArtifactRow(row, tenantId));
});

router.delete('/opportunities/:opportunityId/artifact-links/:linkId', requireTenantPermission(PERMISSIONS.RECORDS_ARTIFACTS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const r = db
    .prepare(
      'DELETE FROM artifact_links WHERE id = ? AND opportunity_id = ? AND tenant_id = ?'
    )
    .run(req.params.linkId, req.params.opportunityId, tenantId);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

router.patch('/opportunities/:opportunityId/artifact-links/:linkId', requireTenantPermission(PERMISSIONS.RECORDS_ARTIFACTS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const existing = db
    .prepare('SELECT * FROM artifact_links WHERE id = ? AND opportunity_id = ? AND tenant_id = ?')
    .get(req.params.linkId, req.params.opportunityId, tenantId);
  if (!existing) return res.status(404).json({ message: 'Not found' });

  const { artifactType, url, title } = req.body || {};
  const resolvedType = resolveArtifactTypeInput(tenantId, artifactType);
  if (!resolvedType.ok) {
    return res.status(400).json({ message: resolvedType.message });
  }
  const u = String(url || '').trim();
  if (!u) return res.status(400).json({ message: 'URL required' });
  try {
    // eslint-disable-next-line no-new
    new URL(u);
  } catch {
    return res.status(400).json({ message: 'Invalid URL' });
  }

  const displayType = resolvedType.label;
  db.prepare(
    `UPDATE artifact_links
     SET artifact_type = ?, url = ?, title = ?
     WHERE id = ? AND opportunity_id = ? AND tenant_id = ?`
  ).run(
    displayType,
    u,
    title ? String(title) : null,
    req.params.linkId,
    req.params.opportunityId,
    tenantId
  );

  const row = db
    .prepare('SELECT * FROM artifact_links WHERE id = ? AND tenant_id = ?')
    .get(req.params.linkId, tenantId);
  res.json(mapArtifactRow(row, tenantId));
});

router.get('/opportunities/:id/activities', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const oppId = req.params.id;
  const exists = db
    .prepare('SELECT id FROM opportunities WHERE id = ? AND tenant_id = ?')
    .get(oppId, tenantId);
  if (!exists) return res.status(404).json({ message: 'Not found' });
  const rows = db
    .prepare(
      `SELECT * FROM opportunity_activities WHERE opportunity_id = ? AND tenant_id = ? ORDER BY created_at DESC`
    )
    .all(oppId, tenantId);
  res.json({ items: rows.map(mapActivityRow) });
});

router.post('/opportunities/:id/activities', requireTenantPermission(PERMISSIONS.RECORDS_COMMENTS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const oppId = req.params.id;
  const exists = db
    .prepare('SELECT id FROM opportunities WHERE id = ? AND tenant_id = ?')
    .get(oppId, tenantId);
  if (!exists) return res.status(404).json({ message: 'Not found' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ message: 'body required' });
  const row = logActivity({
    opportunityId: oppId,
    req,
    kind: 'COMMENT',
    body,
  });
  res.status(201).json(mapActivityRow(row));
});
  return router;
}

