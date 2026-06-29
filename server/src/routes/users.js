import express from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { hashPassword } from '../auth-utils.js';
import {
  PERMISSIONS,
  PLATFORM_ROLES,
  ROLE_PERMISSIONS,
  TENANT_ROLES,
  tenantRoleFromLegacyRole,
} from '../rbac.js';
import { requirePlatformAdmin, requireTenantPermission } from '../middleware/permissions.js';
import { mountDualRoute } from './mountDualRoute.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { nowIso } from '../utils/time.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import {
  userToJson,
  membershipToJson,
  normalizeMembershipRole,
  validateMembershipInputs,
  normalizeMembershipStatus,
  membershipErrorResponse,
  membershipInputsFromBody,
  syncUserTenantMemberships,
  createOrUpdateMembership,
} from '../services/membershipService.js';
import { getPlatformRolesConfig } from '../services/configService.js';

export function createUsersRouter() {
  const router = express.Router();

  router.get('/users/assignable', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
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

  mountDualRoute(router, 'get', ['/users', '/platform/users'], requirePlatformAdmin, listUsersHandler);

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

  mountDualRoute(router, 'post', ['/users', '/platform/users'], requirePlatformAdmin, createUserHandler);

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

  mountDualRoute(router, 'patch', ['/users/:id', '/platform/users/:id'], requirePlatformAdmin, updateUserHandler);

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

  mountDualRoute(router, 'delete', ['/users/:id', '/platform/users/:id'], requirePlatformAdmin, deleteUserHandler);

  router.get('/platform/tenants/:tenantId/permissions', requirePlatformAdmin, (_req, res) => {
    res.json({
      permissions: Object.values(PERMISSIONS),
      templates: Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => ({
        role,
        permissions,
      })),
    });
  });

  router.get('/platform/roles', requirePlatformAdmin, (_req, res) => {
    res.json({ platformRoles: getPlatformRolesConfig() });
  });

router.get('/platform/tenants/:tenantId/memberships', requirePlatformAdmin, (req, res) => {
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

router.post('/platform/tenants/:tenantId/memberships', requirePlatformAdmin, (req, res) => {
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

router.patch('/platform/tenants/:tenantId/memberships/:membershipId', requirePlatformAdmin, (req, res) => {
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

router.delete('/platform/tenants/:tenantId/memberships/:membershipId', requirePlatformAdmin, (req, res) => {
  const r = db
    .prepare(`DELETE FROM tenant_memberships WHERE id = ? AND tenant_id = ?`)
    .run(req.params.membershipId, req.params.tenantId);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

  return router;
}

