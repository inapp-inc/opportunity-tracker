export function opportunitiesDrilldownUrl(
  field: string | undefined,
  bucket: string,
  options?: { mine?: boolean; ownerId?: string }
): string {
  const params = new URLSearchParams();
  params.set("from", "dashboard");
  if (options?.mine) params.set("mine", "1");
  if (options?.ownerId) params.set("ownerId", options.ownerId);
  if (!field || bucket === "Unspecified") {
    return `/app/opportunities?${params}`;
  }
  if (field === "dealStage") params.set("dealStage", bucket);
  else if (field === "status") params.set("status", bucket);
  else if (field === "winOrLoss") params.set("winOrLoss", bucket);
  else if (field === "prospectType") params.set("prospectType", bucket);
  else if (field === "engagementType") params.set("engagementType", bucket);
  else if (field.startsWith("custom:")) {
    params.set("customField", field.slice(7));
    params.set("customValue", bucket);
  }
  return `/app/opportunities?${params}`;
}

export function reportsDrilldownUrl(
  field: string | undefined,
  bucket: string,
  dateFrom?: string,
  dateTo?: string
): string {
  const params = new URLSearchParams();
  params.set("from", "dashboard");
  if (dateFrom) params.set("fromDate", dateFrom);
  if (dateTo) params.set("toDate", dateTo);
  if (field === "dealStage") params.set("dealStage", bucket);
  else if (field === "status") params.set("status", bucket);
  else if (field === "winOrLoss") params.set("winOrLoss", bucket);
  else if (field === "prospectType") params.set("prospectType", bucket);
  else if (field === "engagementType") params.set("engagementType", bucket);
  else if (field?.startsWith("custom:")) {
    params.set("customField", field.slice(7));
    params.set("customValue", bucket);
  }
  return `/app/reports?${params}`;
}
