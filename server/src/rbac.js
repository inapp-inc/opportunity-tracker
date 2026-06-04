export const PLATFORM_ROLES = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  NONE: 'NONE',
};

export const TENANT_ROLES = {
  TENANT_ADMIN: 'TENANT_ADMIN',
  MANAGER: 'MANAGER',
  VIEWER: 'VIEWER',
};

export const PERMISSIONS = {
  TENANT_SETTINGS_READ: 'tenant.settings.read',
  TENANT_SETTINGS_WRITE: 'tenant.settings.write',
  RECORDS_READ: 'records.read',
  RECORDS_CREATE: 'records.create',
  RECORDS_UPDATE: 'records.update',
  RECORDS_ARCHIVE: 'records.archive',
  RECORDS_DELETE: 'records.delete',
  RECORDS_ARTIFACTS_WRITE: 'records.artifacts.write',
  RECORDS_COMMENTS_WRITE: 'records.comments.write',
  REPORTS_READ: 'reports.read',
  NOTIFICATIONS_READ: 'notifications.read',
};

export const ROLE_PERMISSIONS = {
  [TENANT_ROLES.TENANT_ADMIN]: Object.values(PERMISSIONS),
  [TENANT_ROLES.MANAGER]: [
    PERMISSIONS.TENANT_SETTINGS_READ,
    PERMISSIONS.RECORDS_READ,
    PERMISSIONS.RECORDS_CREATE,
    PERMISSIONS.RECORDS_UPDATE,
    PERMISSIONS.RECORDS_ARCHIVE,
    PERMISSIONS.RECORDS_DELETE,
    PERMISSIONS.RECORDS_ARTIFACTS_WRITE,
    PERMISSIONS.RECORDS_COMMENTS_WRITE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.NOTIFICATIONS_READ,
  ],
  [TENANT_ROLES.VIEWER]: [
    PERMISSIONS.TENANT_SETTINGS_READ,
    PERMISSIONS.RECORDS_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.NOTIFICATIONS_READ,
  ],
};

export function permissionsForMembership(membership) {
  const base = ROLE_PERMISSIONS[membership?.role] || [];
  let extras = [];
  try {
    extras = JSON.parse(membership?.permissions_json || '[]');
  } catch {
    extras = [];
  }
  return [...new Set([...base, ...extras].filter(Boolean))];
}

export function legacyRoleFromMembership(membership, platformRole = PLATFORM_ROLES.NONE) {
  if (platformRole === PLATFORM_ROLES.PLATFORM_ADMIN) return 'ADMIN';
  if (membership?.role === TENANT_ROLES.TENANT_ADMIN) return 'ADMIN';
  if (membership?.role === TENANT_ROLES.MANAGER) return 'EDITOR';
  return 'VIEWER';
}

export function tenantRoleFromLegacyRole(role) {
  if (role === 'ADMIN') return TENANT_ROLES.TENANT_ADMIN;
  if (role === 'EDITOR') return TENANT_ROLES.MANAGER;
  return TENANT_ROLES.VIEWER;
}
