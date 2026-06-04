import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { CaseStudyConfigurator } from "./CaseStudyConfigurator";
import { ACTIVE_TENANT_EVENT, apiFetch } from "../../lib/api";
import {
  defaultCaseStudyLayout,
  layoutFromWorkspaceConfig,
  type CaseStudyLayout,
} from "../../lib/caseStudyLayout";
import { invalidateCaseStudyConfigCache } from "../../lib/caseStudyConfig";
import { emitWorkspaceLayoutUpdated } from "../../lib/pageLayoutEvents";
import { useTenantSchema } from "../../lib/serverState";
import { validateCaseStudyExpression } from "../../lib/caseStudyRender";

export function CaseStudySettingsPanel() {
  const { fields: schemaFields, loading: schemaLoading } = useTenantSchema();
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [caseStudyEnabled, setCaseStudyEnabled] = useState(true);
  const [layout, setLayout] = useState<CaseStudyLayout>(defaultCaseStudyLayout());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        caseStudyEnabled?: boolean;
        caseStudyLayout?: CaseStudyLayout;
      }>("/settings");
      if (res.caseStudyEnabled !== undefined) {
        setCaseStudyEnabled(Boolean(res.caseStudyEnabled));
      }
      setLayout(layoutFromWorkspaceConfig(res.caseStudyLayout));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onTenantChange = () => void load();
    window.addEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    return () => window.removeEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
  }, [load]);

  const handleSave = async () => {
    setSaveMsg(null);
    try {
      for (const col of layout.columns || []) {
        for (const entry of col.entries || []) {
          if (entry.type !== "expression") continue;
          const expr = String(entry.expression || "").trim();
          if (!expr) continue;
          const validated = validateCaseStudyExpression(expr);
          if (!validated.ok) {
            setSaveMsg(
              `Expression error in "${entry.label?.trim() || "Calculated"}": ${validated.error}`
            );
            return;
          }
        }
      }
      const res = await apiFetch<{
        caseStudyEnabled?: boolean;
        caseStudyLayout?: CaseStudyLayout;
      }>("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          caseStudyEnabled,
          caseStudyLayout: layout,
        }),
      });
      setLayout(layoutFromWorkspaceConfig(res.caseStudyLayout));
      if (res.caseStudyEnabled !== undefined) {
        setCaseStudyEnabled(Boolean(res.caseStudyEnabled));
      }
      invalidateCaseStudyConfigCache();
      emitWorkspaceLayoutUpdated({ page: "case-study" });
      setSaveMsg("Case study settings saved for this workspace.");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleReset = () => {
    if (!confirm("Reset case study layout to the default template?")) return;
    setLayout(defaultCaseStudyLayout());
  };

  if (loading || schemaLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading case study settings…</p>
    );
  }

  return (
    <div className="space-y-6">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="rounded border-border"
          checked={caseStudyEnabled}
          onChange={() => setCaseStudyEnabled((v) => !v)}
        />
        <span className="text-sm font-medium">Enable Case Study tab on records</span>
      </label>

      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground space-y-2">
        <p>
          Build the Case Study view with one or more columns. Each column holds ordered
          entries: record fields, free text (with optional {"{{fieldKey}}"} tokens), or math
          expressions using any active schema field.
        </p>
        <p>
          <strong className="text-foreground">Expressions</strong> support {"{{fieldKey}}"}{" "}
          placeholders (<code className="text-xs">{"{{value}}"}</code> or{" "}
          <code className="text-xs">{"{{custom.my_field}}"}</code>),{" "}
          <code className="text-xs">+ - * / ( )</code>. Subtracting two date fields (
          e.g. <code className="text-xs">{"{{closedDate}} - {{firstPresalesCall}}"}</code>
          ) returns the number of <strong className="text-foreground">working days</strong>{" "}
          between them (Mon–Fri, inclusive). Set the entry format to &quot;Days&quot; to label
          the result. Tenant custom fields are read from
          each record&apos;s custom data. Money values use the record&apos;s currency.
        </p>
      </div>

      <CaseStudyConfigurator
        layout={layout}
        schemaFields={schemaFields}
        onChange={setLayout}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void handleSave()}>
          Save case study layout
        </Button>
        <Button type="button" variant="outline" onClick={handleReset}>
          Reset to default
        </Button>
        {saveMsg ? (
          <p
            className={`text-sm ${
              saveMsg.toLowerCase().includes("failed") ||
              saveMsg.toLowerCase().includes("error")
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {saveMsg}
          </p>
        ) : null}
      </div>
    </div>
  );
}
