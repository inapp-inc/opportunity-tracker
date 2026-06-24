import type { PageKey } from "../../lib/pageAccess";

export const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: "Dashboard",
  records: "Records",
  opportunities: "Opportunities",
  artifacts: "Artifact Links",
  caseStudies: "Case Studies",
  notifications: "Notifications",
  reports: "Reports",
  settings: "Settings",
};

export const PERMISSION_OPTIONS = [
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

export const PROTECTED_LOOKUP_CATEGORIES = new Set([
  "DEAL_STAGE",
  "DELIVERABLES",
  "ENGAGEMENT_TYPE",
  "PROSPECT_TYPE",
  "WIN_LOSS",
  "ARTIFACT_TYPE",
  "CURRENCY",
]);
