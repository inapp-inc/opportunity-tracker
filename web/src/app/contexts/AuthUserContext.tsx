import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ACTIVE_TENANT_EVENT, apiFetch, getActiveTenantId, setActiveTenantId } from '../lib/api';
import type { PageAccessConfig } from '../lib/pageAccess';

export type TenantMembership = {
  id: string;
  userId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: 'TENANT_ADMIN' | 'MANAGER' | 'VIEWER';
  permissions: string[];
  status: string;
};

export type AuthUser = {
  sub: string;
  email: string;
  name?: string;
  role: string;
  tenantRole?: TenantMembership['role'];
  platformRole: 'PLATFORM_ADMIN' | 'NONE';
  tenantId: string;
  tenantName: string;
  activeTenantId: string;
  activeTenantName: string;
  memberships: TenantMembership[];
  permissions: string[];
  pageAccess?: PageAccessConfig;
};

type AuthUserContextValue = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
};

const AuthUserContext = createContext<AuthUserContextValue | null>(null);

export function AuthUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await apiFetch<AuthUser>('/auth/me');
      if (me.activeTenantId && !getActiveTenantId()) {
        setActiveTenantId(me.activeTenantId);
      }
      setUser(me);
    } catch (e) {
      setUser(null);
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      setActiveTenantId(tenantId);
      await refetch();
    },
    [refetch]
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const onTenantChange = () => {
      void refetch();
    };
    window.addEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
    return () => window.removeEventListener(ACTIVE_TENANT_EVENT, onTenantChange);
  }, [refetch]);

  const value = useMemo(
    () => ({ user, loading, error, refetch, switchTenant }),
    [user, loading, error, refetch, switchTenant]
  );

  return (
    <AuthUserContext.Provider value={value}>{children}</AuthUserContext.Provider>
  );
}

export function useAuthUser() {
  const ctx = useContext(AuthUserContext);
  if (!ctx) {
    throw new Error('useAuthUser must be used within AuthUserProvider');
  }
  return ctx;
}
