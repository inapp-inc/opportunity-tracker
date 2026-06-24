import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { lowerFirst, useTerminology } from "../lib/terminology";
import { useOnTenantLookupsUpdated } from "../lib/serverState";
import type { ApiOpportunity, OpportunityActivity } from "../lib/opportunity";

export type ArtifactUi = {
  id: string;
  type: string;
  url: string;
  title?: string;
  addedBy: string;
  addedOn: string;
};

type ApiArtifact = ArtifactUi & { artifactType: string };

function mapArtifact(a: ApiArtifact): ArtifactUi {
  return {
    id: String(a.id),
    type: String(a.type || a.artifactType || "Artifact"),
    url: a.url,
    title: a.title,
    addedBy: a.addedBy,
    addedOn: a.addedOn,
  };
}

export function useOpportunityDetail(id: string | undefined) {
  const terminology = useTerminology();
  const [opp, setOpp] = useState<ApiOpportunity | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactUi[]>([]);
  const [activity, setActivity] = useState<OpportunityActivity[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadOpportunity = useCallback(async () => {
    if (!id) return;
    try {
      const [o, arts, acts] = await Promise.all([
        apiFetch<ApiOpportunity>(`/records/${id}`),
        apiFetch<{ items: ApiArtifact[] }>(`/records/${id}/artifacts`),
        apiFetch<{ items: OpportunityActivity[] }>(`/records/${id}/activities`),
      ]);
      setOpp(o);
      setArtifacts((arts.items || []).map(mapArtifact));
      setActivity(acts.items || []);
      setLoadError(null);
    } catch (e) {
      setLoadError(
        e instanceof Error
          ? e.message
          : `Failed to load ${lowerFirst(terminology.recordSingular)}`
      );
    }
  }, [id, terminology.recordSingular]);

  const refreshRecord = useCallback(async () => {
    if (!id) return null;
    try {
      const record = await apiFetch<ApiOpportunity>(`/records/${id}?ts=${Date.now()}`, {
        cache: "no-store",
      });
      setOpp(record);
      setLoadError(null);
      return record;
    } catch (e) {
      setLoadError(
        e instanceof Error
          ? e.message
          : `Failed to refresh ${lowerFirst(terminology.recordSingular)}`
      );
      return null;
    }
  }, [id, terminology.recordSingular]);

  const reloadArtifacts = useCallback(async () => {
    if (!id) return;
    const arts = await apiFetch<{ items: ApiArtifact[] }>(`/records/${id}/artifacts`);
    setArtifacts((arts.items || []).map(mapArtifact));
  }, [id]);

  const reloadActivity = useCallback(async () => {
    if (!id) return;
    const acts = await apiFetch<{ items: OpportunityActivity[] }>(
      `/records/${id}/activities`
    );
    setActivity(acts.items || []);
  }, [id]);

  useEffect(() => {
    void loadOpportunity();
  }, [loadOpportunity]);

  useOnTenantLookupsUpdated(() => {
    void loadOpportunity();
  });

  return {
    opp,
    setOpp,
    artifacts,
    activity,
    loadError,
    loadOpportunity,
    refreshRecord,
    reloadArtifacts,
    reloadActivity,
  };
}
