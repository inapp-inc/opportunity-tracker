import { useCallback, useEffect, useState } from "react";
import { ACTIVE_TENANT_EVENT, apiFetch, getActiveTenantId } from "./api";
import type { ApiOpportunity, AssignableUser, TenantFieldDefinition } from "./opportunity";
import {
  DEFAULT_DASHBOARD_CONFIG,
  type DashboardConfig,
} from "./dashboard";
import {
  DEFAULT_TERMINOLOGY,
  updateTerminologyCache,
  type TerminologyConfig,
} from "./terminology";
import { normalizeSummaryCardsConfig, type SummaryCardsConfig } from "./summaryCards";

const SCHEMA_EVENT = "tenant-schema-updated";
const LOOKUPS_EVENT = "tenant-lookups-updated";
const USERS_EVENT = "assignable-users-updated";

export type CatalogLookups = {
  prospectTypes: { value: string }[];
  engagementTypes: { value: string }[];
  deliverables: { value: string }[];
  dealStages: { value: string }[];
  winLoss: { value: string }[];
  currencies: { value: string }[];
  artifactTypes: { value: string }[];
  displayTimezone?: string;
};

const schemaCache = new Map<string, TenantFieldDefinition[]>();
const schemaRequests = new Map<string, Promise<TenantFieldDefinition[]>>();
const catalogLookupsCache = new Map<string, CatalogLookups>();
const catalogLookupsRequests = new Map<string, Promise<CatalogLookups>>();
const assignableUsersCache = new Map<string, AssignableUser[]>();
const assignableUsersRequests = new Map<string, Promise<AssignableUser[]>>();

function cacheKey() {
  return getActiveTenantId() || "__active__";
}

function emit<T>(name: string, detail: T) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function clearServerStateCaches() {
  schemaCache.clear();
  schemaRequests.clear();
  catalogLookupsCache.clear();
  catalogLookupsRequests.clear();
  assignableUsersCache.clear();
  assignableUsersRequests.clear();
}

function currentTenantKey() {
  return cacheKey();
}

export async function loadTenantSchema(force = false) {
  const key = cacheKey();
  const cached = schemaCache.get(key);
  if (cached && !force) return cached;
  if (!schemaRequests.has(key) || force) {
    const request = (async () => {
      try {
        const res = await apiFetch<{ fields: TenantFieldDefinition[] }>("/settings/schema");
        return res.fields || [];
      } catch {
        const res = await apiFetch<{ fields: TenantFieldDefinition[] }>("/catalog/schema");
        return res.fields || [];
      }
    })()
      .then((fields) => {
        schemaCache.set(key, fields);
        emit(SCHEMA_EVENT, { tenantId: key, fields });
        return fields;
      })
      .finally(() => {
        schemaRequests.delete(key);
      });
    schemaRequests.set(key, request);
  }
  return schemaRequests.get(key)!;
}

export function updateTenantSchemaCache(fields: TenantFieldDefinition[]) {
  const tenantId = cacheKey();
  schemaCache.set(tenantId, fields);
  emit(SCHEMA_EVENT, { tenantId, fields });
}

export async function loadCatalogLookups(force = false) {
  const key = cacheKey();
  const cached = catalogLookupsCache.get(key);
  if (cached && !force) return cached;
  if (!catalogLookupsRequests.has(key) || force) {
    const request = apiFetch<CatalogLookups>(`/catalog/lookups?ts=${Date.now()}`)
      .then((res) => {
        catalogLookupsCache.set(key, res);
        return res;
      })
      .finally(() => {
        catalogLookupsRequests.delete(key);
      });
    catalogLookupsRequests.set(key, request);
  }
  return catalogLookupsRequests.get(key)!;
}

/** Call after lookup values/categories change so forms reload catalog options and schema field options. */
export async function notifyTenantLookupsUpdated() {
  const tenantId = cacheKey();
  catalogLookupsCache.delete(tenantId);
  const [fields, lookups] = await Promise.all([
    loadTenantSchema(true).catch(() => undefined),
    loadCatalogLookups(true).catch(() => undefined),
  ]);
  emit(LOOKUPS_EVENT, { tenantId, fields, lookups });
}

export function useOnTenantLookupsUpdated(effect: () => void) {
  useEffect(() => {
    const handler = () => effect();
    window.addEventListener(LOOKUPS_EVENT, handler);
    return () => window.removeEventListener(LOOKUPS_EVENT, handler);
  }, [effect]);
}

export function useCatalogLookups() {
  const key = cacheKey();
  const [lookups, setLookups] = useState<CatalogLookups | null>(
    catalogLookupsCache.get(key) || null
  );
  const [loading, setLoading] = useState(!catalogLookupsCache.get(key));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loadCatalogLookups(true);
      setLookups(res);
      return res;
    } catch {
      setLookups(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCatalogLookups(true)
      .then((res) => {
        if (!cancelled) setLookups(res);
      })
      .catch(() => {
        if (!cancelled) setLookups(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const onUpdate = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          tenantId: string;
          lookups?: CatalogLookups;
        }>
      ).detail;
      if (detail?.tenantId !== cacheKey()) return;
      if (detail.lookups) {
        catalogLookupsCache.set(cacheKey(), detail.lookups);
        setLookups(detail.lookups);
        setLoading(false);
        return;
      }
      void reload();
    };
    window.addEventListener(LOOKUPS_EVENT, onUpdate);
    window.addEventListener(ACTIVE_TENANT_EVENT, onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(LOOKUPS_EVENT, onUpdate);
      window.removeEventListener(ACTIVE_TENANT_EVENT, onUpdate);
    };
  }, [reload]);

  return { lookups, loading, reload };
}

export function useTenantSchema() {
  const [fields, setFields] = useState<TenantFieldDefinition[]>(schemaCache.get(cacheKey()) || []);
  const [loading, setLoading] = useState(!schemaCache.get(cacheKey()));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadTenantSchema(true);
      setFields(next);
      setError(null);
      return next;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load schema";
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ tenantId: string; fields: TenantFieldDefinition[] }>).detail;
      if (detail?.tenantId === currentTenantKey()) setFields(detail.fields);
    };
    const onTenantChange = () => {
      const tenantId = currentTenantKey();
      setFields(schemaCache.get(tenantId) || []);
      setLoading(!schemaCache.get(tenantId));
      void reload();
    };
    const onLookupsUpdated = () => void reload();
    window.addEventListener(SCHEMA_EVENT, onUpdate);
    window.addEventListener(LOOKUPS_EVENT, onLookupsUpdated);
    window.addEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    const initialTenantId = currentTenantKey();
    loadTenantSchema()
      .then((next) => {
        if (!cancelled && initialTenantId === currentTenantKey()) {
          setFields(next);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load schema");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      window.removeEventListener(SCHEMA_EVENT, onUpdate);
      window.removeEventListener(LOOKUPS_EVENT, onLookupsUpdated);
      window.removeEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    };
  }, [reload]);

  return { fields, loading, error, reload };
}

export async function loadAssignableUsers(force = false) {
  const key = cacheKey();
  const cached = assignableUsersCache.get(key);
  if (cached && !force) return cached;
  if (!assignableUsersRequests.has(key) || force) {
    const request = apiFetch<{ items: AssignableUser[] }>("/users/assignable")
      .then((res) => {
        const users = res.items || [];
        assignableUsersCache.set(key, users);
        emit(USERS_EVENT, { tenantId: key, users });
        return users;
      })
      .finally(() => {
        assignableUsersRequests.delete(key);
      });
    assignableUsersRequests.set(key, request);
  }
  return assignableUsersRequests.get(key)!;
}

export function updateAssignableUsersCache(users: AssignableUser[]) {
  const tenantId = cacheKey();
  assignableUsersCache.set(tenantId, users);
  emit(USERS_EVENT, { tenantId, users });
}

export function useAssignableUsers(enabled = true) {
  const [users, setUsers] = useState<AssignableUser[]>(assignableUsersCache.get(cacheKey()) || []);
  const [loading, setLoading] = useState(enabled && !assignableUsersCache.get(cacheKey()));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadAssignableUsers(true);
      setUsers(next);
      setError(null);
      return next;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load users";
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ tenantId: string; users: AssignableUser[] }>).detail;
      if (detail?.tenantId === currentTenantKey()) setUsers(detail.users);
    };
    const onTenantChange = () => {
      const tenantId = currentTenantKey();
      setUsers(assignableUsersCache.get(tenantId) || []);
      setLoading(!assignableUsersCache.get(tenantId));
      void reload();
    };
    window.addEventListener(USERS_EVENT, onUpdate);
    window.addEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    const initialTenantId = currentTenantKey();
    loadAssignableUsers()
      .then((next) => {
        if (!cancelled && initialTenantId === currentTenantKey()) {
          setUsers(next);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load users");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      window.removeEventListener(USERS_EVENT, onUpdate);
      window.removeEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    };
  }, [enabled, reload]);

  return { users, loading, error, reload };
}

export type DashboardScope = "me" | "workspace";

export function useDashboardData(options?: {
  scope?: DashboardScope;
  reloadToken?: number;
}) {
  const [opportunities, setOpportunities] = useState<ApiOpportunity[]>([]);
  const [schemaFields, setSchemaFields] = useState<TenantFieldDefinition[]>(
    schemaCache.get(cacheKey()) || []
  );
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig>(
    DEFAULT_DASHBOARD_CONFIG
  );
  const [terminology, setTerminology] =
    useState<TerminologyConfig>(DEFAULT_TERMINOLOGY);
  const [summaryCards, setSummaryCards] = useState<SummaryCardsConfig>(
    normalizeSummaryCardsConfig(null)
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope: DashboardScope = options?.scope || "workspace";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const tenantId = currentTenantKey();
      setLoading(true);
      try {
        const recordsQuery = new URLSearchParams();
        recordsQuery.set("archived", "exclude");
        // Dashboard defaults to excluding drafts (server default). Scope controls mine-only.
        if (scope === "me") recordsQuery.set("mine", "1");
        const [oppRes, fields] = await Promise.all([
          apiFetch<{ items: ApiOpportunity[] }>(`/records?${recordsQuery.toString()}`),
          loadTenantSchema(),
        ]);
        let settingsRes: {
          dashboard?: DashboardConfig;
          terminology?: TerminologyConfig;
          summaryCards?: SummaryCardsConfig;
        } = {};
        try {
          settingsRes = await apiFetch<{
            dashboard?: DashboardConfig;
            terminology?: TerminologyConfig;
            summaryCards?: SummaryCardsConfig;
          }>("/settings");
        } catch {
          settingsRes = {};
        }
        if (cancelled || tenantId !== currentTenantKey()) return;
        const nextTerminology = settingsRes.terminology || DEFAULT_TERMINOLOGY;
        setOpportunities(oppRes.items || []);
        setDashboardConfig(settingsRes.dashboard || DEFAULT_DASHBOARD_CONFIG);
        setTerminology(nextTerminology);
        updateTerminologyCache(nextTerminology);
        setSummaryCards(normalizeSummaryCardsConfig(settingsRes.summaryCards));
        setSchemaFields(fields);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load dashboard");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const onTenantChange = () => {
      setOpportunities([]);
      void load();
    };
    window.addEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    void load();
    return () => {
      cancelled = true;
      window.removeEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    };
  }, [scope, options?.reloadToken]);

  return {
    opportunities,
    schemaFields,
    dashboardConfig,
    terminology,
    summaryCards,
    loading,
    error,
  };
}
