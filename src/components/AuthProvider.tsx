"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";

interface User { id: string; username: string }
interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (mode: "login" | "signup", username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  requireLogin: () => void;      // opens the login modal
  loginOpen: boolean;
  setLoginOpen: (v: boolean) => void;
  refresh: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/auth").then(r => r.json()).then(d => { setUser(d.user); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (mode: "login" | "signup", username: string, password: string) => {
    const clean = username.trim();
    if (clean.length < 2) return { ok: false, error: "Pseudo : au moins 2 caractères." };
    if (password.length < 6) return { ok: false, error: "Mot de passe : au moins 6 caractères." };
    try {
      const res = await fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, username: clean, password }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error };
      setUser(data.user); setLoginOpen(false);
      return { ok: true };
    } catch (e: any) { return { ok: false, error: e.message }; }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth", { method: "DELETE" });
    setUser(null);
  }, []);

  const requireLogin = useCallback(() => setLoginOpen(true), []);

  return (
    <Ctx.Provider value={{ user, loading, login, logout, requireLogin, loginOpen, setLoginOpen, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
