import { useCallback, useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { apiFetch } from "../../../lib/api";
import {
  DEFAULT_TERMINOLOGY,
  updateTerminologyCache,
  type TerminologyConfig,
} from "../../../lib/terminology";
import { emitWorkspaceLayoutUpdated } from "../../../lib/pageLayoutEvents";

export function WorkspaceTerminologyPanel() {
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [terminology, setTerminology] =
    useState<TerminologyConfig>(DEFAULT_TERMINOLOGY);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ terminology?: TerminologyConfig }>("/settings");
      setTerminology(res.terminology || DEFAULT_TERMINOLOGY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaveMsg(null);
    try {
      const res = await apiFetch<{ terminology: TerminologyConfig }>("/settings", {
        method: "PATCH",
        body: JSON.stringify({ terminology }),
      });
      const next = res.terminology || terminology;
      setTerminology(next);
      updateTerminologyCache(next);
      setSaveMsg("Workspace terminology saved.");
      emitWorkspaceLayoutUpdated({ page: "workspace" });
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading terminology…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Names used across navigation, forms, and lists in this workspace.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Application name"
          value={terminology.appName}
          onChange={(e) =>
            setTerminology({ ...terminology, appName: e.target.value })
          }
        />
        <Input
          label="Dashboard label"
          value={terminology.dashboardLabel || "Dashboard"}
          placeholder="Dashboard"
          onChange={(e) =>
            setTerminology({ ...terminology, dashboardLabel: e.target.value })
          }
        />
        <Input
          label="Singular record name"
          value={terminology.recordSingular}
          placeholder="Project"
          onChange={(e) =>
            setTerminology({ ...terminology, recordSingular: e.target.value })
          }
        />
        <Input
          label="Plural record name"
          value={terminology.recordPlural}
          placeholder="Projects"
          onChange={(e) =>
            setTerminology({ ...terminology, recordPlural: e.target.value })
          }
        />
        <Input
          label="Description"
          value={terminology.recordDescription}
          onChange={(e) =>
            setTerminology({ ...terminology, recordDescription: e.target.value })
          }
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        {saveMsg ? <p className="text-sm text-muted-foreground">{saveMsg}</p> : <span />}
        <Button type="button" onClick={() => void handleSave()}>
          Save terminology
        </Button>
      </div>
    </div>
  );
}
