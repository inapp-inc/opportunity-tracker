import { Outlet, Link, useLocation, useNavigate } from "react-router";
import { clearToken } from "../lib/auth";
import {
  LayoutDashboard,
  Briefcase,
  BookOpen,
  Bell,
  Settings,
  Search,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Zap,
  Link2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AuthUserProvider, useAuthUser } from "../contexts/AuthUserContext";
import { apiFetch, clearActiveTenantId } from "../lib/api";
import { clearTerminologyCache, lowerFirst, useTerminology } from "../lib/terminology";
import { useCanManageTenantSettings, useIsPlatformAdmin } from "../lib/roles";
import { clearServerStateCaches } from "../lib/serverState";
import { clearTenantThemeCache, useTenantTheme } from "../lib/tenantTheme";
import { cn } from "../components/ui/utils";
import { displayNameFromUser, initialsFromDisplayName } from "../lib/format";
import { usePageAccess } from "../lib/pageAccess";
import { WORKSPACE_LAYOUT_EVENT } from "../lib/pageLayoutEvents";

function MainLayoutShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: userLoading, switchTenant } = useAuthUser();
  const canManageTenantSettings = useCanManageTenantSettings();
  const isPlatformAdmin = useIsPlatformAdmin();
  const terminology = useTerminology();
  const { canAccess: canAccessPage } = usePageAccess();
  useTenantTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [dashboardTitle, setDashboardTitle] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const loadDashboardTitle = async () => {
      try {
        const res = await apiFetch<{ dashboard?: { title?: string } }>("/settings");
        const title = String(res.dashboard?.title || "").trim();
        if (!cancelled) setDashboardTitle(title);
      } catch {
        if (!cancelled) setDashboardTitle("");
      }
    };

    const onLayout = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: string }>).detail;
      if (!detail?.page || detail.page === "dashboard") void loadDashboardTitle();
    };

    window.addEventListener(WORKSPACE_LAYOUT_EVENT, onLayout);
    void loadDashboardTitle();
    return () => {
      cancelled = true;
      window.removeEventListener(WORKSPACE_LAYOUT_EVENT, onLayout);
    };
  }, [user?.activeTenantId, user?.tenantId]);

  const dashboardNavLabel = dashboardTitle || terminology.dashboardLabel || "Dashboard";

  const navItems = [
    canAccessPage("dashboard")
      ? { path: "/app", icon: LayoutDashboard, label: dashboardNavLabel }
      : null,
    canAccessPage("records")
      ? { path: "/app/opportunities", icon: Briefcase, label: terminology.recordPlural }
      : null,
    canAccessPage("artifacts")
      ? { path: "/app/artifacts", icon: Link2, label: "Artifact Links" }
      : null,
    canAccessPage("caseStudies")
      ? { path: "/app/case-studies", icon: BookOpen, label: "Case Studies" }
      : null,
    canAccessPage("notifications")
      ? { path: "/app/notifications", icon: Bell, label: "Notifications" }
      : null,
    canAccessPage("settings") && (canManageTenantSettings || isPlatformAdmin)
      ? { path: "/app/settings", icon: Settings, label: "Settings" }
      : null,
  ].filter(Boolean) as { path: string; icon: typeof LayoutDashboard; label: string }[];

  const handleLogout = () => {
    clearActiveTenantId();
    clearServerStateCaches();
    clearTerminologyCache();
    clearTenantThemeCache();
    clearToken();
    navigate("/");
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/app/opportunities?search=${encodeURIComponent(searchQuery)}`);
    }
  };

  useEffect(() => {
    if (location.pathname.startsWith("/app/opportunities")) {
      const q = new URLSearchParams(location.search).get("search") || "";
      setSearchQuery(q);
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    let cancelled = false;
    const loadUnread = async () => {
      try {
        const res = await apiFetch<{ items: { isRead: boolean }[] }>(
          "/notifications"
        );
        if (cancelled) return;
        const n = (res.items || []).filter((x) => !x.isRead).length;
        setUnreadCount(n);
      } catch {
        if (!cancelled) setUnreadCount(0);
      }
    };

    void loadUnread();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadUnread();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [location.pathname]);

  const displayName = displayNameFromUser(user);
  const displayInitials = user
    ? initialsFromDisplayName(displayName, user.email)
    : userLoading
      ? "…"
      : "?";

  const activeNav = navItems.find(
    (item) =>
      location.pathname === item.path ||
      (item.path !== "/app" && location.pathname.startsWith(item.path))
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={cn(
          "flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300",
          collapsed ? "w-16" : "w-72"
        )}
      >
        <div className={cn("flex h-16 items-center gap-3 border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
          {!collapsed ? (
            <img
              src={`${import.meta.env.BASE_URL}inapp-logo.png`}
              alt="InApp"
              className="h-8 w-auto shrink-0 object-contain"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
              <Zap className="h-4 w-4" />
            </div>
          )}
          {!collapsed ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-none text-sidebar-foreground">
                {terminology.appName}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/60">
                Built by The Foundry
              </p>
            </div>
          ) : null}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4">
          {!collapsed ? (
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
              Main Menu
            </p>
          ) : null}
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path ||
              (item.path !== "/app" && location.pathname.startsWith(item.path));

            return (
              <Link
                key={item.path}
                to={item.path}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group mb-1 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed && "mx-auto h-10 w-10 justify-center px-0"
                )}
              >
                <Icon className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} />
                {!collapsed ? (
                  <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.path === "/app/notifications" && unreadCount > 0 ? (
                      <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className={cn("space-y-2 border-t border-sidebar-border p-2", collapsed && "flex flex-col items-center")}>
          {user?.email && (
            <div className={cn("rounded-xl px-3 py-2 transition-colors hover:bg-sidebar-accent", collapsed && "px-0")}>
              <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-sky-400 text-[10px] font-bold text-white">
                  {displayInitials}
                </div>
                {!collapsed ? (
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-sidebar-foreground" title={displayName}>
                      {displayName}
                    </p>
                    <p className="truncate text-[10px] text-sidebar-foreground/60" title={user.tenantName}>
                      {user.activeTenantName || user.tenantName}
                    </p>
                  </div>
                ) : null}
              </div>
              {!collapsed && (user.memberships || []).length > 1 ? (
                <select
                  value={user.activeTenantId || user.tenantId}
                  onChange={(event) => {
                    const nextTenantId = event.target.value;
                    if (nextTenantId === (user.activeTenantId || user.tenantId)) return;
                    void (async () => {
                      clearServerStateCaches();
                      clearTerminologyCache();
                      clearTenantThemeCache();
                      await switchTenant(nextTenantId);
                      navigate("/app");
                    })();
                  }}
                  className="mt-3 w-full rounded-lg border border-sidebar-border bg-sidebar px-2 py-1.5 text-xs text-sidebar-foreground focus:outline-none focus:ring-2 focus:ring-sidebar-ring"
                  aria-label="Switch workspace"
                >
                  {user.memberships.map((membership) => (
                    <option key={membership.tenantId} value={membership.tenantId}>
                      {membership.tenantName}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          )}
          <button
            onClick={handleLogout}
            title={collapsed ? "Sign Out" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed && "h-10 w-10 justify-center px-0"
            )}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed ? <span>Sign Out</span> : null}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Toggle sidebar"
            >
              {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-semibold text-foreground">
                {activeNav?.label || (terminology.dashboardLabel || "Dashboard")}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.activeTenantName || user?.tenantName || "Current workspace"}
              </p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="mx-4 hidden flex-1 max-w-md md:block">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder={`Search ${lowerFirst(terminology.recordPlural)}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-input-background py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </form>

          <div className="flex items-center gap-2">
            <Link
              to="/app/notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={
                unreadCount > 0
                  ? `Notifications, ${unreadCount} unread`
                  : "Notifications"
              }
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 ? (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive" />
              ) : null}
            </Link>
            <div className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-background px-2 py-1">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-sky-400 text-[10px] font-bold text-white"
                title={displayName}
              >
                {displayInitials}
              </div>
              {displayName && (
                <span className="hidden max-w-[220px] truncate pr-1 text-xs text-muted-foreground lg:inline">
                  {displayName}
                </span>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function MainLayout() {
  return (
    <AuthUserProvider>
      <MainLayoutShell />
    </AuthUserProvider>
  );
}
