import { DEFAULT_TENANT_ID } from '../constants.js';

export function tenantIdFromReq(req) {
  return String(req.user?.tenantId || req.user?.activeTenantId || DEFAULT_TENANT_ID);
}

export function requestedTenantId(req, fallback) {
  const headerTenant = req.headers['x-tenant-id'];
  const raw = Array.isArray(headerTenant) ? headerTenant[0] : headerTenant;
  return String(raw || req.query?.tenantId || fallback || DEFAULT_TENANT_ID);
}
