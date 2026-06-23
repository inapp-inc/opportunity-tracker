import { useEffect, useState } from "react";
import { ACTIVE_TENANT_EVENT, apiFetch, getActiveTenantId } from "./api";
import { useAuthUser } from "../contexts/AuthUserContext";
import { useIsPlatformAdmin } from "./roles";
import { tenantRoleFromLegacyRole } from "./roles";

export type PageKey =
  | "dashboard"
  | "records"
  | "opportunities"
  | "artifacts"
  | "caseStudies"
  | "notifications"
  | "reports"
  | "settings";

export type PagePermission = { read: boolean; write: boolean };

export type PageAccessConfig = {
  pages: PageKey[];
  roles: Record<string, Record<PageKey, PagePermission> | PageKey[]>;
};

const accessCache = new Map<string, PageAccessConfig>();
const accessRequests = new Map<string, Promise<PageAccessConfig>>();

function cacheKey() {
  return getActiveTenantId() || "__active__";
}

const DEFAULT_ACCESS: PageAccessConfig = {
  pages: ["dashboard", "records", "opportunities", "artifacts", "caseStudies", "notifications", "reports", "settings"],
  roles: {
    TENANT_ADMIN: {
      dashboard: { read: true, write: false },
      records: { read: true, write: true },
      opportunities: { read: true, write: false },
      artifacts: { read: true, write: true },
      caseStudies: { read: true, write: false },
      notifications: { read: true, write: false },
      reports: { read: true, write: false },
      settings: { read: true, write: true },
    },
    MANAGER: {
      dashboard: { read: true, write: false },
      records: { read: true, write: true },
      opportunities: { read: true, write: false },
      artifacts: { read: true, write: true },
      caseStudies: { read: true, write: false },
      notifications: { read: true, write: false },
      reports: { read: true, write: false },
      settings: { read: false, write: false },
    },
    VIEWER: {
      dashboard: { read: true, write: false },
      records: { read: true, write: false },
      opportunities: { read: true, write: false },
      artifacts: { read: true, write: false },
      caseStudies: { read: true, write: false },
      notifications: { read: true, write: false },
      reports: { read: true, write: false },
      settings: { read: false, write: false },
    },
  },
};

function normalizeAccessConfig(cfg?: PageAccessConfig | null): PageAccessConfig {
  if (!cfg?.roles) return DEFAULT_ACCESS;
  const validPages = new Set(DEFAULT_ACCESS.pages);
  const normalizeList = (raw: unknown) =>
    (Array.isArray(raw) ? raw : [])
      .map(String)
      .filter((p): p is PageKey => validPages.has(p as PageKey));
  const knownPages = normalizeList(cfg.pages);
  const newPages = DEFAULT_ACCESS.pages.filter((p) => !knownPages.includes(p));
  const normalizePerm = (value: unknown, fallback: PagePermission): PagePermission => {
    if (!value || typeof value !== "object") return fallback;
    const v = value as any;
    return { read: Boolean(v.read), write: Boolean(v.write) };
  };
  const mergeRole = (role: string) => {
    const raw = (cfg.roles as any)[role];
    const legacyPages = normalizeList(raw);
    const isLegacy = Array.isArray(raw);
    const saved = !isLegacy && raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
    const out: Record<PageKey, PagePermission> = {} as any;
    for (const page of DEFAULT_ACCESS.pages) {
      const fallback =
        (DEFAULT_ACCESS.roles as any)[role]?.[page] ||
        (DEFAULT_ACCESS.roles as any).VIEWER?.[page] ||
        { read: false, write: false };
      const legacyRead = legacyPages.includes(page);
      out[page] = saved?.[page]
        ? normalizePerm(saved[page], fallback)
        : legacyRead
          ? { read: true, write: fallback.write }
          : fallback;
    }
    // New pages: only auto-add based on defaults.
    for (const page of newPages) {
      out[page] = out[page] || ((DEFAULT_ACCESS.roles as any)[role]?.[page] ?? { read: false, write: false });
    }
    return out;
  };
  const roleKeys = Array.from(new Set([...Object.keys(cfg.roles || {}), ...Object.keys(DEFAULT_ACCESS.roles || {})]));
  const roles: Record<string, Record<PageKey, PagePermission>> = {};
  for (const roleKey of roleKeys) {
    roles[roleKey] = mergeRole(roleKey);
  }
  return {
    pages: DEFAULT_ACCESS.pages,
    roles,
  };
}

async function loadAccessConfig(): Promise<PageAccessConfig> {
  const key = cacheKey();
  const cached = accessCache.get(key);
  if (cached) return cached;
  if (!accessRequests.has(key)) {
    const request = (async () => {
      try {
        const me = await apiFetch<{ pageAccess?: PageAccessConfig }>("/auth/me");
        if (me.pageAccess) {
          const cfg = normalizeAccessConfig(me.pageAccess);
          accessCache.set(key, cfg);
          return cfg;
        }
      } catch {
        // fall through
      }
      try {
        const res = await apiFetch<{ pageAccess?: PageAccessConfig }>("/catalog/lookups");
        if (res.pageAccess) {
          const cfg = normalizeAccessConfig(res.pageAccess);
          accessCache.set(key, cfg);
          return cfg;
        }
      } catch {
        // fall through
      }
      try {
        const res = await apiFetch<{ pageAccess?: PageAccessConfig }>("/settings");
        const cfg = normalizeAccessConfig(res.pageAccess);
        accessCache.set(key, cfg);
        return cfg;
      } catch {
        return DEFAULT_ACCESS;
      }
    })().finally(() => accessRequests.delete(key));
    accessRequests.set(key, request);
  }
  return accessRequests.get(key)!;
}

export function updatePageAccessCache(cfg: PageAccessConfig) {
  const tenantId = cacheKey();
  accessCache.set(tenantId, normalizeAccessConfig(cfg));
  window.dispatchEvent(new CustomEvent("tenant-page-access-updated", { detail: { tenantId } }));
}

export function usePageAccess() {
  const { user } = useAuthUser();
  const isPlatformAdmin = useIsPlatformAdmin();
  const [config, setConfig] = useState<PageAccessConfig>(
    accessCache.get(cacheKey()) || DEFAULT_ACCESS
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.pageAccess) {
      const cfg = normalizeAccessConfig(user.pageAccess);
      accessCache.set(cacheKey(), cfg);
      setConfig(cfg);
    }
  }, [user?.pageAccess, user?.activeTenantId]);

  useEffect(() => {
    let cancelled = false;
    const onTenantChange = () => {
      const tenantId = cacheKey();
      setConfig(accessCache.get(tenantId) || DEFAULT_ACCESS);
      setLoading(true);
      loadAccessConfig().then((next) => {
        if (!cancelled && tenantId === cacheKey()) {
          setConfig(next);
          setLoading(false);
        }
      });
    };
    const onUpdate = () => onTenantChange();
    window.addEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    window.addEventListener("tenant-page-access-updated", onUpdate);
    const tenantId = cacheKey();
    loadAccessConfig().then((next) => {
      if (!cancelled && tenantId === cacheKey()) {
        setConfig(next);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      window.removeEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
      window.removeEventListener("tenant-page-access-updated", onUpdate);
    };
  }, []);

  const role =
    (user?.tenantRole as string | undefined) ||
    tenantRoleFromLegacyRole(user?.role) ||
    "VIEWER";

  const canAccess = (page: PageKey) => {
    if (isPlatformAdmin) return true;
    const roleCfg = (config.roles as any)[role] || (DEFAULT_ACCESS.roles as any)[role];
    if (Array.isArray(roleCfg)) return roleCfg.includes(page);
    return Boolean(roleCfg?.[page]?.read);
  };

  return { config, loading, role, canAccess };
}
