import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const legacy = fs.readFileSync(path.join(root, 'index.legacy.js'), 'utf8');
const L = legacy.split('\n');

function rng(a, b) {
  return L.slice(a - 1, b).join('\n');
}

function w(file, content) {
  const p = path.join(root, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content.trimStart() + '\n');
  console.log('OK', file);
}

w('routes/mountDualRoute.js', `export function mountDualRoute(router, method, paths, ...handlers) {
  for (const p of paths) {
    router[method](p, ...handlers);
  }
}
`);

w('routes/auth.js', `import express from 'express';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { PLATFORM_ROLES } from '../rbac.js';
import { defaultPageAccessConfig } from '../services/configService.js';

export function createAuthRouter() {
  const router = express.Router();

  router.get('/auth/me', (req, res) => {
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

  return router;
}
`);

// Extract route blocks from legacy - transform app. to router.
function routeBlock(start, end, transform = (s) => s.replace(/^app\./gm, 'router.')) {
  return transform(rng(start, end));
}

w('routes/tenants.js', `import express from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { requirePlatformAdmin } from '../middleware/permissions.js';
import { nowIso } from '../utils/time.js';
import { slugify } from '../utils/slug.js';
import { seedTenantDefaults } from '../startup/seeds.js';

export function createTenantsRouter() {
  const router = express.Router();

${routeBlock(527, 596)}

  return router;
}
`);

w('routes/users.js', `import express from 'express';
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

  router.get('/assignable', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
    const tenantId = tenantIdFromReq(req);
    const rows = db
      .prepare(
        \`SELECT u.id, u.email, u.name, tm.role
         FROM tenant_memberships tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
         ORDER BY u.name, u.email\`
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

${rng(1641, 1661).replace(/^function listUsersHandler/, 'function listUsersHandler')}

  mountDualRoute(router, 'get', ['/users', '/platform/users'], requirePlatformAdmin, listUsersHandler);

${rng(1666, 1734).replace(/^function createUserHandler/, 'function createUserHandler')}

  mountDualRoute(router, 'post', ['/users', '/platform/users'], requirePlatformAdmin, createUserHandler);

${rng(1739, 1832).replace(/^function updateUserHandler/, 'function updateUserHandler')}

  mountDualRoute(router, 'patch', ['/users/:id', '/platform/users/:id'], requirePlatformAdmin, updateUserHandler);

${rng(1837, 1856).replace(/^function deleteUserHandler/, 'function deleteUserHandler')}

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

${routeBlock(1875, 1956)}

  return router;
}
`);

console.log('routes partial done');
