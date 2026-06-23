import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/Table";
import { Users, Settings as SettingsIcon, Plus, Trash2, Shield, Server, Palette, Pencil, Check, X } from "lucide-react";
import { WorkspaceTerminologyPanel } from "../components/page-layout/panels/WorkspaceTerminologyPanel";
import { CaseStudySettingsPanel } from "../components/settings/CaseStudySettingsPanel";
import { useAuthUser } from "../contexts/AuthUserContext";
import { tenantRoleFromLegacyRole, useCanManageTenantSettings, useIsPlatformAdmin } from "../lib/roles";
import { apiFetch } from "../lib/api";
import type { TenantFieldDefinition } from "../lib/opportunity";
import { useTerminology } from "../lib/terminology";
import { FIELD_TYPE_OPTIONS } from "../lib/fields";
import {
  loadAssignableUsers,
  notifyTenantLookupsUpdated,
  useTenantSchema,
} from "../lib/serverState";
import {
  roleLabel,
  type ApiTenant,
  type ApiUser,
  type LookupCategory,
  type LookupEntry,
  type TenantRolesConfig,
} from "./settings/types";
import { PageHeader } from "../components/shared";
import {
  DEFAULT_TENANT_THEME,
  updateTenantThemeCache,
  type TenantThemeConfig,
} from "../lib/tenantTheme";
import { updatePageAccessCache, type PageAccessConfig, type PageKey, type PagePermission } from "../lib/pageAccess";

const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: "Dashboard",
  records: "Records",
  opportunities: "Opportunities",
  artifacts: "Artifact Links",
  caseStudies: "Case Studies",
  notifications: "Notifications",
  reports: "Reports",
  settings: "Settings",
};

type SchemaEditState = {
  label: string;
  fieldType: TenantFieldDefinition["fieldType"];
  options: string;
  lookupCategory: string;
  required: boolean;
  showInTable: boolean;
  status: string;
  sortOrder: string;
};

export function Settings() {
  const { user: authUser } = useAuthUser();
  const isPlatformAdmin = useIsPlatformAdmin();
  const canManageSettings = useCanManageTenantSettings();
  const isAdmin = canManageSettings;
  const PERMISSION_OPTIONS = [
    { value: "tenant.settings.read", label: "Settings: read" },
    { value: "tenant.settings.write", label: "Settings: write" },
    { value: "records.read", label: "Records: read" },
    { value: "records.create", label: "Records: create" },
    { value: "records.update", label: "Records: update" },
    { value: "records.archive", label: "Records: archive" },
    { value: "records.delete", label: "Records: delete" },
    { value: "records.artifacts.write", label: "Artifacts: write" },
    { value: "records.comments.write", label: "Comments: write" },
    { value: "reports.read", label: "Reports: read" },
    { value: "notifications.read", label: "Notifications: read" },
  ] as const;

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<ApiTenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [newTenant, setNewTenant] = useState({ name: "", slug: "" });

  const [lookups, setLookups] = useState<{
    categories: LookupCategory[];
    deliverables: LookupEntry[];
    prospectTypes: LookupEntry[];
    engagementTypes: LookupEntry[];
    dealStages: LookupEntry[];
  }>({ categories: [], deliverables: [], prospectTypes: [], engagementTypes: [], dealStages: [] });
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const {
    fields: schemaFields,
    loading: schemaLoading,
    reload: loadSchema,
  } = useTenantSchema();
  const [newField, setNewField] = useState({
    label: "",
    key: "",
    fieldType: "text" as TenantFieldDefinition["fieldType"],
    options: "",
    lookupCategory: "",
    required: false,
    showInTable: false,
  });

  const terminology = useTerminology();
  const [tenantTheme, setTenantTheme] =
    useState<TenantThemeConfig>(DEFAULT_TENANT_THEME);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pageAccess, setPageAccess] = useState<PageAccessConfig | null>(null);
  const [pageAccessSaving, setPageAccessSaving] = useState(false);
  const [platformRoles, setPlatformRoles] = useState<TenantRolesConfig | null>(null);
  const [platformRolesSaving, setPlatformRolesSaving] = useState(false);
  // Back-compat variable names within this file (UI was previously tenant-scoped).
  const tenantRoles = platformRoles;
  const setTenantRoles = setPlatformRoles;
  const tenantRolesSaving = platformRolesSaving;
  const [tenantRolePermissions, setTenantRolePermissions] = useState<Record<string, string[]> | null>(null);
  const [tenantRolePermissionsSaving, setTenantRolePermissionsSaving] = useState(false);

  const tenantRoleOptions = useMemo(() => {
    const fallback = [
      { value: "TENANT_ADMIN", label: "Workspace Admin" },
      { value: "MANAGER", label: "Manager" },
      { value: "VIEWER", label: "Viewer" },
    ];
    const raw = tenantRoles?.roles?.length
      ? tenantRoles.roles.map((r) => ({ value: r.key, label: r.label || r.key }))
      : fallback;
    const uniq = new Map<string, { value: string; label: string }>();
    for (const opt of raw) {
      if (!opt?.value) continue;
      if (!uniq.has(opt.value)) uniq.set(opt.value, opt);
    }
    return Array.from(uniq.values());
  }, [tenantRoles?.roles]);

  const defaultTenantRoleKey = useMemo(() => {
    const keys = tenantRoleOptions.map((o) => o.value);
    return keys.includes("VIEWER") ? "VIEWER" : keys[0] || "VIEWER";
  }, [tenantRoleOptions]);

  const roleOptionsForTenant = useCallback(() => tenantRoleOptions, [tenantRoleOptions]);
  const defaultRoleKeyForTenant = useCallback(
    () => defaultTenantRoleKey,
    [defaultTenantRoleKey]
  );

  const allowedRoleKeys = useMemo(() => new Set(tenantRoleOptions.map((o) => o.value)), [tenantRoleOptions]);
  const sanitizeRoleKey = useCallback(
    (role: string | undefined) => {
      const value = String(role || "").trim();
      if (value && allowedRoleKeys.has(value)) return value;
      return defaultTenantRoleKey;
    },
    [allowedRoleKeys, defaultTenantRoleKey]
  );

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
  const [editingSchemaField, setEditingSchemaField] = useState<TenantFieldDefinition | null>(null);
  const [schemaEdit, setSchemaEdit] = useState<SchemaEditState>({
    label: "",
    fieldType: "text",
    options: "",
    lookupCategory: "",
    required: false,
    showInTable: false,
    status: "ACTIVE",
    sortOrder: "0",
  });

  const [addOpen, setAddOpen] = useState<string | null>(null);
  const [addValue, setAddValue] = useState("");
  const [newLookupCategory, setNewLookupCategory] = useState("");
  const [editingLookupId, setEditingLookupId] = useState<string | null>(null);
  const [editingLookupValue, setEditingLookupValue] = useState("");
  const activeTenantId = authUser?.activeTenantId || authUser?.tenantId || "";

  const tenantIdsForUser = useCallback((user: ApiUser) => {
    const ids = (user.memberships || [])
      .filter((membership) => membership.status === "ACTIVE")
      .map((membership) => membership.tenantId);
    return ids.length ? ids : user.tenantId ? [user.tenantId] : [];
  }, []);

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

  const loadUsers = useCallback(async () => {
    if (!isPlatformAdmin) return;
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
  }, [isPlatformAdmin, selectedTenantId]);

  const loadTenants = useCallback(async () => {
    if (!isPlatformAdmin) return;
    setTenantsLoading(true);
    try {
      const res = await apiFetch<{ items: ApiTenant[] }>("/tenants");
      setTenants(res.items || []);
      setSelectedTenantId((prev) => prev || authUser?.tenantId || res.items?.[0]?.id || "");
    } catch {
      setTenants([]);
    } finally {
      setTenantsLoading(false);
    }
  }, [authUser?.tenantId, isPlatformAdmin]);

  const loadLookups = useCallback(async () => {
    if (!canManageSettings) {
      setLookupsLoading(false);
      return;
    }
    setLookupsLoading(true);
    try {
      const res = await apiFetch<{
        categories?: LookupCategory[];
        deliverables: LookupEntry[];
        prospectTypes: LookupEntry[];
        engagementTypes: LookupEntry[];
        dealStages?: LookupEntry[];
      }>("/settings/lookups");
      setLookups({
        categories: res.categories || [],
        deliverables: res.deliverables || [],
        prospectTypes: res.prospectTypes || [],
        engagementTypes: res.engagementTypes || [],
        dealStages: res.dealStages || [],
      });
    } finally {
      setLookupsLoading(false);
    }
  }, [activeTenantId, canManageSettings]);

  const loadThemeSettings = useCallback(async () => {
    if (!canManageSettings) {
      setSettingsLoading(false);
      return;
    }
    setSettingsLoading(true);
    try {
      const res = await apiFetch<{ theme?: TenantThemeConfig }>("/settings");
      setTenantTheme(res.theme || DEFAULT_TENANT_THEME);
    } finally {
      setSettingsLoading(false);
    }
  }, [activeTenantId, canManageSettings]);

  const loadPageAccess = useCallback(async () => {
    if (!canManageSettings) return;
    try {
      const res = await apiFetch<{ pageAccess?: PageAccessConfig }>("/settings");
      setPageAccess(res.pageAccess || null);
    } catch {
      setPageAccess(null);
    }
  }, [activeTenantId, canManageSettings]);

  const loadTenantRoles = useCallback(async () => {
    if (!canManageSettings) return;
    try {
      const res = await apiFetch<{ platformRoles?: TenantRolesConfig }>("/settings");
      setTenantRoles(res.platformRoles || null);
    } catch {
      setTenantRoles(null);
    }
  }, [activeTenantId, canManageSettings]);

  const loadTenantRolePermissions = useCallback(async () => {
    if (!canManageSettings) return;
    try {
      const res = await apiFetch<{ tenantRolePermissions?: { roles?: Record<string, string[]> } }>("/settings");
      setTenantRolePermissions(res.tenantRolePermissions?.roles || null);
    } catch {
      setTenantRolePermissions(null);
    }
  }, [activeTenantId, canManageSettings]);

  useEffect(() => {
    void loadLookups();
    void loadThemeSettings();
    void loadPageAccess();
    void loadTenantRoles();
    void loadTenantRolePermissions();
  }, [loadLookups, loadThemeSettings, loadPageAccess, loadTenantRoles, loadTenantRolePermissions]);

  // Roles are platform-wide, so no per-tenant role fetching is needed.

  useEffect(() => {
    void loadTenants();
    void loadUsers();
  }, [loadTenants, loadUsers]);

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

  const deleteLookup = async (id: string) => {
    if (!confirm("Remove this lookup value?")) return;
    try {
      await apiFetch(`/settings/lookups/${id}`, { method: "DELETE" });
      await loadLookups();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const startEditLookup = (item: LookupEntry) => {
    setEditingLookupId(item.id);
    setEditingLookupValue(item.value);
  };

  const cancelEditLookup = () => {
    setEditingLookupId(null);
    setEditingLookupValue("");
  };

  const saveLookup = async (id: string) => {
    const value = editingLookupValue.trim();
    if (!value) return;
    try {
      await apiFetch(`/settings/lookups/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ value }),
      });
      cancelEditLookup();
      await loadLookups();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  };

  const addTenant = async () => {
    if (!newTenant.name.trim()) return;
    try {
      const created = await apiFetch<ApiTenant>("/tenants", {
        method: "POST",
        body: JSON.stringify({
          name: newTenant.name.trim(),
          slug: newTenant.slug.trim() || undefined,
        }),
      });
      setNewTenant({ name: "", slug: "" });
      await loadTenants();
      setSelectedTenantId(created.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create workspace");
    }
  };

  const addLookup = async (category: string | null) => {
    if (!category || !addValue.trim()) return;
    try {
      await apiFetch("/settings/lookups", {
        method: "POST",
        body: JSON.stringify({ category, value: addValue.trim() }),
      });
      setAddValue("");
      setAddOpen(null);
      await loadLookups();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Add failed");
    }
  };

  const addLookupCategory = async () => {
    if (!newLookupCategory.trim()) return;
    try {
      await apiFetch("/settings/lookups/categories", {
        method: "POST",
        body: JSON.stringify({ name: newLookupCategory.trim() }),
      });
      setNewLookupCategory("");
      await loadLookups();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create lookup category");
    }
  };

  const PROTECTED_LOOKUP_CATEGORIES = new Set([
    "DEAL_STAGE",
    "DELIVERABLES",
    "ENGAGEMENT_TYPE",
    "PROSPECT_TYPE",
    "WIN_LOSS",
    "ARTIFACT_TYPE",
    "CURRENCY",
  ]);

  const deleteLookupCategory = async (category: string, label: string) => {
    if (PROTECTED_LOOKUP_CATEGORIES.has(category)) {
      alert("This lookup category is required by the workspace and cannot be removed.");
      return;
    }
    if (
      !confirm(
        `Remove the "${label}" lookup category and all of its values? Existing record data that used these values is not changed.`
      )
    ) {
      return;
    }
    try {
      await apiFetch(`/settings/lookups/categories/${encodeURIComponent(category)}`, {
        method: "DELETE",
      });
      await loadLookups();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove lookup category");
    }
  };

  const addSchemaField = async () => {
    if (!newField.label.trim()) return;
    try {
      await apiFetch("/settings/schema", {
        method: "POST",
        body: JSON.stringify(newField),
      });
      setNewField({
        label: "",
        key: "",
        fieldType: "text",
        options: "",
        lookupCategory: "",
        required: false,
        showInTable: false,
      });
      await loadSchema();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create field");
    }
  };

  const patchSchemaField = async (
    id: string,
    patch: Partial<TenantFieldDefinition>
  ) => {
    try {
      await apiFetch(`/settings/schema/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadSchema();
      await notifyTenantLookupsUpdated();
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update field");
      return false;
    }
  };

  const deleteSchemaField = async (id: string, label: string, source: string) => {
    const message =
      source === "system"
        ? `Hide "${label}" from forms, tables, and layouts? Existing ${terminology.recordSingular.toLowerCase()} data is kept; you can restore the field later by setting its status to Active.`
        : `Remove "${label}" from future forms and views? Existing values stay in stored ${terminology.recordSingular.toLowerCase()} data. You can restore it from this schema list.`;
    if (!confirm(message)) return;
    try {
      await apiFetch(`/settings/schema/${id}`, { method: "DELETE" });
      await loadSchema();
      await notifyTenantLookupsUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove field");
    }
  };

  const startEditSchemaField = (field: TenantFieldDefinition) => {
    setEditingSchemaField(field);
    setSchemaEdit({
      label: field.label,
      fieldType: field.fieldType,
      options: (field.options || []).join(", "),
      lookupCategory: field.lookupCategory || "",
      required: field.required,
      showInTable: field.showInTable,
      status: field.status || "ACTIVE",
      sortOrder: String(field.sortOrder ?? 0),
    });
  };

  const saveSchemaField = async () => {
    if (!editingSchemaField) return;
    const isChoiceField = ["select", "multi_select", "lookup_select", "lookup_multi_select"].includes(schemaEdit.fieldType);
    const saved = await patchSchemaField(editingSchemaField.id, {
      label: schemaEdit.label.trim(),
      fieldType: schemaEdit.fieldType,
      options: isChoiceField
        ? schemaEdit.options
            .split(",")
            .map((option) => option.trim())
            .filter(Boolean)
        : [],
      lookupCategory: isChoiceField ? schemaEdit.lookupCategory : "",
      required: schemaEdit.required,
      showInTable: schemaEdit.showInTable,
      status: schemaEdit.status,
      sortOrder: Number(schemaEdit.sortOrder || 0),
    });
    if (saved) setEditingSchemaField(null);
  };

  const renderLookupSection = (title: string, category: string, items: LookupEntry[]) => (
    <Card key={category}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          {isAdmin && (
            <div className="flex items-center gap-2">
              {!PROTECTED_LOOKUP_CATEGORIES.has(category) ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void deleteLookupCategory(category, title)}
                >
                  <Trash2 className="w-4 h-4" />
                  Remove category
                </Button>
              ) : null}
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
            </div>
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
              {editingLookupId === item.id ? (
                <>
                  <input
                    value={editingLookupValue}
                    onChange={(e) => setEditingLookupValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveLookup(item.id);
                      if (e.key === "Escape") cancelEditLookup();
                    }}
                    className="h-7 w-40 rounded-md border border-border bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="hover:text-primary"
                    aria-label={`Save ${item.value}`}
                    onClick={() => void saveLookup(item.id)}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    className="hover:text-muted-foreground"
                    aria-label="Cancel edit"
                    onClick={cancelEditLookup}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <>
                  <span>{item.value}</span>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        className="hover:text-primary"
                        aria-label={`Edit ${item.value}`}
                        onClick={() => startEditLookup(item)}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        className="hover:text-destructive"
                        aria-label={`Remove ${item.value}`}
                        onClick={() => void deleteLookup(item.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </>
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
    <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
      <PageHeader
        title="Settings"
        description="Platform administration, workspace schema, lookups, and theme. Page-specific layout options live on each screen."
      />

      <Tabs defaultValue={isPlatformAdmin ? "platform" : "lookups"}>
        <TabsList>
          {isPlatformAdmin && (
            <>
              <TabsTrigger value="platform">
                <Server className="w-4 h-4 mr-2" />
                Platform
              </TabsTrigger>
              <TabsTrigger value="users">
                <Users className="w-4 h-4 mr-2" />
                User Management
              </TabsTrigger>
              <TabsTrigger value="roles">
                <Shield className="w-4 h-4 mr-2" />
                Role Management
              </TabsTrigger>
            </>
          )}
          {canManageSettings && (
            <>
              <TabsTrigger value="lookups">
                <SettingsIcon className="w-4 h-4 mr-2" />
                Lookup Values
              </TabsTrigger>
              <TabsTrigger value="schema">
                <SettingsIcon className="w-4 h-4 mr-2" />
                Schema Builder
              </TabsTrigger>
              <TabsTrigger value="access">
                <Shield className="w-4 h-4 mr-2" />
                Access Control
              </TabsTrigger>
              <TabsTrigger value="workspace">
                <SettingsIcon className="w-4 h-4 mr-2" />
                Workspace
              </TabsTrigger>
              <TabsTrigger value="theme">
                <Palette className="w-4 h-4 mr-2" />
                Theme
              </TabsTrigger>
              <TabsTrigger value="case-study">
                <SettingsIcon className="w-4 h-4 mr-2" />
                Case Study
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {canManageSettings && (
          <TabsContent value="access">
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
                    ]) as { key: string; label: string }[]).map((roleInfo) => (
                      (() => {
                        const role = roleInfo.key as any;
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
                                const roleCfg = (pageAccess.roles as any)?.[role];
                                const perm: PagePermission | null =
                                  roleCfg && !Array.isArray(roleCfg) ? (roleCfg[page] as PagePermission) : null;
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
                                            const next = { ...(pageAccess.roles as any) };
                                            const nextRole = {
                                              ...(next[role] && !Array.isArray(next[role]) ? next[role] : {}),
                                            };
                                            const current = (nextRole[page] as PagePermission) || {
                                              read: false,
                                              write: false,
                                            };
                                            const read = e.target.checked;
                                            const write = read ? current.write : false;
                                            nextRole[page] = { read, write };
                                            next[role] = nextRole;
                                            setPageAccess({ ...pageAccess, roles: next });
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
                                            const next = { ...(pageAccess.roles as any) };
                                            const nextRole = {
                                              ...(next[role] && !Array.isArray(next[role]) ? next[role] : {}),
                                            };
                                            const current = (nextRole[page] as PagePermission) || {
                                              read: false,
                                              write: false,
                                            };
                                            nextRole[page] = { ...current, read: true, write: e.target.checked };
                                            next[role] = nextRole;
                                            setPageAccess({ ...pageAccess, roles: next });
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
                      })()
                    ))}

                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        disabled={pageAccessSaving || tenantRolePermissionsSaving}
                        onClick={async () => {
                          if (!pageAccess) return;
                          setPageAccessSaving(true);
                          setTenantRolePermissionsSaving(true);
                          setSaveMsg(null);
                          try {
                            const res = await apiFetch<{ pageAccess?: PageAccessConfig; tenantRolePermissions?: { roles?: Record<string, string[]> } }>(
                              "/settings",
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  pageAccess,
                                  tenantRolePermissions: { roles: tenantRolePermissions || {} },
                                }),
                              }
                            );
                            const next = res.pageAccess || pageAccess;
                            setPageAccess(next);
                            updatePageAccessCache(next);
                            if (res.tenantRolePermissions?.roles) setTenantRolePermissions(res.tenantRolePermissions.roles);
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
          </TabsContent>
        )}

        {isPlatformAdmin && (
        <TabsContent value="platform">
          <Card>
            <CardHeader>
              <CardTitle>Architecture</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>
                This workspace uses a PostgreSQL database for records, artifact links,
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
                {roleLabel(authUser?.role || "")}) for{" "}
                <span className="text-foreground font-medium">
                  {authUser?.tenantName || "Default Team"}
                </span>
                .
              </p>
            </CardContent>
          </Card>

          {isPlatformAdmin ? (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Workspaces</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Workspaces represent teams using the platform. Data is stored in the same PostgreSQL
                  database and isolated by workspace.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="Workspace name"
                    value={newTenant.name}
                    onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
                    placeholder="Solutions Engineering"
                  />
                  <Input
                    label="Slug (optional)"
                    value={newTenant.slug}
                    onChange={(e) => setNewTenant({ ...newTenant, slug: e.target.value })}
                    placeholder="solutions-engineering"
                  />
                </div>
                <Button type="button" onClick={() => void addTenant()}>
                  <Plus className="w-4 h-4" />
                  Add Workspace
                </Button>

                {tenantsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading tenants…</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {tenants.map((tenant) => (
                      <div key={tenant.id} className="border border-border rounded-lg p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-medium">{tenant.name}</p>
                            <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                          </div>
                          <Badge variant={tenant.status === "ACTIVE" ? "success" : "default"}>
                            {tenant.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
        )}

        {isPlatformAdmin && (
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Users & Roles</CardTitle>
                {isPlatformAdmin && (
                  <Button type="button" onClick={() => setIsUserModalOpen(true)}>
                    <Plus className="w-4 h-4" />
                    Add User
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isPlatformAdmin ? (
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
        </TabsContent>
        )}

        {isPlatformAdmin && (
        <TabsContent value="roles">
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
                            roles: [
                              ...base.roles,
                              { key, label: `Role ${n}` },
                            ],
                          };
                        });
                      }}
                    >
                      <Plus className="w-4 h-4" />
                      Add role
                    </Button>

                    <Button
                      type="button"
                      disabled={tenantRolesSaving}
                      onClick={async () => {
                        if (!tenantRoles) return;
                        setTenantRolesSaving(true);
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
                          setTenantRolesSaving(false);
                        }
                      }}
                    >
                      Save roles
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        <TabsContent value="lookups">
          <div className="space-y-6">
            {lookupsLoading ? (
              <p className="text-sm text-muted-foreground">Loading lookups…</p>
            ) : (
              <>
                {isAdmin ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Add Lookup Field</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex gap-2 items-end flex-wrap">
                        <Input
                          label="Lookup field name"
                          value={newLookupCategory}
                          onChange={(e) => setNewLookupCategory(e.target.value)}
                          placeholder="Priority, Region, Department..."
                        />
                        <Button type="button" onClick={() => void addLookupCategory()}>
                          Add Lookup Field
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
                {lookups.categories.map((category) =>
                  renderLookupSection(category.label, category.category, category.items)
                )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="schema">
          <Card>
            <CardHeader>
              <CardTitle>{terminology.recordSingular} Schema</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Review built-in fields and add any number of custom fields that appear on this
                workspace&apos;s {terminology.recordSingular.toLowerCase()} forms, detail views,
                and optionally the {terminology.recordSingular.toLowerCase()} table.
              </p>

              {isAdmin ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <Input
                    label="Field label"
                    value={newField.label}
                    onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                    placeholder="Customer segment"
                  />
                  <Input
                    label="Field key (optional)"
                    value={newField.key}
                    onChange={(e) => setNewField({ ...newField, key: e.target.value })}
                    placeholder="customer_segment"
                  />
                  <Select
                    label="Field type"
                    value={newField.fieldType}
                    onChange={(e) =>
                      setNewField({
                        ...newField,
                        fieldType: e.target.value as TenantFieldDefinition["fieldType"],
                      })
                    }
                    options={FIELD_TYPE_OPTIONS}
                  />
                  {["select", "multi_select"].includes(newField.fieldType) ? (
                    <Input
                      label="Options (comma-separated)"
                      value={newField.options}
                      onChange={(e) =>
                        setNewField({ ...newField, options: e.target.value })
                      }
                      placeholder="Strategic, Enterprise, SMB"
                    />
                  ) : null}
                  {["select", "multi_select", "lookup_select", "lookup_multi_select"].includes(newField.fieldType) ? (
                    <Select
                      label="Lookup source"
                      value={newField.lookupCategory}
                      onChange={(e) =>
                        setNewField({ ...newField, lookupCategory: e.target.value })
                      }
                      options={[
                        { value: "", label: "Inline options" },
                        ...lookups.categories.map((category) => ({
                          value: category.category,
                          label: category.label,
                        })),
                      ]}
                    />
                  ) : null}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={newField.required}
                      onChange={(e) =>
                        setNewField({ ...newField, required: e.target.checked })
                      }
                    />
                    Required
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={newField.showInTable}
                      onChange={(e) =>
                        setNewField({ ...newField, showInTable: e.target.checked })
                      }
                    />
                    Show in table
                  </label>
                  <Button type="button" onClick={() => void addSchemaField()}>
                    <Plus className="w-4 h-4" />
                    Add Field
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Only administrators can change workspace schema fields.
                </p>
              )}

              {schemaLoading ? (
                <p className="text-sm text-muted-foreground">Loading schema…</p>
              ) : schemaFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No configurable fields yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Lookup</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead>Table</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schemaFields.map((field) => (
                      <TableRow
                        key={field.id}
                        className={field.status === "INACTIVE" ? "opacity-60" : undefined}
                      >
                        <TableCell>
                          {isAdmin ? (
                            <Input
                              defaultValue={field.label}
                              onBlur={(e) => {
                                const value = e.target.value.trim();
                                if (value && value !== field.label) {
                                  void patchSchemaField(field.id, { label: value });
                                }
                              }}
                            />
                          ) : (
                            field.label
                          )}
                        </TableCell>
                        <TableCell>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {field.key}
                          </code>
                        </TableCell>
                        <TableCell>
                          {field.source === "system" ? "Built-in" : "Custom"}
                          {field.status === "INACTIVE" ? (
                            <Badge variant="secondary" className="ml-2">
                              Hidden
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>{field.fieldType}</TableCell>
                        <TableCell>
                          {isAdmin && ["select", "multi_select", "lookup_select", "lookup_multi_select"].includes(field.fieldType) ? (
                            <Select
                              value={field.lookupCategory || ""}
                              onChange={(e) =>
                                void patchSchemaField(field.id, {
                                  lookupCategory: e.target.value,
                                } as Partial<TenantFieldDefinition>)
                              }
                              options={[
                                { value: "", label: "Inline" },
                                ...lookups.categories.map((category) => ({
                                  value: category.category,
                                  label: category.label,
                                })),
                              ]}
                            />
                          ) : field.lookupCategory ? (
                            field.lookupCategory
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {isAdmin ? (
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(e) =>
                                void patchSchemaField(field.id, {
                                  required: e.target.checked,
                                })
                              }
                            />
                          ) : field.required ? (
                            "Yes"
                          ) : (
                            "No"
                          )}
                        </TableCell>
                        <TableCell>
                          {isAdmin ? (
                            <input
                              type="checkbox"
                              checked={field.showInTable}
                              onChange={(e) =>
                                void patchSchemaField(field.id, {
                                  showInTable: e.target.checked,
                                })
                              }
                            />
                          ) : field.showInTable ? (
                            "Yes"
                          ) : (
                            "No"
                          )}
                        </TableCell>
                        <TableCell>
                          {isAdmin ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => startEditSchemaField(field)}
                                title="Edit field"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() =>
                                  void deleteSchemaField(field.id, field.label, field.source)
                                }
                                title={
                                  field.status === "INACTIVE"
                                    ? "Field is already hidden"
                                    : field.source === "system"
                                      ? "Hide field"
                                      : "Remove field"
                                }
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workspace">
          <Card>
            <CardHeader>
              <CardTitle>Workspace terminology</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkspaceTerminologyPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="theme">
          <Card>
            <CardHeader>
              <CardTitle>Workspace Theme</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Customize the look and feel for this workspace only. Users who belong to
                multiple workspaces will see the theme change when they switch workspaces.
              </p>

              {settingsLoading ? (
                <p className="text-sm text-muted-foreground">Loading theme settings...</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {[
                      ["primaryColor", "Primary color"],
                      ["accentColor", "Accent color"],
                      ["backgroundColor", "Page background"],
                      ["cardColor", "Card surface"],
                      ["sidebarColor", "Sidebar surface"],
                    ].map(([key, label]) => (
                      <div key={key} className="space-y-2 rounded-xl border border-border p-4">
                        <Input
                          label={label}
                          type="color"
                          value={tenantTheme[key as keyof TenantThemeConfig]}
                          disabled={!isAdmin}
                          onChange={(e) =>
                            setTenantTheme({
                              ...tenantTheme,
                              [key]: e.target.value,
                            })
                          }
                        />
                        <Input
                          value={tenantTheme[key as keyof TenantThemeConfig]}
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
                      onChange={(e) =>
                        setTenantTheme({ ...tenantTheme, radius: e.target.value })
                      }
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
                          <p className="text-sm text-slate-500">
                            Applied to this workspace.
                          </p>
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
        </TabsContent>

        <TabsContent value="case-study">
          <Card>
            <CardHeader>
              <CardTitle>Case Study layout</CardTitle>
            </CardHeader>
            <CardContent>
              <CaseStudySettingsPanel />
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>

      <Modal
        isOpen={Boolean(editingSchemaField)}
        onClose={() => setEditingSchemaField(null)}
        title={editingSchemaField ? `Edit ${editingSchemaField.label}` : "Edit Field"}
        size="lg"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditingSchemaField(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveSchemaField()}>
              Save Field
            </Button>
          </>
        }
      >
        {editingSchemaField ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Field label"
                value={schemaEdit.label}
                onChange={(e) => setSchemaEdit({ ...schemaEdit, label: e.target.value })}
              />
              <Input
                label="Field key"
                value={editingSchemaField.key}
                disabled
                helperText="Keys are stable so existing saved values keep mapping correctly."
              />
              <Select
                label="Field type"
                value={schemaEdit.fieldType}
                onChange={(e) =>
                  setSchemaEdit({
                    ...schemaEdit,
                    fieldType: e.target.value as TenantFieldDefinition["fieldType"],
                  })
                }
                options={[
                  ...(FIELD_TYPE_OPTIONS.some((option) => option.value === schemaEdit.fieldType)
                    ? []
                    : [{ value: schemaEdit.fieldType, label: schemaEdit.fieldType }]),
                  ...FIELD_TYPE_OPTIONS,
                ]}
              />
              <Input
                label="Sort order"
                type="number"
                value={schemaEdit.sortOrder}
                onChange={(e) => setSchemaEdit({ ...schemaEdit, sortOrder: e.target.value })}
              />
              {["select", "multi_select", "lookup_select", "lookup_multi_select"].includes(schemaEdit.fieldType) ? (
                <>
                  <Select
                    label="Lookup source"
                    value={schemaEdit.lookupCategory}
                    onChange={(e) =>
                      setSchemaEdit({ ...schemaEdit, lookupCategory: e.target.value })
                    }
                    options={[
                      { value: "", label: "Inline options" },
                      ...lookups.categories.map((category) => ({
                        value: category.category,
                        label: category.label,
                      })),
                    ]}
                  />
                  <Input
                    label="Inline options"
                    value={schemaEdit.options}
                    disabled={Boolean(schemaEdit.lookupCategory)}
                    onChange={(e) => setSchemaEdit({ ...schemaEdit, options: e.target.value })}
                    helperText={
                      schemaEdit.lookupCategory
                        ? "Options come from the selected lookup source."
                        : "Comma-separated values. Required for choice fields without a lookup source."
                    }
                  />
                </>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={schemaEdit.required}
                  onChange={(e) => setSchemaEdit({ ...schemaEdit, required: e.target.checked })}
                />
                Required
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={schemaEdit.showInTable}
                  onChange={(e) => setSchemaEdit({ ...schemaEdit, showInTable: e.target.checked })}
                />
                Show in table
              </label>
              <Select
                label="Status"
                value={schemaEdit.status}
                onChange={(e) => setSchemaEdit({ ...schemaEdit, status: e.target.value })}
                options={[
                  { value: "ACTIVE", label: "Active" },
                  { value: "INACTIVE", label: "Hidden" },
                ]}
              />
            </div>

            {editingSchemaField.source === "system" ? (
              <p className="text-sm text-muted-foreground">
                Built-in fields keep their key for existing data. Set status to Hidden to remove this
                field from forms, tables, and layouts without deleting stored values.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

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
                        onChange={(e) =>
                          setNewUserTenantRole(tenant.id, e.target.value)
                        }
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
                        onChange={(e) =>
                          setEditUserTenantRole(tenant.id, e.target.value)
                        }
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
    </div>
  );
}
