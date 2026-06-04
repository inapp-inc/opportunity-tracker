import { useAuthUser } from "../contexts/AuthUserContext";

export const TenantPermissions = {
  tenantSettingsRead: "tenant.settings.read",
  tenantSettingsWrite: "tenant.settings.write",
  recordsRead: "records.read",
  recordsCreate: "records.create",
  recordsUpdate: "records.update",
  recordsArchive: "records.archive",
  recordsDelete: "records.delete",
  recordsArtifactsWrite: "records.artifacts.write",
  recordsCommentsWrite: "records.comments.write",
  reportsRead: "reports.read",
  notificationsRead: "notifications.read",
} as const;

export function useIsPlatformAdmin() {
  const { user } = useAuthUser();
  return user?.platformRole === "PLATFORM_ADMIN";
}

export function useTenantPermission(permission: string) {
  const { user } = useAuthUser();
  return Boolean(user?.permissions?.includes(permission));
}

export function useCanManageTenantSettings() {
  const isPlatformAdmin = useIsPlatformAdmin();
  const canWrite = useTenantPermission(TenantPermissions.tenantSettingsWrite);
  return isPlatformAdmin || canWrite;
}

export function useCanManageRecords() {
  return useTenantPermission(TenantPermissions.recordsUpdate);
}

export function useCanViewRecords() {
  return useTenantPermission(TenantPermissions.recordsRead);
}

export function useCanEdit() {
  return useTenantPermission(TenantPermissions.recordsUpdate);
}

export function useCanCreateRecords() {
  return useTenantPermission(TenantPermissions.recordsCreate);
}

export function useCanArchiveRecords() {
  return useTenantPermission(TenantPermissions.recordsArchive);
}

export function useCanDeleteRecords() {
  return useTenantPermission(TenantPermissions.recordsDelete);
}

export function useCanWriteArtifacts() {
  return useTenantPermission(TenantPermissions.recordsArtifactsWrite);
}

export function useCanWriteComments() {
  return useTenantPermission(TenantPermissions.recordsCommentsWrite);
}

export function useIsAdmin() {
  const { user } = useAuthUser();
  return (
    user?.platformRole === "PLATFORM_ADMIN" ||
    user?.tenantRole === "TENANT_ADMIN" ||
    user?.role === "TENANT_ADMIN"
  );
}

export function useIsViewer() {
  const { user } = useAuthUser();
  return user?.role === "VIEWER";
}

export function tenantRoleFromLegacyRole(
  role?: string
): "TENANT_ADMIN" | "MANAGER" | "VIEWER" {
  if (role === "ADMIN" || role === "TENANT_ADMIN") return "TENANT_ADMIN";
  if (role === "EDITOR" || role === "MANAGER") return "MANAGER";
  return "VIEWER";
}
