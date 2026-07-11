"use client";
import { useEffect, useState } from "react";
import { Trail, SURFACE_FAMILIES, SurfaceKey, SurfaceBreakdown } from "@/types";
import { difficultyColor } from "@/lib/difficulty";
import styles from "./TrailActions.module.css";

interface Props { trail: Trail; onSaved: () => void; onDelete: () => void }

export default function TrailActions({ trail, onSaved, onDelete }: Props) {
  const props = (trail.geojson as any)?.properties ?? {};
  const autoScore: number | null = props.globalScore ?? null;
  const autoBreakdown: SurfaceBreakdown = props.surfaceBreakdown ?? { route:0, sentier:0, rocheux:0, montagne:0 };

  const [showRating, setShowRating] = useState(false);
  const [pcts, setPcts] = useState<Record<SurfaceKey, number>>({
    route: autoBreakdown.route, sentier: autoBreakdown.sentier,
    rocheux: autoBreakdown.rocheux, montagne: autoBreakdown.montagne,
  });
  const [difficulty, setDifficulty] = useState(autoScore != null ? Math.round(autoScore) : 5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [isPublic, setIsPublic] = useState(!!trail.isPublic);
  const [togglingPublic, setTogglingPublic] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setIsPublic(!!trail.isPublic);
    fetch(`/api/trails/${trail.id}/review`).then(r => r.json()).then(data => {
      if (data) {
        setPcts({ route: data.pctRoute, sentier: data.pctSentier, rocheux: data.pctRocheux, montagne: data.pctMontagne });
        setDifficulty(data.difficulty); setComment(data.comment ?? ""); setHasExisting(true);
      }
    });
  }, [trail.id]);

  const totalPct = pcts.route + pcts.sentier + pcts.rocheux + pcts.montagne;
  const setPct = (k: SurfaceKey, v: number) => setPcts(p => ({ ...p, [k]: v }));

  async function handleSubmit() {
    setLoading(true);
    await fetch(`/api/trails/${trail.id}/review`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pctRoute: pcts.route, pctSentier: pcts.sentier, pctRocheux: pcts.rocheux, pctMontagne: pcts.montagne, difficulty, comment }),
    });
    setLoading(false); setSaved(true); setHasExisting(true);
    setTimeout(() => { setShowRating(false); setSaved(false); }, 900);
    onSaved();
  }

  async function togglePublic() {
    setTogglingPublic(true);
    try {
      const res = await fetch(`/api/trails/${trail.id}/visibility`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: !isPublic }),
      });
      const data = await res.json();
      if (res.ok) setIsPublic(data.isPublic);
    } finally { setTogglingPublic(false); }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Votre évaluation</div>

      {!showRating ? (
        <button className={styles.rateBtn} onClick={() => setShowRating(true)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.6L5.7 21l2.3-7.4-6-4.6h7.6z" strokeLinejoin="round"/></svg>
          {hasExisting ? "Modifier ma note" : "Noter ce sentier"}
        </button>
      ) : (
        <div className={styles.form}>
          <div className={styles.formHint}>Quel terrain avez-vous rencontré ? Indiquez votre ressenti en %.</div>
          {SURFACE_FAMILIES.map(f => (
            <div key={f.key} className={styles.surfaceRow}>
              <div className={styles.surfaceTop}>
                <span className={styles.dot} style={{ background: f.color }} />
                <span className={styles.sLabel}>{f.label}</span>
                <span className={styles.sVals}>
                  <span className={styles.sVal}>{pcts[f.key]}%</span>
                  <span className={styles.sAuto}>estimé {autoBreakdown[f.key]}%</span>
                </span>
              </div>
              <input type="range" min={0} max={100} step={5} value={pcts[f.key]} className={styles.slider}
                style={{ accentColor: f.color }} onChange={e => setPct(f.key, Number(e.target.value))} />
            </div>
          ))}
          <div className={`${styles.total} ${totalPct !== 100 ? styles.totalWarn : ""}`}>Total : {totalPct}%{totalPct === 100 ? " ✓" : " (visez 100%)"}</div>

          <div className={styles.diffRow}>
            <div className={styles.surfaceTop}>
              <span className={styles.sLabel}>Difficulté ressentie</span>
              <span className={styles.sVals}>
                <span className={styles.sVal} style={{ color: difficultyColor(difficulty) }}>{difficulty}/10</span>
                {autoScore != null && <span className={styles.sAuto}>estimé {autoScore}</span>}
              </span>
            </div>
            <input type="range" min={1} max={10} value={difficulty} className={styles.slider}
              style={{ accentColor: difficultyColor(difficulty) }} onChange={e => setDifficulty(Number(e.target.value))} />
          </div>

          <textarea className={styles.comment} rows={2} placeholder="Commentaire (conditions, passages délicats…)"
            value={comment} onChange={e => setComment(e.target.value)} />

          <div className={styles.formBtns}>
            <button className={styles.cancel} onClick={() => setShowRating(false)}>Annuler</button>
            <button className={`${styles.save} ${saved ? styles.saved : ""}`} onClick={handleSubmit} disabled={loading}>
              {loading ? "…" : saved ? "✓ Envoyé" : "Envoyer"}
            </button>
          </div>
        </div>
      )}

      {/* Publish toggle */}
      <div className={styles.publishRow}>
        <div>
          <div className={styles.publishLabel}>{isPublic ? "Trace publique" : "Trace privée"}</div>
          <div className={styles.publishHint}>{isPublic ? "Visible par tous dans la banque" : "Visible par vous seul"}</div>
        </div>
        <button className={`${styles.toggle} ${isPublic ? styles.toggleOn : ""}`} onClick={togglePublic} disabled={togglingPublic} aria-label="Public/privé">
          <span className={styles.knob} />
        </button>
      </div>

      {/* Delete */}
      {!confirmDelete ? (
        <button className={styles.deleteBtn} onClick={() => setConfirmDelete(true)}>Supprimer ce sentier</button>
      ) : (
        <div className={styles.confirmRow}>
          <span>Supprimer définitivement ?</span>
          <div className={styles.confirmBtns}>
            <button className={styles.confirmYes} onClick={onDelete}>Supprimer</button>
            <button className={styles.confirmNo} onClick={() => setConfirmDelete(false)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}
