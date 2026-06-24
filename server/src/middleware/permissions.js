import { PERMISSIONS, PLATFORM_ROLES } from '../rbac.js';

export function requirePlatformAdmin(req, res, next) {
  if (req.user?.platformRole !== PLATFORM_ROLES.PLATFORM_ADMIN) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
}

export function requireTenantPermission(permission) {
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

export function requireRoles(...roles) {
  return (req, res, next) => {
    const legacyRole = req.user?.role;
    if (legacyRole === 'ADMIN' || roles.includes(legacyRole)) return next();
    return res.status(403).json({ message: 'Forbidden' });
  };
}

