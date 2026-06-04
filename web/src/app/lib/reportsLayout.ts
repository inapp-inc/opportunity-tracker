export const REPORT_SECTION_KEYS = [
  "pipelineByStatus",
  "countByOwner",
  "dueDateTimeline",
  "winLoss",
  "engagementType",
] as const;

export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

export type ReportsLayout = {
  sections: ReportSectionKey[];
};

export const DEFAULT_REPORTS_LAYOUT: ReportsLayout = {
  sections: [...REPORT_SECTION_KEYS],
};

export const REPORT_SECTION_LABELS: Record<ReportSectionKey, string> = {
  pipelineByStatus: "Pipeline value by status",
  countByOwner: "Record count by owner",
  dueDateTimeline: "Due date timeline",
  winLoss: "Win / loss snapshot",
  engagementType: "Engagement type distribution",
};

export function normalizeReportsLayout(input: unknown): ReportsLayout {
  const defaults = DEFAULT_REPORTS_LAYOUT;
  if (!input || typeof input !== "object") return defaults;
  const raw = (input as { sections?: unknown }).sections;
  if (!Array.isArray(raw)) return defaults;
  const sections = raw
    .map(String)
    .filter((key): key is ReportSectionKey =>
      (REPORT_SECTION_KEYS as readonly string[]).includes(key)
    );
  return { sections: sections.length ? sections : defaults.sections };
}

export function isReportSectionVisible(
  layout: ReportsLayout,
  key: ReportSectionKey
) {
  return layout.sections.includes(key);
}
