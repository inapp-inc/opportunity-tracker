import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Download, Eye } from "lucide-react";
import { apiFetch } from "../lib/api";
import type { ApiOpportunity, TenantFieldDefinition } from "../lib/opportunity";
import { useTenantSchema } from "../lib/serverState";
import { lowerFirst, useTerminology } from "../lib/terminology";
import { layoutFromWorkspaceConfig, type CaseStudyLayout } from "../lib/caseStudyLayout";
import { renderCaseStudyLayout } from "../lib/caseStudyRender";
import { downloadCaseStudyPng } from "../lib/caseStudyDownload";
import { PageHeader, LoadingDisplay, EmptyDisplay, ErrorDisplay } from "../components/shared";
import { Input } from "../components/ui/Input";

function CaseStudyPreview({
  opportunity,
  schemaFields,
  layout,
}: {
  opportunity: ApiOpportunity;
  schemaFields: TenantFieldDefinition[];
  layout: CaseStudyLayout;
}) {
  const columns = useMemo(
    () => renderCaseStudyLayout(layout, opportunity, schemaFields),
    [layout, opportunity, schemaFields]
  );
  const first = columns[0];
  if (!first) return <p className="text-sm text-muted-foreground">No layout configured.</p>;
  const previewRows = first.rows.slice(0, 8);
  return (
    <div className="space-y-2">
      {previewRows.map((row) => (
        <div key={row.id} className="text-sm">
          {row.label ? <span className="text-muted-foreground">{row.label}: </span> : null}
          <span className="font-medium">{row.value || "—"}</span>
        </div>
      ))}
    </div>
  );
}

function CaseStudyFull({
  opportunity,
  schemaFields,
  layout,
}: {
  opportunity: ApiOpportunity;
  schemaFields: TenantFieldDefinition[];
  layout: CaseStudyLayout;
}) {
  const columns = useMemo(
    () => renderCaseStudyLayout(layout, opportunity, schemaFields),
    [layout, opportunity, schemaFields]
  );
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))` }}
    >
      {columns.map((col) => (
        <div key={col.id} className="rounded-lg border border-border p-4 bg-white space-y-3">
          {col.title ? <h3 className="text-sm font-semibold border-b border-border pb-2">{col.title}</h3> : null}
          {col.blocks.map((block) => (
            <p key={block.id} className="text-sm whitespace-pre-wrap text-foreground">
              {block.html}
            </p>
          ))}
          <div className="space-y-2">
            {col.rows.map((row) => (
              <div key={row.id} className="text-sm">
                {row.label ? <div className="text-xs text-muted-foreground">{row.label}</div> : null}
                <div className="font-medium whitespace-pre-wrap break-words">{row.value || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CaseStudies() {
  const terminology = useTerminology();
  const { fields: schemaFields } = useTenantSchema();
  const [items, setItems] = useState<ApiOpportunity[]>([]);
  const [layout, setLayout] = useState<CaseStudyLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ApiOpportunity | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((opp) => {
      const haystack = `${opp.prospect || ""} ${opp.opportunityDescription || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [recordsRes, lookupsRes] = await Promise.all([
          apiFetch<{ items: ApiOpportunity[] }>(`/records?archived=exclude`),
          apiFetch<{ caseStudyEnabled?: boolean; caseStudyLayout?: unknown }>(`/catalog/lookups`),
        ]);
        if (cancelled) return;
        const nextLayout = layoutFromWorkspaceConfig(lookupsRes.caseStudyLayout);
        setLayout(nextLayout);
        setItems(recordsRes.items || []);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load case studies");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <LoadingDisplay message={`Loading ${lowerFirst(terminology.recordPlural)}...`} />;
  if (error) return <ErrorDisplay title="Unable to load" description={error} />;
  if (!layout) return <EmptyDisplay title="No case study layout" description="Configure a case study layout in Settings." />;

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
      <PageHeader
        eyebrow="Case Studies"
        title="Case Studies"
        description={`Browse case studies across ${lowerFirst(terminology.recordPlural)}.`}
        actions={
          <Link to="/app/settings">
            <Button variant="outline" size="sm" type="button">
              Configure
            </Button>
          </Link>
        }
      />

      <div className="max-w-xl">
        <Input
          label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${lowerFirst(terminology.recordPlural)}...`}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyDisplay title="No records" description={`No ${lowerFirst(terminology.recordPlural)} found.`} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((opp) => (
            <Card key={opp.id} className="h-full">
              <CardHeader>
                <CardTitle className="truncate">{opp.prospect}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <CaseStudyPreview opportunity={opp} schemaFields={schemaFields} layout={layout} />
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setActive(opp)}
                  >
                    <Eye className="w-4 h-4" />
                    View more
                  </Button>
                  <Link to={`/app/opportunities/${opp.id}?tab=case-study`} className="text-sm text-primary hover:underline">
                    Open {terminology.recordSingular}
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={!!active}
        onClose={() => setActive(null)}
        title={active ? `${active.prospect} — Case Study` : "Case Study"}
        // 16:7 "deck" modal, sized to viewport without overflowing.
        className="w-[min(90vw,calc(90vh*16/7))] max-w-none aspect-[16/7]"
        footer={
          <div className="flex items-center justify-between w-full gap-2">
            <Button type="button" variant="outline" onClick={() => setActive(null)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={!active || downloading}
              onClick={async () => {
                if (!active || !viewRef.current) return;
                try {
                  setDownloading(true);
                  await downloadCaseStudyPng(viewRef.current, `Case-Study-${active.id}.png`);
                } finally {
                  setDownloading(false);
                }
              }}
            >
              <Download className="w-4 h-4" />
              {downloading ? "Rendering…" : "Download"}
            </Button>
          </div>
        }
      >
        {active ? (
          <div ref={viewRef} className="bg-white p-6 rounded-xl border border-border h-full">
            <CaseStudyFull opportunity={active} schemaFields={schemaFields} layout={layout} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

