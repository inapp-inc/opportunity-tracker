import { clearToken, getToken } from './auth';

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

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'omit',
  });

  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.assign('/');
    }
  }

  const data = await parseJsonSafe(res);
  if (res.status === 403) {
    throw new Error(
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: string }).message)
        : 'You do not have permission for this action.'
    );
  }
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: string }).message)
        : res.statusText;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data as T;
}
