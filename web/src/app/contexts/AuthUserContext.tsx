import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from '../lib/api';

export type AuthUser = {
  sub: string;
  email: string;
  role: string;
};

type AuthUserContextValue = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
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
      setUser(me);
    } catch (e) {
      setUser(null);
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const value = useMemo(
    () => ({ user, loading, error, refetch }),
    [user, loading, error, refetch]
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
