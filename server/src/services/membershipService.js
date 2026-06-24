import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { nowIso } from '../utils/time.js';
import { isUuid } from '../utils/uuid.js';
import {
  PERMISSIONS,
  PLATFORM_ROLES,
  legacyRoleFromMembership,
  tenantRoleFromLegacyRole,
  TENANT_ROLES,
} from '../rbac.js';
import { requestedTenantId } from '../utils/tenant.js';
import {
  permissionsForTenantRole,
  getConfigValue,
  defaultPageAccessConfig,
  normalizePageAccessConfig,
  isAllowedPlatformRole,
} from './configService.js';

export function getTenant(id) {
  return db
    .prepare(`SELECT id, name, slug, status FROM tenants WHERE id = ?`)
    .get(id);
}

export function getMembershipRows(userId) {
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

export function membershipToJson(membership) {
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

export function userToJson(user) {
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

export function createOrUpdateMembership({ userId, tenantId, role, permissions = [], status = 'ACTIVE' }) {
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

export function normalizeMembershipRole(role, fallback = TENANT_ROLES.VIEWER) {
  const raw = String(role || fallback || '').trim();
  if (!raw) return TENANT_ROLES.VIEWER;
  if (Object.values(TENANT_ROLES).includes(raw)) return raw;
  if (['ADMIN', 'EDITOR', 'VIEWER'].includes(raw)) return tenantRoleFromLegacyRole(raw);
  // Custom role keys are validated per-tenant in validateMembershipInputs.
  return raw.toUpperCase();
  if (!role && fallback) return normalizeMembershipRole(fallback, TENANT_ROLES.VIEWER);
  throw new Error('invalid tenantRole');
}

export function validateMembershipInputs(memberships) {
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

export function normalizeMembershipStatus(status) {
  const value = String(status || 'ACTIVE');
  if (!['ACTIVE', 'INACTIVE'].includes(value)) throw new Error('invalid membership status');
  return value;
}

export function membershipErrorResponse(res, error) {
  const message = error instanceof Error ? error.message : 'invalid memberships';
  const status = message.includes('invalid') || message.includes('required') ? 400 : 500;
  return res.status(status).json({ message });
}

export function membershipInputsFromBody(body, fallbackRole) {
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

export function syncUserTenantMemberships({ userId, tenantIds, memberships, role, permissions = [] }) {
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

export function buildAuthContext(userId, req) {
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

