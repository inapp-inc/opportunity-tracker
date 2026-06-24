import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Modal } from "../ui/Modal";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/Table";
import { apiFetch } from "../../lib/api";
import { useAuthUser } from "../../contexts/AuthUserContext";
import { tenantRoleFromLegacyRole } from "../../lib/roles";
import { loadAssignableUsers } from "../../lib/serverState";
import { useTenantRoleOptions } from "../../hooks/useTenantRoleOptions";
import type { ApiTenant, ApiUser } from "../../pages/settings/types";

export function UserManagementPanel() {
  const { user: authUser } = useAuthUser();
  const {
    tenantRoleOptions,
    sanitizeRoleKey,
    roleOptionsForTenant,
    defaultRoleKeyForTenant,
  } = useTenantRoleOptions();

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<ApiTenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    tenantIds: [] as string[],
    tenantRoles: {} as Record<string, string>,
  });
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [editUserTenantIds, setEditUserTenantIds] = useState<string[]>([]);
  const [editUserTenantRoles, setEditUserTenantRoles] = useState<Record<string, string>>({});

  const tenantIdsForUser = useCallback((user: ApiUser) => {
    const ids = (user.memberships || [])
      .filter((membership) => membership.status === "ACTIVE")
      .map((membership) => membership.tenantId);
    return ids.length ? ids : user.tenantId ? [user.tenantId] : [];
  }, []);

  const loadTenants = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: ApiTenant[] }>("/tenants");
      setTenants(res.items || []);
      setSelectedTenantId((prev) => prev || authUser?.tenantId || res.items?.[0]?.id || "");
    } catch {
      setTenants([]);
    }
  }, [authUser?.tenantId]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const q = selectedTenantId
        ? `?tenantId=${encodeURIComponent(selectedTenantId)}`
        : "";
      const res = await apiFetch<{ items: ApiUser[] }>(`/users${q}`);
      setUsers(res.items || []);
    } catch (e) {
      setUsersError(e instanceof Error ? e.message : "Failed to load users");
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const toggleNewUserTenant = (tenantId: string) => {
    setNewUser((prev) => {
      const has = prev.tenantIds.includes(tenantId);
      const tenantRoles = { ...prev.tenantRoles };
      if (has) {
        delete tenantRoles[tenantId];
      } else if (!tenantRoles[tenantId]) {
        tenantRoles[tenantId] = defaultRoleKeyForTenant(tenantId);
      }
      return {
        ...prev,
        tenantIds: has
          ? prev.tenantIds.filter((id) => id !== tenantId)
          : [...prev.tenantIds, tenantId],
        tenantRoles,
      };
    });
  };

  const setNewUserTenantRole = (tenantId: string, role: string) => {
    setNewUser((prev) => ({
      ...prev,
      tenantRoles: { ...prev.tenantRoles, [tenantId]: role },
    }));
  };

  const toggleEditUserTenant = (tenantId: string) => {
    setEditUserTenantIds((prev) => {
      const has = prev.includes(tenantId);
      if (has) {
        setEditUserTenantRoles((roles) => {
          const next = { ...roles };
          delete next[tenantId];
          return next;
        });
        return prev.filter((id) => id !== tenantId);
      }
      setEditUserTenantRoles((roles) => ({
        ...roles,
        [tenantId]: roles[tenantId] || defaultRoleKeyForTenant(tenantId),
      }));
      return [...prev, tenantId];
    });
  };

  const setEditUserTenantRole = (tenantId: string, role: string) => {
    setEditUserTenantRoles((prev) => ({ ...prev, [tenantId]: role }));
  };

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.password) return;
    if (!newUser.tenantIds.length) {
      alert("Select at least one workspace for this user.");
      return;
    }
    try {
      await apiFetch("/users", {
        method: "POST",
        body: JSON.stringify({
          email: newUser.email,
          password: newUser.password,
          name: newUser.name,
          role: "VIEWER",
          memberships: newUser.tenantIds.map((tenantId) => ({
            tenantId,
            role: sanitizeRoleKey(newUser.tenantRoles[tenantId]),
          })),
        }),
      });
      setNewUser({ name: "", email: "", password: "", tenantIds: [], tenantRoles: {} });
      setIsUserModalOpen(false);
      await loadUsers();
      void loadAssignableUsers(true).catch(() => undefined);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create user");
    }
  };

  const patchUser = async (
    id: string,
    patch: Partial<{ role: string; status: string; platformRole: "PLATFORM_ADMIN" | "NONE" }>
  ) => {
    try {
      await apiFetch(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadUsers();
      void loadAssignableUsers(true).catch(() => undefined);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  };

  const openEditUser = (user: ApiUser) => {
    setEditingUser(user);
    setEditUserTenantIds(tenantIdsForUser(user));
    setEditUserTenantRoles(
      (user.memberships || []).reduce<Record<string, string>>((roles, membership) => {
        if (membership.status === "ACTIVE") {
          const normalized = tenantRoleFromLegacyRole(membership.role) || membership.role;
          roles[membership.tenantId] = sanitizeRoleKey(normalized);
        }
        return roles;
      }, {})
    );
  };

  const saveUserTenantAssignments = async () => {
    if (!editingUser) return;
    try {
      await apiFetch(`/users/${editingUser.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          role: "VIEWER",
          memberships: editUserTenantIds.map((tenantId) => ({
            tenantId,
            role: sanitizeRoleKey(editUserTenantRoles[tenantId]),
          })),
        }),
      });
      setEditingUser(null);
      await loadUsers();
      void loadAssignableUsers(true).catch(() => undefined);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  };

  const deleteUser = async (id: string) => {
    if (!confirm("Remove this user?")) return;
    try {
      await apiFetch(`/users/${id}`, { method: "DELETE" });
      await loadUsers();
      void loadAssignableUsers(true).catch(() => undefined);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Users & Roles</CardTitle>
            <Button type="button" onClick={() => setIsUserModalOpen(true)}>
              <Plus className="w-4 h-4" />
              Add User
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {usersLoading ? (
            <p className="text-sm text-muted-foreground">Loading users…</p>
          ) : usersError ? (
            <p className="text-sm text-destructive">{usersError}</p>
          ) : (
            <>
              <div className="max-w-xs">
                <Select
                  label="Workspace"
                  value={selectedTenantId}
                  onChange={(e) => setSelectedTenantId(e.target.value)}
                  options={tenants.map((tenant) => ({
                    value: tenant.id,
                    label: tenant.name,
                  }))}
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="w-[170px]">Platform Admin</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        {(user.memberships || []).length
                          ? user.memberships
                              .filter((membership) => membership.status === "ACTIVE")
                              .map((membership) => membership.tenantName)
                              .join(", ")
                          : user.tenantName}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const memberships = (user.memberships || []).filter(
                            (m) => m.status === "ACTIVE"
                          );
                          const chosen =
                            (selectedTenantId
                              ? memberships.find((m) => m.tenantId === selectedTenantId)
                              : memberships[0]) || null;
                          const key = chosen?.role || tenantRoleFromLegacyRole(user.role) || user.role;
                          const label =
                            tenantRoleOptions.find((o) => o.value === key)?.label ||
                            key ||
                            "—";
                          return <span className="text-sm">{label}</span>;
                        })()}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const memberships = (user.memberships || []).filter(
                            (m) => m.status === "ACTIVE"
                          );
                          const hasWorkspaceAdmin = memberships.some(
                            (m) =>
                              (!selectedTenantId || m.tenantId === selectedTenantId) &&
                              m.role === "TENANT_ADMIN"
                          );
                          const checked = user.platformRole === "PLATFORM_ADMIN";
                          return (
                            <label className="inline-flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!hasWorkspaceAdmin || user.id === authUser?.sub}
                                onChange={(e) =>
                                  void patchUser(user.id, {
                                    platformRole: e.target.checked ? "PLATFORM_ADMIN" : "NONE",
                                  })
                                }
                              />
                              {hasWorkspaceAdmin ? "Enabled" : "Workspace admin only"}
                            </label>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={user.status}
                          onChange={(e) =>
                            void patchUser(user.id, { status: e.target.value })
                          }
                          options={[
                            { value: "ACTIVE", label: "Active" },
                            { value: "INACTIVE", label: "Inactive" },
                          ]}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => openEditUser(user)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          disabled={user.id === authUser?.sub}
                          onClick={() => void deleteUser(user.id)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}

          <div className="mt-6 p-4 bg-muted/50 rounded-lg">
            <h4 className="mb-2">Role Permissions</h4>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">Workspace Admin:</span> Configure workspace forms,
                dashboards, lookups, notifications, and records
              </div>
              <div>
                <span className="font-medium">Manager:</span> Create, edit, archive records
                and artifacts
              </div>
              <div>
                <span className="font-medium">Viewer:</span> Read-only access to records
                and reports
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Modal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        title="Add New User"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsUserModalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleAddUser()}>
              Add User
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={newUser.name}
            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
            placeholder="John Doe"
          />
          <Input
            label="Email"
            type="email"
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            required
            placeholder="john@company.com"
          />
          <Input
            label="Password"
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            required
            placeholder="••••••••"
          />
          <div>
            <p className="mb-2 text-sm font-medium">Workspace access and roles</p>
            <div className="max-h-48 space-y-2 overflow-auto rounded-lg border border-border p-3">
              {tenants.map((tenant) => {
                const selected = newUser.tenantIds.includes(tenant.id);
                return (
                  <div key={tenant.id} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px] md:items-center">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleNewUserTenant(tenant.id)}
                      />
                      <span>{tenant.name}</span>
                    </label>
                    {selected ? (
                      <Select
                        value={newUser.tenantRoles[tenant.id] || defaultRoleKeyForTenant(tenant.id)}
                        onChange={(e) => setNewUserTenantRole(tenant.id, e.target.value)}
                        options={roleOptionsForTenant(tenant.id)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        title={editingUser ? `Edit ${editingUser.name || editingUser.email}` : "Edit User"}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveUserTenantAssignments()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">Workspace access and roles</p>
            <div className="max-h-64 space-y-2 overflow-auto rounded-lg border border-border p-3">
              {tenants.map((tenant) => {
                const selected = editUserTenantIds.includes(tenant.id);
                return (
                  <div key={tenant.id} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px] md:items-center">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleEditUserTenant(tenant.id)}
                      />
                      <span>{tenant.name}</span>
                    </label>
                    {selected ? (
                      <Select
                        value={editUserTenantRoles[tenant.id] || defaultRoleKeyForTenant(tenant.id)}
                        onChange={(e) => setEditUserTenantRole(tenant.id, e.target.value)}
                        options={roleOptionsForTenant(tenant.id)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
