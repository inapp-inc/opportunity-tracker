import { Outlet, Link, useLocation, useNavigate } from "react-router";
import { clearToken } from "../lib/auth";
import {
  LayoutDashboard,
  Briefcase,
  Bell,
  BarChart3,
  Settings,
  Search,
  LogOut,
  Package
} from "lucide-react";
import { useEffect, useState } from "react";
import { AuthUserProvider, useAuthUser } from "../contexts/AuthUserContext";
import { apiFetch } from "../lib/api";

function initialsFromEmail(email: string) {
  const local = email.split("@")[0] || "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (local.slice(0, 2) || "?").toUpperCase();
}

function MainLayoutShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: userLoading } = useAuthUser();
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);

  const navItems = [
    { path: "/app", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/app/opportunities", icon: Briefcase, label: "Opportunities" },
    { path: "/app/notifications", icon: Bell, label: "Notifications" },
    { path: "/app/reports", icon: BarChart3, label: "Reports" },
    { path: "/app/settings", icon: Settings, label: "Settings" },
    { path: "/app/components", icon: Package, label: "Components" },
  ];

  const handleLogout = () => {
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

  const displayInitials = user?.email
    ? initialsFromEmail(user.email)
    : userLoading
      ? "…"
      : "?";

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="p-6 border-b border-sidebar-border">
          <h1 className="text-sidebar-foreground">Presales Tracker</h1>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path ||
              (item.path !== "/app" && location.pathname.startsWith(item.path));

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border space-y-3">
          {user?.email && (
            <p className="px-3 text-xs text-sidebar-foreground/80 truncate" title={user.email}>
              {user.email}
            </p>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors w-full"
          >
            <LogOut className="w-5 h-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-6">
          <form onSubmit={handleSearch} className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search opportunities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-input-background rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </form>

          <div className="flex items-center gap-4">
            <Link
              to="/app/notifications"
              className="relative p-2 hover:bg-accent rounded-lg transition-colors text-foreground"
              aria-label={
                unreadCount > 0
                  ? `Notifications, ${unreadCount} unread`
                  : "Notifications"
              }
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 flex items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium shrink-0"
                title={user?.email || ""}
              >
                {displayInitials}
              </div>
              {user?.email && (
                <span className="text-sm text-muted-foreground truncate max-w-[180px] hidden sm:inline">
                  {user.email}
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
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
