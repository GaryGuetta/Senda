"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import TrailCard from "@/components/TrailCard";
import { Trail } from "@/types";
import styles from "../mes-traces/mes-traces.module.css";

export default function MesProjetsPage() {
  const router = useRouter();
  const { user, requireLogin, loading: authLoading } = useAuth();
  const [trails, setTrails] = useState<Trail[]>([]);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState<string | null>(null);

  function fetchTrails() {
    fetch("/api/trails").then(r => r.json()).then(d => {
      setTrails(Array.isArray(d) ? d : []); setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) { requireLogin(); setLoading(false); return; }
    fetchTrails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  async function markDone(id: string) {
    if (!confirm("Marquer ce projet comme réalisé ? Il rejoindra vos traces faites (et pourra alors être partagé).")) return;
    setConverting(id);
    try {
      const r = await fetch(`/api/trails/${id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "faite" }),
      });
      if (r.ok) setTrails(ts => ts.filter(t => t.id !== id));
    } finally { setConverting(null); }
  }

  if (authLoading) return <div className={styles.state}>Chargement…</div>;

  if (!user) return (
    <div className={styles.gate}>
      <h1 className={styles.gateTitle}>Vos projets de rando</h1>
      <p className={styles.gateText}>Connectez-vous pour préparer et retrouver vos randos à faire.</p>
      <button className={styles.gateBtn} onClick={requireLogin}>Se connecter</button>
    </div>
  );

  const projets = trails.filter((t: any) => t.status === "projet");

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Mes projets</h1>
          <p className={styles.subtitle}>
            {projets.length} rando{projets.length > 1 ? "s" : ""} à faire — tracée{projets.length > 1 ? "s" : ""} sur la carte
          </p>
        </div>
        <button className={styles.importBtn} onClick={() => router.push("/refuges")}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
          Tracer un projet
        </button>
      </div>

      {loading ? (
        <div className={styles.state}>Chargement…</div>
      ) : projets.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIllus}>
            <svg viewBox="0 0 48 48" fill="none"><path d="M6 40L18 16l8 14 4-6 12 16z" fill="var(--terra)" opacity="0.2"/><path d="M6 40L18 16l8 14" stroke="var(--terra)" strokeWidth="1.5" fill="none"/></svg>
          </div>
          <h3 className={styles.emptyTitle}>Aucun projet pour l'instant</h3>
          <p className={styles.emptyText}>Tracez une rando sur la carte depuis « Planifier » pour la préparer et la garder ici. Une fois réalisée, marquez-la comme faite.</p>
          <button className={styles.emptyBtn} onClick={() => router.push("/refuges")}>Tracer mon premier projet</button>
        </div>
      ) : (
        <div className={`${styles.grid} stagger`}>
          {projets.map(t => (
            <div key={t.id} className={styles.projectCard}>
              <TrailCard trail={t} />
              <button className={styles.doneBtn} onClick={() => markDone(t.id)} disabled={converting === t.id}>
                {converting === t.id ? "…" : "✓ Marquer comme faite"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
