import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import type { TenantRolesConfig } from "../pages/settings/types";

export function useTenantRoleOptions(enabled = true) {
  const [platformRoles, setPlatformRoles] = useState<TenantRolesConfig | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await apiFetch<{ platformRoles?: TenantRolesConfig }>("/settings");
      setPlatformRoles(res.platformRoles || null);
    } catch {
      setPlatformRoles(null);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const tenantRoleOptions = useMemo(() => {
    const fallback = [
      { value: "TENANT_ADMIN", label: "Workspace Admin" },
      { value: "MANAGER", label: "Manager" },
      { value: "VIEWER", label: "Viewer" },
    ];
    const raw = platformRoles?.roles?.length
      ? platformRoles.roles.map((r) => ({ value: r.key, label: r.label || r.key }))
      : fallback;
    const uniq = new Map<string, { value: string; label: string }>();
    for (const opt of raw) {
      if (!opt?.value) continue;
      if (!uniq.has(opt.value)) uniq.set(opt.value, opt);
    }
    return Array.from(uniq.values());
  }, [platformRoles?.roles]);

  const defaultTenantRoleKey = useMemo(() => {
    const keys = tenantRoleOptions.map((o) => o.value);
    return keys.includes("VIEWER") ? "VIEWER" : keys[0] || "VIEWER";
  }, [tenantRoleOptions]);

  const allowedRoleKeys = useMemo(
    () => new Set(tenantRoleOptions.map((o) => o.value)),
    [tenantRoleOptions]
  );

  const sanitizeRoleKey = useCallback(
    (role: string | undefined) => {
      const value = String(role || "").trim();
      if (value && allowedRoleKeys.has(value)) return value;
      return defaultTenantRoleKey;
    },
    [allowedRoleKeys, defaultTenantRoleKey]
  );

  const roleOptionsForTenant = useCallback(
    (_tenantId?: string) => tenantRoleOptions,
    [tenantRoleOptions]
  );

  const defaultRoleKeyForTenant = useCallback(
    (_tenantId?: string) => defaultTenantRoleKey,
    [defaultTenantRoleKey]
  );

  return {
    platformRoles,
    setPlatformRoles,
    tenantRoleOptions,
    defaultTenantRoleKey,
    sanitizeRoleKey,
    roleOptionsForTenant,
    defaultRoleKeyForTenant,
    reload: load,
  };
}
