import { getToken } from "./auth";
import { getActiveTenantId, withAppBasePath } from "./api";

export async function downloadWithAuth(path: string, filename: string) {
  const token = getToken();
  const activeTenantId = getActiveTenantId();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (activeTenantId) headers["X-Tenant-Id"] = activeTenantId;
  const res = await fetch(withAppBasePath(path), {
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
