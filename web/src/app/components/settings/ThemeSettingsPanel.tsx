import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { apiFetch } from "../../lib/api";
import {
  DEFAULT_TENANT_THEME,
  updateTenantThemeCache,
  type TenantThemeConfig,
} from "../../lib/tenantTheme";
import { useCanManageTenantSettings } from "../../lib/roles";

export function ThemeSettingsPanel() {
  const canManageSettings = useCanManageTenantSettings();
  const isAdmin = canManageSettings;
  const [tenantTheme, setTenantTheme] = useState<TenantThemeConfig>(DEFAULT_TENANT_THEME);
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const loadThemeSettings = useCallback(async () => {
    if (!canManageSettings) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ theme?: TenantThemeConfig }>("/settings");
      setTenantTheme(res.theme || DEFAULT_TENANT_THEME);
    } finally {
      setLoading(false);
    }
  }, [canManageSettings]);

  useEffect(() => {
    void loadThemeSettings();
  }, [loadThemeSettings]);

  const handleSaveTheme = async () => {
    setSaveMsg(null);
    try {
      const res = await apiFetch<{ theme: TenantThemeConfig }>("/settings", {
        method: "PATCH",
        body: JSON.stringify({ theme: tenantTheme }),
      });
      const next = res.theme || tenantTheme;
      setTenantTheme(next);
      updateTenantThemeCache(next);
      setSaveMsg("Theme saved.");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace Theme</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Customize the look and feel for this workspace only. Users who belong to
          multiple workspaces will see the theme change when they switch workspaces.
        </p>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading theme settings...</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {(
                [
                  ["primaryColor", "Primary color"],
                  ["accentColor", "Accent color"],
                  ["backgroundColor", "Page background"],
                  ["cardColor", "Card surface"],
                  ["sidebarColor", "Sidebar surface"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-2 rounded-xl border border-border p-4">
                  <Input
                    label={label}
                    type="color"
                    value={tenantTheme[key]}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      setTenantTheme({
                        ...tenantTheme,
                        [key]: e.target.value,
                      })
                    }
                  />
                  <Input
                    value={tenantTheme[key]}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      setTenantTheme({
                        ...tenantTheme,
                        [key]: e.target.value,
                      })
                    }
                  />
                </div>
              ))}
              <Select
                label="Corner radius"
                value={tenantTheme.radius}
                disabled={!isAdmin}
                onChange={(e) => setTenantTheme({ ...tenantTheme, radius: e.target.value })}
                options={[
                  { value: "0.5rem", label: "Compact" },
                  { value: "0.875rem", label: "Default" },
                  { value: "1.25rem", label: "Rounded" },
                ]}
              />
            </div>

            <div
              className="rounded-2xl border border-border p-5"
              style={{
                background: tenantTheme.backgroundColor,
                borderRadius: tenantTheme.radius,
              }}
            >
              <div
                className="max-w-md rounded-xl border p-4 shadow-sm"
                style={{
                  background: tenantTheme.cardColor,
                  borderRadius: tenantTheme.radius,
                }}
              >
                <div className="mb-3 flex items-center gap-3">
                  <div
                    className="h-10 w-10 rounded-xl"
                    style={{ background: tenantTheme.primaryColor }}
                  />
                  <div>
                    <p className="font-semibold text-slate-900">Theme preview</p>
                    <p className="text-sm text-slate-500">Applied to this workspace.</p>
                  </div>
                </div>
                <div
                  className="rounded-lg px-3 py-2 text-sm"
                  style={{ background: tenantTheme.accentColor }}
                >
                  Accent surface sample
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              {saveMsg ? <p className="text-sm text-muted-foreground">{saveMsg}</p> : <span />}
              <Button type="button" disabled={!isAdmin} onClick={() => void handleSaveTheme()}>
                Save Theme
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
