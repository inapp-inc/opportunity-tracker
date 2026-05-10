import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db, migrate } from './db.js';
import { hashPassword, verifyPassword } from './auth-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const STATIC_AUTH_EMAIL =
  process.env.STATIC_AUTH_EMAIL || 'demo@example.com';
const STATIC_AUTH_PASSWORD =
  process.env.STATIC_AUTH_PASSWORD || 'password';

function requireRoles(...roles) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

/** Paths handled by the JSON API (require Bearer token except as noted). */
function isApiPath(p) {
  if (p === '/auth/me') return true;
  if (p.startsWith('/opportunities')) return true;
  if (p.startsWith('/notifications')) return true;
  if (p.startsWith('/reports')) return true;
  if (p.startsWith('/settings')) return true;
  if (p.startsWith('/users')) return true;
  if (p.startsWith('/export')) return true;
  return false;
}

migrate();
seedUsersIfEmpty();
seedLookupsIfEmpty();
seedDefaultAppConfigIfEmpty();
seedIfEmpty();

const app = express();
app.set('trust proxy', 1);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.status(200).type('text/plain').send('ok');
});

app.post('/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const remember = Boolean(req.body?.remember);
  const row = db
    .prepare(
      `SELECT id, email, password_hash, role, status FROM users WHERE lower(email) = ?`
    )
    .get(email);
  let authed = null;
  if (row && row.status === 'ACTIVE' && verifyPassword(password, row.password_hash)) {
    authed = row;
  }
  if (!authed && email === STATIC_AUTH_EMAIL.toLowerCase() && password === STATIC_AUTH_PASSWORD) {
    const fallback = db
      .prepare(`SELECT id, email, role, status FROM users WHERE lower(email) = ?`)
      .get(email);
    if (fallback && fallback.status === 'ACTIVE') authed = fallback;
  }
  if (!authed) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  const accessToken = jwt.sign(
    {
      sub: authed.id,
      email: authed.email,
      role: authed.role,
    },
    JWT_SECRET,
    { expiresIn: remember ? '30d' : '12h' }
  );
  res.json({ accessToken, expiresIn: remember ? '30d' : '12h' });
});

app.use(authMiddleware);

app.get('/auth/me', (req, res) => {
  const u = req.user || {};
  res.json({
    sub: String(u.sub || ''),
    email: String(u.email || ''),
    role: String(u.role || ''),
  });
});

app.get('/opportunities', (req, res) => {
  const ownerId = req.query.ownerId ? String(req.query.ownerId) : '';
  const status = req.query.status ? String(req.query.status) : '';
  const fromDue = req.query.fromDueDate ? String(req.query.fromDueDate) : '';
  const toDue = req.query.toDueDate ? String(req.query.toDueDate) : '';
  const q = req.query.q ? String(req.query.q).toLowerCase() : '';
  const archivedMode = req.query.archived ? String(req.query.archived) : 'exclude';

  let sql = 'SELECT * FROM opportunities WHERE 1=1';
  const params = [];
  if (archivedMode === 'exclude') {
    sql += ' AND COALESCE(archived,0) = 0';
  } else if (archivedMode === 'only') {
    sql += ' AND COALESCE(archived,0) = 1';
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (fromDue) {
    sql += ' AND due_date >= ?';
    params.push(fromDue);
  }
  if (toDue) {
    sql += ' AND due_date <= ?';
    params.push(toDue);
  }
  if (ownerId) {
    sql += ' AND owner_json LIKE ?';
    params.push(`%"${ownerId.replace(/"/g, '')}"%`);
  }
  sql += ' ORDER BY due_date ASC';
  const rows = db.prepare(sql).all(...params);
  let items = rows.map(mapOpportunityRow);
  if (q) {
    items = items.filter(
      (o) =>
        o.prospect.toLowerCase().includes(q) ||
        (o.opportunityDescription || '').toLowerCase().includes(q)
    );
  }
  res.json({ items });
});

app.get('/opportunities/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM opportunities WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ message: 'Not found' });
  res.json(mapOpportunityRow(row));
});

app.post('/opportunities', requireRoles('ADMIN', 'EDITOR'), (req, res) => {
  const body = req.body || {};
  const err = validateOpportunityCreate(body);
  if (err) return res.status(400).json({ message: err });

  const id = randomUUID();
  const now = nowIso();
  const ownerJson = JSON.stringify(normalizeOwners(body.ownerIds));
  const row = {
    id,
    prospect: String(body.prospect),
    opportunity_description: String(body.opportunityDescription || ''),
    owner_json: ownerJson,
    deliverables: formatDeliverables(body.deliverables),
    due_date: String(body.dueDate),
    status: String(body.status),
    notes: String(body.notes || ''),
    win_or_loss: String(body.winOrLoss || 'Open'),
    first_presales_call: body.firstPresalesCall || null,
    closed_date: body.closedDate || null,
    prospect_type: String(body.prospectType || ''),
    engagement_type: String(body.engagementType || ''),
    value: Number(body.value || 0),
    currency: String(body.currency || 'USD'),
    version: 1,
    archived: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO opportunities (
      id, prospect, opportunity_description, owner_json, deliverables, due_date, status, notes,
      win_or_loss, first_presales_call, closed_date, prospect_type, engagement_type,
      value, currency, version, archived, created_at, updated_at
    ) VALUES (
      @id, @prospect, @opportunity_description, @owner_json, @deliverables, @due_date, @status, @notes,
      @win_or_loss, @first_presales_call, @closed_date, @prospect_type, @engagement_type,
      @value, @currency, @version, @archived, @created_at, @updated_at
    )`
  ).run(row);
  res.status(201).json(mapOpportunityRow(row));
});

app.patch('/opportunities/:id', requireRoles('ADMIN', 'EDITOR'), (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
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
    next.owner_json = JSON.stringify(normalizeOwners(body.ownerIds));
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

  const verr = validateOpportunityPartial(next);
  if (verr) return res.status(400).json({ message: verr });

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
        archived=@archived,
        version=@version,
        updated_at=@updated_at
      WHERE id=@id AND version=@prevVersion`
    )
    .run({
      ...next,
      archived: Number(next.archived || 0),
      prevVersion: Number(existing.version),
    });

  if (r.changes === 0) {
    return res.status(409).json({ message: 'Version conflict' });
  }
  const saved = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  res.json(mapOpportunityRow(saved));
});

app.delete('/opportunities/:id', requireRoles('ADMIN'), (req, res) => {
  const id = req.params.id;
  const r = db.prepare('DELETE FROM opportunities WHERE id = ?').run(id);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

app.get('/opportunities/:id/artifact-links', (req, res) => {
  const oppId = req.params.id;
  const exists = db.prepare('SELECT id FROM opportunities WHERE id = ?').get(oppId);
  if (!exists) return res.status(404).json({ message: 'Not found' });
  const rows = db
    .prepare(
      'SELECT * FROM artifact_links WHERE opportunity_id = ? ORDER BY created_at DESC'
    )
    .all(oppId);
  res.json({
    items: rows.map(mapArtifactRow),
  });
});

app.post('/opportunities/:id/artifact-links', requireRoles('ADMIN', 'EDITOR'), (req, res) => {
  const oppId = req.params.id;
  const exists = db.prepare('SELECT id FROM opportunities WHERE id = ?').get(oppId);
  if (!exists) return res.status(404).json({ message: 'Not found' });

  const { artifactType, url, title } = req.body || {};
  const allowed = ['PROPOSAL', 'SOW', 'PRESENTATION_DECK'];
  if (!allowed.includes(String(artifactType))) {
    return res.status(400).json({ message: 'Invalid artifact type' });
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
  const displayType = artifactTypeToLabel(artifactType);
  db.prepare(
    `INSERT INTO artifact_links (id, opportunity_id, artifact_type, url, title, created_by, created_at)
     VALUES (@id, @opportunity_id, @artifact_type, @url, @title, @created_by, @created_at)`
  ).run({
    id,
    opportunity_id: oppId,
    artifact_type: displayType,
    url: u,
    title: title ? String(title) : null,
    created_by: String(req.user?.email || 'user'),
    created_at: now,
  });
  const row = db.prepare('SELECT * FROM artifact_links WHERE id = ?').get(id);
  res.status(201).json(mapArtifactRow(row));
});

app.delete('/opportunities/:opportunityId/artifact-links/:linkId', requireRoles('ADMIN', 'EDITOR'), (req, res) => {
  const r = db
    .prepare(
      'DELETE FROM artifact_links WHERE id = ? AND opportunity_id = ?'
    )
    .run(req.params.linkId, req.params.opportunityId);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

app.get('/notifications', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT n.*, o.prospect AS prospect
       FROM notifications n
       JOIN opportunities o ON o.id = n.opportunity_id
       ORDER BY n.created_at DESC`
    )
    .all();
  res.json({
    items: rows.map(mapNotificationRow),
  });
});

app.patch('/notifications/:id/read', (req, res) => {
  const r = db
    .prepare('UPDATE notifications SET is_read = 1 WHERE id = ?')
    .run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.json({ ok: true });
});

app.patch('/notifications/read-all', (_req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1').run();
  res.json({ ok: true });
});

app.get('/reports/pipeline-summary', (req, res) => {
  const fromDate = req.query.fromDate ? String(req.query.fromDate) : '';
  const toDate = req.query.toDate ? String(req.query.toDate) : '';
  const status = req.query.status ? String(req.query.status) : '';
  const owner = req.query.owner ? String(req.query.owner) : '';

  let where = ' WHERE COALESCE(archived,0) = 0 ';
  const params = [];
  if (fromDate) {
    where += ' AND due_date >= ? ';
    params.push(fromDate);
  }
  if (toDate) {
    where += ' AND due_date <= ? ';
    params.push(toDate);
  }
  if (status) {
    where += ' AND status = ? ';
    params.push(status);
  }
  if (owner) {
    where += ' AND owner_json LIKE ? ';
    params.push(`%"${owner.replace(/"/g, '')}"%`);
  }

  const statusRows = db
    .prepare(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(value),0) AS totalValue FROM opportunities ${where} GROUP BY status`
    )
    .all(...params);

  const allForOwners = db
    .prepare(`SELECT owner_json AS oj, value FROM opportunities ${where}`)
    .all(...params);

  const ownerMap = new Map();
  for (const row of allForOwners) {
    let names = [];
    try {
      names = JSON.parse(row.oj || '[]');
    } catch {
      names = [];
    }
    if (!names.length) names = ['Unassigned'];
    const share = Number(row.value || 0) / names.length;
    for (const n of names) {
      ownerMap.set(n, (ownerMap.get(n) || 0) + share);
    }
  }
  const countsByOwner = [];
  const ownerCounts = new Map();
  for (const row of allForOwners) {
    let names = [];
    try {
      names = JSON.parse(row.oj || '[]');
    } catch {
      names = [];
    }
    if (!names.length) names = ['Unassigned'];
    for (const n of names) {
      ownerCounts.set(n, (ownerCounts.get(n) || 0) + 1);
    }
  }
  for (const [ownerId, count] of ownerCounts.entries()) {
    countsByOwner.push({
      ownerId,
      count,
      totalValue: Math.round((ownerMap.get(ownerId) || 0) * 100) / 100,
    });
  }

  res.json({
    totalsByStatus: statusRows.map((r) => ({
      status: r.status,
      count: r.count,
      totalValue: r.totalValue,
    })),
    countsByOwner,
  });
});

app.get('/settings', (_req, res) => {
  res.json(getSettingsPayload());
});

app.patch('/settings', requireRoles('ADMIN'), (req, res) => {
  const body = req.body || {};
  const cur = getSettingsPayload();
  const merged = {
    ...cur.notifications,
    ...(body.notifications || {}),
  };
  const notifications = {
    dueSoonThreshold: String(merged.dueSoonThreshold ?? '3'),
    emailEnabled: false,
  };
  const reminderOffsets = Array.isArray(body.reminderOffsets)
    ? body.reminderOffsets.map(Number).filter((n) => !Number.isNaN(n))
    : inferReminderOffsets(String(notifications.dueSoonThreshold ?? '3'));

  db.prepare(
    `INSERT INTO app_config (key, value_json) VALUES (@key, @value_json)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run({
    key: 'notification_settings',
    value_json: JSON.stringify(notifications),
  });
  db.prepare(
    `INSERT INTO app_config (key, value_json) VALUES (@key, @value_json)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run({
    key: 'reminder_offsets',
    value_json: JSON.stringify(reminderOffsets),
  });
  res.json(getSettingsPayload());
});

app.get('/settings/lookups', (_req, res) => {
  res.json(getLookupsPayload());
});

app.post('/settings/lookups', requireRoles('ADMIN'), (req, res) => {
  const category = String(req.body?.category || '');
  const value = String(req.body?.value || '').trim();
  const allowed = ['DELIVERABLES', 'PROSPECT_TYPE', 'ENGAGEMENT_TYPE'];
  if (!allowed.includes(category)) {
    return res.status(400).json({ message: 'Invalid category' });
  }
  if (!value) return res.status(400).json({ message: 'value required' });
  const maxSort =
    db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m FROM lookup_entries WHERE category = ?`
      )
      .get(category).m + 1;
  const id = randomUUID();
  db.prepare(
    `INSERT INTO lookup_entries (id, category, value, sort_order) VALUES (?, ?, ?, ?)`
  ).run(id, category, value, maxSort);
  res.status(201).json({ id, category, value, sortOrder: maxSort });
});

app.delete('/settings/lookups/:id', requireRoles('ADMIN'), (req, res) => {
  const r = db.prepare('DELETE FROM lookup_entries WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

app.get('/users', requireRoles('ADMIN'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, email, name, role, status, created_at, updated_at FROM users ORDER BY email`
    )
    .all();
  res.json({
    items: rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    })),
  });
});

app.post('/users', requireRoles('ADMIN'), (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = String(req.body?.name || '').trim();
  const role = String(req.body?.role || 'VIEWER');
  if (!email || !password) {
    return res.status(400).json({ message: 'email and password required' });
  }
  if (!['ADMIN', 'EDITOR', 'VIEWER'].includes(role)) {
    return res.status(400).json({ message: 'invalid role' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (exists) return res.status(409).json({ message: 'Email already exists' });
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at)
     VALUES (@id, @email, @password_hash, @name, @role, 'ACTIVE', @created_at, @updated_at)`
  ).run({
    id,
    email,
    password_hash: hashPassword(password),
    name: name || email.split('@')[0],
    role,
    created_at: now,
    updated_at: now,
  });
  const row = db
    .prepare(`SELECT id, email, name, role, status, created_at, updated_at FROM users WHERE id = ?`)
    .get(id);
  res.status(201).json({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

app.patch('/users/:id', requireRoles('ADMIN'), (req, res) => {
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ message: 'Not found' });
  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : row.name;
  const role = body.role !== undefined ? String(body.role) : row.role;
  const status = body.status !== undefined ? String(body.status) : row.status;
  if (!['ADMIN', 'EDITOR', 'VIEWER'].includes(role)) {
    return res.status(400).json({ message: 'invalid role' });
  }
  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({ message: 'invalid status' });
  }
  let password_hash = row.password_hash;
  if (body.password && String(body.password).length > 0) {
    password_hash = hashPassword(String(body.password));
  }
  const now = nowIso();
  db.prepare(
    `UPDATE users SET name=@name, role=@role, status=@status, password_hash=@password_hash, updated_at=@updated_at
     WHERE id=@id`
  ).run({
    id,
    name,
    role,
    status,
    password_hash,
    updated_at: now,
  });
  const saved = db
    .prepare(`SELECT id, email, name, role, status, created_at, updated_at FROM users WHERE id = ?`)
    .get(id);
  res.json({
    id: saved.id,
    email: saved.email,
    name: saved.name,
    role: saved.role,
    status: saved.status,
    createdAt: saved.created_at,
    updatedAt: saved.updated_at,
  });
});

app.delete('/users/:id', requireRoles('ADMIN'), (req, res) => {
  const id = req.params.id;
  const me = req.user?.sub;
  if (id === me) {
    return res.status(400).json({ message: 'Cannot delete your own account' });
  }
  const admins = db
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'`)
    .get().c;
  const target = db.prepare('SELECT role, status FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ message: 'Not found' });
  if (target.role === 'ADMIN' && target.status === 'ACTIVE' && admins <= 1) {
    return res.status(400).json({ message: 'Cannot remove the last active admin' });
  }
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

app.get('/export/opportunities.csv', (req, res) => {
  const ownerId = req.query.ownerId ? String(req.query.ownerId) : '';
  const status = req.query.status ? String(req.query.status) : '';
  const fromDue = req.query.fromDueDate ? String(req.query.fromDueDate) : '';
  const toDue = req.query.toDueDate ? String(req.query.toDueDate) : '';
  const archivedMode = req.query.archived ? String(req.query.archived) : 'exclude';
  const q = req.query.q ? String(req.query.q).toLowerCase() : '';

  let sql = 'SELECT * FROM opportunities WHERE 1=1';
  const params = [];
  if (archivedMode === 'exclude') {
    sql += ' AND COALESCE(archived,0) = 0';
  } else if (archivedMode === 'only') {
    sql += ' AND COALESCE(archived,0) = 1';
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (fromDue) {
    sql += ' AND due_date >= ?';
    params.push(fromDue);
  }
  if (toDue) {
    sql += ' AND due_date <= ?';
    params.push(toDue);
  }
  if (ownerId) {
    sql += ' AND owner_json LIKE ?';
    params.push(`%"${ownerId.replace(/"/g, '')}"%`);
  }
  sql += ' ORDER BY due_date ASC';
  let rows = db.prepare(sql).all(...params);
  if (q) {
    rows = rows.filter((r) => {
      const o = mapOpportunityRow(r);
      return (
        o.prospect.toLowerCase().includes(q) ||
        (o.opportunityDescription || '').toLowerCase().includes(q)
      );
    });
  }
  const lines = [
    [
      'id',
      'prospect',
      'description',
      'owners',
      'deliverables',
      'due_date',
      'status',
      'win_or_loss',
      'value',
      'currency',
      'prospect_type',
      'engagement_type',
      'archived',
    ].join(','),
  ];
  for (const r of rows) {
    const o = mapOpportunityRow(r);
    lines.push(
      [
        csvEscape(o.id),
        csvEscape(o.prospect),
        csvEscape(o.opportunityDescription),
        csvEscape((o.ownerIds || []).join('; ')),
        csvEscape(Array.isArray(o.deliverables) ? o.deliverables.join('; ') : ''),
        csvEscape(o.dueDate),
        csvEscape(o.status),
        csvEscape(o.winOrLoss),
        String(o.value ?? ''),
        csvEscape(o.currency || 'USD'),
        csvEscape(o.prospectType),
        csvEscape(o.engagementType),
        r.archived ? '1' : '0',
      ].join(',')
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="opportunities.csv"');
  res.send(lines.join('\n'));
});

app.get('/export/reports/pipeline-summary.csv', (req, res) => {
  const fromDate = req.query.fromDate ? String(req.query.fromDate) : '';
  const toDate = req.query.toDate ? String(req.query.toDate) : '';
  const status = req.query.status ? String(req.query.status) : '';
  const owner = req.query.owner ? String(req.query.owner) : '';

  let where = ' WHERE COALESCE(archived,0) = 0 ';
  const params = [];
  if (fromDate) {
    where += ' AND due_date >= ? ';
    params.push(fromDate);
  }
  if (toDate) {
    where += ' AND due_date <= ? ';
    params.push(toDate);
  }
  if (status) {
    where += ' AND status = ? ';
    params.push(status);
  }
  if (owner) {
    where += ' AND owner_json LIKE ? ';
    params.push(`%"${owner.replace(/"/g, '')}"%`);
  }

  const statusRows = db
    .prepare(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(value),0) AS totalValue FROM opportunities ${where} GROUP BY status`
    )
    .all(...params);

  const allForOwners = db
    .prepare(`SELECT owner_json AS oj, value FROM opportunities ${where}`)
    .all(...params);

  const ownerCounts = new Map();
  const ownerMap = new Map();
  for (const row of allForOwners) {
    let names = [];
    try {
      names = JSON.parse(row.oj || '[]');
    } catch {
      names = [];
    }
    if (!names.length) names = ['Unassigned'];
    const share = Number(row.value || 0) / names.length;
    for (const n of names) {
      ownerCounts.set(n, (ownerCounts.get(n) || 0) + 1);
      ownerMap.set(n, (ownerMap.get(n) || 0) + share);
    }
  }

  const lines = ['section,key,count,totalValue'];
  for (const r of statusRows) {
    lines.push(['by_status', csvEscape(r.status), r.count, r.totalValue].join(','));
  }
  for (const [ownerId, count] of ownerCounts.entries()) {
    const tv = Math.round((ownerMap.get(ownerId) || 0) * 100) / 100;
    lines.push(['by_owner', csvEscape(ownerId), count, tv].join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="pipeline-summary.csv"'
  );
  res.send(lines.join('\n'));
});

const webDist = path.join(__dirname, '../../web/dist');
const serveStatic =
  fs.existsSync(webDist) &&
  (process.env.NODE_ENV === 'production' || process.env.SERVE_STATIC === '1');
if (serveStatic) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (isApiPath(req.path)) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on port ${PORT}${serveStatic ? ' (API + static SPA)' : ' (API only)'}`);
});

setInterval(runNotificationEvaluator, 60 * 1000);
runNotificationEvaluator();

function authMiddleware(req, res, next) {
  if (req.path === '/auth/login') return next();
  if (req.path === '/health') return next();
  if (req.method === 'GET' && !isApiPath(req.path)) return next();
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return res.status(401).json({ message: 'Unauthorized' });
  try {
    req.user = jwt.verify(m[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

function normalizeOwners(ownerIds) {
  if (!ownerIds) return [];
  if (Array.isArray(ownerIds))
    return ownerIds.map(String).filter(Boolean);
  return [String(ownerIds)].filter(Boolean);
}

function formatDeliverables(d) {
  if (d === undefined || d === null) return '';
  if (Array.isArray(d)) return d.map(String).join(', ');
  return String(d);
}

function mapOpportunityRow(r) {
  let ownerIds = [];
  try {
    ownerIds = JSON.parse(r.owner_json || '[]');
  } catch {
    ownerIds = [];
  }
  const deliverables = String(r.deliverables || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    id: r.id,
    prospect: r.prospect,
    opportunityDescription: r.opportunity_description,
    ownerIds,
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
    version: r.version,
    archived: !!Number(r.archived),
  };
}

function csvEscape(s) {
  const x = String(s ?? '');
  if (/[",\n\r]/.test(x)) return `"${x.replace(/"/g, '""')}"`;
  return x;
}

function inferReminderOffsets(thresholdStr) {
  const t = Number(thresholdStr);
  const set = new Set([7, 1, 0]);
  if (!Number.isNaN(t) && t >= 0) set.add(t);
  return [...set].sort((a, b) => b - a);
}

function getSettingsPayload() {
  const notifRow = db
    .prepare(`SELECT value_json FROM app_config WHERE key = 'notification_settings'`)
    .get();
  const offRow = db
    .prepare(`SELECT value_json FROM app_config WHERE key = 'reminder_offsets'`)
    .get();
  const defaultNotif = {
    dueSoonThreshold: '3',
    emailEnabled: false,
  };
  let notifications = { ...defaultNotif };
  if (notifRow?.value_json) {
    try {
      const parsed = JSON.parse(notifRow.value_json);
      notifications = {
        dueSoonThreshold: String(parsed.dueSoonThreshold ?? defaultNotif.dueSoonThreshold),
        emailEnabled: false,
      };
    } catch {
      /* ignore */
    }
  }
  let reminderOffsets = null;
  if (offRow?.value_json) {
    try {
      reminderOffsets = JSON.parse(offRow.value_json);
    } catch {
      reminderOffsets = null;
    }
  }
  if (!Array.isArray(reminderOffsets) || !reminderOffsets.length) {
    reminderOffsets = inferReminderOffsets(String(notifications.dueSoonThreshold));
  }
  return {
    notifications,
    reminderOffsets,
  };
}

function getLookupsPayload() {
  const rows = db
    .prepare(
      `SELECT id, category, value, sort_order FROM lookup_entries ORDER BY category, sort_order, value`
    )
    .all();
  const deliverables = [];
  const prospectTypes = [];
  const engagementTypes = [];
  for (const r of rows) {
    const entry = { id: r.id, value: r.value, sortOrder: r.sort_order };
    if (r.category === 'DELIVERABLES') deliverables.push(entry);
    else if (r.category === 'PROSPECT_TYPE') prospectTypes.push(entry);
    else if (r.category === 'ENGAGEMENT_TYPE') engagementTypes.push(entry);
  }
  return { deliverables, prospectTypes, engagementTypes };
}

function getReminderOffsetsForEvaluator() {
  try {
    const { reminderOffsets } = getSettingsPayload();
    return [...new Set(reminderOffsets.map(Number).filter((n) => !Number.isNaN(n)))].sort(
      (a, b) => b - a
    );
  } catch {
    return [7, 3, 1, 0];
  }
}

function reminderMessage(daysRemaining, prospect, dueDate) {
  if (daysRemaining === 0) return `${prospect} is due today (${dueDate})`;
  if (daysRemaining === 1) return `${prospect} is due tomorrow (${dueDate})`;
  return `${prospect} is due in ${daysRemaining} days (${dueDate})`;
}

function mapArtifactRow(r) {
  return {
    id: r.id,
    artifactType: labelToArtifactCode(r.artifact_type),
    type: r.artifact_type,
    url: r.url,
    title: r.title || undefined,
    addedBy: r.created_by,
    addedOn: r.created_at?.split?.('T')?.[0] || r.created_at,
  };
}

function mapNotificationRow(r) {
  const uiType =
    r.type === 'OVERDUE'
      ? 'overdue'
      : r.type === 'REMINDER_DAY'
        ? 'reminder'
        : 'reminder';
  return {
    id: r.id,
    dbType: r.type,
    type: uiType,
    title:
      r.type === 'OVERDUE' ? 'Opportunity overdue' : 'Due date reminder',
    message: r.message || '',
    opportunityId: r.opportunity_id,
    opportunityName: r.prospect || '',
    timestamp: r.created_at.replace('T', ' ').slice(0, 16),
    isRead: !!r.is_read,
    actionRequired: r.type === 'OVERDUE',
  };
}

function validateOpportunityCreate(body) {
  if (!body.prospect) return 'prospect required';
  if (!body.ownerIds?.length && !normalizeOwners(body.ownerIds).length) {
    return 'ownerIds required';
  }
  if (!body.dueDate) return 'dueDate required';
  if (!body.status) return 'status required';
  if (!body.prospectType) return 'prospectType required';
  if (!body.engagementType) return 'engagementType required';
  const allowedStatus = ['Not Started', 'In Progress', 'Completed'];
  if (!allowedStatus.includes(String(body.status)))
    return 'invalid status';
  const wl = ['Win', 'Loss', 'Open'];
  if (body.winOrLoss && !wl.includes(String(body.winOrLoss))) return 'invalid winOrLoss';
  if (body.value !== undefined && Number(body.value) < 0) return 'value must be >= 0';
  return '';
}

function validateOpportunityPartial(r) {
  const allowedStatus = ['Not Started', 'In Progress', 'Completed'];
  if (!allowedStatus.includes(String(r.status))) return 'invalid status';
  const wl = ['Win', 'Loss', 'Open'];
  if (r.win_or_loss && !wl.includes(String(r.win_or_loss))) return 'invalid winOrLoss';
  if (Number(r.value) < 0) return 'value must be >= 0';
  return '';
}

function nowIso() {
  return new Date().toISOString();
}

function artifactTypeToLabel(code) {
  switch (code) {
    case 'PROPOSAL':
      return 'Proposal';
    case 'SOW':
      return 'SOW';
    case 'PRESENTATION_DECK':
      return 'Presentation Deck';
    default:
      return code;
  }
}

function labelToArtifactCode(label) {
  switch (label) {
    case 'Proposal':
      return 'PROPOSAL';
    case 'SOW':
      return 'SOW';
    case 'Presentation Deck':
      return 'PRESENTATION_DECK';
    default:
      return String(label || '');
  }
}

function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM opportunities').get().c;
  if (n > 0) return;
  const now = nowIso();
  const samples = [
    {
      prospect: 'Acme Corporation',
      opportunity_description: 'Enterprise Cloud Migration',
      owner: ['Sarah Chen'],
      deliverables: 'Migration Plan, ROI Analysis',
      due_date: '2026-04-30',
      status: 'In Progress',
      prospect_type: 'Enterprise',
      engagement_type: 'RFP',
      value: 150000,
    },
    {
      prospect: 'GlobalTech Inc',
      opportunity_description: 'AI Platform Integration',
      owner: ['Michael Ross', 'Emily Zhang'],
      deliverables: 'Technical Architecture, Demo',
      due_date: '2026-05-15',
      status: 'In Progress',
      prospect_type: 'Enterprise',
      engagement_type: 'POC',
      value: 200000,
    },
    {
      prospect: 'StartupX',
      opportunity_description: 'Product Evaluation',
      owner: ['David Kim'],
      deliverables: 'Feature Demo, Pricing Proposal',
      due_date: '2026-05-01',
      status: 'Not Started',
      prospect_type: 'SMB',
      engagement_type: 'Demo',
      value: 25000,
    },
  ];
  const ins = db.prepare(
    `INSERT INTO opportunities (
      id, prospect, opportunity_description, owner_json, deliverables, due_date, status, notes,
      win_or_loss, first_presales_call, closed_date, prospect_type, engagement_type,
      value, currency, version, archived, created_at, updated_at
    ) VALUES (
      @id, @prospect, @opportunity_description, @owner_json, @deliverables, @due_date, @status, @notes,
      @win_or_loss, @first_presales_call, @closed_date, @prospect_type, @engagement_type,
      @value, @currency, @version, @archived, @created_at, @updated_at
    )`
  );

  for (const s of samples) {
    ins.run({
      id: randomUUID(),
      prospect: s.prospect,
      opportunity_description: s.opportunity_description,
      owner_json: JSON.stringify(s.owner),
      deliverables: s.deliverables,
      due_date: s.due_date,
      status: s.status,
      notes: '',
      win_or_loss: 'Open',
      first_presales_call: null,
      closed_date: null,
      prospect_type: s.prospect_type,
      engagement_type: s.engagement_type,
      value: s.value,
      currency: 'USD',
      version: 1,
      archived: 0,
      created_at: now,
      updated_at: now,
    });
  }
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function dayDiff(a, b) {
  const ms = 86400000;
  return Math.round((startOfDay(a) - startOfDay(b)) / ms);
}

function runNotificationEvaluator() {
  const opps = db
    .prepare(
      `SELECT id, prospect, due_date, status, archived FROM opportunities`
    )
    .all();
  const today = new Date();
  const offsets = getReminderOffsetsForEvaluator();

  const insert = db.prepare(
    `INSERT OR IGNORE INTO notifications (
       id, opportunity_id, type, channel, state, trigger_at, idempotency_key, message, is_read, created_at
     ) VALUES (
       @id, @opportunity_id, @type, @channel, @state, @trigger_at, @idempotency_key, @message, 0, @created_at
     )`
  );

  for (const o of opps) {
    if (Number(o.archived)) continue;
    if (o.status === 'Completed') continue;
    let due;
    try {
      due = new Date(o.due_date + 'T12:00:00');
    } catch {
      continue;
    }
    const dd = Math.floor(dayDiff(due, today));

    if (dd < 0) {
      insert.run({
        id: randomUUID(),
        opportunity_id: o.id,
        type: 'OVERDUE',
        channel: 'IN_APP',
        state: 'SENT',
        trigger_at: nowIso(),
        idempotency_key: `overdue|${o.id}|${o.due_date}`,
        message: `${o.prospect} is overdue (due ${o.due_date})`,
        created_at: nowIso(),
      });
      continue;
    }

    for (const off of offsets) {
      if (dd !== off) continue;
      const type = off === 7 ? 'REMINDER_7' : 'REMINDER_DAY';
      insert.run({
        id: randomUUID(),
        opportunity_id: o.id,
        type,
        channel: 'IN_APP',
        state: 'SENT',
        trigger_at: nowIso(),
        idempotency_key: `r${off}|${o.id}|${o.due_date}`,
        message: reminderMessage(off, o.prospect, o.due_date),
        created_at: nowIso(),
      });
    }
  }
}

function seedUsersIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (n > 0) return;
  const now = nowIso();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at)
     VALUES (@id, @email, @password_hash, @name, 'ADMIN', 'ACTIVE', @created_at, @updated_at)`
  ).run({
    id,
    email: STATIC_AUTH_EMAIL.toLowerCase(),
    password_hash: hashPassword(STATIC_AUTH_PASSWORD),
    name: 'Administrator',
    created_at: now,
    updated_at: now,
  });
}

function seedLookupsIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM lookup_entries').get().c;
  if (n > 0) return;
  const defaults = [
    ['DELIVERABLES', 'Proposal', 0],
    ['DELIVERABLES', 'Demo', 1],
    ['DELIVERABLES', 'POC', 2],
    ['DELIVERABLES', 'Technical Architecture', 3],
    ['DELIVERABLES', 'ROI Analysis', 4],
    ['PROSPECT_TYPE', 'Enterprise', 0],
    ['PROSPECT_TYPE', 'Mid-Market', 1],
    ['PROSPECT_TYPE', 'SMB', 2],
    ['ENGAGEMENT_TYPE', 'RFP', 0],
    ['ENGAGEMENT_TYPE', 'POC', 1],
    ['ENGAGEMENT_TYPE', 'Demo', 2],
    ['ENGAGEMENT_TYPE', 'Consultation', 3],
  ];
  const ins = db.prepare(
    `INSERT INTO lookup_entries (id, category, value, sort_order) VALUES (?, ?, ?, ?)`
  );
  for (const [cat, val, ord] of defaults) {
    ins.run(randomUUID(), cat, val, ord);
  }
}

function seedDefaultAppConfigIfEmpty() {
  const has = db.prepare(`SELECT 1 FROM app_config WHERE key = 'notification_settings'`).get();
  if (!has) {
    const notifications = {
      dueSoonThreshold: '3',
      emailEnabled: false,
    };
    db.prepare(`INSERT INTO app_config (key, value_json) VALUES (?, ?)`).run(
      'notification_settings',
      JSON.stringify(notifications)
    );
    const offsets = inferReminderOffsets(notifications.dueSoonThreshold);
    db.prepare(`INSERT INTO app_config (key, value_json) VALUES (?, ?)`).run(
      'reminder_offsets',
      JSON.stringify(offsets)
    );
  }
}
