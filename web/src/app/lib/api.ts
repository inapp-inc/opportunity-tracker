import { clearToken, getToken } from './auth';

const ACTIVE_TENANT_KEY = 'pt_active_tenant_id';
export const ACTIVE_TENANT_EVENT = 'active-tenant-changed';

export function getActiveTenantId(): string {
  try {
    return localStorage.getItem(ACTIVE_TENANT_KEY) || '';
  } catch {
    return '';
  }
}

export function setActiveTenantId(tenantId: string): void {
  try {
    if (tenantId) {
      localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
    } else {
      localStorage.removeItem(ACTIVE_TENANT_KEY);
    }
    window.dispatchEvent(new CustomEvent(ACTIVE_TENANT_EVENT, { detail: tenantId }));
  } catch {
    // ignore storage failures
  }
}

export function clearActiveTenantId(): void {
  setActiveTenantId('');
}

export function withAppBasePath(path: string): string {
  if (/^https?:\/\//i.test(path) || !path.startsWith('/')) return path;
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  if (!base || base === '/') return path;
  if (path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}

async function parseJsonSafe(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const activeTenantId = getActiveTenantId();
  if (activeTenantId) {
    headers.set('X-Tenant-Id', activeTenantId);
  }

  const res = await fetch(withAppBasePath(path), {
    ...init,
    headers,
    credentials: 'omit',
  });

  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.assign(withAppBasePath('/'));
    }
    // Prevent callers from treating this as success.
    throw new Error('Unauthorized');
  }

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    const serverMsg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: string }).message)
        : typeof data === 'string'
          ? data
          : '';
    const base =
      res.status === 403
        ? 'You do not have permission for this action.'
        : res.statusText || 'Request failed';
    const msg = (serverMsg || base).trim();
    throw new Error(`${msg} (${res.status})`);
  }
  return data as T;
}
