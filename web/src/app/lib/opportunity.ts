export type AssignableUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type OpportunityOwner = {
  id: string;
  name: string;
  email: string;
};

export type OpportunityActivity = {
  id: string;
  kind: string;
  actorId?: string;
  actorEmail: string;
  body: string;
  meta?: Record<string, unknown> | null;
  createdAt: string;
};

export type TenantFieldDefinition = {
  id: string;
  key: string;
  label: string;
  fieldType:
    | 'text'
    | 'textarea'
    | 'number'
    | 'currency'
    | 'percent'
    | 'date'
    | 'select'
    | 'multi_select'
    | 'boolean'
    | 'url'
    | 'email'
    | 'phone'
    | 'lookup_select'
    | 'lookup_multi_select'
    | 'user_multi_select';
  options: string[];
  lookupCategory?: string;
  required: boolean;
  showInTable: boolean;
  sortOrder?: number;
  status: string;
  source?: 'system' | 'custom';
  locked?: boolean;
};

export type ApiOpportunity = {
  id: string;
  tenantId: string;
  prospect: string;
  opportunityDescription: string;
  ownerIds: string[];
  owners?: OpportunityOwner[];
  deliverables: string[];
  dueDate: string;
  status: string;
  notes: string;
  winOrLoss: string;
  firstPresalesCall?: string | null;
  closedDate?: string | null;
  prospectType: string;
  engagementType: string;
  dealStage: string;
  customFields?: Record<string, string | number | boolean | string[]>;
  value: number;
  currency: string;
  version: number;
  archived?: boolean;
  isDraft?: boolean;
};

export function ownerLabels(o: ApiOpportunity): string[] {
  if (o.owners?.length) return o.owners.map((x) => x.name || x.email);
  return o.ownerIds?.length ? o.ownerIds : ["Unassigned"];
}
