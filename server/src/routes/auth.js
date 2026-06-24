import express from 'express';
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

