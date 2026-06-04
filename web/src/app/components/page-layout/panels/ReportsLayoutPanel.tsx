import { useCallback, useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { apiFetch } from "../../../lib/api";
import {
  DEFAULT_REPORTS_LAYOUT,
  REPORT_SECTION_KEYS,
  REPORT_SECTION_LABELS,
  normalizeReportsLayout,
  type ReportsLayout,
  type ReportSectionKey,
} from "../../../lib/reportsLayout";
import { emitWorkspaceLayoutUpdated } from "../../../lib/pageLayoutEvents";

export function ReportsLayoutPanel() {
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [layout, setLayout] = useState<ReportsLayout>(DEFAULT_REPORTS_LAYOUT);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ reportsLayout?: ReportsLayout }>("/settings");
      setLayout(normalizeReportsLayout(res.reportsLayout));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSection = (key: ReportSectionKey) => {
    setLayout((prev) => {
      const has = prev.sections.includes(key);
      const sections = has
        ? prev.sections.filter((s) => s !== key)
        : [...prev.sections, key];
      return { sections };
    });
  };

  const handleSave = async () => {
    setSaveMsg(null);
    try {
      await apiFetch("/settings", {
        method: "PATCH",
        body: JSON.stringify({ reportsLayout: layout }),
      });
      setSaveMsg("Reports layout saved for this workspace.");
      emitWorkspaceLayoutUpdated({ page: "reports" });
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading reports layout…</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Choose which charts and sections appear on the Reports page for everyone in this
        workspace.
      </p>
      <div className="space-y-2">
        {REPORT_SECTION_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={layout.sections.includes(key)}
              onChange={() => toggleSection(key)}
            />
            {REPORT_SECTION_LABELS[key]}
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        {saveMsg ? <p className="text-sm text-muted-foreground">{saveMsg}</p> : <span />}
        <Button type="button" onClick={() => void handleSave()}>
          Save reports layout
        </Button>
      </div>
    </div>
  );
}
