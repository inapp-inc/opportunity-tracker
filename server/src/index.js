import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db, migrate } from './db.js';
import { hashPassword, verifyPassword } from './auth-utils.js';
import {
  PERMISSIONS,
  PLATFORM_ROLES,
  ROLE_PERMISSIONS,
  TENANT_ROLES,
  legacyRoleFromMembership,
  permissionsForMembership,
  tenantRoleFromLegacyRole,
} from './rbac.js';
import { initAnalytics } from './analytics.js';
import {
  assertChoiceValue,
  importColumnTypeForField,
  isSchemaChoiceFieldType,
  isSchemaMultiChoiceFieldType,
  schemaKeyToSnakeColumn,
  validateChoiceValue,
} from './schemaChoices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let analyticsApi;

const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}
const STATIC_AUTH_EMAIL =
  process.env.STATIC_AUTH_EMAIL || 'demo@example.com';
const STATIC_AUTH_PASSWORD =
  process.env.STATIC_AUTH_PASSWORD || 'password';
const STATIC_AUTH_ENABLED = process.env.NODE_ENV !== 'production';
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const DEFAULT_TENANT_ID = 'default-tenant';

function normalizeBasePath(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned || cleaned === '/') return '';
  return `/${cleaned.replace(/^\/+|\/+$/g, '')}`;
}

const APP_BASE_PATH = normalizeBasePath(
  process.env.APP_BASE_PATH || process.env.PUBLIC_BASE_PATH || ''
);

function tenantIdFromReq(req) {
  return String(req.user?.tenantId || req.user?.activeTenantId || DEFAULT_TENANT_ID);
}

function getTenant(id) {
  return db
    .prepare(`SELECT id, name, slug, status FROM tenants WHERE id = ?`)
    .get(id);
}

function requirePlatformAdmin(req, res, next) {
  if (req.user?.platformRole !== PLATFORM_ROLES.PLATFORM_ADMIN) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
}

function requireTenantPermission(permission) {
  return (req, res, next) => {
    if (
      req.user?.platformRole === PLATFORM_ROLES.PLATFORM_ADMIN &&
      [
        PERMISSIONS.TENANT_SETTINGS_READ,
        PERMISSIONS.TENANT_SETTINGS_WRITE,
        PERMISSIONS.RECORDS_READ,
        PERMISSIONS.RECORDS_CREATE,
        PERMISSIONS.RECORDS_UPDATE,
        PERMISSIONS.RECORDS_ARCHIVE,
        PERMISSIONS.RECORDS_DELETE,
        PERMISSIONS.RECORDS_ARTIFACTS_WRITE,
        PERMISSIONS.RECORDS_COMMENTS_WRITE,
        PERMISSIONS.REPORTS_READ,
        PERMISSIONS.NOTIFICATIONS_READ,
      ].includes(permission)
    ) {
      return next();
    }
    const permissions = req.user?.permissions || [];
    if (!permissions.includes(permission)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

function requireRoles(...roles) {
  return (req, res, next) => {
    const legacyRole = req.user?.role;
    if (legacyRole === 'ADMIN' || roles.includes(legacyRole)) return next();
    return res.status(403).json({ message: 'Forbidden' });
  };
}

/** Paths handled by the JSON API (require Bearer token except as noted). */
function isApiPath(p) {
  if (p === '/auth/me') return true;
  if (p.startsWith('/opportunities')) return true;
  if (p.startsWith('/records')) return true;
  if (p.startsWith('/notifications')) return true;
  if (p.startsWith('/reports')) return true;
  if (p.startsWith('/analytics')) return true;
  if (p.startsWith('/settings')) return true;
  if (p.startsWith('/catalog')) return true;
  if (p.startsWith('/users')) return true;
  if (p.startsWith('/platform')) return true;
  if (p.startsWith('/tenants')) return true;
  if (p.startsWith('/export')) return true;
  return false;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return UUID_RE.test(String(s || ''));
}

migrate();
migrateRetiredCaseStudySchemaFields();
migrateLegacyOwnerIds();
seedUsersIfEmpty();
ensureDefaultPlatformAdminOnly();
seedLookupsIfEmpty();
seedDealStagesIfEmpty();
seedDefaultAppConfigIfEmpty();
seedIfEmpty();

const app = express();
app.set('trust proxy', 1);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!CORS_ORIGINS.length && process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      if (CORS_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin not allowed'));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  if (!APP_BASE_PATH) return next();
  if (req.url === APP_BASE_PATH) {
    req.url = '/';
  } else if (req.url.startsWith(`${APP_BASE_PATH}/`)) {
    req.url = req.url.slice(APP_BASE_PATH.length) || '/';
  }
  next();
});

app.get('/health', (_req, res) => {
  res.status(200).type('text/plain').send('ok');
});

function getMembershipRows(userId) {
  return db
    .prepare(
      `SELECT
        tm.id,
        tm.user_id,
        tm.tenant_id,
        tm.role,
        tm.permissions_json,
        tm.status,
        tm.created_at,
        tm.updated_at,
        t.name AS tenant_name,
        t.slug AS tenant_slug,
        t.status AS tenant_status
       FROM tenant_memberships tm
       JOIN tenants t ON t.id = tm.tenant_id
       WHERE tm.user_id = ?
       ORDER BY t.name`
    )
    .all(userId);
}

function membershipToJson(membership) {
  const tenantId = membership.tenant_id || DEFAULT_TENANT_ID;
  const base = permissionsForTenantRole(tenantId, membership.role);
  return {
    id: membership.id,
    userId: membership.user_id,
    tenantId: membership.tenant_id,
    tenantName: membership.tenant_name,
    tenantSlug: membership.tenant_slug,
    role: membership.role,
    permissions: (() => {
      let extras = [];
      try {
        extras = JSON.parse(membership?.permissions_json || '[]');
      } catch {
        extras = [];
      }
      return [...new Set([...base, ...extras].map(String).filter(Boolean))];
    })(),
    status: membership.status,
    createdAt: membership.created_at,
    updatedAt: membership.updated_at,
  };
}

function userToJson(user) {
  const memberships = getMembershipRows(user.id).map(membershipToJson);
  return {
    id: user.id,
    email: user.email,
    name: user.name || user.email,
    role: user.role,
    platformRole: user.platform_role || PLATFORM_ROLES.NONE,
    status: user.status,
    tenantId: user.tenant_id || memberships[0]?.tenantId || DEFAULT_TENANT_ID,
    tenantName: user.tenant_name || memberships[0]?.tenantName || 'Default Team',
    memberships,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function createOrUpdateMembership({ userId, tenantId, role, permissions = [], status = 'ACTIVE' }) {
  if (!isAllowedPlatformRole(role)) {
    throw new Error('invalid membership role');
  }
  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    throw new Error('invalid membership status');
  }
  const tenant = db.prepare(`SELECT id FROM tenants WHERE id = ?`).get(tenantId);
  if (!tenant) throw new Error('invalid tenantId');
  const now = nowIso();
  const existing = db
    .prepare(`SELECT id FROM tenant_memberships WHERE user_id = ? AND tenant_id = ?`)
    .get(userId, tenantId);
  const permissionsJson = JSON.stringify(Array.isArray(permissions) ? permissions.map(String) : []);
  if (existing) {
    db.prepare(
      `UPDATE tenant_memberships
       SET role = ?, permissions_json = ?, status = ?, updated_at = ?
       WHERE id = ?`
    ).run(role, permissionsJson, status, now, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tenant_memberships (
      id, user_id, tenant_id, role, permissions_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, tenantId, role, permissionsJson, status, now, now);
  return id;
}

function normalizeMembershipRole(role, fallback = TENANT_ROLES.VIEWER) {
  const raw = String(role || fallback || '').trim();
  if (!raw) return TENANT_ROLES.VIEWER;
  if (Object.values(TENANT_ROLES).includes(raw)) return raw;
  if (['ADMIN', 'EDITOR', 'VIEWER'].includes(raw)) return tenantRoleFromLegacyRole(raw);
  // Custom role keys are validated per-tenant in validateMembershipInputs.
  return raw.toUpperCase();
  if (!role && fallback) return normalizeMembershipRole(fallback, TENANT_ROLES.VIEWER);
  throw new Error('invalid tenantRole');
}

function validateMembershipInputs(memberships) {
  for (const membership of memberships) {
    if (!isAllowedPlatformRole(membership.role)) {
      throw new Error(`invalid tenantRole (tenantId=${membership.tenantId}, role=${membership.role})`);
    }
    const tenant = db
      .prepare(`SELECT id FROM tenants WHERE id = ? AND status = 'ACTIVE'`)
      .get(membership.tenantId);
    if (!tenant) throw new Error('invalid tenantIds');
  }
}

function normalizeMembershipStatus(status) {
  const value = String(status || 'ACTIVE');
  if (!['ACTIVE', 'INACTIVE'].includes(value)) throw new Error('invalid membership status');
  return value;
}

function membershipErrorResponse(res, error) {
  const message = error instanceof Error ? error.message : 'invalid memberships';
  const status = message.includes('invalid') || message.includes('required') ? 400 : 500;
  return res.status(status).json({ message });
}

function membershipInputsFromBody(body, fallbackRole) {
  if (Array.isArray(body?.memberships)) {
    const byTenant = new Map();
    for (const item of body.memberships) {
      const tenantId = String(item?.tenantId || '').trim();
      if (!tenantId) continue;
      byTenant.set(tenantId, {
        tenantId,
        role: normalizeMembershipRole(item?.role || item?.tenantRole || item?.membershipRole, fallbackRole),
        permissions: Array.isArray(item?.permissions) ? item.permissions.map(String) : [],
      });
    }
    return [...byTenant.values()];
  }
  const ids = [...new Set((Array.isArray(body?.tenantIds) ? body.tenantIds : []).map(String).filter(Boolean))];
  return ids.map((tenantId) => ({
    tenantId,
    role: normalizeMembershipRole(body?.tenantRole || body?.membershipRole, fallbackRole),
    permissions: Array.isArray(body?.permissions) ? body.permissions.map(String) : [],
  }));
}

function syncUserTenantMemberships({ userId, tenantIds, memberships, role, permissions = [] }) {
  const inputs = Array.isArray(memberships)
    ? memberships
    : (Array.isArray(tenantIds) ? tenantIds : []).map((tenantId) => ({
        tenantId: String(tenantId),
        role,
        permissions,
      }));
  const normalized = [];
  const seen = new Set();
  for (const input of inputs) {
    const tenantId = String(input?.tenantId || '').trim();
    if (!tenantId || seen.has(tenantId)) continue;
    seen.add(tenantId);
    normalized.push({
      tenantId,
      role: normalizeMembershipRole(input?.role, role),
      permissions: Array.isArray(input?.permissions) ? input.permissions.map(String) : [],
    });
  }
  validateMembershipInputs(normalized);
  const now = nowIso();
  db.prepare(`DELETE FROM tenant_memberships WHERE user_id = ?`).run(userId);
  for (const membership of normalized) {
    createOrUpdateMembership({
      userId,
      tenantId: membership.tenantId,
      role: membership.role,
      permissions: membership.permissions,
      status: 'ACTIVE',
    });
  }
  db.prepare(`UPDATE users SET tenant_id = ?, updated_at = ? WHERE id = ?`).run(
    normalized[0]?.tenantId || DEFAULT_TENANT_ID,
    now,
    userId
  );
}

function requestedTenantId(req, fallback) {
  const headerTenant = req.headers['x-tenant-id'];
  const raw = Array.isArray(headerTenant) ? headerTenant[0] : headerTenant;
  return String(raw || req.query?.tenantId || fallback || DEFAULT_TENANT_ID);
}

function buildAuthContext(userId, req) {
  const user = db
    .prepare(
      `SELECT id, email, role, platform_role, status, tenant_id, name
       FROM users
       WHERE id = ?`
    )
    .get(userId);
  if (!user || user.status !== 'ACTIVE') return null;
  const memberships = getMembershipRows(user.id).filter(
    (m) => m.status === 'ACTIVE' && m.tenant_status === 'ACTIVE'
  );
  const platformRole = user.platform_role || PLATFORM_ROLES.NONE;
  const preferredTenant = requestedTenantId(req, user.tenant_id || memberships[0]?.tenant_id || DEFAULT_TENANT_ID);
  let activeMembership = memberships.find((m) => m.tenant_id === preferredTenant);
  const platformTenant = getTenant(preferredTenant);
  if (!activeMembership && platformRole === PLATFORM_ROLES.PLATFORM_ADMIN && platformTenant?.status === 'ACTIVE') {
    activeMembership = {
      id: '',
      user_id: user.id,
      tenant_id: platformTenant.id,
      role: '',
      permissions_json: '[]',
      status: 'ACTIVE',
      tenant_name: platformTenant.name,
      tenant_slug: platformTenant.slug,
      tenant_status: platformTenant.status,
    };
  }
  if (!activeMembership) return null;
  const permissions =
    platformRole === PLATFORM_ROLES.PLATFORM_ADMIN && !activeMembership.role
      ? [
          PERMISSIONS.TENANT_SETTINGS_READ,
          PERMISSIONS.TENANT_SETTINGS_WRITE,
          PERMISSIONS.RECORDS_READ,
          PERMISSIONS.RECORDS_CREATE,
          PERMISSIONS.RECORDS_UPDATE,
          PERMISSIONS.RECORDS_ARCHIVE,
          PERMISSIONS.RECORDS_DELETE,
          PERMISSIONS.RECORDS_ARTIFACTS_WRITE,
          PERMISSIONS.RECORDS_COMMENTS_WRITE,
          PERMISSIONS.REPORTS_READ,
          PERMISSIONS.NOTIFICATIONS_READ,
        ]
      : activeMembership.role
        ? (() => {
            const tenantId = activeMembership.tenant_id || DEFAULT_TENANT_ID;
            const base = permissionsForTenantRole(tenantId, activeMembership.role);
            let extras = [];
            try {
              extras = JSON.parse(activeMembership?.permissions_json || '[]');
            } catch {
              extras = [];
            }
            return [...new Set([...base, ...extras].map(String).filter(Boolean))];
          })()
        : [];
  return {
    sub: user.id,
    id: user.id,
    email: user.email,
    name: user.name || '',
    platformRole,
    role: legacyRoleFromMembership(activeMembership, platformRole),
    tenantRole: activeMembership.role,
    tenantId: activeMembership.tenant_id,
    activeTenantId: activeMembership.tenant_id,
    activeTenantName: activeMembership.tenant_name,
    tenantName: activeMembership.tenant_name,
    permissions,
    memberships: memberships.map(membershipToJson),
    pageAccess: getConfigValue(
      activeMembership.tenant_id,
      'page_access_config',
      defaultPageAccessConfig(),
      normalizePageAccessConfig
    ),
  };
}

app.post('/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const remember = Boolean(req.body?.remember);
  const row = db
    .prepare(
      `SELECT id, email, password_hash, role, platform_role, status, tenant_id FROM users WHERE lower(email) = ?`
    )
    .get(email);
  let authed = null;
  if (row && row.status === 'ACTIVE' && verifyPassword(password, row.password_hash)) {
    authed = row;
  }
  if (
    !authed &&
    STATIC_AUTH_ENABLED &&
    email === STATIC_AUTH_EMAIL.toLowerCase() &&
    password === STATIC_AUTH_PASSWORD
  ) {
    const fallback = db
      .prepare(`SELECT id, email, role, platform_role, status, tenant_id FROM users WHERE lower(email) = ?`)
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
      tenantId: authed.tenant_id || DEFAULT_TENANT_ID,
    },
    JWT_SECRET,
    { expiresIn: remember ? '30d' : '12h' }
  );
  res.json({ accessToken, expiresIn: remember ? '30d' : '12h' });
});

app.use(authMiddleware);

app.use((req, _res, next) => {
  if (req.path === '/records' || req.path.startsWith('/records/')) {
    req.url = req.url
      .replace(/^\/records\b/, '/opportunities')
      .replace(/\/artifacts(?=\/|$)/, '/artifact-links');
  }
  next();
});

app.get('/auth/me', (req, res) => {
  const u = req.user || {};
  res.json({
    sub: String(u.sub || ''),
    email: String(u.email || ''),
    name: String(u.name || ''),
    role: String(u.role || ''),
    tenantRole: String(u.tenantRole || ''),
    platformRole: String(u.platformRole || PLATFORM_ROLES.NONE),
    tenantId: String(u.activeTenantId || u.tenantId || DEFAULT_TENANT_ID),
    tenantName: String(u.activeTenantName || u.tenantName || 'Default Team'),
    activeTenantId: String(u.activeTenantId || u.tenantId || DEFAULT_TENANT_ID),
    activeTenantName: String(u.activeTenantName || u.tenantName || 'Default Team'),
    permissions: Array.isArray(u.permissions) ? u.permissions : [],
    memberships: Array.isArray(u.memberships) ? u.memberships : [],
    pageAccess: u.pageAccess || defaultPageAccessConfig(),
  });
});

app.get('/tenants', requirePlatformAdmin, (_req, res) => {
  const rows = db
    .prepare(`SELECT id, name, slug, status, created_at, updated_at FROM tenants ORDER BY name`)
    .all();
  res.json({
    items: rows.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    })),
  });
});

app.post('/tenants', requirePlatformAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const slug = slugify(String(req.body?.slug || name));
  if (!name) return res.status(400).json({ message: 'name required' });
  if (!slug) return res.status(400).json({ message: 'slug required' });
  const exists = db.prepare(`SELECT id FROM tenants WHERE slug = ?`).get(slug);
  if (exists) return res.status(409).json({ message: 'Tenant slug already exists' });
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
     VALUES (?, ?, ?, 'ACTIVE', ?, ?)`
  ).run(id, name, slug, now, now);
  seedTenantDefaults(id);
  const row = db
    .prepare(`SELECT id, name, slug, status, created_at, updated_at FROM tenants WHERE id = ?`)
    .get(id);
  res.status(201).json({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

app.patch('/tenants/:id', requirePlatformAdmin, (req, res) => {
  const id = req.params.id;
  const row = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ message: 'Not found' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : row.name;
  const status =
    req.body?.status !== undefined ? String(req.body.status).trim() : row.status;
  if (!name) return res.status(400).json({ message: 'name required' });
  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({ message: 'invalid status' });
  }
  const now = nowIso();
  db.prepare(
    `UPDATE tenants SET name = ?, status = ?, updated_at = ? WHERE id = ?`
  ).run(name, status, now, id);
  const saved = db
    .prepare(`SELECT id, name, slug, status, created_at, updated_at FROM tenants WHERE id = ?`)
    .get(id);
  res.json({
    id: saved.id,
    name: saved.name,
    slug: saved.slug,
    status: saved.status,
    createdAt: saved.created_at,
    updatedAt: saved.updated_at,
  });
});

app.get('/users/assignable', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, tm.role
       FROM tenant_memberships tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
       ORDER BY u.name, u.email`
    )
    .all(tenantId);
  res.json({
    items: rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name || u.email,
      role: u.role,
    })),
  });
});

app.get('/opportunities', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
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

app.get('/opportunities/template.csv', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const headers = recordImportHeaders(tenantId);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="records-template.csv"');
  res.send(`${headers.map(csvEscape).join(',')}\n`);
});

app.get('/opportunities/template.xlsx', requireTenantPermission(PERMISSIONS.RECORDS_READ), async (req, res) => {
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

app.post(
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

app.get('/opportunities/artifact-links', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
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

app.get('/opportunities/:id', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const row = db
    .prepare('SELECT * FROM opportunities WHERE id = ? AND tenant_id = ?')
    .get(req.params.id, tenantId);
  if (!row) return res.status(404).json({ message: 'Not found' });
  res.json(mapOpportunityRow(row));
});

app.post('/opportunities', requireTenantPermission(PERMISSIONS.RECORDS_CREATE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const body = req.body || {};
  try {
    const saved = createOpportunityRecord(body, tenantId, req);
    res.status(201).json(mapOpportunityRow(saved));
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : 'invalid record' });
  }
});

app.patch('/opportunities/:id', requireTenantPermission(PERMISSIONS.RECORDS_UPDATE), (req, res) => {
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

app.delete('/opportunities/:id', requireTenantPermission(PERMISSIONS.RECORDS_DELETE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const id = req.params.id;
  const r = db
    .prepare('DELETE FROM opportunities WHERE id = ? AND tenant_id = ?')
    .run(id, tenantId);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

app.get('/artifact-links', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
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

app.get('/opportunities/:id/artifact-links', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
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

app.post('/opportunities/:id/artifact-links', requireTenantPermission(PERMISSIONS.RECORDS_ARTIFACTS_WRITE), (req, res) => {
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

app.delete('/opportunities/:opportunityId/artifact-links/:linkId', requireTenantPermission(PERMISSIONS.RECORDS_ARTIFACTS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const r = db
    .prepare(
      'DELETE FROM artifact_links WHERE id = ? AND opportunity_id = ? AND tenant_id = ?'
    )
    .run(req.params.linkId, req.params.opportunityId, tenantId);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

app.patch('/opportunities/:opportunityId/artifact-links/:linkId', requireTenantPermission(PERMISSIONS.RECORDS_ARTIFACTS_WRITE), (req, res) => {
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

app.get('/opportunities/:id/activities', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
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

app.post('/opportunities/:id/activities', requireTenantPermission(PERMISSIONS.RECORDS_COMMENTS_WRITE), (req, res) => {
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

app.get('/notifications', requireTenantPermission(PERMISSIONS.NOTIFICATIONS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const rows = db
    .prepare(
      `SELECT n.*, o.prospect AS prospect
       FROM notifications n
       JOIN opportunities o ON o.id = n.opportunity_id AND o.tenant_id = n.tenant_id
       WHERE n.tenant_id = ?
       ORDER BY n.created_at DESC`
    )
    .all(tenantId);
  res.json({
    items: rows.map(mapNotificationRow),
  });
});

app.patch('/notifications/:id/read', requireTenantPermission(PERMISSIONS.NOTIFICATIONS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const r = db
    .prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND tenant_id = ?')
    .run(req.params.id, tenantId);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.json({ ok: true });
});

app.patch('/notifications/read-all', requireTenantPermission(PERMISSIONS.NOTIFICATIONS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  db.prepare('UPDATE notifications SET is_read = 1 WHERE tenant_id = ?').run(tenantId);
  res.json({ ok: true });
});

app.get('/reports/pipeline-summary', requireTenantPermission(PERMISSIONS.REPORTS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  res.json(analyticsApi.buildPipelineSummary(tenantId, req.query));
});

app.get('/analytics/dimensions', requireTenantPermission(PERMISSIONS.REPORTS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  res.json({
    dimensions: analyticsApi.analyticsDimensionsForTenant(tenantId),
    measures: [
      { key: 'count', label: 'Record count' },
      { key: 'sumValue', label: 'Sum of value' },
      { key: 'avgValue', label: 'Average value' },
    ],
  });
});

app.post('/analytics/query', requireTenantPermission(PERMISSIONS.REPORTS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  try {
    res.json(analyticsApi.runAnalyticsQuery(tenantId, req.body || {}));
  } catch (e) {
    res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid analytics query' });
  }
});

app.get('/settings', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_READ), (req, res) => {
  res.json(getSettingsPayload(tenantIdFromReq(req), req.user));
});

app.patch('/settings/my-dashboard', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = req.user?.sub ? String(req.user.sub) : '';
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  const dashboard = normalizeDashboardConfig(req.body?.dashboard || {}, tenantId);
  setConfigValue(tenantId, `user_dashboard:${userId}`, dashboard);
  res.json({ dashboard: resolveDashboardConfig(tenantId, req.user) });
});

app.patch('/settings', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const body = req.body || {};
  const cur = getSettingsPayload(tenantId, req.user);
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

  setConfigValue(tenantId, 'notification_settings', notifications);
  setConfigValue(tenantId, 'reminder_offsets', reminderOffsets);
  if (body.dashboard) {
    const dashboard = normalizeDashboardConfig({
      ...cur.dashboard,
      ...body.dashboard,
    }, tenantId);
    const scope = String(body.dashboardScope || 'tenant');
    if (scope === 'user' && req.user?.sub) {
      setConfigValue(tenantId, `user_dashboard:${req.user.sub}`, dashboard);
    } else if (scope === 'role') {
      const roleKey = String(body.dashboardRole || req.user?.tenantRole || req.user?.role || 'VIEWER');
      setConfigValue(tenantId, `role_dashboard:${roleKey}`, dashboard);
    } else {
      setConfigValue(tenantId, 'dashboard_config', dashboard);
    }
  }
  if (body.displayTimezone !== undefined) {
    const tz = String(body.displayTimezone || 'UTC').trim() || 'UTC';
    setConfigValue(tenantId, 'display_timezone', tz);
  }
  if (body.terminology) {
    const terminology = normalizeTerminologyConfig({
      ...cur.terminology,
      ...body.terminology,
    });
    setConfigValue(tenantId, 'terminology_config', terminology);
  }
  if (body.theme) {
    const theme = normalizeThemeConfig({
      ...cur.theme,
      ...body.theme,
    });
    setConfigValue(tenantId, 'theme_config', theme);
  }
  if (body.listTableLayout) {
    setConfigValue(
      tenantId,
      'list_table_layout',
      normalizeListTableLayout({
        ...cur.listTableLayout,
        ...body.listTableLayout,
      })
    );
  }
  if (body.reportsLayout) {
    setConfigValue(
      tenantId,
      'reports_layout',
      normalizeReportsLayout({
        ...cur.reportsLayout,
        ...body.reportsLayout,
      })
    );
  }
  if (body.caseStudyEnabled !== undefined) {
    setConfigValue(tenantId, 'case_study_enabled', Boolean(body.caseStudyEnabled));
  }
  if (body.caseStudyLayout !== undefined) {
    const next = normalizeCaseStudyLayoutValue(body.caseStudyLayout);
    setConfigValue(tenantId, 'case_study_layout', next ?? { columns: [] });
  }
  if (body.pageAccess !== undefined) {
    const next = normalizePageAccessConfigForTenant({
      ...cur.pageAccess,
      ...body.pageAccess,
    }, tenantId);
    setConfigValue(tenantId, 'page_access_config', next);
  }
  if (body.platformRoles !== undefined) {
    if (String(req.user?.platformRole || PLATFORM_ROLES.NONE) !== PLATFORM_ROLES.PLATFORM_ADMIN) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const next = normalizePlatformRolesConfig(body.platformRoles);
    setGlobalConfigValue('platform_roles_config', next);
  }
  if (body.tenantRolePermissions !== undefined) {
    const next = normalizeTenantRolePermissionsConfig(body.tenantRolePermissions, tenantId);
    setConfigValue(tenantId, 'tenant_role_permissions_config', next);
  }
  if (body.summaryCards !== undefined) {
    const next = normalizeSummaryCardsConfig(body.summaryCards);
    setConfigValue(tenantId, 'summary_cards_config', next);
  }
  res.json(getSettingsPayload(tenantId, req.user));
});

app.get('/catalog/lookups', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  ensureStandardLookupCategories(tenantId);
  const payload = getLookupsPayload(tenantId);
  const settings = getSettingsPayload(tenantId, req.user);
  const displayTimezone = getConfigValue(
    tenantId,
    'display_timezone',
    'UTC',
    (parsed) => String(parsed || 'UTC')
  );
  res.json({
    artifactTypes: payload.artifactTypes,
    prospectTypes: payload.prospectTypes,
    engagementTypes: payload.engagementTypes,
    deliverables: payload.deliverables,
    currencies: payload.currencies,
    dealStages: payload.dealStages,
    winLoss: payload.winLoss,
    displayTimezone,
    caseStudyEnabled: settings.caseStudyEnabled,
    caseStudyLayout: settings.caseStudyLayout,
    pageAccess: settings.pageAccess,
  });
});

app.get('/settings/lookups', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_READ), (req, res) => {
  res.json(getLookupsPayload(tenantIdFromReq(req)));
});

app.post('/settings/lookups', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const category = lookupCategoryKey(req.body?.category || req.body?.categoryName);
  const value = String(req.body?.value || '').trim();
  if (!category) return res.status(400).json({ message: 'category required' });
  if (!value) return res.status(400).json({ message: 'value required' });
  const maxSort =
    db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m FROM lookup_entries WHERE tenant_id = ? AND category = ?`
      )
      .get(tenantId, category).m + 1;
  const id = randomUUID();
  db.prepare(
    `INSERT INTO lookup_entries (id, tenant_id, category, value, sort_order) VALUES (?, ?, ?, ?, ?)`
  ).run(id, tenantId, category, value, maxSort);
  res.status(201).json({ id, category, value, sortOrder: maxSort });
});

app.post('/settings/lookups/categories', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const category = lookupCategoryKey(req.body?.category || req.body?.name);
  if (!category) return res.status(400).json({ message: 'category required' });
  const categories = getLookupCategoryConfigs(tenantId);
  if (!categories.some((item) => item.category === category)) {
    categories.push({ category, label: lookupCategoryLabel(category) });
    setConfigValue(tenantId, 'lookup_categories', categories);
  }
  res.status(201).json({ category, label: lookupCategoryLabel(category), items: [] });
});

const PROTECTED_LOOKUP_CATEGORIES = new Set([
  'DEAL_STAGE',
  'DELIVERABLES',
  'ENGAGEMENT_TYPE',
  'PROSPECT_TYPE',
  'WIN_LOSS',
  'ARTIFACT_TYPE',
  'CURRENCY',
]);

app.delete(
  '/settings/lookups/categories/:category',
  requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE),
  (req, res) => {
    const tenantId = tenantIdFromReq(req);
    const category = lookupCategoryKey(req.params.category);
    if (!category) return res.status(400).json({ message: 'category required' });
    if (PROTECTED_LOOKUP_CATEGORIES.has(category)) {
      return res.status(400).json({ message: 'This lookup category cannot be removed' });
    }
    const categories = getLookupCategoryConfigs(tenantId);
    const nextCategories = categories.filter((item) => item.category !== category);
    const removed = db
      .prepare('DELETE FROM lookup_entries WHERE tenant_id = ? AND category = ?')
      .run(tenantId, category);
    if (nextCategories.length === categories.length && removed.changes === 0) {
      return res.status(404).json({ message: 'Not found' });
    }
    setConfigValue(tenantId, 'lookup_categories', nextCategories);
    res.status(204).send();
  }
);

app.patch('/settings/lookups/:id', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const value = String(req.body?.value || '').trim();
  if (!value) return res.status(400).json({ message: 'value required' });
  const existing = db
    .prepare('SELECT id, category, value, sort_order FROM lookup_entries WHERE id = ? AND tenant_id = ?')
    .get(req.params.id, tenantId);
  if (!existing) return res.status(404).json({ message: 'Not found' });
  const prevValue = String(existing.value || '');
  db.prepare('UPDATE lookup_entries SET value = ? WHERE id = ? AND tenant_id = ?').run(
    value,
    req.params.id,
    tenantId
  );
  // Propagate lookup edits to existing records that store the lookup value directly.
  // (Records store the lookup entry's `value` string, not an ID.)
  const category = String(existing.category || '');
  const propagate = (col) => {
    if (!prevValue || prevValue === value) return;
    db.prepare(
      `UPDATE opportunities
       SET ${col} = ?
       WHERE tenant_id = ? AND ${col} = ?`
    ).run(value, tenantId, prevValue);
  };
  if (category === 'WIN_LOSS') propagate('win_or_loss');
  if (category === 'DEAL_STAGE') propagate('deal_stage');
  if (category === 'PROSPECT_TYPE') propagate('prospect_type');
  if (category === 'ENGAGEMENT_TYPE') propagate('engagement_type');
  if (category === 'CURRENCY') propagate('currency');
  res.json({
    id: existing.id,
    category: existing.category,
    value,
    sortOrder: existing.sort_order,
  });
});

app.delete('/settings/lookups/:id', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const r = db
    .prepare('DELETE FROM lookup_entries WHERE id = ? AND tenant_id = ?')
    .run(req.params.id, tenantId);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

app.get('/settings/schema', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_READ), (req, res) => {
  res.json({ fields: getRecordSchemaDefinitions(tenantIdFromReq(req)) });
});

// Read-only schema access for non-admin users (Dashboard, reports, etc.)
app.get('/catalog/schema', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  res.json({ fields: getRecordSchemaDefinitions(tenantIdFromReq(req)) });
});

app.post('/settings/schema', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const parsed = parseFieldDefinitionInput(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const systemKeys = new Set(defaultSystemFieldDefinitions().map((f) => f.key));
  if (systemKeys.has(parsed.field.key)) {
    return res.status(409).json({
      message: `Field key "${parsed.field.key}" is reserved by a built-in field. Choose a different key.`,
    });
  }
  const exists = db
    .prepare(
      `SELECT id FROM tenant_field_definitions WHERE tenant_id = ? AND entity = 'opportunity' AND key = ?`
    )
    .get(tenantId, parsed.field.key);
  if (exists) return res.status(409).json({ message: 'Field key already exists' });
  const maxSort =
    db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m
         FROM tenant_field_definitions WHERE tenant_id = ? AND entity = 'opportunity'`
      )
      .get(tenantId).m + 1;
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO tenant_field_definitions (
      id, tenant_id, entity, key, label, field_type, options_json, lookup_category,
      required, show_in_table, sort_order, status, created_at, updated_at
    ) VALUES (
      @id, @tenant_id, 'opportunity', @key, @label, @field_type, @options_json, @lookup_category,
      @required, @show_in_table, @sort_order, 'ACTIVE', @created_at, @updated_at
    )`
  ).run({
    id,
    tenant_id: tenantId,
    ...parsed.field,
    sort_order: maxSort,
    created_at: now,
    updated_at: now,
  });
  res.status(201).json(getTenantFieldDefinition(tenantId, id));
});

app.patch('/settings/schema/:id', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  if (String(req.params.id).startsWith('system:')) {
    try {
      const saved = updateSystemFieldDefinition(
        tenantId,
        String(req.params.id).replace(/^system:/, ''),
        req.body || {}
      );
      if (!saved) return res.status(404).json({ message: 'Not found' });
      return res.json(saved);
    } catch (e) {
      return res.status(400).json({ message: e instanceof Error ? e.message : 'invalid field' });
    }
  }
  const existing = getTenantFieldDefinition(tenantId, req.params.id);
  if (!existing) return res.status(404).json({ message: 'Not found' });
  const body = req.body || {};
  const patch = {
    label: body.label !== undefined ? String(body.label).trim() : existing.label,
    field_type:
      body.fieldType !== undefined ? String(body.fieldType) : existing.fieldType,
    options_json:
      body.options !== undefined
        ? JSON.stringify(normalizeFieldOptions(body.options))
        : JSON.stringify(existing.options || []),
    lookup_category:
      body.lookupCategory !== undefined
        ? lookupCategoryKey(body.lookupCategory)
        : existing.lookupCategory || null,
    required:
      body.required !== undefined ? (body.required ? 1 : 0) : existing.required ? 1 : 0,
    show_in_table:
      body.showInTable !== undefined
        ? body.showInTable
          ? 1
          : 0
        : existing.showInTable
          ? 1
          : 0,
    status: body.status !== undefined ? String(body.status) : existing.status,
    sort_order:
      body.sortOrder !== undefined ? Number(body.sortOrder) : Number(existing.sortOrder || 0),
  };
  if (!patch.label) return res.status(400).json({ message: 'label required' });
  if (!allowedFieldTypes().includes(patch.field_type)) {
    return res.status(400).json({ message: 'invalid fieldType' });
  }
  const nextOptions = normalizeFieldOptions(JSON.parse(patch.options_json || '[]'));
  if (
    ['select', 'multi_select', 'lookup_select', 'lookup_multi_select'].includes(patch.field_type) &&
    !nextOptions.length &&
    !patch.lookup_category
  ) {
    return res.status(400).json({ message: 'choice fields require options or lookup source' });
  }
  if (!['ACTIVE', 'INACTIVE'].includes(patch.status)) {
    return res.status(400).json({ message: 'invalid status' });
  }
  db.prepare(
    `UPDATE tenant_field_definitions SET
      label = @label,
      field_type = @field_type,
      options_json = @options_json,
      lookup_category = @lookup_category,
      required = @required,
      show_in_table = @show_in_table,
      status = @status,
      sort_order = @sort_order,
      updated_at = @updated_at
     WHERE id = @id AND tenant_id = @tenant_id`
  ).run({
    id: req.params.id,
    tenant_id: tenantId,
    ...patch,
    updated_at: nowIso(),
  });
  res.json(getTenantFieldDefinition(tenantId, req.params.id));
});

app.delete('/settings/schema/:id', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  if (String(req.params.id).startsWith('system:')) {
    const saved = updateSystemFieldDefinition(
      tenantId,
      String(req.params.id).replace(/^system:/, ''),
      { status: 'INACTIVE' }
    );
    if (!saved) return res.status(404).json({ message: 'Not found' });
    return res.status(204).send();
  }
  db.prepare(
    `UPDATE tenant_field_definitions
     SET status = 'INACTIVE', updated_at = ?
     WHERE id = ? AND tenant_id = ?`
  ).run(nowIso(), req.params.id, tenantId);
  res.status(204).send();
});

function listUsersHandler(req, res) {
  const tenantFilter = req.query.tenantId ? String(req.query.tenantId) : '';
  const params = tenantFilter ? [tenantFilter] : [];
  const where = tenantFilter
    ? `WHERE EXISTS (
        SELECT 1 FROM tenant_memberships tm
        WHERE tm.user_id = u.id AND tm.tenant_id = ?
      )`
    : '';
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.platform_role, u.status, u.tenant_id, t.name AS tenant_name,
              u.created_at, u.updated_at
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       ${where}
       ORDER BY t.name, u.email`
    )
    .all(...params);
  res.json({ items: rows.map(userToJson) });
}

app.get('/users', requirePlatformAdmin, listUsersHandler);
app.get('/platform/users', requirePlatformAdmin, listUsersHandler);

function createUserHandler(req, res) {
  const legacyTenantIds = Array.isArray(req.body?.tenantIds)
    ? req.body.tenantIds.map(String).filter(Boolean)
    : req.body?.tenantId
      ? [String(req.body.tenantId)]
      : [];
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = String(req.body?.name || '').trim();
  const role = String(req.body?.role || 'VIEWER');
  let tenantRole;
  let memberships;
  try {
    tenantRole = normalizeMembershipRole(req.body?.tenantRole || req.body?.membershipRole, tenantRoleFromLegacyRole(role));
    memberships = membershipInputsFromBody(
      Array.isArray(req.body?.memberships) ? req.body : { ...req.body, tenantIds: legacyTenantIds },
      tenantRole
    );
    validateMembershipInputs(memberships);
  } catch (error) {
    return membershipErrorResponse(res, error);
  }
  const tenantIds = memberships.map((membership) => membership.tenantId);
  const tenantId = tenantIds[0] || DEFAULT_TENANT_ID;
  const platformRole = String(req.body?.platformRole || PLATFORM_ROLES.NONE);
  if (!email || !password) {
    return res.status(400).json({ message: 'email and password required' });
  }
  if (!['ADMIN', 'EDITOR', 'VIEWER'].includes(role)) {
    return res.status(400).json({ message: 'invalid role' });
  }
  if (!Object.values(PLATFORM_ROLES).includes(platformRole)) {
    return res.status(400).json({ message: 'invalid platformRole' });
  }
  if (platformRole !== PLATFORM_ROLES.PLATFORM_ADMIN && !tenantIds.length) {
    return res.status(400).json({ message: 'tenantIds required' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (exists) return res.status(409).json({ message: 'Email already exists' });
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, platform_role, status, created_at, updated_at)
     VALUES (@id, @tenant_id, @email, @password_hash, @name, @role, @platform_role, 'ACTIVE', @created_at, @updated_at)`
  ).run({
    id,
    tenant_id: tenantId,
    email,
    password_hash: hashPassword(password),
    name: name || email.split('@')[0],
    role,
    platform_role: platformRole,
    created_at: now,
    updated_at: now,
  });
  syncUserTenantMemberships({
    userId: id,
    memberships,
    role: tenantRole,
  });
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.platform_role, u.status, u.tenant_id, t.name AS tenant_name,
              u.created_at, u.updated_at
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ?`
    )
    .get(id);
  res.status(201).json(userToJson(row));
}

app.post('/users', requirePlatformAdmin, createUserHandler);
app.post('/platform/users', requirePlatformAdmin, createUserHandler);

function updateUserHandler(req, res) {
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ message: 'Not found' });
  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : row.name;
  const role = body.role !== undefined ? String(body.role) : row.role;
  let tenantRole;
  try {
    tenantRole = normalizeMembershipRole(body.tenantRole || body.membershipRole, tenantRoleFromLegacyRole(role));
  } catch (error) {
    return membershipErrorResponse(res, error);
  }
  const platformRole =
    body.platformRole !== undefined ? String(body.platformRole) : row.platform_role || PLATFORM_ROLES.NONE;
  const status = body.status !== undefined ? String(body.status) : row.status;
  if (!['ADMIN', 'EDITOR', 'VIEWER'].includes(role)) {
    return res.status(400).json({ message: 'invalid role' });
  }
  if (!Object.values(PLATFORM_ROLES).includes(platformRole)) {
    return res.status(400).json({ message: 'invalid platformRole' });
  }
  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({ message: 'invalid status' });
  }
  let membershipSync = null;
  let membershipPatch = null;
  try {
    if (Array.isArray(body.memberships) || Array.isArray(body.tenantIds)) {
      membershipSync = membershipInputsFromBody(body, tenantRole);
      if (platformRole !== PLATFORM_ROLES.PLATFORM_ADMIN && membershipSync.length === 0) {
        return res.status(400).json({ message: 'workspace memberships required' });
      }
      validateMembershipInputs(membershipSync);
    } else if (body.tenantId || body.tenantRole || body.membershipRole || body.permissions) {
      const tenantId = String(body.tenantId || row.tenant_id || DEFAULT_TENANT_ID);
      membershipPatch = {
        tenantId,
        role: tenantRole,
        permissions: Array.isArray(body.permissions) ? body.permissions.map(String) : [],
        status: normalizeMembershipStatus(body.membershipStatus),
      };
      validateMembershipInputs([membershipPatch]);
    }
  } catch (error) {
    return membershipErrorResponse(res, error);
  }
  let password_hash = row.password_hash;
  if (body.password && String(body.password).length > 0) {
    password_hash = hashPassword(String(body.password));
  }
  const now = nowIso();
  db.prepare(
    `UPDATE users
     SET name=@name,
         role=@role,
         platform_role=@platform_role,
         status=@status,
         password_hash=@password_hash,
         updated_at=@updated_at
     WHERE id=@id`
  ).run({
    id,
    name,
    role,
    platform_role: platformRole,
    status,
    password_hash,
    updated_at: now,
  });
  if (membershipSync) {
    syncUserTenantMemberships({
      userId: id,
      memberships: membershipSync,
      role: tenantRole,
    });
  } else if (membershipPatch) {
    createOrUpdateMembership({
      userId: id,
      tenantId: membershipPatch.tenantId,
      role: tenantRole,
      permissions: membershipPatch.permissions,
      status: membershipPatch.status,
    });
  }
  const saved = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.platform_role, u.status, u.tenant_id, t.name AS tenant_name,
              u.created_at, u.updated_at
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ?`
    )
    .get(id);
  res.json(userToJson(saved));
}

app.patch('/users/:id', requirePlatformAdmin, updateUserHandler);
app.patch('/platform/users/:id', requirePlatformAdmin, updateUserHandler);

function deleteUserHandler(req, res) {
  const id = req.params.id;
  const me = req.user?.sub;
  if (id === me) {
    return res.status(400).json({ message: 'Cannot delete your own account' });
  }
  const target = db.prepare('SELECT role, platform_role, status, tenant_id FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ message: 'Not found' });
  const admins = db
    .prepare(
      `SELECT COUNT(*) AS c FROM users WHERE platform_role = 'PLATFORM_ADMIN' AND status = 'ACTIVE'`
    )
    .get().c;
  if (target.platform_role === PLATFORM_ROLES.PLATFORM_ADMIN && target.status === 'ACTIVE' && admins <= 1) {
    return res.status(400).json({ message: 'Cannot remove the last active platform admin' });
  }
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
}

app.delete('/users/:id', requirePlatformAdmin, deleteUserHandler);
app.delete('/platform/users/:id', requirePlatformAdmin, deleteUserHandler);

app.get('/platform/tenants/:tenantId/permissions', requirePlatformAdmin, (_req, res) => {
  res.json({
    permissions: Object.values(PERMISSIONS),
    templates: Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => ({
      role,
      permissions,
    })),
  });
});

app.get('/platform/roles', requirePlatformAdmin, (_req, res) => {
  res.json({ platformRoles: getPlatformRolesConfig() });
});

app.get('/platform/tenants/:tenantId/memberships', requirePlatformAdmin, (req, res) => {
  const tenantId = String(req.params.tenantId);
  const rows = db
    .prepare(
      `SELECT tm.*, u.email, u.name, u.status AS user_status, t.name AS tenant_name, t.slug AS tenant_slug, t.status AS tenant_status
       FROM tenant_memberships tm
       JOIN users u ON u.id = tm.user_id
       JOIN tenants t ON t.id = tm.tenant_id
       WHERE tm.tenant_id = ?
       ORDER BY u.email`
    )
    .all(tenantId);
  res.json({
    items: rows.map((row) => ({
      ...membershipToJson(row),
      userEmail: row.email,
      userName: row.name || row.email,
      userStatus: row.user_status,
    })),
  });
});

app.post('/platform/tenants/:tenantId/memberships', requirePlatformAdmin, (req, res) => {
  const tenantId = String(req.params.tenantId);
  const userId = String(req.body?.userId || '');
  const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId);
  if (!user) return res.status(400).json({ message: 'invalid userId' });
  try {
    const id = createOrUpdateMembership({
      userId,
      tenantId,
      role: normalizeMembershipRole(req.body?.role, TENANT_ROLES.VIEWER),
      permissions: req.body?.permissions,
      status: normalizeMembershipStatus(req.body?.status),
    });
    const row = db
      .prepare(
        `SELECT tm.*, t.name AS tenant_name, t.slug AS tenant_slug, t.status AS tenant_status
         FROM tenant_memberships tm JOIN tenants t ON t.id = tm.tenant_id
         WHERE tm.id = ?`
      )
      .get(id);
    res.status(201).json(membershipToJson(row));
  } catch (e) {
    res.status(400).json({ message: e instanceof Error ? e.message : 'invalid membership' });
  }
});

app.patch('/platform/tenants/:tenantId/memberships/:membershipId', requirePlatformAdmin, (req, res) => {
  const tenantId = String(req.params.tenantId);
  const membership = db
    .prepare(`SELECT * FROM tenant_memberships WHERE id = ? AND tenant_id = ?`)
    .get(req.params.membershipId, tenantId);
  if (!membership) return res.status(404).json({ message: 'Not found' });
  try {
    createOrUpdateMembership({
      userId: membership.user_id,
      tenantId,
      role: normalizeMembershipRole(req.body?.role, membership.role),
      permissions: req.body?.permissions ?? JSON.parse(membership.permissions_json || '[]'),
      status: normalizeMembershipStatus(req.body?.status || membership.status),
    });
    const row = db
      .prepare(
        `SELECT tm.*, t.name AS tenant_name, t.slug AS tenant_slug, t.status AS tenant_status
         FROM tenant_memberships tm JOIN tenants t ON t.id = tm.tenant_id
         WHERE tm.id = ?`
      )
      .get(req.params.membershipId);
    res.json(membershipToJson(row));
  } catch (e) {
    res.status(400).json({ message: e instanceof Error ? e.message : 'invalid membership' });
  }
});

app.delete('/platform/tenants/:tenantId/memberships/:membershipId', requirePlatformAdmin, (req, res) => {
  const r = db
    .prepare(`DELETE FROM tenant_memberships WHERE id = ? AND tenant_id = ?`)
    .run(req.params.membershipId, req.params.tenantId);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

function exportRecordRows(req) {
  const tenantId = tenantIdFromReq(req);
  let ownerId = req.query.ownerId ? String(req.query.ownerId) : '';
  if (req.query.mine === '1' || req.query.mine === 'true') {
    const sub = req.user?.sub ? String(req.user.sub) : '';
    if (sub) ownerId = sub;
  }
  const { where, params } = analyticsApi.buildRecordFilterWhere(tenantId, {
    archived: req.query.archived || 'exclude',
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
  const sql = `SELECT * FROM opportunities ${where} ORDER BY due_date ASC`;
  return db.prepare(sql).all(...params);
}

function recordExportRows(tenantId, rows) {
  const headers = recordImportHeaders(tenantId);
  const schemaFields = getTenantFieldDefinitions(tenantId);
  const items = rows.map((r) => {
    const o = mapOpportunityRow(r);
    const byHeader = {
      prospect: o.prospect,
      opportunity_description: o.opportunityDescription,
      owner_emails: (o.owners || []).map((x) => x.email).filter(Boolean).join('; '),
      deliverables: Array.isArray(o.deliverables) ? o.deliverables.join('; ') : '',
      due_date: o.dueDate,
      status: o.status,
      prospect_type: o.prospectType,
      engagement_type: o.engagementType,
      deal_stage: o.dealStage,
      value: o.value ?? '',
      currency: o.currency || 'USD',
      win_or_loss: o.winOrLoss,
      notes: o.notes || '',
      first_presales_call: o.firstPresalesCall || '',
      closed_date: o.closedDate || '',
    };
    for (const field of schemaFields) {
      byHeader[`custom.${field.key}`] = formatExportCell(o.customFields?.[field.key]);
    }
    return byHeader;
  });
  return { headers, items };
}

app.get('/export/opportunities.csv', requireTenantPermission(PERMISSIONS.REPORTS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const rows = exportRecordRows(req);
  const { headers, items } = recordExportRows(tenantId, rows);
  const lines = [headers.map(csvEscape).join(',')];
  for (const item of items) {
    lines.push(
      headers.map((header) => csvEscape(item[header] ?? '')).join(',')
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="opportunities.csv"');
  res.send(lines.join('\n'));
});

app.get('/export/opportunities.xlsx', requireTenantPermission(PERMISSIONS.REPORTS_READ), async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  try {
    const rows = exportRecordRows(req);
    const { headers, items } = recordExportRows(tenantId, rows);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Record Export';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Records', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
    sheet.columns = headers.map((header) => ({
      key: header,
      width: Math.max(16, Math.min(36, header.length + 4)),
    }));
    for (const item of items) {
      sheet.addRow(headers.map((header) => item[header] ?? ''));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="records-export.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : 'Export failed' });
  }
});

app.get('/export/reports/pipeline-summary.csv', requireTenantPermission(PERMISSIONS.REPORTS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const summary = analyticsApi.buildPipelineSummary(tenantId, req.query);
  const lines = ['section,key,count,totalValue'];
  for (const row of summary.totalsByStatus) {
    lines.push(['by_status', csvEscape(row.status), row.count, row.totalValue].join(','));
  }
  for (const row of summary.countsByOwner) {
    lines.push(['by_owner', csvEscape(row.ownerId), row.count, row.totalValue].join(','));
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

analyticsApi = initAnalytics({
  db,
  mapOpportunityRow,
  ownerDisplayNames,
  getTenantFieldDefinitions,
  DEFAULT_TENANT_ID,
});

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
    const tokenUser = jwt.verify(m[1], JWT_SECRET);
    const context = buildAuthContext(String(tokenUser?.sub || ''), req);
    if (!context) return res.status(403).json({ message: 'Forbidden' });
    req.user = context;
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

function defaultDealStage(tenantId = DEFAULT_TENANT_ID) {
  const stages = getDealStageValues(tenantId);
  return stages[0] || 'Discovery';
}

const RECORD_IMPORT_FIELD_EXCLUDE = new Set(['ownerIds', 'techStack']);

function recordFieldDbColumn(key) {
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

function activeSystemRecordFields(tenantId) {
  return getRecordSchemaDefinitions(tenantId).filter(
    (field) => field.source === 'system' && field.status !== 'INACTIVE'
  );
}

function readRecordFieldFromSource(source, key, useDbColumns = false) {
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

function validateRecordSchemaChoiceFields(tenantId, source, useDbColumns = false) {
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

function validateRecordSchemaRequiredForPublish(tenantId, source, useDbColumns = false) {
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

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tenantConfigKey(tenantId, key) {
  return `tenant:${tenantId || DEFAULT_TENANT_ID}:${key}`;
}

function globalConfigKey(key) {
  return `global:${key}`;
}

function getGlobalConfigValue(key, fallback, normalize = (v) => v) {
  const row = db
    .prepare(
      `SELECT value_json FROM app_config
       WHERE key = ? AND (tenant_id IS NULL OR tenant_id = '')
       LIMIT 1`
    )
    .get(globalConfigKey(key));
  if (!row?.value_json) return fallback;
  try {
    const result = normalize(JSON.parse(row.value_json));
    return result == null ? fallback : result;
  } catch {
    return fallback;
  }
}

function setGlobalConfigValue(key, value) {
  db.prepare(
    `INSERT INTO app_config (key, tenant_id, value_json) VALUES (@key, @tenant_id, @value_json)
     ON CONFLICT(key) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      value_json = excluded.value_json`
  ).run({
    key: globalConfigKey(key),
    tenant_id: '',
    value_json: JSON.stringify(value),
  });
}

function getDealStageValues(tenantId = DEFAULT_TENANT_ID) {
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

function getActiveUsersMap(tenantId = '') {
  const where = tenantId
    ? `JOIN tenant_memberships tm ON tm.user_id = u.id
       WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'`
    : `WHERE u.status = 'ACTIVE'`;
  const rows = db
    .prepare(`SELECT u.id, u.email, u.name FROM users u ${where}`)
    .all(...(tenantId ? [tenantId] : []));
  return new Map(rows.map((u) => [u.id, u]));
}

function migrateRetiredCaseStudySchemaFields() {
  const retiredKeys = [
    'buildDays',
    'tokenUsage',
    'aiCostUsd',
    'token_usage',
    'ai_cost',
  ];
  const tenants = db.prepare(`SELECT id FROM tenants`).all();
  const deleteFieldDef = db.prepare(
    `DELETE FROM tenant_field_definitions
     WHERE tenant_id = ? AND entity = 'opportunity' AND key = ?`
  );
  const updateOpp = db.prepare(
    `UPDATE opportunities SET custom_data_json = ?, updated_at = ? WHERE id = ?`
  );

  for (const tenant of tenants) {
    const tenantId = tenant.id;
    const formConfig = getRecordFormFieldConfig(tenantId);
    let formChanged = false;
    for (const key of retiredKeys) {
      if (formConfig[key]) {
        delete formConfig[key];
        formChanged = true;
      }
    }
    if (formChanged) setRecordFormFieldConfig(tenantId, formConfig);

    for (const key of retiredKeys) {
      deleteFieldDef.run(tenantId, key);
    }

    const rows = db
      .prepare(
        `SELECT id, custom_data_json FROM opportunities WHERE tenant_id = ?`
      )
      .all(tenantId);
    const now = new Date().toISOString();
    for (const row of rows) {
      let customFields = {};
      try {
        customFields = JSON.parse(row.custom_data_json || '{}');
      } catch {
        customFields = {};
      }
      let changed = false;
      for (const key of retiredKeys) {
        if (Object.prototype.hasOwnProperty.call(customFields, key)) {
          delete customFields[key];
          changed = true;
        }
      }
      if (changed) {
        updateOpp.run(JSON.stringify(customFields), now, row.id);
      }
    }
  }
}

function migrateLegacyOwnerIds() {
  const rows = db.prepare('SELECT id, tenant_id, owner_json FROM opportunities').all();
  const upd = db.prepare('UPDATE opportunities SET owner_json = ? WHERE id = ?');
  for (const row of rows) {
    const tenantId = row.tenant_id || DEFAULT_TENANT_ID;
    const users = db
      .prepare(
        `SELECT u.id, u.email, u.name
         FROM users u
         JOIN tenant_memberships tm ON tm.user_id = u.id
         WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'`
      )
      .all(tenantId);
    const byName = new Map();
    for (const u of users) {
      if (u.name) byName.set(String(u.name).toLowerCase(), u.id);
      byName.set(String(u.email).toLowerCase(), u.id);
    }
    const fallback = users[0]?.id;
    let raw = [];
    try {
      raw = JSON.parse(row.owner_json || '[]');
    } catch {
      raw = [];
    }
    if (!Array.isArray(raw)) raw = [raw].filter(Boolean);
    const next = [];
    let changed = false;
    for (const entry of raw.map(String)) {
      if (isUuid(entry)) {
        next.push(entry);
        if (!users.some((u) => u.id === entry)) changed = true;
      } else {
        const id = byName.get(entry.toLowerCase()) || fallback;
        if (id) {
          next.push(id);
          changed = true;
        }
      }
    }
    if (!next.length && fallback) {
      next.push(fallback);
      changed = true;
    }
    const deduped = [...new Set(next)];
    if (changed || JSON.stringify(deduped) !== JSON.stringify(raw)) {
      upd.run(JSON.stringify(deduped), row.id);
    }
  }
}

function normalizeOwnerIds(ownerIds, tenantId = DEFAULT_TENANT_ID) {
  if (!ownerIds) return [];
  const ids = Array.isArray(ownerIds)
    ? ownerIds.map(String).filter(Boolean)
    : [String(ownerIds)].filter(Boolean);
  const valid = [];
  for (const id of ids) {
    const row = db
      .prepare(
        `SELECT u.id
         FROM users u
         JOIN tenant_memberships tm ON tm.user_id = u.id
         WHERE u.id = ? AND tm.tenant_id = ? AND u.status = 'ACTIVE' AND tm.status = 'ACTIVE'`
      )
      .get(id, tenantId);
    if (row) valid.push(id);
  }
  return [...new Set(valid)];
}

function syncRecordOwners(recordId, tenantId, ownerIds) {
  db.prepare(`DELETE FROM record_owners WHERE record_id = ? AND tenant_id = ?`).run(recordId, tenantId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO record_owners (record_id, tenant_id, user_id, created_at)
     VALUES (?, ?, ?, ?)`
  );
  const now = nowIso();
  for (const ownerId of normalizeOwnerIds(ownerIds, tenantId)) {
    insert.run(recordId, tenantId, ownerId, now);
  }
}

function resolveOwnersFromJson(ownerJson, tenantId = '', usersMap) {
  const userMap = usersMap || getActiveUsersMap(tenantId);
  let ids = [];
  try {
    ids = JSON.parse(ownerJson || '[]');
  } catch {
    ids = [];
  }
  if (!Array.isArray(ids)) ids = [ids].filter(Boolean);
  const ownerIds = [];
  const owners = [];
  for (const entry of ids.map(String)) {
    if (isUuid(entry)) {
      const u = userMap.get(entry);
      if (u) {
        ownerIds.push(entry);
        owners.push({
          id: entry,
          name: u.name || u.email,
          email: u.email,
        });
      }
    } else if (entry) {
      ownerIds.push(entry);
      owners.push({ id: entry, name: entry, email: '' });
    }
  }
  return { ownerIds, owners };
}

function ownerDisplayNames(ownerJson, tenantId = '') {
  const { owners } = resolveOwnersFromJson(ownerJson, tenantId);
  if (!owners.length) return ['Unassigned'];
  return owners.map((o) => o.name || o.email);
}

function logActivity({ opportunityId, req, kind, body, meta }) {
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

function mapActivityRow(r) {
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

function recordOpportunityFieldChanges(before, after, req) {
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

function normalizeOwners(ownerIds, tenantId = DEFAULT_TENANT_ID) {
  return normalizeOwnerIds(ownerIds, tenantId);
}

function formatDeliverables(d) {
  if (d === undefined || d === null) return '';
  if (Array.isArray(d)) return d.map(String).join(', ');
  return String(d);
}

function mapOpportunityRow(r, usersMap) {
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

function mapOpportunityRows(rows, tenantId = DEFAULT_TENANT_ID) {
  const userMap = getActiveUsersMap(tenantId);
  return rows.map((row) => mapOpportunityRow(row, userMap));
}

function validateOpportunityRowForPublish(row, tenantId = DEFAULT_TENANT_ID) {
  const requiredErr = validateRecordSchemaRequiredForPublish(tenantId, row, true);
  if (requiredErr) return requiredErr;
  const choiceErr = validateRecordSchemaChoiceFields(tenantId, row, true);
  if (choiceErr) return choiceErr;
  if (row.value !== undefined && !Number.isFinite(Number(row.value))) return 'value must be a number';
  if (row.value !== undefined && Number(row.value) < 0) return 'value must be >= 0';
  return '';
}

function createOpportunityRecord(body, tenantId = DEFAULT_TENANT_ID, req) {
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

function recordImportHeaders(tenantId = DEFAULT_TENANT_ID) {
  return recordImportColumns(tenantId).map((column) => column.header);
}

function recordImportColumns(tenantId = DEFAULT_TENANT_ID) {
  const ownerEmails = db
    .prepare(
      `SELECT u.email
       FROM users u
       JOIN tenant_memberships tm ON tm.user_id = u.id
       WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
       ORDER BY u.email`
    )
    .all(tenantId)
    .map((user) => user.email);

  const columns = [];
  for (const field of activeSystemRecordFields(tenantId)) {
    if (RECORD_IMPORT_FIELD_EXCLUDE.has(field.key)) continue;
    if (field.key === 'ownerIds') {
      columns.push({
        header: 'owner_emails',
        required: field.required,
        type: 'lookup',
        options: ownerEmails,
      });
      continue;
    }
    const header = recordFieldDbColumn(field.key);
    columns.push({
      header,
      required: field.required,
      type: importColumnTypeForField(field.fieldType),
      options: recordSchemaFieldOptions(tenantId, field.key),
    });
  }

  const customFields = getRecordSchemaDefinitions(tenantId).filter(
    (field) => field.source === 'custom' && field.status !== 'INACTIVE'
  );
  for (const field of customFields) {
    columns.push({
      header: `custom.${field.key}`,
      required: field.required,
      type: importColumnTypeForField(field.fieldType),
      options: field.options || [],
    });
  }

  return columns;
}

async function buildRecordImportWorkbook(tenantId = DEFAULT_TENANT_ID) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Record Import Template';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Records', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const lookupSheet = workbook.addWorksheet('Lookup Values');
  lookupSheet.state = 'veryHidden';
  const columns = recordImportColumns(tenantId);
  sheet.addRow(columns.map((column) => column.header));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  sheet.columns = columns.map((column) => ({
    key: column.header,
    width: Math.max(18, Math.min(36, column.header.length + 4)),
  }));

  const lookupRanges = new Map();
  columns.forEach((column, index) => {
    const values = [...new Set((column.options || []).map(String).filter(Boolean))];
    if (!values.length) return;
    const lookupColumnNumber = lookupRanges.size + 1;
    lookupSheet.getCell(1, lookupColumnNumber).value = column.header;
    values.forEach((value, rowIndex) => {
      lookupSheet.getCell(rowIndex + 2, lookupColumnNumber).value = value;
    });
    lookupSheet.getColumn(lookupColumnNumber).width = Math.max(
      18,
      Math.min(60, values.reduce((max, value) => Math.max(max, value.length), column.header.length) + 2)
    );
    const letter = excelColumnLetter(lookupColumnNumber);
    lookupRanges.set(index + 1, `'Lookup Values'!$${letter}$2:$${letter}$${values.length + 1}`);
  });

  for (let rowNumber = 2; rowNumber <= 1001; rowNumber += 1) {
    columns.forEach((column, index) => {
      const cell = sheet.getCell(rowNumber, index + 1);
      if (column.type === 'date') {
        cell.numFmt = 'yyyy-mm-dd';
        cell.dataValidation = {
          type: 'date',
          operator: 'greaterThanOrEqual',
          allowBlank: !column.required,
          formulae: [new Date(1900, 0, 1)],
          showErrorMessage: true,
          errorTitle: 'Invalid date',
          error: 'Enter a date in yyyy-mm-dd format.',
        };
      } else if (column.type === 'number' || column.type === 'currency' || column.type === 'percent') {
        cell.dataValidation = {
          type: 'decimal',
          operator: 'greaterThanOrEqual',
          allowBlank: !column.required,
          formulae: [0],
          showErrorMessage: true,
          errorTitle: 'Invalid number',
          error: 'Enter a non-negative number.',
        };
      } else if (lookupRanges.has(index + 1)) {
        cell.dataValidation = {
          type: 'list',
          allowBlank: !column.required,
          formulae: [lookupRanges.get(index + 1)],
          showErrorMessage: true,
          errorTitle: 'Invalid value',
          error: 'Choose a value from the dropdown list.',
        };
      }
    });
  }

  const instructions = workbook.addWorksheet('Instructions');
  instructions.addRows([
    ['How to use this template'],
    ['Fill rows in the Records sheet only.'],
    ['Use dropdowns where available; uploaded files are validated again by the server.'],
    ['For multi-value fields, use comma-separated values. Each value must match the lookup list exactly.'],
    ['Do not rename or remove the header row.'],
  ]);
  instructions.getColumn(1).width = 100;
  instructions.getRow(1).font = { bold: true };
  return workbook.xlsx.writeBuffer();
}

function formatImportDateValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + value * 86400000).toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function excelColumnLetter(columnNumber) {
  let n = Number(columnNumber);
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function importCellValue(cell) {
  const value = cell?.value;
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return formatImportDateValue(value);
  if (typeof value !== 'object') return String(value).trim();
  if (value.text) return String(value.text).trim();
  if (value.result !== undefined && value.result !== null) return String(value.result).trim();
  if (Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || '').join('').trim();
  }
  return cell.text ? String(cell.text).trim() : '';
}

async function rowsFromImportWorkbook(buffer, tenantId = DEFAULT_TENANT_ID) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Records') || workbook.worksheets[0];
  if (!sheet) return [];
  const dateHeaders = new Set(
    recordImportColumns(tenantId)
      .filter((column) => column.type === 'date')
      .map((column) => column.header)
  );
  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = importCellValue(cell);
    if (header) headers[colNumber] = header;
  });
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const item = {};
    let hasValue = false;
    headers.forEach((header, colNumber) => {
      if (!header) return;
      const rawValue = row.getCell(colNumber).value;
      let value =
        rawValue instanceof Date || (dateHeaders.has(header) && typeof rawValue === 'number')
          ? formatImportDateValue(rawValue)
          : importCellValue(row.getCell(colNumber));
      if (value !== '') hasValue = true;
      item[header] = value;
    });
    if (hasValue) rows.push(item);
  });
  return rows;
}

function validateImportRowLookups(row, tenantId = DEFAULT_TENANT_ID) {
  for (const field of activeSystemRecordFields(tenantId)) {
    if (!isSchemaChoiceFieldType(field.fieldType)) continue;
    const header = recordFieldDbColumn(field.key);
    const multi = isSchemaMultiChoiceFieldType(field.fieldType);
    const raw =
      row[header] ??
      row[field.key] ??
      (field.key === 'dealStage' || header === 'deal_stage'
        ? defaultDealStage(tenantId)
        : undefined);
    validateImportLookupValue(
      header,
      raw,
      recordSchemaFieldOptions(tenantId, field.key),
      multi
    );
  }
  const customFields = getRecordSchemaDefinitions(tenantId).filter(
    (field) => field.source === 'custom' && field.status !== 'INACTIVE'
  );
  for (const field of customFields) {
    if (!isSchemaChoiceFieldType(field.fieldType)) continue;
    const header = `custom.${field.key}`;
    const multi = isSchemaMultiChoiceFieldType(field.fieldType);
    validateImportLookupValue(header, row[header], field.options || [], multi);
  }
}

function validateLookupValue(label, raw, options, multi = false) {
  return validateChoiceValue(label, raw, options, multi);
}

function validateImportLookupValue(label, raw, options, multi = false) {
  assertChoiceValue(label, raw, options, multi);
}


function splitImportList(value) {
  return String(value || '')
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function importOwnerIds(row, tenantId) {
  const explicitIds = splitImportList(row.owner_ids || row.ownerIds);
  if (explicitIds.length) return explicitIds;
  const emails = splitImportList(row.owner_emails || row.ownerEmails).map((email) =>
    email.toLowerCase()
  );
  if (!emails.length) return [];
  const users = db
    .prepare(
      `SELECT u.id, lower(u.email) AS email
       FROM users u
       JOIN tenant_memberships tm ON tm.user_id = u.id
       WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'`
    )
    .all(tenantId);
  const byEmail = new Map(users.map((user) => [user.email, user.id]));
  return emails.map((email) => byEmail.get(email)).filter(Boolean);
}

function parseImportCustomValue(raw, field) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (['number', 'currency', 'percent'].includes(field.fieldType)) return Number(raw);
  if (field.fieldType === 'boolean') {
    const value = String(raw).trim().toLowerCase();
    return ['1', 'true', 'yes', 'y'].includes(value);
  }
  if (field.fieldType === 'multi_select' || field.fieldType === 'lookup_multi_select') return splitImportList(raw);
  return String(raw).trim();
}

function recordImportRowToPayload(rawRow, tenantId = DEFAULT_TENANT_ID) {
  if (!rawRow || typeof rawRow !== 'object') throw new Error('row must be an object');
  const row = {};
  for (const [key, value] of Object.entries(rawRow)) {
    row[String(key).trim()] = typeof value === 'string' ? value.trim() : value;
  }
  validateImportRowLookups(row, tenantId);
  const customFields = {};
  for (const field of getTenantFieldDefinitions(tenantId)) {
    const raw = row[`custom.${field.key}`] ?? row[field.key];
    const parsed = parseImportCustomValue(raw, field);
    if (parsed !== undefined) customFields[field.key] = parsed;
  }
  return {
    prospect: row.prospect,
    opportunityDescription: row.opportunity_description || row.opportunityDescription || '',
    ownerIds: importOwnerIds(row, tenantId),
    deliverables: splitImportList(row.deliverables),
    dueDate: row.due_date || row.dueDate,
    status: row.status,
    prospectType: row.prospect_type || row.prospectType,
    engagementType: row.engagement_type || row.engagementType,
    dealStage: row.deal_stage || row.dealStage || defaultDealStage(tenantId),
    value: row.value === '' || row.value === undefined ? 0 : Number(row.value),
    currency: row.currency || 'USD',
    winOrLoss: row.win_or_loss || row.winOrLoss || 'Open',
    notes: row.notes || '',
    firstPresalesCall: row.first_presales_call || row.firstPresalesCall || null,
    closedDate: row.closed_date || row.closedDate || null,
    customFields,
  };
}

function csvEscape(s) {
  const x = String(s ?? '');
  if (/[",\n\r]/.test(x)) return `"${x.replace(/"/g, '""')}"`;
  return x;
}

function formatExportCell(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function inferReminderOffsets(thresholdStr) {
  const t = Number(thresholdStr);
  const set = new Set([7, 1, 0]);
  if (!Number.isNaN(t) && t >= 0) set.add(t);
  return [...set].sort((a, b) => b - a);
}

function defaultDashboardConfig() {
  return {
    title: 'Dashboard',
    subtitle: "Welcome back! Here's your workspace overview.",
    widgets: [
      {
        id: 'total-records',
        title: 'Visible Records',
        type: 'metric_count',
      },
      {
        id: 'total-value',
        title: 'Total Value',
        type: 'metric_sum',
        field: 'value',
      },
      {
        id: 'by-status',
        title: 'Records by Status',
        type: 'bar',
        field: 'status',
      },
      {
        id: 'by-stage',
        title: 'Records by Stage',
        type: 'pie',
        field: 'dealStage',
      },
    ],
  };
}

function defaultTerminologyConfig() {
  return {
    appName: 'Opportunity Tracker',
    recordSingular: 'Record',
    recordPlural: 'Records',
    recordDescription: 'Track work items, projects, opportunities, or engagements.',
    dashboardLabel: 'Dashboard',
  };
}

function normalizeTerminologyConfig(input) {
  const defaults = defaultTerminologyConfig();
  const src = input && typeof input === 'object' ? input : {};
  const clean = (key, max) => {
    const value = String(src[key] || defaults[key]).trim().slice(0, max);
    return value || defaults[key];
  };
  return {
    appName: clean('appName', 80),
    recordSingular: clean('recordSingular', 40),
    recordPlural: clean('recordPlural', 40),
    recordDescription: clean('recordDescription', 180),
    dashboardLabel: clean('dashboardLabel', 40),
  };
}

function defaultPageAccessConfig() {
  return {
    pages: [
      'dashboard',
      'records',
      'artifacts',
      'caseStudies',
      'notifications',
      'reports',
      'settings',
    ],
    // v2 shape: pages -> { read, write } per role.
    // v1 legacy shape: role -> string[] pages is migrated in normalizePageAccessConfig.
    roles: {
      TENANT_ADMIN: {
        dashboard: { read: true, write: false },
        records: { read: true, write: true },
        artifacts: { read: true, write: true },
        caseStudies: { read: true, write: false },
        notifications: { read: true, write: false },
        reports: { read: true, write: false },
        settings: { read: true, write: true },
      },
      MANAGER: {
        dashboard: { read: true, write: false },
        records: { read: true, write: true },
        artifacts: { read: true, write: true },
        caseStudies: { read: true, write: false },
        notifications: { read: true, write: false },
        reports: { read: true, write: false },
        settings: { read: false, write: false },
      },
      VIEWER: {
        dashboard: { read: true, write: false },
        records: { read: true, write: false },
        artifacts: { read: true, write: false },
        caseStudies: { read: true, write: false },
        notifications: { read: true, write: false },
        reports: { read: true, write: false },
        settings: { read: false, write: false },
      },
    },
  };
}

function defaultPlatformRolesConfig() {
  return {
    roles: [
      { key: 'TENANT_ADMIN', label: 'Workspace Admin' },
      { key: 'MANAGER', label: 'Manager' },
      { key: 'VIEWER', label: 'Viewer' },
    ],
  };
}

function normalizePlatformRolesConfig(input) {
  const defaults = defaultPlatformRolesConfig();
  const src = input && typeof input === 'object' ? input : {};
  const raw = Array.isArray(src.roles) ? src.roles : [];
  const seen = new Set();
  const roles = raw
    .filter((r) => r && typeof r === 'object')
    .map((r, idx) => {
      const fallback = defaults.roles[idx] || defaults.roles[0];
      const key = String(r.key || fallback.key || `ROLE_${idx + 1}`)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
      const label =
        String(r.label || fallback.label || key)
          .trim()
          .slice(0, 40) || key;
      return {
        key: key || fallback.key,
        label,
      };
    })
    .filter((r) => {
      if (!r.key) return false;
      if (seen.has(r.key)) return false;
      seen.add(r.key);
      return true;
    });
  // Ensure core roles always exist.
  for (const core of defaults.roles) {
    if (!seen.has(core.key)) roles.push(core);
  }
  return { roles };
}

function getPlatformRolesConfig() {
  const base = getGlobalConfigValue(
    'platform_roles_config',
    defaultPlatformRolesConfig(),
    normalizePlatformRolesConfig
  );

  // Backward compatibility: older builds stored roles per-tenant under `tenant:*:tenant_roles_config`.
  // If a platform admin created roles previously (e.g. ROLE_4), we merge them into the platform catalog
  // so memberships don’t start failing after the platform-wide refactor.
  let legacy = [];
  try {
    const rows = db
      .prepare(`SELECT value_json FROM app_config WHERE key LIKE 'tenant:%:tenant_roles_config'`)
      .all();
    for (const row of rows) {
      if (!row?.value_json) continue;
      try {
        const parsed = normalizePlatformRolesConfig(JSON.parse(row.value_json));
        legacy.push(...(parsed?.roles || []));
      } catch {
        // ignore malformed legacy rows
      }
    }
  } catch {
    legacy = [];
  }

  if (!legacy.length) return base;

  const merged = normalizePlatformRolesConfig({
    roles: [...(base.roles || []), ...legacy],
  });

  // Persist merged catalog once so future reads are consistent.
  try {
    setGlobalConfigValue('platform_roles_config', merged);
  } catch {
    // ignore write errors; we still return merged for this request.
  }
  return merged;
}

function isAllowedPlatformRole(roleKey) {
  const rolesCfg = getPlatformRolesConfig();
  return Boolean((rolesCfg.roles || []).some((r) => r.key === roleKey));
}

function tenantRoleKeyFromLegacyRole(role) {
  return tenantRoleFromLegacyRole(role);
}

function defaultTenantRolePermissionsConfig() {
  return {
    roles: {
      TENANT_ADMIN: ROLE_PERMISSIONS[TENANT_ROLES.TENANT_ADMIN],
      MANAGER: ROLE_PERMISSIONS[TENANT_ROLES.MANAGER],
      VIEWER: ROLE_PERMISSIONS[TENANT_ROLES.VIEWER],
    },
  };
}

function normalizeTenantRolePermissionsConfig(input, tenantId) {
  const defaults = defaultTenantRolePermissionsConfig();
  const rolesCfg = getPlatformRolesConfig();
  const allowedRoleKeys = new Set((rolesCfg.roles || []).map((r) => r.key));
  const allowedPerms = new Set(Object.values(PERMISSIONS));
  const src = input && typeof input === 'object' ? input : {};
  const rawRoles = src.roles && typeof src.roles === 'object' ? src.roles : {};
  const out = {};
  for (const roleKey of allowedRoleKeys) {
    const raw = Array.isArray(rawRoles[roleKey]) ? rawRoles[roleKey] : defaults.roles[roleKey] || [];
    out[roleKey] = [...new Set(raw.map(String).filter((p) => allowedPerms.has(p)))];
  }
  return { roles: out };
}

function getTenantRolePermissionsConfig(tenantId) {
  return getConfigValue(
    tenantId,
    'tenant_role_permissions_config',
    defaultTenantRolePermissionsConfig(),
    (parsed) => normalizeTenantRolePermissionsConfig(parsed, tenantId)
  );
}

function permissionsForTenantRole(tenantId, roleKey) {
  const permsCfg = getTenantRolePermissionsConfig(tenantId);
  const list = permsCfg.roles?.[roleKey];
  if (Array.isArray(list)) return list;
  // Backward compatibility for base roles even if role list changed.
  if (Object.values(TENANT_ROLES).includes(roleKey)) return ROLE_PERMISSIONS[roleKey] || [];
  return [];
}

function defaultSummaryCardsConfig() {
  return {
    cards: [
      { id: 'records-count', aggregation: 'count', label: 'Visible Records', description: 'After filters' },
      { id: 'records-value', aggregation: 'sum', field: 'value', label: 'Total Value', description: 'Sum of record values' },
      { id: 'records-completed', aggregation: 'count', filter: { mode: 'preset', preset: 'completed' }, label: 'Completed', description: 'Done records' },
      { id: 'records-overdue', aggregation: 'count', filter: { mode: 'preset', preset: 'overdue' }, label: 'Overdue', description: 'Needs attention' },
    ],
  };
}

function normalizeSummaryCardsConfig(input) {
  const defaults = defaultSummaryCardsConfig();
  const src = input && typeof input === 'object' ? input : {};
  const raw = Array.isArray(src.cards) ? src.cards : [];
  const allowedAggs = new Set(['count', 'sum', 'avg', 'min', 'max']);
  const allowedPresets = new Set(['all', 'completed', 'overdue']);
  const allowedOps = new Set(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'is_empty', 'is_not_empty']);
  const normalizeFilter = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'string') {
      return allowedPresets.has(value) ? { mode: 'preset', preset: value } : fallback;
    }
    if (!value || typeof value !== 'object') return fallback;
    if (String(value.mode) === 'field') {
      const field = String(value.field || '').trim();
      const op = String(value.op || 'eq');
      const v = value.value !== undefined ? String(value.value) : undefined;
      if (!field) return fallback;
      if (!allowedOps.has(op)) return fallback;
      return { mode: 'field', field, op, value: v };
    }
    const preset = String(value.preset || value.filter || '').trim();
    return allowedPresets.has(preset) ? { mode: 'preset', preset } : fallback;
  };
  const cards = raw
    .filter((c) => c && typeof c === 'object')
    .map((c, idx) => ({
      id: String(c.id || `card-${idx}`),
      aggregation: allowedAggs.has(String(c.aggregation))
        ? String(c.aggregation)
        : String(c.type) === 'metric_sum'
          ? 'sum'
          : String(c.type) === 'metric_avg'
            ? 'avg'
            : String(c.metric) === 'sumValue'
              ? 'sum'
              : 'count',
      field: c.field !== undefined ? String(c.field) : defaults.cards[idx]?.field,
      filter: normalizeFilter(c.filter, defaults.cards[idx]?.filter),
      label:
        String(c.label || defaults.cards[idx]?.label || '').trim().slice(0, 60) ||
        defaults.cards[idx]?.label,
      description:
        String(c.description || defaults.cards[idx]?.description || '').trim().slice(0, 120) ||
        defaults.cards[idx]?.description,
    }));
  return { cards: cards.slice(0, 20).length ? cards.slice(0, 20) : defaults.cards };
}

function normalizePageAccessConfigForTenant(input, tenantId) {
  const defaults = defaultPageAccessConfig();
  const rolesCfg = getPlatformRolesConfig();
  const roleKeys = [...new Set((rolesCfg.roles || []).map((r) => r.key))];

  const src = input && typeof input === 'object' ? input : {};
  const validPages = new Set(defaults.pages);
  const normalizeList = (raw) =>
    (Array.isArray(raw) ? raw : [])
      .map(String)
      .filter((p) => validPages.has(p));
  const roles = src.roles && typeof src.roles === 'object' ? src.roles : {};
  // `pages` represents the set of pages that existed when the config was saved.
  // When we add new pages in a future release, we auto-include them using role defaults.
  // But we must NOT re-add pages that an admin intentionally unchecked.
  const knownPages = normalizeList(src.pages);
  const newPages = defaults.pages.filter((p) => !knownPages.includes(p));
  const normalizePerm = (value, fallback) => ({
    read: value && typeof value === 'object' ? Boolean(value.read) : Boolean(fallback?.read),
    write: value && typeof value === 'object' ? Boolean(value.write) : Boolean(fallback?.write),
  });
  const mergeRolePages = (roleKey) => {
    const legacySavedPages = normalizeList(roles[roleKey]);
    const isLegacy = Array.isArray(roles[roleKey]);
    const saved = !isLegacy && roles[roleKey] && typeof roles[roleKey] === 'object' ? roles[roleKey] : null;
    const baseFallback =
      defaults.roles[roleKey] ||
      defaults.roles.VIEWER ||
      Object.values(defaults.roles)[0];
    const base = saved || (legacySavedPages.length ? null : baseFallback);
    const out = {};
    for (const page of defaults.pages) {
      const legacyRead = legacySavedPages.includes(page);
      const fallback = baseFallback?.[page] || { read: false, write: false };
      const fromSaved = saved ? saved[page] : null;
      const next = fromSaved
        ? normalizePerm(fromSaved, fallback)
        : legacyRead
          ? { read: true, write: fallback.write }
          : normalizePerm(base?.[page], fallback);
      out[page] = next;
    }
    // Auto-add any new pages based on defaults read/write (only if the page is new).
    for (const page of newPages) {
      out[page] = out[page] || baseFallback?.[page] || { read: false, write: false };
    }
    return out;
  };

  const outRoles = {};
  for (const roleKey of roleKeys) {
    outRoles[roleKey] = mergeRolePages(roleKey);
  }
  return {
    pages: defaults.pages,
    roles: outRoles,
  };
}

function normalizePageAccessConfig(input) {
  // Backward-compatible default when tenantId isn't available.
  return normalizePageAccessConfigForTenant(input, null);
}

function defaultThemeConfig() {
  return {
    primaryColor: '#2563eb',
    accentColor: '#eaf1ff',
    backgroundColor: '#f7f9fc',
    cardColor: '#ffffff',
    sidebarColor: '#ffffff',
    radius: '0.875rem',
  };
}

function normalizeHexColor(value, fallback) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return fallback;
}

function normalizeRadius(value, fallback) {
  const raw = String(value || '').trim();
  if (/^(0|0?\.\d+|[1-9]\d*(\.\d+)?)(rem|px)$/.test(raw)) return raw;
  return fallback;
}

function normalizeThemeConfig(input) {
  const defaults = defaultThemeConfig();
  const src = input && typeof input === 'object' ? input : {};
  return {
    primaryColor: normalizeHexColor(src.primaryColor, defaults.primaryColor),
    accentColor: normalizeHexColor(src.accentColor, defaults.accentColor),
    backgroundColor: normalizeHexColor(src.backgroundColor, defaults.backgroundColor),
    cardColor: normalizeHexColor(src.cardColor, defaults.cardColor),
    sidebarColor: normalizeHexColor(src.sidebarColor, defaults.sidebarColor),
    radius: normalizeRadius(src.radius, defaults.radius),
  };
}

function normalizeDashboardConfig(input, tenantId = DEFAULT_TENANT_ID) {
  const defaults = defaultDashboardConfig();
  const src = input && typeof input === 'object' ? input : {};
  const validFields = new Set([
    'status',
    'dealStage',
    'winOrLoss',
    'prospectType',
    'engagementType',
    'value',
    'dueDate',
    'owner',
    'currency',
    ...getTenantFieldDefinitions(tenantId).map((field) => `custom:${field.key}`),
  ]);
  const rawWidgets = Array.isArray(src.widgets)
    ? src.widgets
    : src.sections && typeof src.sections === 'object'
      ? defaults.widgets
      : defaults.widgets;
  const allowedTypes = new Set(['metric_count', 'metric_sum', 'metric_avg', 'bar', 'pie']);
  const widgets = rawWidgets
    .map((w, i) => {
      const widget = w && typeof w === 'object' ? w : {};
      const type = allowedTypes.has(String(widget.type))
        ? String(widget.type)
        : 'metric_count';
      const id = String(widget.id || `widget-${i + 1}`)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 64);
      const requestedField = widget.field ? String(widget.field).trim() : '';
      const field = validFields.has(requestedField) ? requestedField : '';
      return {
        id: id || `widget-${i + 1}`,
        title: String(widget.title || 'Dashboard Widget').slice(0, 80),
        type,
        field: type === 'metric_count' ? '' : field,
        limit: Math.max(1, Math.min(20, Number(widget.limit || 8))),
      };
    })
    .filter((w) => w.type === 'metric_count' || w.field);
  return {
    title: String(src.title || defaults.title).slice(0, 80),
    subtitle: String(src.subtitle || defaults.subtitle).slice(0, 180),
    widgets: widgets.length ? widgets : defaults.widgets,
  };
}

function normalizeListTableLayout(input) {
  // Defined inside the function to avoid top-level initialization ordering issues
  // (this runs during startup seeding before the rest of the module is evaluated).
  const LIST_TABLE_COLUMN_KEYS = [
    'prospect',
    'description',
    'owner',
    'dueDate',
    'stage',
    'status',
    'value',
    'winLoss',
  ];
  const defaults = { columns: [...LIST_TABLE_COLUMN_KEYS] };
  const src = input && typeof input === 'object' ? input : {};
  const raw = Array.isArray(src.columns) ? src.columns : null;
  if (!raw) return defaults;
  const columns = raw.map(String).filter((key) => LIST_TABLE_COLUMN_KEYS.includes(key));
  return { columns: columns.length ? columns : defaults.columns };
}

function normalizeReportsLayout(input) {
  // Defined inside the function to avoid top-level initialization ordering issues.
  const REPORT_SECTION_KEYS = [
    'pipelineByStatus',
    'countByOwner',
    'dueDateTimeline',
    'winLoss',
    'engagementType',
  ];
  const defaults = { sections: [...REPORT_SECTION_KEYS] };
  const src = input && typeof input === 'object' ? input : {};
  const raw = Array.isArray(src.sections) ? src.sections : null;
  if (!raw) return defaults;
  const sections = raw.map(String).filter((key) => REPORT_SECTION_KEYS.includes(key));
  return { sections: sections.length ? sections : defaults.sections };
}

function normalizeCaseStudyLayoutValue(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.columns)) {
    return null;
  }
  const columns = input.columns
    .filter((col) => col && typeof col === 'object')
    .map((col, index) => {
      const normalized = {
        id: String(col.id || `col-${index + 1}`).trim(),
        entries: Array.isArray(col.entries)
          ? col.entries.filter((entry) => entry && typeof entry === 'object')
          : [],
      };
      if (col.title !== undefined && col.title !== null && String(col.title).trim()) {
        normalized.title = String(col.title);
      }
      return normalized;
    })
    .filter((col) => col.entries.length > 0);
  return { columns };
}

function getConfigValue(tenantId, key, fallback, normalize = (v) => v) {
  const scopedKey = tenantConfigKey(tenantId, key);
  const row = db
    .prepare(
      `SELECT value_json FROM app_config
       WHERE key = ? AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')
       LIMIT 1`
    )
    .get(scopedKey, tenantId || DEFAULT_TENANT_ID);
  if (!row?.value_json) return fallback;
  try {
    const result = normalize(JSON.parse(row.value_json));
    return result == null ? fallback : result;
  } catch {
    return fallback;
  }
}

function setConfigValue(tenantId, key, value) {
  db.prepare(
    `INSERT INTO app_config (key, tenant_id, value_json) VALUES (@key, @tenant_id, @value_json)
     ON CONFLICT(key) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      value_json = excluded.value_json`
  ).run({
    key: tenantConfigKey(tenantId, key),
    tenant_id: tenantId || DEFAULT_TENANT_ID,
    value_json: JSON.stringify(value),
  });
}

function ensureConfigValue(tenantId, key, value) {
  const existing = db
    .prepare(
      `SELECT 1 FROM app_config
       WHERE key = ? AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')
       LIMIT 1`
    )
    .get(tenantConfigKey(tenantId, key), tenantId || DEFAULT_TENANT_ID);
  if (!existing) setConfigValue(tenantId, key, value);
}

function resolveDashboardConfig(tenantId, user) {
  const normalize = (parsed) => normalizeDashboardConfig(parsed, tenantId);
  const fallback = getConfigValue(
    tenantId,
    'dashboard_config',
    defaultDashboardConfig(),
    normalize
  );
  if (!user) return fallback;
  const userId = user.sub || user.id;
  if (userId) {
    const userDash = getConfigValue(tenantId, `user_dashboard:${userId}`, null);
    if (userDash && typeof userDash === 'object') return normalize(userDash);
  }
  const roleKey = user.tenantRole || user.role;
  if (roleKey) {
    const roleDash = getConfigValue(tenantId, `role_dashboard:${roleKey}`, null);
    if (roleDash && typeof roleDash === 'object') return normalize(roleDash);
  }
  return fallback;
}

function getSettingsPayload(tenantId = DEFAULT_TENANT_ID, user = null) {
  ensureStandardLookupCategories(tenantId);
  const defaultNotif = {
    dueSoonThreshold: '3',
    emailEnabled: false,
  };
  const caseStudyEnabled = getConfigValue(
    tenantId,
    'case_study_enabled',
    true,
    (parsed) => {
      if (typeof parsed === 'boolean') return parsed;
      const s = String(parsed ?? '').trim().toLowerCase();
      if (!s) return true;
      return ['1', 'true', 'yes', 'on'].includes(s);
    }
  );
  const notifications = getConfigValue(
    tenantId,
    'notification_settings',
    { ...defaultNotif },
    (parsed) => ({
      dueSoonThreshold: String(parsed.dueSoonThreshold ?? defaultNotif.dueSoonThreshold),
      emailEnabled: false,
    })
  );
  let reminderOffsets = getConfigValue(tenantId, 'reminder_offsets', null);
  if (!Array.isArray(reminderOffsets) || !reminderOffsets.length) {
    reminderOffsets = inferReminderOffsets(String(notifications.dueSoonThreshold));
  }
  const dashboard = resolveDashboardConfig(tenantId, user);
  const listTableLayout = getConfigValue(
    tenantId,
    'list_table_layout',
    normalizeListTableLayout(null),
    normalizeListTableLayout
  );
  const reportsLayout = getConfigValue(
    tenantId,
    'reports_layout',
    normalizeReportsLayout(null),
    normalizeReportsLayout
  );
  const caseStudyLayout = getConfigValue(
    tenantId,
    'case_study_layout',
    null,
    normalizeCaseStudyLayoutValue
  );
  const terminology = getConfigValue(
    tenantId,
    'terminology_config',
    defaultTerminologyConfig(),
    normalizeTerminologyConfig
  );
  const theme = getConfigValue(
    tenantId,
    'theme_config',
    defaultThemeConfig(),
    normalizeThemeConfig
  );
  const displayTimezone = getConfigValue(
    tenantId,
    'display_timezone',
    'UTC',
    (parsed) => String(parsed || 'UTC')
  );
  const pageAccess = getConfigValue(
    tenantId,
    'page_access_config',
    defaultPageAccessConfig(),
    (parsed) => normalizePageAccessConfigForTenant(parsed, tenantId)
  );
  const tenantRolePermissions = getConfigValue(
    tenantId,
    'tenant_role_permissions_config',
    defaultTenantRolePermissionsConfig(),
    (parsed) => normalizeTenantRolePermissionsConfig(parsed, tenantId)
  );
  const summaryCards = getConfigValue(
    tenantId,
    'summary_cards_config',
    defaultSummaryCardsConfig(),
    normalizeSummaryCardsConfig
  );
  return {
    tenantId,
    caseStudyEnabled,
    caseStudyLayout,
    notifications,
    reminderOffsets,
    dashboard,
    listTableLayout,
    reportsLayout,
    terminology,
    theme,
    displayTimezone,
    pageAccess,
    platformRoles: getPlatformRolesConfig(),
    tenantRolePermissions,
    summaryCards,
  };
}

function lookupCategoryKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function lookupCategoryLabel(category) {
  return String(category || '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function defaultLookupCategories() {
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

function ensureLookupEntriesForTenant(tenantId, category, defaults) {
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

function ensureStandardLookupCategories(tenantId) {
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

function getArtifactTypeEntries(tenantId) {
  ensureStandardLookupCategories(tenantId);
  return db
    .prepare(
      `SELECT value FROM lookup_entries WHERE tenant_id = ? AND category = 'ARTIFACT_TYPE' ORDER BY sort_order, value`
    )
    .all(tenantId);
}

function artifactLabelToCode(label) {
  const known = {
    Proposal: 'PROPOSAL',
    SOW: 'SOW',
    'Presentation Deck': 'PRESENTATION_DECK',
  };
  if (known[label]) return known[label];
  return lookupCategoryKey(label);
}

function artifactCodeToLabel(code, tenantId) {
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

function resolveArtifactTypeInput(tenantId, input) {
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

function getLookupCategoryConfigs(tenantId) {
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

function getLookupsPayload(tenantId = DEFAULT_TENANT_ID) {
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

function allowedFieldTypes() {
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

function fieldKeyFromLabel(label) {
  return slugify(label).replace(/-/g, '_');
}

function normalizeFieldOptions(input) {
  if (Array.isArray(input)) {
    return input.map(String).map((s) => s.trim()).filter(Boolean);
  }
  return String(input || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function defaultSystemFieldDefinitions() {
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

function getRecordFormFieldConfig(tenantId) {
  return getConfigValue(tenantId, 'record_form_fields', {}, (parsed) =>
    parsed && typeof parsed === 'object' ? parsed : {}
  );
}

function setRecordFormFieldConfig(tenantId, config) {
  setConfigValue(tenantId, 'record_form_fields', config);
}

function resolveLookupOptions(tenantId, lookupCategory) {
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
function recordSchemaFieldOptions(tenantId, key) {
  const def = getRecordSchemaDefinitions(tenantId).find((item) => item.key === key);
  if (!def || def.status === 'INACTIVE') return [];
  return Array.isArray(def.options) ? def.options.map(String) : [];
}

function dealStageValuesForTenant(tenantId) {
  const fromSchema = recordSchemaFieldOptions(tenantId, 'dealStage');
  return fromSchema.length ? fromSchema : getDealStageValues(tenantId);
}

function systemFieldLookupCategory(field, override) {
  if (Object.prototype.hasOwnProperty.call(override, 'lookupCategory')) {
    return lookupCategoryKey(override.lookupCategory);
  }
  return lookupCategoryKey(field.lookupCategory);
}

function isRecordSchemaFieldActive(tenantId, key) {
  const def = getRecordSchemaDefinitions(tenantId).find((item) => item.key === key);
  return !def || def.status !== 'INACTIVE';
}

function getRecordSchemaDefinitions(tenantId) {
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

function updateSystemFieldDefinition(tenantId, key, patch) {
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

function parseFieldDefinitionInput(body) {
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

function mapFieldDefinitionRow(r) {
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

function getTenantFieldDefinitions(tenantId, includeInactive = false) {
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

function getTenantFieldDefinition(tenantId, id) {
  const row = db
    .prepare(
      `SELECT * FROM tenant_field_definitions
       WHERE id = ? AND tenant_id = ? AND entity = 'opportunity'`
    )
    .get(id, tenantId);
  return row ? mapFieldDefinitionRow(row) : null;
}

function normalizeCustomFields(input, tenantId = DEFAULT_TENANT_ID) {
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

function getReminderOffsetsForEvaluator(tenantId = DEFAULT_TENANT_ID) {
  try {
    const { reminderOffsets } = getSettingsPayload(tenantId);
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

function mapArtifactRow(r, tenantId = DEFAULT_TENANT_ID) {
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

function validateOpportunityCreate(body, tenantId = DEFAULT_TENANT_ID) {
  const requiredErr = validateRecordSchemaRequiredForPublish(tenantId, body, false);
  if (requiredErr) return requiredErr;
  const choiceErr = validateRecordSchemaChoiceFields(tenantId, body, false);
  if (choiceErr) return choiceErr;
  if (body.value !== undefined && !Number.isFinite(Number(body.value))) return 'value must be a number';
  if (body.value !== undefined && Number(body.value) < 0) return 'value must be >= 0';
  return '';
}

function validateOpportunityPartial(r) {
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
  const admin =
    db
      .prepare(
        `SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1`
      )
      .get() ||
    db.prepare(`SELECT id FROM users WHERE status = 'ACTIVE' LIMIT 1`).get();
  const ownerId = admin?.id;
  if (!ownerId) return;
  const samples = [
    {
      prospect: 'Acme Corporation',
      opportunity_description: 'Enterprise Cloud Migration',
      owner: [ownerId],
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
      owner: [ownerId],
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
      owner: [ownerId],
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
      id, tenant_id, prospect, opportunity_description, owner_json, deliverables, due_date, status, notes,
      win_or_loss, first_presales_call, closed_date, prospect_type, engagement_type,
      value, currency, deal_stage, version, archived, created_at, updated_at
    ) VALUES (
      @id, @tenant_id, @prospect, @opportunity_description, @owner_json, @deliverables, @due_date, @status, @notes,
      @win_or_loss, @first_presales_call, @closed_date, @prospect_type, @engagement_type,
      @value, @currency, @deal_stage, @version, @archived, @created_at, @updated_at
    )`
  );

  for (const s of samples) {
    const id = randomUUID();
    ins.run({
      id,
      tenant_id: DEFAULT_TENANT_ID,
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
      deal_stage: 'Discovery',
      version: 1,
      archived: 0,
      created_at: now,
      updated_at: now,
    });
    syncRecordOwners(id, DEFAULT_TENANT_ID, s.owner);
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
  const today = new Date();
  const future = new Date(startOfDay(today) + 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const opps = db
    .prepare(
      `SELECT id, tenant_id, prospect, due_date, status, archived, is_draft
       FROM opportunities
       WHERE COALESCE(archived,0) = 0
         AND COALESCE(is_draft,0) = 0
         AND status <> 'Completed'
         AND due_date IS NOT NULL
         AND due_date <= ?`
    )
    .all(future);
  const offsetsByTenant = new Map();

  const insert = db.prepare(
    `INSERT OR IGNORE INTO notifications (
       id, tenant_id, opportunity_id, type, channel, state, trigger_at, idempotency_key, message, is_read, created_at
     ) VALUES (
       @id, @tenant_id, @opportunity_id, @type, @channel, @state, @trigger_at, @idempotency_key, @message, 0, @created_at
     )`
  );

  for (const o of opps) {
    let due;
    try {
      due = new Date(o.due_date + 'T12:00:00');
    } catch {
      continue;
    }
    const dd = Math.floor(dayDiff(due, today));
    const tenantId = o.tenant_id || DEFAULT_TENANT_ID;
    if (!offsetsByTenant.has(tenantId)) {
      offsetsByTenant.set(tenantId, getReminderOffsetsForEvaluator(tenantId));
    }
    const offsets = offsetsByTenant.get(tenantId);

    if (dd < 0) {
      insert.run({
        id: randomUUID(),
        tenant_id: tenantId,
        opportunity_id: o.id,
        type: 'OVERDUE',
        channel: 'IN_APP',
        state: 'SENT',
        trigger_at: nowIso(),
        idempotency_key: `${tenantId}|overdue|${o.id}|${o.due_date}`,
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
        tenant_id: tenantId,
        opportunity_id: o.id,
        type,
        channel: 'IN_APP',
        state: 'SENT',
        trigger_at: nowIso(),
        idempotency_key: `${tenantId}|r${off}|${o.id}|${o.due_date}`,
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
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, platform_role, status, created_at, updated_at)
     VALUES (@id, @tenant_id, @email, @password_hash, @name, 'VIEWER', 'PLATFORM_ADMIN', 'ACTIVE', @created_at, @updated_at)`
  ).run({
    id,
    tenant_id: DEFAULT_TENANT_ID,
    email: STATIC_AUTH_EMAIL.toLowerCase(),
    password_hash: hashPassword(STATIC_AUTH_PASSWORD),
    name: 'Administrator',
    created_at: now,
    updated_at: now,
  });
}

function ensureDefaultPlatformAdminOnly() {
  const email = STATIC_AUTH_EMAIL.toLowerCase();
  const user = db.prepare(`SELECT id FROM users WHERE lower(email) = ?`).get(email);
  if (!user) return;
  db.prepare(
    `UPDATE users
     SET role = 'VIEWER', platform_role = 'PLATFORM_ADMIN', updated_at = ?
     WHERE id = ?`
  ).run(nowIso(), user.id);
  db.prepare(`DELETE FROM tenant_memberships WHERE user_id = ?`).run(user.id);
}

function seedDealStagesIfEmpty() {
  const n = db
    .prepare(
      `SELECT COUNT(*) AS c FROM lookup_entries WHERE tenant_id = ? AND category = 'DEAL_STAGE'`
    )
    .get(DEFAULT_TENANT_ID).c;
  if (n > 0) return;
  const defaults = [
    ['DEAL_STAGE', 'Discovery', 0],
    ['DEAL_STAGE', 'Qualification', 1],
    ['DEAL_STAGE', 'Solutioning', 2],
    ['DEAL_STAGE', 'Proposal', 3],
    ['DEAL_STAGE', 'Negotiation', 4],
    ['DEAL_STAGE', 'Closed', 5],
  ];
  const ins = db.prepare(
    `INSERT INTO lookup_entries (id, tenant_id, category, value, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  for (const [cat, val, ord] of defaults) {
    ins.run(randomUUID(), DEFAULT_TENANT_ID, cat, val, ord);
  }
}

function seedLookupsIfEmpty() {
  const n = db
    .prepare('SELECT COUNT(*) AS c FROM lookup_entries WHERE tenant_id = ?')
    .get(DEFAULT_TENANT_ID).c;
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
    ['DEAL_STAGE', 'Discovery', 0],
    ['DEAL_STAGE', 'Qualification', 1],
    ['DEAL_STAGE', 'Solutioning', 2],
    ['DEAL_STAGE', 'Proposal', 3],
    ['DEAL_STAGE', 'Negotiation', 4],
    ['DEAL_STAGE', 'Closed', 5],
  ];
  const ins = db.prepare(
    `INSERT INTO lookup_entries (id, tenant_id, category, value, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  for (const [cat, val, ord] of defaults) {
    ins.run(randomUUID(), DEFAULT_TENANT_ID, cat, val, ord);
  }
}

function seedDefaultAppConfigIfEmpty() {
  seedTenantDefaults(DEFAULT_TENANT_ID);
}

function seedTenantDefaults(tenantId) {
  ensureStandardLookupCategories(tenantId);
  const notifications = {
    dueSoonThreshold: '3',
    emailEnabled: false,
  };
  ensureConfigValue(tenantId, 'case_study_enabled', true);
  ensureConfigValue(tenantId, 'notification_settings', notifications);
  ensureConfigValue(
    tenantId,
    'reminder_offsets',
    inferReminderOffsets(notifications.dueSoonThreshold)
  );
  ensureConfigValue(tenantId, 'dashboard_config', defaultDashboardConfig());
  ensureConfigValue(tenantId, 'list_table_layout', normalizeListTableLayout(null));
  ensureConfigValue(tenantId, 'reports_layout', normalizeReportsLayout(null));
  ensureConfigValue(tenantId, 'terminology_config', defaultTerminologyConfig());
  ensureConfigValue(tenantId, 'theme_config', defaultThemeConfig());
  ensureConfigValue(tenantId, 'lookup_categories', defaultLookupCategories());
  const existingLookups = db
    .prepare(`SELECT COUNT(*) AS c FROM lookup_entries WHERE tenant_id = ?`)
    .get(tenantId).c;
  if (existingLookups > 0) return;
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
    ['DEAL_STAGE', 'Discovery', 0],
    ['DEAL_STAGE', 'Qualification', 1],
    ['DEAL_STAGE', 'Solutioning', 2],
    ['DEAL_STAGE', 'Proposal', 3],
    ['DEAL_STAGE', 'Negotiation', 4],
    ['DEAL_STAGE', 'Closed', 5],
    ['ARTIFACT_TYPE', 'Proposal', 0],
    ['ARTIFACT_TYPE', 'SOW', 1],
    ['ARTIFACT_TYPE', 'Presentation Deck', 2],
    ['CURRENCY', 'USD', 0],
    ['CURRENCY', 'EUR', 1],
    ['CURRENCY', 'GBP', 2],
    ['CURRENCY', 'CAD', 3],
  ];
  const ins = db.prepare(
    `INSERT INTO lookup_entries (id, tenant_id, category, value, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  for (const [cat, val, ord] of defaults) {
    ins.run(randomUUID(), tenantId, cat, val, ord);
  }
}
