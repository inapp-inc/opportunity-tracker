import { useEffect, useState } from "react";
import { ACTIVE_TENANT_EVENT, apiFetch, getActiveTenantId } from "./api";

export type TenantThemeConfig = {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  cardColor: string;
  sidebarColor: string;
  radius: string;
};

export const DEFAULT_TENANT_THEME: TenantThemeConfig = {
  primaryColor: "#2563eb",
  accentColor: "#eaf1ff",
  backgroundColor: "#f7f9fc",
  cardColor: "#ffffff",
  sidebarColor: "#ffffff",
  radius: "0.875rem",
};

const themeCache = new Map<string, TenantThemeConfig>();
const themeRequests = new Map<string, Promise<TenantThemeConfig>>();
const THEME_EVENT = "tenant-theme-updated";

function cacheKey() {
  return getActiveTenantId() || "__active__";
}

function readableTextColor(hex: string) {
  const raw = hex.replace("#", "");
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0f172a" : "#ffffff";
}

export function applyTenantTheme(theme: TenantThemeConfig = DEFAULT_TENANT_THEME) {
  const root = document.documentElement;
  const primaryText = readableTextColor(theme.primaryColor);
  root.style.setProperty("--primary", theme.primaryColor);
  root.style.setProperty("--primary-foreground", primaryText);
  root.style.setProperty("--ring", theme.primaryColor);
  root.style.setProperty("--accent", theme.accentColor);
  root.style.setProperty("--background", theme.backgroundColor);
  root.style.setProperty("--card", theme.cardColor);
  root.style.setProperty("--popover", theme.cardColor);
  root.style.setProperty("--sidebar", theme.sidebarColor);
  root.style.setProperty("--sidebar-primary", theme.primaryColor);
  root.style.setProperty("--sidebar-primary-foreground", primaryText);
  root.style.setProperty("--sidebar-accent", theme.accentColor);
  root.style.setProperty("--radius", theme.radius);
}

export async function loadTenantTheme(force = false) {
  const key = cacheKey();
  const cached = themeCache.get(key);
  if (cached && !force) return cached;
  if (!themeRequests.has(key) || force) {
    const request = apiFetch<{ theme?: TenantThemeConfig }>("/settings")
      .then((res) => {
        const theme = res.theme || DEFAULT_TENANT_THEME;
        themeCache.set(key, theme);
        return theme;
      })
      .catch(() => DEFAULT_TENANT_THEME)
      .finally(() => {
        themeRequests.delete(key);
      });
    themeRequests.set(key, request);
  }
  return themeRequests.get(key)!;
}

export function updateTenantThemeCache(theme: TenantThemeConfig) {
  const tenantId = cacheKey();
  themeCache.set(tenantId, theme);
  applyTenantTheme(theme);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { tenantId, theme } }));
}

export function clearTenantThemeCache() {
  themeCache.clear();
  themeRequests.clear();
  applyTenantTheme(DEFAULT_TENANT_THEME);
}

export function useTenantTheme() {
  const [theme, setTheme] = useState<TenantThemeConfig>(
    themeCache.get(cacheKey()) || DEFAULT_TENANT_THEME
  );

  useEffect(() => {
    let cancelled = false;
    const loadForTenant = () => {
      const tenantId = cacheKey();
      const cached = themeCache.get(tenantId) || DEFAULT_TENANT_THEME;
      setTheme(cached);
      applyTenantTheme(cached);
      loadTenantTheme().then((next) => {
        if (cancelled || tenantId !== cacheKey()) return;
        setTheme(next);
        applyTenantTheme(next);
      });
    };
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ tenantId: string; theme: TenantThemeConfig }>).detail;
      if (detail?.tenantId !== cacheKey()) return;
      setTheme(detail.theme);
      applyTenantTheme(detail.theme);
    };
    window.addEventListener(THEME_EVENT, onUpdate);
    window.addEventListener(ACTIVE_TENANT_EVENT, loadForTenant);
    loadForTenant();
    return () => {
      cancelled = true;
      window.removeEventListener(THEME_EVENT, onUpdate);
      window.removeEventListener(ACTIVE_TENANT_EVENT, loadForTenant);
    };
  }, []);

  return theme;
}
