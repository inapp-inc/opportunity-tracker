import { useEffect, useState } from "react";
import { ACTIVE_TENANT_EVENT, apiFetch, getActiveTenantId } from "./api";

export type TerminologyConfig = {
  appName: string;
  recordSingular: string;
  recordPlural: string;
  recordDescription: string;
  dashboardLabel: string;
};

export const DEFAULT_TERMINOLOGY: TerminologyConfig = {
  appName: "Opportunity Tracker",
  recordSingular: "Record",
  recordPlural: "Records",
  recordDescription:
    "Track work items, projects, opportunities, or engagements.",
  dashboardLabel: "Dashboard",
};

export function lowerFirst(value: string) {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

const terminologyCache = new Map<string, TerminologyConfig>();
const terminologyRequests = new Map<string, Promise<TerminologyConfig>>();
const TERMINOLOGY_EVENT = "tenant-terminology-updated";

function cacheKey() {
  return getActiveTenantId() || "__active__";
}

export async function loadTerminology() {
  const key = cacheKey();
  const cached = terminologyCache.get(key);
  if (cached) return cached;
  if (!terminologyRequests.has(key)) {
    const request = apiFetch<{ terminology?: TerminologyConfig }>("/settings")
      .then((res) => {
        const terminology = res.terminology || DEFAULT_TERMINOLOGY;
        terminologyCache.set(key, terminology);
        return terminology;
      })
      .catch(() => DEFAULT_TERMINOLOGY)
      .finally(() => {
        terminologyRequests.delete(key);
      });
    terminologyRequests.set(key, request);
  }
  return terminologyRequests.get(key)!;
}

export function updateTerminologyCache(terminology: TerminologyConfig) {
  const tenantId = cacheKey();
  terminologyCache.set(tenantId, terminology);
  window.dispatchEvent(new CustomEvent(TERMINOLOGY_EVENT, { detail: { tenantId, terminology } }));
}

export function clearTerminologyCache() {
  terminologyCache.clear();
  terminologyRequests.clear();
}

export function useTerminology() {
  const [terminology, setTerminology] =
    useState<TerminologyConfig>(terminologyCache.get(cacheKey()) || DEFAULT_TERMINOLOGY);

  useEffect(() => {
    let cancelled = false;
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ tenantId: string; terminology: TerminologyConfig }>).detail;
      if (detail?.tenantId === cacheKey()) setTerminology(detail.terminology);
    };
    const onTenantChange = () => {
      const tenantId = cacheKey();
      setTerminology(terminologyCache.get(tenantId) || DEFAULT_TERMINOLOGY);
      loadTerminology().then((next) => {
        if (!cancelled && tenantId === cacheKey()) setTerminology(next);
      });
    };
    window.addEventListener(TERMINOLOGY_EVENT, onUpdate);
    window.addEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    const tenantId = cacheKey();
    loadTerminology().then((next) => {
      if (!cancelled && tenantId === cacheKey()) setTerminology(next);
    });
    return () => {
      cancelled = true;
      window.removeEventListener(TERMINOLOGY_EVENT, onUpdate);
      window.removeEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    };
  }, []);

  return terminology;
}
