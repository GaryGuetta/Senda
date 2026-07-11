"use client";
import { useEffect, useState, createContext, useContext } from "react";
import styles from "./AuthGate.module.css";

interface User { id: string; username: string }
interface AuthCtx { user: User | null; logout: () => void }

const Ctx = createContext<AuthCtx>({ user: null, logout: () => {} });
export const useAuth = () => useContext(Ctx);

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth").then(r => r.json()).then(d => {
      setUser(d.user); setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function handleLogin() {
    const clean = username.trim();
    if (clean.length < 2) { setError("Au moins 2 caractères"); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: clean }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(data.user);
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    setUser(null); setUsername("");
  }

  if (loading) {
    return <div className={styles.loading}>Chargement…</div>;
  }

  if (!user) {
    return (
      <div className={styles.gate}>
        <div className={styles.card}>
          <div className={styles.logo}>
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 20L9 8l4 7 2-3 6 8z" fill="currentColor" opacity="0.15"/>
              <path d="M3 20L9 8l4 7 2-3 6 8z" strokeLinejoin="round"/>
              <circle cx="17" cy="6" r="2.5" fill="currentColor"/>
            </svg>
          </div>
          <h1 className={styles.title}>TrailRate</h1>
          <p className={styles.subtitle}>
            Note tes randonnées. L'app apprend ta perception de la difficulté et adapte ses calculs rien que pour toi.
          </p>

          <div className={styles.form}>
            <input
              className={styles.input}
              type="text"
              placeholder="Choisis un pseudo"
              value={username}
              maxLength={24}
              onChange={e => { setUsername(e.target.value); setError(null); }}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              autoFocus
            />
            <button className={styles.btn} onClick={handleLogin} disabled={submitting}>
              {submitting ? "…" : "Entrer"}
            </button>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <p className={styles.hint}>
            Pas de mot de passe. Entre le même pseudo pour retrouver tes traces.
          </p>
        </div>
      </div>
    );
  }

  return <Ctx.Provider value={{ user, logout }}>{children}</Ctx.Provider>;
}
