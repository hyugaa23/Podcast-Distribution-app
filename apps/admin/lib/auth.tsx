'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, onSessionExpired, post, refreshSession, setAccessToken, get, type Role, type SessionData } from './api';
import type { Tenant } from './types';

interface AuthState {
  ready: boolean;
  user: SessionData['user'] | null;
  /** Tenant currently in scope: the user's own tenant, or the tenant chosen by a super admin (null = whole network). */
  scopeTenantId: number | null;
  setScopeTenantId: (id: number | null) => void;
  tenants: Tenant[];
  reloadTenants: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);
const SCOPE_KEY = 'pe-admin-scope';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionData['user'] | null>(null);
  const [scope, setScope] = useState<number | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const reloadTenants = useCallback(async () => {
    try {
      setTenants(await get<Tenant[]>('/tenants'));
    } catch {
      setTenants([]);
    }
  }, []);

  const applySession = useCallback((d: SessionData | null) => {
    setUser(d?.user ?? null);
    if (d?.user.role === 'SUPER_ADMIN') {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem(SCOPE_KEY) : null;
      setScope(saved ? Number(saved) || null : null);
    } else {
      setScope(d?.user.tenant_id ?? null);
    }
  }, []);

  useEffect(() => {
    refreshSession()
      .then(async (d) => {
        applySession(d);
        if (d) await reloadTenants();
      })
      .finally(() => setReady(true));
    return onSessionExpired(() => {
      setAccessToken(null);
      setUser(null);
    });
  }, [applySession, reloadTenants]);

  const login = useCallback(async (email: string, password: string) => {
    const d = await post<SessionData>('/auth/login', { email, password });
    setAccessToken(d.access_token);
    applySession(d);
    await reloadTenants();
  }, [applySession, reloadTenants]);

  const logout = useCallback(async () => {
    try { await post('/auth/logout'); } catch (e) { if (!(e instanceof ApiError)) throw e; }
    setAccessToken(null);
    setUser(null);
  }, []);

  const setScopeTenantId = useCallback((id: number | null) => {
    if (user?.role !== 'SUPER_ADMIN') return;
    setScope(id);
    try { window.localStorage.setItem(SCOPE_KEY, id ? String(id) : ''); } catch { /* ignore */ }
  }, [user]);

  const value = useMemo<AuthState>(() => ({
    ready, user, scopeTenantId: scope, setScopeTenantId, tenants, reloadTenants, login, logout,
    can: (...roles: Role[]) => !!user && roles.includes(user.role),
  }), [ready, user, scope, setScopeTenantId, tenants, reloadTenants, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

/** Query parameter for tenant-scoped endpoints (only meaningful for super admins; the backend pins others). */
export function useTenantQuery(): { tenant_id?: number } {
  const { scopeTenantId, user } = useAuth();
  return user?.role === 'SUPER_ADMIN' && scopeTenantId ? { tenant_id: scopeTenantId } : {};
}
