"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import TrailCard from "@/components/TrailCard";
import ModelInsight from "@/components/ModelInsight";
import GpxImport from "@/components/GpxImport";
import { Trail } from "@/types";
import styles from "./mes-traces.module.css";

export default function MesTracesPage() {
  const router = useRouter();
  const { user, loading: authLoading, requireLogin } = useAuth();
  const [trails, setTrails] = useState<Trail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [modelKey, setModelKey] = useState(0);

  function fetchTrails() {
    fetch("/api/trails").then(r => r.json()).then(d => {
      setTrails(Array.isArray(d) ? d : []); setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) { requireLogin(); setLoading(false); return; }
    fetchTrails();
  }, [user, authLoading]);

  if (authLoading) return <div className={styles.state}>Chargement…</div>;

  if (!user) return (
    <div className={styles.gate}>
      <h1 className={styles.gateTitle}>Votre espace personnel</h1>
      <p className={styles.gateText}>Connectez-vous pour importer vos traces, les noter et suivre votre modèle de difficulté.</p>
      <button className={styles.gateBtn} onClick={requireLogin}>Se connecter</button>
    </div>
  );

  const publicCount = trails.filter(t => t.isPublic).length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Mes traces</h1>
          <p className={styles.subtitle}>
            {trails.length} trace{trails.length > 1 ? "s" : ""}
            {publicCount > 0 ? ` · ${publicCount} publiée${publicCount > 1 ? "s" : ""}` : ""}
          </p>
        </div>
        <button className={styles.importBtn} onClick={() => setShowImport(true)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
          Importer un GPX
        </button>
      </div>

      {trails.length > 0 && (
        <div className={styles.modelStrip}>
          <ModelInsight refreshKey={modelKey} />
        </div>
      )}

      {loading ? (
        <div className={styles.state}>Chargement…</div>
      ) : trails.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIllus}>
            <svg viewBox="0 0 48 48" fill="none"><path d="M6 40L18 16l8 14 4-6 12 16z" fill="var(--sage)" opacity="0.2"/><path d="M6 40L18 16l8 14" stroke="var(--sage)" strokeWidth="1.5" fill="none"/></svg>
          </div>
          <h3 className={styles.emptyTitle}>Aucune trace pour l'instant</h3>
          <p className={styles.emptyText}>Importez un fichier GPX pour voir sa difficulté analysée, la noter et nourrir votre modèle personnel.</p>
          <button className={styles.emptyBtn} onClick={() => setShowImport(true)}>Importer ma première trace</button>
        </div>
      ) : (
        <div className={`${styles.grid} stagger`}>
          {trails.map(t => <TrailCard key={t.id} trail={t} />)}
        </div>
      )}

      {showImport && (
        <GpxImport
          onClose={() => setShowImport(false)}
          onImported={(id?: string) => { setShowImport(false); if (id) { router.push(`/sentier/${id}`); } else { fetchTrails(); setModelKey(k => k + 1); } }}
        />
      )}
    </div>
  );
}
