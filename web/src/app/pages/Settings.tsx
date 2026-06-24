import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/Tabs";
import { Users, Settings as SettingsIcon, Shield, Server, Palette } from "lucide-react";
import { PageHeader } from "../components/shared";
import { useCanManageTenantSettings, useIsPlatformAdmin } from "../lib/roles";
import { PlatformSettingsPanel } from "../components/settings/PlatformSettingsPanel";
import { UserManagementPanel } from "../components/settings/UserManagementPanel";
import { RoleManagementPanel } from "../components/settings/RoleManagementPanel";
import { AccessControlPanel } from "../components/settings/AccessControlPanel";
import { LookupsSettingsPanel } from "../components/settings/LookupsSettingsPanel";
import { SchemaSettingsPanel } from "../components/settings/SchemaSettingsPanel";
import { WorkspaceSettingsPanel } from "../components/settings/WorkspaceSettingsPanel";
import { ThemeSettingsPanel } from "../components/settings/ThemeSettingsPanel";
import { CaseStudySettingsPanel } from "../components/settings/CaseStudySettingsPanel";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";

export function Settings() {
  const isPlatformAdmin = useIsPlatformAdmin();
  const canManageSettings = useCanManageTenantSettings();

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
            <AccessControlPanel />
          </TabsContent>
        )}

        {isPlatformAdmin && (
          <TabsContent value="platform">
            <PlatformSettingsPanel />
          </TabsContent>
        )}

        {isPlatformAdmin && (
          <TabsContent value="users">
            <UserManagementPanel />
          </TabsContent>
        )}

        {isPlatformAdmin && (
          <TabsContent value="roles">
            <RoleManagementPanel />
          </TabsContent>
        )}

        {canManageSettings && (
          <TabsContent value="lookups">
            <LookupsSettingsPanel />
          </TabsContent>
        )}

        {canManageSettings && (
          <TabsContent value="schema">
            <SchemaSettingsPanel />
          </TabsContent>
        )}

        {canManageSettings && (
          <TabsContent value="workspace">
            <WorkspaceSettingsPanel />
          </TabsContent>
        )}

        {canManageSettings && (
          <TabsContent value="theme">
            <ThemeSettingsPanel />
          </TabsContent>
        )}

        {canManageSettings && (
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
        )}
      </Tabs>
    </div>
  );
}
