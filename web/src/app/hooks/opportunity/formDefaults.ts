export interface OpportunityFormData {
  prospect: string;
  description: string;
  ownerIds: string[];
  deliverables: string;
  dueDate: string;
  status: string;
  winLoss: string;
  dealStage: string;
  firstPresalesCall: string;
  closedDate: string;
  prospectType: string;
  engagementType: string;
  value: string;
  currency: string;
  notes: string;
}

export const initialOpportunityFormData: OpportunityFormData = {
  prospect: "",
  description: "",
  ownerIds: [],
  deliverables: "",
  dueDate: "",
  status: "Not Started",
  winLoss: "Open",
  dealStage: "Discovery",
  firstPresalesCall: "",
  closedDate: "",
  prospectType: "",
  engagementType: "",
  value: "",
  currency: "USD",
  notes: "",
};

export const DEFAULT_PROSPECT_TYPE_OPTIONS = [
  { value: "", label: "Select type..." },
  { value: "Enterprise", label: "Enterprise" },
  { value: "Mid-Market", label: "Mid-Market" },
  { value: "SMB", label: "SMB" },
];

export const DEFAULT_ENGAGEMENT_TYPE_OPTIONS = [
  { value: "", label: "Select engagement..." },
  { value: "RFP", label: "RFP" },
  { value: "POC", label: "POC" },
  { value: "Demo", label: "Demo" },
  { value: "Consultation", label: "Consultation" },
];

export const DEFAULT_WIN_LOSS_OPTIONS = [
  { value: "", label: "Select outcome..." },
  { value: "Open", label: "Open" },
  { value: "Win", label: "Win" },
  { value: "Loss", label: "Loss" },
];

export const DEFAULT_CURRENCY_OPTIONS = [
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
  { value: "CAD", label: "CAD" },
];
