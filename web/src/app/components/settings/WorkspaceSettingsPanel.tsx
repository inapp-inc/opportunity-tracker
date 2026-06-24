import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { WorkspaceTerminologyPanel } from "../page-layout/panels/WorkspaceTerminologyPanel";

export function WorkspaceSettingsPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace terminology</CardTitle>
      </CardHeader>
      <CardContent>
        <WorkspaceTerminologyPanel />
      </CardContent>
    </Card>
  );
}
