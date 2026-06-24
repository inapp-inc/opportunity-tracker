import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/Table";
import { apiFetch } from "../../lib/api";
import { updatePageAccessCache, type PageAccessConfig, type PagePermission } from "../../lib/pageAccess";
import { useTenantRoleOptions } from "../../hooks/useTenantRoleOptions";
import { roleLabel } from "../../pages/settings/types";
import { PAGE_LABELS, PERMISSION_OPTIONS } from "./constants";

export function AccessControlPanel() {
  const { platformRoles: tenantRoles } = useTenantRoleOptions();
  const [pageAccess, setPageAccess] = useState<PageAccessConfig | null>(null);
  const [tenantRolePermissions, setTenantRolePermissions] = useState<Record<string, string[]> | null>(null);
  const [pageAccessSaving, setPageAccessSaving] = useState(false);
  const [tenantRolePermissionsSaving, setTenantRolePermissionsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{
        pageAccess?: PageAccessConfig;
        tenantRolePermissions?: { roles?: Record<string, string[]> };
      }>("/settings");
      setPageAccess(res.pageAccess || null);
      setTenantRolePermissions(res.tenantRolePermissions?.roles || null);
    } catch {
      setPageAccess(null);
      setTenantRolePermissions(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Page access control</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Control which pages each role can access in this workspace. Platform admins can configure this across workspaces by switching the active workspace.
        </p>

        {!pageAccess ? (
          <p className="text-sm text-muted-foreground">Loading access rules…</p>
        ) : (
          <div className="space-y-4">
            {((tenantRoles?.roles || [
              { key: "TENANT_ADMIN", label: "Workspace Admin" },
              { key: "MANAGER", label: "Manager" },
              { key: "VIEWER", label: "Viewer" },
            ]) as { key: string; label: string }[]).map((roleInfo) => {
              const role = roleInfo.key;
              const rolePerms = tenantRolePermissions?.[roleInfo.key] || [];
              return (
                <div key={role} className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{roleInfo.label || roleLabel(role)}</p>
                  </div>
                  <div className="mt-3">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Page</TableHead>
                          <TableHead className="w-[140px]">Read</TableHead>
                          <TableHead className="w-[140px]">Write</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(pageAccess.pages || []).map((page) => {
                          const roleCfg = (pageAccess.roles as Record<string, unknown>)?.[role];
                          const perm: PagePermission | null =
                            roleCfg && !Array.isArray(roleCfg)
                              ? (roleCfg as Record<string, PagePermission>)[page]
                              : null;
                          const readChecked = Boolean(perm?.read);
                          const writeChecked = Boolean(perm?.write);
                          return (
                            <TableRow key={page}>
                              <TableCell className="font-medium">{PAGE_LABELS[page]}</TableCell>
                              <TableCell>
                                <label className="inline-flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={readChecked}
                                    onChange={(e) => {
                                      const next = { ...(pageAccess.roles as Record<string, unknown>) };
                                      const nextRole = {
                                        ...(next[role] && !Array.isArray(next[role])
                                          ? (next[role] as Record<string, PagePermission>)
                                          : {}),
                                      };
                                      const current = (nextRole[page] as PagePermission) || {
                                        read: false,
                                        write: false,
                                      };
                                      const read = e.target.checked;
                                      const write = read ? current.write : false;
                                      nextRole[page] = { read, write };
                                      next[role] = nextRole;
                                      setPageAccess({ ...pageAccess, roles: next as PageAccessConfig["roles"] });
                                    }}
                                  />
                                  Allow
                                </label>
                              </TableCell>
                              <TableCell>
                                <label className="inline-flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={writeChecked}
                                    disabled={!readChecked}
                                    onChange={(e) => {
                                      const next = { ...(pageAccess.roles as Record<string, unknown>) };
                                      const nextRole = {
                                        ...(next[role] && !Array.isArray(next[role])
                                          ? (next[role] as Record<string, PagePermission>)
                                          : {}),
                                      };
                                      const current = (nextRole[page] as PagePermission) || {
                                        read: false,
                                        write: false,
                                      };
                                      nextRole[page] = { ...current, read: true, write: e.target.checked };
                                      next[role] = nextRole;
                                      setPageAccess({ ...pageAccess, roles: next as PageAccessConfig["roles"] });
                                    }}
                                  />
                                  Allow
                                </label>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-sm font-medium">Role permissions</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      These permissions control what actions the role can perform (API-level RBAC).
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {PERMISSION_OPTIONS.map((p) => {
                        const checked = rolePerms.includes(p.value);
                        return (
                          <label key={p.value} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setTenantRolePermissions((prev) => {
                                  const base = prev || {};
                                  const set = new Set(base[roleInfo.key] || []);
                                  if (e.target.checked) set.add(p.value);
                                  else set.delete(p.value);
                                  return { ...base, [roleInfo.key]: Array.from(set) };
                                });
                              }}
                            />
                            {p.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-end gap-2">
              {saveMsg ? <p className="text-sm text-muted-foreground">{saveMsg}</p> : null}
              <Button
                type="button"
                disabled={pageAccessSaving || tenantRolePermissionsSaving}
                onClick={async () => {
                  if (!pageAccess) return;
                  setPageAccessSaving(true);
                  setTenantRolePermissionsSaving(true);
                  setSaveMsg(null);
                  try {
                    const res = await apiFetch<{
                      pageAccess?: PageAccessConfig;
                      tenantRolePermissions?: { roles?: Record<string, string[]> };
                    }>("/settings", {
                      method: "PATCH",
                      body: JSON.stringify({
                        pageAccess,
                        tenantRolePermissions: { roles: tenantRolePermissions || {} },
                      }),
                    });
                    const next = res.pageAccess || pageAccess;
                    setPageAccess(next);
                    updatePageAccessCache(next);
                    if (res.tenantRolePermissions?.roles) {
                      setTenantRolePermissions(res.tenantRolePermissions.roles);
                    }
                    setSaveMsg("Access control saved.");
                  } catch (e) {
                    setSaveMsg(e instanceof Error ? e.message : "Save failed");
                  } finally {
                    setPageAccessSaving(false);
                    setTenantRolePermissionsSaving(false);
                  }
                }}
              >
                Save access control
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
