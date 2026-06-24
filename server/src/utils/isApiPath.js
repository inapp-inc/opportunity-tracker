/** Paths handled by the JSON API (require Bearer token except as noted). */
export function isApiPath(p) {
  if (p === '/auth/me') return true;
  if (p.startsWith('/opportunities')) return true;
  if (p.startsWith('/prospect-groups')) return true;
  if (p.startsWith('/records')) return true;
  if (p.startsWith('/notifications')) return true;
  if (p.startsWith('/reports')) return true;
  if (p.startsWith('/analytics')) return true;
  if (p.startsWith('/settings')) return true;
  if (p.startsWith('/catalog')) return true;
  if (p.startsWith('/users')) return true;
  if (p.startsWith('/platform')) return true;
  if (p.startsWith('/tenants')) return true;
  if (p.startsWith('/export')) return true;
  return false;
}
