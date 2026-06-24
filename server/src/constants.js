export const DEFAULT_TENANT_ID = 'default-tenant';

export const PORT = Number(process.env.PORT || 3001);

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}

export const STATIC_AUTH_EMAIL =
  process.env.STATIC_AUTH_EMAIL || 'demo@example.com';
export const STATIC_AUTH_PASSWORD =
  process.env.STATIC_AUTH_PASSWORD || 'password';
export const STATIC_AUTH_ENABLED =
  process.env.STATIC_AUTH_ENABLED === 'true' ||
  process.env.NODE_ENV !== 'production';

export const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function normalizeBasePath(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned || cleaned === '/') return '';
  return `/${cleaned.replace(/^\/+|\/+$/g, '')}`;
}

export const APP_BASE_PATH = normalizeBasePath(
  process.env.APP_BASE_PATH || process.env.PUBLIC_BASE_PATH || ''
);
