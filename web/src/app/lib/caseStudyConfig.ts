import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_TENANT_EVENT, apiFetch } from "./api";
import {
  defaultCaseStudyLayout,
  isPersistedCaseStudyLayout,
  layoutFromWorkspaceConfig,
  type CaseStudyLayout,
} from "./caseStudyLayout";
import { WORKSPACE_LAYOUT_EVENT } from "./pageLayoutEvents";
import { useAuthUser } from "../contexts/AuthUserContext";

type CaseStudyConfig = {
  enabled: boolean;
  layout: CaseStudyLayout;
  /** Saved on the server (false = showing built-in template because none was stored). */
  persisted: boolean;
};

type CaseStudySettingsPayload = {
  caseStudyEnabled?: boolean;
  caseStudyLayout?: unknown;
};

async function fetchCaseStudySettingsPayload(): Promise<CaseStudySettingsPayload> {
  const ts = Date.now();
  const opts = { cache: "no-store" as RequestCache };

  // Same source as Settings → Case Study (authoritative).
  try {
    return await apiFetch<CaseStudySettingsPayload>(`/settings?ts=${ts}`, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const forbidden =
      message.toLowerCase().includes("forbidden") ||
      message.toLowerCase().includes("permission");
    if (!forbidden) throw err;
  }

  // Managers and other roles without settings read still need the saved layout on records.
  return apiFetch<CaseStudySettingsPayload>(`/catalog/lookups?ts=${ts}`, opts);
}

export async function fetchCaseStudyConfig(): Promise<CaseStudyConfig> {
  const payload = await fetchCaseStudySettingsPayload();
  const persisted = isPersistedCaseStudyLayout(payload.caseStudyLayout);

  return {
    enabled:
      payload.caseStudyEnabled !== undefined
        ? Boolean(payload.caseStudyEnabled)
        : true,
    layout: layoutFromWorkspaceConfig(payload.caseStudyLayout),
    persisted,
  };
}

/** @deprecated No-op; layout is always fetched fresh when the tab opens. */
export function invalidateCaseStudyConfigCache() {}

export function useCaseStudySession(options: {
  recordId?: string;
  tabActive: boolean;
}) {
  const { user, loading: authLoading } = useAuthUser();

  const [enabled, setEnabled] = useState(true);
  const [layout, setLayout] = useState<CaseStudyLayout | null>(null);
  const [layoutPersisted, setLayoutPersisted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [readyToCapture, setReadyToCapture] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const sessionRef = useRef(0);

  const regenerate = useCallback(async () => {
    if (
      authLoading ||
      !user ||
      !options.tabActive ||
      !options.recordId
    )
      return;

    const session = ++sessionRef.current;
    setLoading(true);
    setReadyToCapture(false);
    setConfigError(null);

    try {
      const config = await fetchCaseStudyConfig();
      if (session !== sessionRef.current) return;

      setEnabled(config.enabled);
      setLayout(config.layout);
      setLayoutPersisted(config.persisted);
      setEpoch((value) => value + 1);
    } catch (err) {
      if (session !== sessionRef.current) return;
      setConfigError(
        err instanceof Error
          ? err.message
          : "Unable to load case study layout for this workspace."
      );
      setLayout(null);
      setLayoutPersisted(false);
    } finally {
      if (session === sessionRef.current) {
        setLoading(false);
      }
    }
  }, [authLoading, user, options.tabActive, options.recordId]);

  useEffect(() => {
    if (!options.tabActive) {
      setReadyToCapture(false);
      return;
    }
    void regenerate();
  }, [options.tabActive, options.recordId, regenerate]);

  useEffect(() => {
    const onTenantChange = () => {
      if (options.tabActive) void regenerate();
    };
    const onLayoutUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: string }>).detail;
      if (detail?.page && detail.page !== "case-study") return;
      if (options.tabActive) void regenerate();
    };

    window.addEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    window.addEventListener(WORKSPACE_LAYOUT_EVENT, onLayoutUpdated);
    return () => {
      window.removeEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
      window.removeEventListener(WORKSPACE_LAYOUT_EVENT, onLayoutUpdated);
    };
  }, [options.tabActive, regenerate]);

  useEffect(() => {
    if (options.tabActive && user && !authLoading) {
      void regenerate();
    }
  }, [options.tabActive, user, authLoading, regenerate]);

  return {
    enabled,
    layout: layout ?? defaultCaseStudyLayout(),
    layoutPersisted,
    loading,
    configError,
    epoch,
    readyToCapture,
    regenerate,
    setReadyToCapture,
  };
}

/** @deprecated Use useCaseStudySession */
export function useCaseStudyConfig(options?: {
  reloadOnTabActive?: boolean;
  tabActive?: boolean;
}) {
  return useCaseStudySession({
    recordId: options?.tabActive ? "active" : undefined,
    tabActive: Boolean(options?.tabActive),
  });
}
