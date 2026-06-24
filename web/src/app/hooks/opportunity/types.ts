import {
  ownerLabels,
  type ApiOpportunity,
} from "../../lib/opportunity";
import type { CustomFieldValue } from "../../lib/fields";

export type WorkspaceOpportunity = {
  id: string;
  prospect: string;
  description: string;
  owner: string[];
  ownerIds: string[];
  deliverables: string;
  dueDate: string;
  status: "Not Started" | "In Progress" | "Completed";
  winLoss: "Win" | "Loss" | "Open";
  dealStage: string;
  value: number;
  currency: string;
  prospectType: string;
  engagementType: string;
  customFields: Record<string, CustomFieldValue>;
  version: number;
  archived: boolean;
  isDraft: boolean;
};

export function mapApiOpportunity(o: ApiOpportunity): WorkspaceOpportunity {
  return {
    id: o.id,
    prospect: o.prospect,
    description: o.opportunityDescription,
    owner: ownerLabels(o),
    ownerIds: o.ownerIds || [],
    deliverables: Array.isArray(o.deliverables)
      ? o.deliverables.join(", ")
      : String(o.deliverables || ""),
    dueDate: o.dueDate,
    status: o.status,
    winLoss: o.winOrLoss,
    dealStage: o.dealStage || "Discovery",
    value: Number(o.value || 0),
    currency: o.currency || "USD",
    prospectType: o.prospectType,
    engagementType: o.engagementType,
    customFields: o.customFields || {},
    version: o.version,
    archived: !!o.archived,
    isDraft: !!o.isDraft,
  };
}

export type PipelineSummary = {
  totalsByStatus: { status: string; count: number; totalValue: number }[];
  countsByOwner: { ownerId: string; count: number; totalValue: number }[];
};
