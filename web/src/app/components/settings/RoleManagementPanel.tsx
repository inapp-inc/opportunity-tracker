import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/Table";
import { apiFetch } from "../../lib/api";
import { useTenantRoleOptions } from "../../hooks/useTenantRoleOptions";
import type { TenantRolesConfig } from "../../pages/settings/types";

export function RoleManagementPanel() {
  const { platformRoles, setPlatformRoles } = useTenantRoleOptions();
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const tenantRoles = platformRoles;
  const setTenantRoles = setPlatformRoles;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Role Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Create or remove roles for this workspace. Permissions are configured in the Access Control tab.
        </p>

        {!tenantRoles ? (
          <p className="text-sm text-muted-foreground">Loading roles…</p>
        ) : (
          <div className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(tenantRoles.roles || []).map((r, idx) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-mono text-xs">{r.key}</TableCell>
                    <TableCell>
                      <Input
                        label=""
                        value={r.label}
                        onChange={(e) => {
                          const label = e.target.value;
                          setTenantRoles((prev) => {
                            if (!prev) return prev;
                            const next = { ...prev, roles: [...prev.roles] };
                            next.roles[idx] = { ...next.roles[idx], label };
                            return next;
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={["TENANT_ADMIN", "MANAGER", "VIEWER"].includes(r.key)}
                        onClick={() => {
                          setTenantRoles((prev) => {
                            if (!prev) return prev;
                            return { ...prev, roles: prev.roles.filter((x) => x.key !== r.key) };
                          });
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setTenantRoles((prev) => {
                    const base: TenantRolesConfig = prev || { roles: [] };
                    const n = base.roles.length + 1;
                    const key = `ROLE_${n}`;
                    return {
                      roles: [...base.roles, { key, label: `Role ${n}` }],
                    };
                  });
                }}
              >
                <Plus className="w-4 h-4" />
                Add role
              </Button>

              <div className="flex items-center gap-2">
                {saveMsg ? <p className="text-sm text-muted-foreground">{saveMsg}</p> : null}
                <Button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    if (!tenantRoles) return;
                    setSaving(true);
                    setSaveMsg(null);
                    try {
                      const res = await apiFetch<{ platformRoles?: TenantRolesConfig }>(
                        "/settings",
                        {
                          method: "PATCH",
                          body: JSON.stringify({ platformRoles: tenantRoles }),
                        }
                      );
                      setTenantRoles(res.platformRoles || tenantRoles);
                      setSaveMsg("Roles saved.");
                    } catch (e) {
                      setSaveMsg(e instanceof Error ? e.message : "Save failed");
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Save roles
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
