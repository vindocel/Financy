import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

type User = { id?: string; email?: string; username?: string; first_name?: string; last_name?: string } | null;

type AuthCtx = {
  user: User;
  loading: boolean;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await api.me();
        setUser({});
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(emailOrUsername: string, password: string) {
    await api.login({ emailOrUsername, password });
    setUser({});
  }
  async function logout() {
    await api.logout();
    setUser(null);
  }

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
