export type LookupEntry = { id: string; value: string; sortOrder?: number };
export type LookupCategory = { category: string; label: string; items: LookupEntry[] };

export type ApiUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  platformRole?: string;
  memberships?: {
    tenantId: string;
    tenantName: string;
    role: string;
    permissions: string[];
    status: string;
  }[];
  status: string;
  tenantId: string;
  tenantName: string;
};

export type ApiTenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

export type TenantRoleConfig = {
  key: string;
  label: string;
};

export type TenantRolesConfig = {
  roles: TenantRoleConfig[];
};

export function roleLabel(role: string) {
  if (role === "TENANT_ADMIN") return "Workspace Admin";
  if (role === "MANAGER") return "Manager";
  if (role === "ADMIN") return "Workspace Admin";
  if (role === "EDITOR") return "Manager";
  return "Viewer";
}
