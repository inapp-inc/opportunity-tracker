import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../ui/Table";
import { Plus, Trash2 } from "lucide-react";
import { apiFetch } from "../../../lib/api";
import {
  DASHBOARD_WIDGET_TYPE_OPTIONS,
  DEFAULT_DASHBOARD_CONFIG,
  buildDashboardFieldOptions,
  dashboardFieldForType,
  dashboardOptionsForWidgetType,
  type DashboardConfig,
  type DashboardWidget,
} from "../../../lib/dashboard";
import { useTenantSchema } from "../../../lib/serverState";
import { emitWorkspaceLayoutUpdated } from "../../../lib/pageLayoutEvents";
import { useTerminology } from "../../../lib/terminology";
import { TenantPermissions, useCanManageTenantSettings, useIsPlatformAdmin, useTenantPermission } from "../../../lib/roles";

export function DashboardLayoutPanel() {
  const { fields: schemaFields } = useTenantSchema();
  const terminology = useTerminology();
  const canManageSettings = useCanManageTenantSettings();
  const isPlatformAdmin = useIsPlatformAdmin();
  const hasSettingsWrite = useTenantPermission(TenantPermissions.tenantSettingsWrite);
  const canSaveWorkspace = canManageSettings || isPlatformAdmin;
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveMsgTone, setSaveMsgTone] = useState<"info" | "error">("info");
  const [addWidgetMsg, setAddWidgetMsg] = useState<string | null>(null);
  const [saveDashboardForUser, setSaveDashboardForUser] = useState(!canSaveWorkspace);
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig>(
    DEFAULT_DASHBOARD_CONFIG
  );
  const [newWidget, setNewWidget] = useState<DashboardWidget>({
    id: "",
    title: "",
    type: "metric_count",
    field: "",
    limit: 8,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      try {
        const res = await apiFetch<{ dashboard?: DashboardConfig }>("/settings");
        setDashboardConfig(res.dashboard || DEFAULT_DASHBOARD_CONFIG);
      } catch {
        // Non-admin users (or misconfigured roles) may not have tenant.settings.read.
        // Fall back to user-scoped dashboard payload which requires only records.read.
        const res = await apiFetch<{ dashboard?: DashboardConfig }>("/settings/my-dashboard");
        setDashboardConfig(res.dashboard || DEFAULT_DASHBOARD_CONFIG);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dashboardFieldOptions = useMemo(
    () => buildDashboardFieldOptions(schemaFields),
    [schemaFields]
  );

  const optionsForType = (type: DashboardWidget["type"]) =>
    dashboardOptionsForWidgetType(type, dashboardFieldOptions);

  const compatibleField = (type: DashboardWidget["type"], current?: string) =>
    dashboardFieldForType(type, dashboardFieldOptions, current);

  const addWidget = () => {
    setAddWidgetMsg(null);
    const needsField = newWidget.type !== "metric_count";
    if (!newWidget.title.trim()) {
      setAddWidgetMsg("Widget title is required.");
      return;
    }
    if (needsField && !newWidget.field) {
      setAddWidgetMsg("Select a field for this widget type.");
      return;
    }
    const id =
      newWidget.id ||
      `${newWidget.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    setDashboardConfig({
      ...dashboardConfig,
      widgets: [
        ...(dashboardConfig.widgets || []),
        {
          ...newWidget,
          id,
          title: newWidget.title.trim(),
          field: needsField ? newWidget.field : "",
          limit: Number(newWidget.limit || 8),
        },
      ],
    });
    setNewWidget({ id: "", title: "", type: "metric_count", field: "", limit: 8 });
  };

  const updateWidget = (id: string, patch: Partial<DashboardWidget>) => {
    setDashboardConfig({
      ...dashboardConfig,
      widgets: dashboardConfig.widgets.map((w) =>
        w.id === id ? { ...w, ...patch } : w
      ),
    });
  };

  const removeWidget = (id: string) => {
    setDashboardConfig({
      ...dashboardConfig,
      widgets: dashboardConfig.widgets.filter((w) => w.id !== id),
    });
  };

  const handleSave = async () => {
    setSaveMsg(null);
    setSaveMsgTone("info");
    try {
      const wantWorkspace = canSaveWorkspace && !saveDashboardForUser;
      if (wantWorkspace) {
        try {
          await apiFetch("/settings", {
            method: "PATCH",
            body: JSON.stringify({
              dashboard: dashboardConfig,
              dashboardScope: "tenant",
            }),
          });
          setSaveMsg("Dashboard layout saved for this workspace.");
          setSaveMsgTone("info");
          emitWorkspaceLayoutUpdated({ page: "dashboard" });
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Save failed";
          setSaveMsg(
            msg.includes("Forbidden")
              ? `Forbidden saving workspace dashboard. Ensure this role has "${TenantPermissions.tenantSettingsWrite}".`
              : msg
          );
          setSaveMsgTone("error");
          return;
        }
      }

      await apiFetch("/settings/my-dashboard", {
        method: "PATCH",
        body: JSON.stringify({ dashboard: dashboardConfig }),
      });
      setSaveMsg("Saved as your personal dashboard.");
      setSaveMsgTone("info");
      emitWorkspaceLayoutUpdated({ page: "dashboard" });
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
      setSaveMsgTone("error");
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading dashboard layout…</p>;
  }

  const dashboardLabel = terminology.dashboardLabel || "Dashboard";
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label={`${dashboardLabel} title`}
          value={dashboardConfig.title}
          onChange={(e) =>
            setDashboardConfig({ ...dashboardConfig, title: e.target.value })
          }
        />
        <Input
          label={`${dashboardLabel} subtitle`}
          value={dashboardConfig.subtitle}
          onChange={(e) =>
            setDashboardConfig({ ...dashboardConfig, subtitle: e.target.value })
          }
        />
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Widget</TableHead>
              <TableHead>Field</TableHead>
              <TableHead>Limit</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(dashboardConfig.widgets || []).map((widget) => (
              <TableRow key={widget.id}>
                <TableCell>
                  <Input
                    value={widget.title}
                    onChange={(e) =>
                      updateWidget(widget.id, { title: e.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={widget.type}
                    options={DASHBOARD_WIDGET_TYPE_OPTIONS}
                    onChange={(e) =>
                      updateWidget(widget.id, {
                        type: e.target.value as DashboardWidget["type"],
                        field:
                          e.target.value === "metric_count"
                            ? ""
                            : compatibleField(
                                e.target.value as DashboardWidget["type"],
                                widget.field
                              ),
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={widget.field || ""}
                    disabled={widget.type === "metric_count"}
                    options={[
                      { value: "", label: "No field needed" },
                      ...optionsForType(widget.type).map((f) => ({
                        value: f.value,
                        label: f.label,
                      })),
                    ]}
                    onChange={(e) =>
                      updateWidget(widget.id, { field: e.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={widget.limit ?? 8}
                    disabled={widget.type === "metric_count"}
                    onChange={(e) =>
                      updateWidget(widget.id, {
                        limit: Number(e.target.value),
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeWidget(widget.id)}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3">
        <p className="text-sm font-medium">Add widget</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="Title"
            value={newWidget.title}
            onChange={(e) => setNewWidget({ ...newWidget, title: e.target.value })}
          />
          <Select
            label="Type"
            value={newWidget.type}
            options={DASHBOARD_WIDGET_TYPE_OPTIONS}
            onChange={(e) =>
              setNewWidget({
                ...newWidget,
                type: e.target.value as DashboardWidget["type"],
                field:
                  e.target.value === "metric_count"
                    ? ""
                    : compatibleField(e.target.value as DashboardWidget["type"]),
              })
            }
          />
          {newWidget.type !== "metric_count" ? (
            <Select
              label="Field"
              value={newWidget.field || ""}
              options={optionsForType(newWidget.type).map((f) => ({
                value: f.value,
                label: f.label,
              }))}
              onChange={(e) =>
                setNewWidget({ ...newWidget, field: e.target.value })
              }
            />
          ) : null}
        </div>
        <Button type="button" variant="outline" onClick={addWidget}>
          <Plus className="w-4 h-4" />
          Add widget
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={saveDashboardForUser}
          disabled={!canSaveWorkspace}
          onChange={() => setSaveDashboardForUser((v) => !v)}
        />
        Save as my personal dashboard (instead of workspace default)
        {!canSaveWorkspace ? " — you don’t have permission to change the workspace default." : null}
      </label>

      <div className="text-sm text-muted-foreground">
        Workspace save permission:{" "}
        <span className={canSaveWorkspace ? "text-foreground font-medium" : "text-destructive font-medium"}>
          {canSaveWorkspace ? "allowed" : "denied"}
        </span>
        {" · "}
        tenant.settings.write:{" "}
        <span className={hasSettingsWrite ? "text-foreground font-medium" : "text-destructive font-medium"}>
          {hasSettingsWrite ? "granted" : "missing"}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="space-y-1">
          {addWidgetMsg ? <p className="text-sm text-destructive">{addWidgetMsg}</p> : null}
          {saveMsg ? (
            <p className={`text-sm ${saveMsgTone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
              {saveMsg}
            </p>
          ) : null}
        </div>
        <Button type="button" onClick={() => void handleSave()}>
          Save dashboard layout
        </Button>
      </div>
    </div>
  );
}
