import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/Table";
import { Users, Settings as SettingsIcon, Bell, Plus, Trash2, Shield, Server } from "lucide-react";
import { useAuthUser } from "../contexts/AuthUserContext";
import { useIsAdmin } from "../lib/roles";
import { apiFetch } from "../lib/api";

type LookupEntry = { id: string; value: string; sortOrder?: number };

type ApiUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};

function roleLabel(role: string) {
  if (role === "ADMIN") return "Admin";
  if (role === "EDITOR") return "Editor";
  return "Viewer";
}

export function Settings() {
  const { user: authUser } = useAuthUser();
  const isAdmin = useIsAdmin();

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [lookups, setLookups] = useState<{
    deliverables: LookupEntry[];
    prospectTypes: LookupEntry[];
    engagementTypes: LookupEntry[];
  }>({ deliverables: [], prospectTypes: [], engagementTypes: [] });
  const [lookupsLoading, setLookupsLoading] = useState(true);

  const [notificationSettings, setNotificationSettings] = useState({
    dueSoonThreshold: "3",
  });
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "VIEWER" as "ADMIN" | "EDITOR" | "VIEWER",
  });

  const [addOpen, setAddOpen] = useState<
    null | "DELIVERABLES" | "PROSPECT_TYPE" | "ENGAGEMENT_TYPE"
  >(null);
  const [addValue, setAddValue] = useState("");

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await apiFetch<{ items: ApiUser[] }>("/users");
      setUsers(res.items || []);
    } catch (e) {
      setUsersError(e instanceof Error ? e.message : "Failed to load users");
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, [isAdmin]);

  const loadLookups = useCallback(async () => {
    setLookupsLoading(true);
    try {
      const res = await apiFetch<{
        deliverables: LookupEntry[];
        prospectTypes: LookupEntry[];
        engagementTypes: LookupEntry[];
      }>("/settings/lookups");
      setLookups({
        deliverables: res.deliverables || [],
        prospectTypes: res.prospectTypes || [],
        engagementTypes: res.engagementTypes || [],
      });
    } finally {
      setLookupsLoading(false);
    }
  }, []);

  const loadNotificationSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await apiFetch<{
        notifications: typeof notificationSettings;
      }>("/settings");
      if (res.notifications) {
        setNotificationSettings({
          dueSoonThreshold: res.notifications.dueSoonThreshold ?? "3",
        });
      }
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLookups();
    void loadNotificationSettings();
  }, [loadLookups, loadNotificationSettings]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleSaveNotifications = async () => {
    setSaveMsg(null);
    try {
      await apiFetch("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          notifications: notificationSettings,
        }),
      });
      setSaveMsg("Settings saved.");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.password) return;
    try {
      await apiFetch("/users", {
        method: "POST",
        body: JSON.stringify({
          email: newUser.email,
          password: newUser.password,
          name: newUser.name,
          role: newUser.role,
        }),
      });
      setNewUser({ name: "", email: "", password: "", role: "VIEWER" });
      setIsUserModalOpen(false);
      await loadUsers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create user");
    }
  };

  const patchUser = async (id: string, patch: Partial<{ role: string; status: string }>) => {
    try {
      await apiFetch(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadUsers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  };

  const deleteUser = async (id: string) => {
    if (!confirm("Remove this user?")) return;
    try {
      await apiFetch(`/users/${id}`, { method: "DELETE" });
      await loadUsers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const deleteLookup = async (id: string) => {
    if (!confirm("Remove this lookup value?")) return;
    try {
      await apiFetch(`/settings/lookups/${id}`, { method: "DELETE" });
      await loadLookups();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const addLookup = async (category: typeof addOpen) => {
    if (!category || !addValue.trim()) return;
    try {
      await apiFetch("/settings/lookups", {
        method: "POST",
        body: JSON.stringify({ category, value: addValue.trim() }),
      });
      setAddValue("");
      setAddOpen(null);
      await loadLookups();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Add failed");
    }
  };

  const LookupSection = ({
    title,
    category,
    items,
  }: {
    title: string;
    category: "DELIVERABLES" | "PROSPECT_TYPE" | "ENGAGEMENT_TYPE";
    items: LookupEntry[];
  }) => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                setAddOpen(category);
                setAddValue("");
              }}
            >
              <Plus className="w-4 h-4" />
              Add Value
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg"
            >
              <span>{item.value}</span>
              {isAdmin && (
                <button
                  type="button"
                  className="hover:text-destructive"
                  aria-label={`Remove ${item.value}`}
                  onClick={() => void deleteLookup(item.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          {!items.length && (
            <p className="text-sm text-muted-foreground">No values yet.</p>
          )}
        </div>
        {isAdmin && addOpen === category && (
          <div className="flex gap-2 items-end flex-wrap">
            <Input
              label="New value"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              placeholder="Type and press Add"
            />
            <Button type="button" onClick={() => void addLookup(category)}>
              Add
            </Button>
            <Button type="button" variant="outline" onClick={() => setAddOpen(null)}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1>Settings</h1>
        <p className="text-muted-foreground">
          Manage users, notifications, and system configuration
        </p>
      </div>

      <Tabs defaultValue="platform">
        <TabsList>
          <TabsTrigger value="platform">
            <Server className="w-4 h-4 mr-2" />
            Platform
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users className="w-4 h-4 mr-2" />
            User Management
          </TabsTrigger>
          <TabsTrigger value="lookups">
            <SettingsIcon className="w-4 h-4 mr-2" />
            Lookup Values
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="w-4 h-4 mr-2" />
            Notifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="platform">
          <Card>
            <CardHeader>
              <CardTitle>Architecture</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>
                This presales tracker uses a SQLite database for opportunities, artifact links,
                notifications, users, lookup values, and app configuration. Artifact records store
                URLs only (no file upload).
              </p>
              <p>
                Users authenticate with email and password (scrypt-hashed). The first database seed
                creates an administrator from{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">STATIC_AUTH_EMAIL</code> /{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">STATIC_AUTH_PASSWORD</code>
                . Additional accounts are managed in the User Management tab (admins only).
              </p>
              <p className="text-muted-foreground">
                Signed in as{" "}
                <span className="text-foreground font-medium">{authUser?.email}</span> (
                {roleLabel(authUser?.role || "")}).
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Users & Roles</CardTitle>
                {isAdmin && (
                  <Button type="button" onClick={() => setIsUserModalOpen(true)}>
                    <Plus className="w-4 h-4" />
                    Add User
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!isAdmin ? (
                <div className="flex items-center gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                  <Shield className="w-5 h-5 text-yellow-600" />
                  <p className="text-sm text-yellow-900 dark:text-yellow-200">
                    You don&apos;t have permission to manage users. Contact your administrator.
                  </p>
                </div>
              ) : usersLoading ? (
                <p className="text-sm text-muted-foreground">Loading users…</p>
              ) : usersError ? (
                <p className="text-sm text-destructive">{usersError}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
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
                          <Select
                            value={user.role}
                            onChange={(e) =>
                              void patchUser(user.id, { role: e.target.value })
                            }
                            options={[
                              { value: "VIEWER", label: "Viewer" },
                              { value: "EDITOR", label: "Editor" },
                              { value: "ADMIN", label: "Admin" },
                            ]}
                          />
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
              )}

              <div className="mt-6 p-4 bg-muted/50 rounded-lg">
                <h4 className="mb-2">Role Permissions</h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium">Admin:</span> Full access including user
                    management, settings, exports, and deleting opportunities
                  </div>
                  <div>
                    <span className="font-medium">Editor:</span> Create, edit, archive opportunities
                    and artifacts
                  </div>
                  <div>
                    <span className="font-medium">Viewer:</span> Read-only access to opportunities
                    and reports
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lookups">
          <div className="space-y-6">
            {lookupsLoading ? (
              <p className="text-sm text-muted-foreground">Loading lookups…</p>
            ) : (
              <>
                <LookupSection title="Deliverables" category="DELIVERABLES" items={lookups.deliverables} />
                <LookupSection title="Prospect Types" category="PROSPECT_TYPE" items={lookups.prospectTypes} />
                <LookupSection
                  title="Engagement Types"
                  category="ENGAGEMENT_TYPE"
                  items={lookups.engagementTypes}
                />
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {settingsLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div>
                    <h4 className="mb-4">Due Date Reminders</h4>
                    <p className="text-sm text-muted-foreground mb-4">
                      In-app reminders fire on overdue (any past due date) and on each day-offset you
                      configure below (merged with 7, 1, and 0-day reminders).
                    </p>
                    <Select
                      label="Include reminder when due in (days)"
                      value={notificationSettings.dueSoonThreshold}
                      onChange={(e) =>
                        setNotificationSettings({
                          dueSoonThreshold: e.target.value,
                        })
                      }
                      options={[
                        { value: "1", label: "1 day" },
                        { value: "2", label: "2 days" },
                        { value: "3", label: "3 days" },
                        { value: "5", label: "5 days" },
                        { value: "7", label: "7 days" },
                      ]}
                    />
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Email notifications are disabled in this build; only in-app reminders run on the
                    server.
                  </p>

                  <div className="flex justify-between items-center flex-wrap gap-2">
                    {saveMsg && (
                      <p className="text-sm text-muted-foreground">{saveMsg}</p>
                    )}
                    <Button
                      type="button"
                      disabled={!isAdmin}
                      onClick={() => void handleSaveNotifications()}
                    >
                      Save Settings
                    </Button>
                  </div>
                  {!isAdmin && (
                    <p className="text-sm text-muted-foreground">
                      Only administrators can change notification settings.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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

          <Select
            label="Role"
            value={newUser.role}
            onChange={(e) =>
              setNewUser({
                ...newUser,
                role: e.target.value as "ADMIN" | "EDITOR" | "VIEWER",
              })
            }
            options={[
              { value: "VIEWER", label: "Viewer" },
              { value: "EDITOR", label: "Editor" },
              { value: "ADMIN", label: "Admin" },
            ]}
          />
        </div>
      </Modal>
    </div>
  );
}
