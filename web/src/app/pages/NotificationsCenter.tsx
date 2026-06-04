import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Select } from "../components/ui/Select";
import { EmptyState } from "../components/ui/EmptyState";
import { Bell, Clock, AlertTriangle, CheckCircle, RefreshCw } from "lucide-react";
import { apiFetch } from "../lib/api";
import { lowerFirst, useTerminology } from "../lib/terminology";
import { PageHeader, Toolbar, LoadingDisplay } from "../components/shared";
import { PageLayoutEditor } from "../components/page-layout/PageLayoutEditor";
import { NotificationsLayoutPanel } from "../components/page-layout/panels/NotificationsLayoutPanel";
import { useCanManageTenantSettings, useIsPlatformAdmin } from "../lib/roles";

interface Notification {
  id: string;
  type: "reminder" | "overdue";
  title: string;
  message: string;
  opportunityId: string;
  opportunityName: string;
  timestamp: string;
  isRead: boolean;
  actionRequired?: boolean;
}

export function NotificationsCenter() {
  const terminology = useTerminology();
  const canManageTenantSettings = useCanManageTenantSettings();
  const isPlatformAdmin = useIsPlatformAdmin();
  const canEditLayouts = canManageTenantSettings || isPlatformAdmin;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filterType, setFilterType] = useState("all");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch<{ items: Notification[] }>("/notifications");
      setNotifications(res.items || []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load");
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = notifications.filter((n) => {
    if (filterType !== "all" && n.type !== filterType) return false;
    if (showUnreadOnly && n.isRead) return false;
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markAsRead = async (id: string) => {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
    } catch {
      await load();
    }
  };

  const markAllAsRead = async () => {
    try {
      await apiFetch("/notifications/read-all", { method: "PATCH" });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      await load();
    }
  };

  const getNotificationIcon = (type: Notification["type"]) => {
    switch (type) {
      case "overdue":
        return <AlertTriangle className="w-5 h-5 text-red-600" />;
      case "reminder":
        return <Clock className="w-5 h-5 text-yellow-600" />;
      default:
        return <Bell className="w-5 h-5" />;
    }
  };

  const getNotificationBadge = (type: Notification["type"]) => {
    const labels: Record<Notification["type"], string> = {
      overdue: "Overdue",
      reminder: "Reminder",
    };

    const variants: Record<Notification["type"], "danger" | "warning"> = {
      overdue: "danger",
      reminder: "warning",
    };

    return <Badge variant={variants[type]}>{labels[type]}</Badge>;
  };

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
      <PageHeader
        title="Notifications"
        description={`Stay updated on ${lowerFirst(terminology.recordSingular)} reminders and changes`}
        actions={
        <div className="flex flex-wrap items-center gap-2">
          {!canEditLayouts ? null : (
            <PageLayoutEditor
              title="Notification settings"
              description="Reminder schedules, display timezone, and Case Study visibility for this workspace."
            >
              <NotificationsLayoutPanel />
            </PageLayoutEditor>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {unreadCount > 0 && (
            <Button variant="outline" onClick={() => void markAllAsRead()}>
              <CheckCircle className="w-4 h-4" />
              Mark All as Read ({unreadCount})
            </Button>
          )}
        </div>
        }
      />

      {loadError && (
        <p className="text-sm text-destructive border border-destructive/40 rounded-lg p-3">
          {loadError}
        </p>
      )}

      <Toolbar>
        <Select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          options={[
            { value: "all", label: "All Types" },
            { value: "overdue", label: "Overdue" },
            { value: "reminder", label: "Reminders" },
          ]}
        />

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-input-background px-4 py-2 text-sm">
          <input
            type="checkbox"
            checked={showUnreadOnly}
            onChange={(e) => setShowUnreadOnly(e.target.checked)}
            className="rounded border-border"
          />
          <span>Show unread only</span>
        </label>
      </Toolbar>

      {loading ? (
        <LoadingDisplay message="Loading notifications..." />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={loading ? "Loading…" : "No notifications"}
          description={
            loading
              ? "Fetching your notifications."
              : "You're all caught up! No notifications to display."
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((notification) => (
            <Card
              key={notification.id}
              className={`p-4 transition-colors ${
                !notification.isRead ? "border-primary bg-primary/5" : ""
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-1">
                  {getNotificationIcon(notification.type)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4>{notification.title}</h4>
                      {getNotificationBadge(notification.type)}
                      {notification.actionRequired && (
                        <Badge variant="danger">Action Required</Badge>
                      )}
                      {!notification.isRead && (
                        <Badge variant="info">New</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {notification.timestamp}
                    </span>
                  </div>

                  <p className="text-sm text-muted-foreground mb-3">
                    {notification.message}
                  </p>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to={`/app/opportunities/${notification.opportunityId}`}>
                      <Button variant="outline" size="sm">
                        View {terminology.recordSingular}
                      </Button>
                    </Link>
                    {!notification.isRead && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void markAsRead(notification.id)}
                      >
                        Mark as Read
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
