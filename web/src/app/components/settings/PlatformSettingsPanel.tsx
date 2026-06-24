import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Badge } from "../ui/Badge";
import { apiFetch } from "../../lib/api";
import { useAuthUser } from "../../contexts/AuthUserContext";
import { roleLabel, type ApiTenant } from "../../pages/settings/types";

export function PlatformSettingsPanel() {
  const { user: authUser } = useAuthUser();
  const [tenants, setTenants] = useState<ApiTenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [newTenant, setNewTenant] = useState({ name: "", slug: "" });

  const loadTenants = useCallback(async () => {
    setTenantsLoading(true);
    try {
      const res = await apiFetch<{ items: ApiTenant[] }>("/tenants");
      setTenants(res.items || []);
    } catch {
      setTenants([]);
    } finally {
      setTenantsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  const addTenant = async () => {
    if (!newTenant.name.trim()) return;
    try {
      await apiFetch<ApiTenant>("/tenants", {
        method: "POST",
        body: JSON.stringify({
          name: newTenant.name.trim(),
          slug: newTenant.slug.trim() || undefined,
        }),
      });
      setNewTenant({ name: "", slug: "" });
      await loadTenants();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create workspace");
    }
  };

  return (
    <>
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
    </>
  );
}
