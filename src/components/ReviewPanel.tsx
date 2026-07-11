"use client";
import { useEffect, useState } from "react";
import { Trail, SURFACE_FAMILIES, SurfaceKey, SurfaceBreakdown } from "@/types";
import { difficultyColor, scoreLabel } from "@/lib/difficulty";
import ElevationProfile from "./ElevationProfile";
import styles from "./ReviewPanel.module.css";

interface DifficultyReason { icon: string; label: string; detail: string; severity: "low"|"medium"|"high" }
interface SimilarTrail { id: string; name: string; distance: number; elevation: number; similarity: number; communityScore: number|null; reviewCount: number; globalScore: number|null }
interface Props { trail: Trail; onReviewSaved: () => void; onDelete: () => void; canManage?: boolean }

const SEV: Record<string, {bg:string;border:string;color:string}> = {
  high:   { bg:"var(--sev-high-bg)", border:"var(--sev-high-border)", color:"var(--sev-high-text)" },
  medium: { bg:"var(--sev-med-bg)",  border:"var(--sev-med-border)",  color:"var(--sev-med-text)" },
  low:    { bg:"var(--sev-low-bg)",  border:"var(--sev-low-border)",  color:"var(--sev-low-text)" },
};

export default function ReviewPanel({ trail, onReviewSaved, onDelete, canManage = true }: Props) {
  const props = (trail.geojson as any)?.properties ?? {};
  const reasons: DifficultyReason[] = props.reasons ?? [];
  const stats = props.stats ?? null;
  const autoScore: number|null = props.globalScore ?? null;
  const calculatedScore: number|null = props.calculatedScore ?? null;
  const autoBreakdown: SurfaceBreakdown = props.surfaceBreakdown ?? { route:0, sentier:0, rocheux:0, montagne:0 };
  const surfaceDetected: boolean = props.surfaceDetected !== false;
  const communityScore = trail.score?.global ?? null;
  const reviewCount = trail.score?.count ?? 0;
  const creatorDifficulty: number | null = (trail.difficulty ?? null) as number | null;
  const photos: string[] = (trail.photos ?? []) as string[];
  const description: string | null = (trail.description ?? null) as string | null;
  // Track the user's own saved difficulty so the score reflects it immediately
  const [myDifficulty, setMyDifficulty] = useState<number | null>(null);
  const [completed, setCompleted] = useState(!!trail.completed);
  const [togglingDone, setTogglingDone] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // My rating state — starts from the auto-detected breakdown
  const [pcts, setPcts] = useState<Record<SurfaceKey, number>>({
    route: autoBreakdown.route, sentier: autoBreakdown.sentier,
    rocheux: autoBreakdown.rocheux, montagne: autoBreakdown.montagne,
  });
  const [difficulty, setDifficulty] = useState(autoScore != null ? Math.round(autoScore) : 5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPublic, setIsPublic] = useState(!!trail.isPublic);
  const [togglingPublic, setTogglingPublic] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [similars, setSimilars] = useState<SimilarTrail[]>([]);

  // Score priority for THIS user's personal app:
  // 1. If you've rated this trail → YOUR difficulty is the score (with a small
  //    pull from the auto estimate so it's not 100% subjective).
  // 2. Otherwise → the auto-calculated score.
  let displayScore: number | null = autoScore;
  if (myDifficulty != null && autoScore != null) {
    displayScore = Math.round((myDifficulty * 0.75 + autoScore * 0.25) * 10) / 10;  // your rating leads
  } else if (myDifficulty != null) {
    displayScore = myDifficulty;
  } else if (creatorDifficulty != null && autoScore != null) {
    displayScore = Math.round((creatorDifficulty * 0.6 + autoScore * 0.4) * 10) / 10;  // creator's stated + auto
  } else if (creatorDifficulty != null) {
    displayScore = creatorDifficulty;
  } else if (autoScore == null && communityScore != null) {
    displayScore = communityScore;
  }
  const scoreColor = displayScore != null ? difficultyColor(displayScore) : "#8A8578";

  useEffect(() => {
    setSaved(false); setShowRating(false); setMyDifficulty(null);
    setIsPublic(!!trail.isPublic); setConfirmDelete(false);
    setCompleted(!!trail.completed);
    setPcts({ route: autoBreakdown.route, sentier: autoBreakdown.sentier, rocheux: autoBreakdown.rocheux, montagne: autoBreakdown.montagne });
    setDifficulty(autoScore != null ? Math.round(autoScore) : 5);
    setComment("");
    fetch(`/api/trails/${trail.id}/review`).then(r => r.json()).then(data => {
      if (data) {
        setPcts({ route: data.pctRoute, sentier: data.pctSentier, rocheux: data.pctRocheux, montagne: data.pctMontagne });
        setDifficulty(data.difficulty); setComment(data.comment ?? ""); setHasExisting(true);
        setMyDifficulty(data.difficulty);
      } else { setHasExisting(false); setMyDifficulty(null); }
    });
  }, [trail.id]);

  useEffect(() => {
    fetch(`/api/trails/similar?id=${trail.id}`).then(r => r.json()).then(d => setSimilars(Array.isArray(d) ? d : []));
  }, [trail.id]);

  const totalPct = pcts.route + pcts.sentier + pcts.rocheux + pcts.montagne;

  function setPct(key: SurfaceKey, val: number) {
    setPcts(p => ({ ...p, [key]: val }));
  }

  async function handleSubmit() {
    setLoading(true);
    await fetch(`/api/trails/${trail.id}/review`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pctRoute: pcts.route, pctSentier: pcts.sentier, pctRocheux: pcts.rocheux, pctMontagne: pcts.montagne, difficulty, comment }),
    });
    setLoading(false); setSaved(true); setHasExisting(true);
    setMyDifficulty(difficulty); // ring updates instantly
    setTimeout(() => setShowRating(false), 900);
    onReviewSaved();
  }

  async function toggleDone() {
    setTogglingDone(true);
    try {
      const res = await fetch(`/api/trails/${trail.id}/completion`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !completed }),
      });
      const data = await res.json();
      if (res.ok) setCompleted(data.completed);
    } finally { setTogglingDone(false); }
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

  const ringRadius = 32, ringCirc = 2 * Math.PI * ringRadius;
  const ringFill = displayScore != null ? (displayScore / 10) * ringCirc : 0;

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>{trail.name}</h2>

      {displayScore != null && (
        <div className={styles.scoreBlock}>
          <div className={styles.ring}>
            <svg width="84" height="84" viewBox="0 0 84 84">
              <circle cx="42" cy="42" r={ringRadius} fill="none" stroke="var(--line)" strokeWidth="6" />
              <circle cx="42" cy="42" r={ringRadius} fill="none" stroke={scoreColor} strokeWidth="6"
                strokeLinecap="round" strokeDasharray={ringCirc} strokeDashoffset={ringCirc - ringFill}
                transform="rotate(-90 42 42)" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
              <text x="42" y="40" textAnchor="middle" dominantBaseline="central"
                style={{ fontFamily:"Fraunces,serif", fontSize:"24px", fontWeight:600, fill:scoreColor }}>{displayScore}</text>
              <text x="42" y="56" textAnchor="middle" dominantBaseline="central"
                style={{ fontFamily:"Inter,sans-serif", fontSize:"9px", fill:"var(--stone)" }}>/ 10</text>
            </svg>
          </div>
          <div className={styles.scoreInfo}>
            <div className={styles.scoreLabel} style={{ color: scoreColor }}>{scoreLabel(displayScore)}</div>
            <div className={styles.scoreSource}>
              {reviewCount > 0 ? `Adapté à toi · base ${autoScore}` : "Calcul automatique"}
            </div>
          </div>
        </div>
      )}

      <div className={styles.statsRow}>
        <div className={styles.stat}><span className={styles.statVal}>{trail.distance}</span><span className={styles.statUnit}>km</span></div>
        <div className={styles.statDivider} />
        <div className={styles.stat}><span className={styles.statVal}>+{trail.elevation}</span><span className={styles.statUnit}>m D+</span></div>
        {stats?.elevLoss > 0 && <><div className={styles.statDivider} /><div className={styles.stat}><span className={styles.statVal}>-{stats.elevLoss}</span><span className={styles.statUnit}>m D-</span></div></>}
        {stats?.maxAlt > 0 && <><div className={styles.statDivider} /><div className={styles.stat}><span className={styles.statVal}>{stats.maxAlt}</span><span className={styles.statUnit}>m max</span></div></>}
      </div>

      {/* "I've done this hike" toggle */}
      <button className={`${styles.doneToggle} ${completed ? styles.doneOn : ""}`} onClick={toggleDone} disabled={togglingDone}>
        <span className={styles.doneCheck}>
          {completed && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </span>
        <span>{completed ? "Rando déjà faite" : "Marquer comme faite"}</span>
      </button>

      {/* Creator's stated difficulty (public bank) */}
      {creatorDifficulty != null && myDifficulty == null && (
        <div className={styles.creatorNote}>
          Difficulté annoncée par l'auteur : <strong style={{ color: difficultyColor(creatorDifficulty) }}>{scoreLabel(creatorDifficulty)}</strong>
        </div>
      )}

      {/* Description */}
      {description && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Description</div>
          <p className={styles.description}>{description}</p>
        </div>
      )}

      {/* Photo gallery */}
      {photos.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Photos</div>
          <div className={styles.gallery}>
            {photos.map((p, i) => (
              <button key={i} className={styles.galleryThumb} style={{ backgroundImage:`url(${p})` }}
                onClick={() => setLightbox(p)} aria-label={`Photo ${i+1}`} />
            ))}
          </div>
        </div>
      )}

      {/* Elevation profile — colored by local difficulty */}
      {(trail.geojson as any)?.properties?.elevations?.length > 1 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Profil altimétrique</div>
          <div className={styles.elevWrap}>
            <ElevationProfile geojson={trail.geojson} width={340} height={110} showAxis />
          </div>
          <div className={styles.elevLegend}>
            <span>Départ</span>
            <span className={styles.elevLegendMid}>couleur = difficulté du passage</span>
            <span>Arrivée</span>
          </div>
        </div>
      )}

      {/* Auto surface breakdown bar */}
      {!surfaceDetected && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Terrain détecté</div>
          <div className={styles.undetermined}>
            Données OpenStreetMap indisponibles pour cette zone. Réimporte la trace pour réessayer, ou indique le terrain toi-même ci-dessous.
          </div>
        </div>
      )}
      {surfaceDetected && (autoBreakdown.route + autoBreakdown.sentier + autoBreakdown.rocheux + autoBreakdown.montagne) > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Terrain détecté</div>
          <div className={styles.breakdownBar}>
            {SURFACE_FAMILIES.map(f => autoBreakdown[f.key] > 0 && (
              <div key={f.key} style={{ width: `${autoBreakdown[f.key]}%`, background: f.color }}
                className={styles.breakdownSeg} title={`${f.label} ${autoBreakdown[f.key]}%`} />
            ))}
          </div>
          <div className={styles.breakdownLegend}>
            {SURFACE_FAMILIES.map(f => autoBreakdown[f.key] > 0 && (
              <div key={f.key} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: f.color }} />
                <span className={styles.legendText}>{f.label.split(" ")[0]} {autoBreakdown[f.key]}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {reasons.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Analyse du terrain</div>
          {reasons.map((r, i) => {
            const s = SEV[r.severity];
            return (
              <div key={i} className={styles.reasonRow} style={{ background:s.bg, borderColor:s.border }}>
                <span className={styles.reasonIcon}>{r.icon}</span>
                <div className={styles.reasonText}>
                  <span className={styles.reasonLabel} style={{ color:s.color }}>{r.label}</span>
                  <span className={styles.reasonDetail}>{r.detail}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {similars.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Sentiers similaires</div>
          {similars.map(s => {
            const sc = s.communityScore ?? s.globalScore;
            const col = sc != null ? difficultyColor(sc) : "#B5B1A6";
            return (
              <div key={s.id} className={styles.similarRow}>
                <div className={styles.similarDot} style={{ background: col }}>{sc ?? "?"}</div>
                <div className={styles.similarInfo}>
                  <div className={styles.similarName}>{s.name}</div>
                  <div className={styles.similarMeta}>{s.distance} km · +{s.elevation} m</div>
                </div>
                <div className={styles.similarPct}>{s.similarity}%</div>
              </div>
            );
          })}
        </div>
      )}

      {/* RATING — surface percentages (only for your own traces) */}
      {canManage && (
      <div className={styles.section}>
        {!showRating ? (
          <button className={styles.rateBtn} onClick={() => setShowRating(true)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.6L5.7 21l2.3-7.4-6-4.6h7.6z" strokeLinejoin="round"/>
            </svg>
            {hasExisting ? "Modifier ma note" : "Noter ce sentier"}
          </button>
        ) : (
          <div className={styles.ratingForm}>
            <div className={styles.sectionTitle}>Quel terrain as-tu rencontré ?</div>
            <div className={styles.ratingIntro}>Indique ton ressenti en %. Mon estimation est affichée à côté.</div>

            {SURFACE_FAMILIES.map(f => (
              <div key={f.key} className={styles.surfaceRow}>
                <div className={styles.surfaceTop}>
                  <span className={styles.surfaceDot} style={{ background: f.color }} />
                  <div className={styles.surfaceLabels}>
                    <span className={styles.surfaceLabel}>{f.label}</span>
                    <span className={styles.surfaceHint}>{f.hint}</span>
                  </div>
                  <div className={styles.surfaceValues}>
                    <span className={styles.surfaceVal}>{pcts[f.key]}%</span>
                    <span className={styles.surfaceAuto}>moi : {autoBreakdown[f.key]}%</span>
                  </div>
                </div>
                <input type="range" min={0} max={100} step={5} value={pcts[f.key]}
                  className={styles.slider} style={{ accentColor: f.color }}
                  onChange={e => setPct(f.key, Number(e.target.value))} />
              </div>
            ))}

            <div className={`${styles.totalRow} ${totalPct !== 100 ? styles.totalWarn : ""}`}>
              Total : {totalPct}%{totalPct !== 100 ? ` (vise 100%)` : " ✓"}
            </div>

            {/* Overall difficulty */}
            <div className={styles.difficultyRow}>
              <div className={styles.surfaceTop}>
                <div className={styles.surfaceLabels}>
                  <span className={styles.surfaceLabel}>Difficulté ressentie</span>
                  <span className={styles.surfaceHint}>ta note globale sur 10</span>
                </div>
                <div className={styles.surfaceValues}>
                  <span className={styles.surfaceVal} style={{ color: difficultyColor(difficulty) }}>{difficulty}/10</span>
                  {autoScore != null && <span className={styles.surfaceAuto}>moi : {autoScore}</span>}
                </div>
              </div>
              <input type="range" min={1} max={10} value={difficulty}
                className={styles.slider} style={{ accentColor: difficultyColor(difficulty) }}
                onChange={e => setDifficulty(Number(e.target.value))} />
            </div>

            <textarea className={styles.comment} rows={2}
              placeholder="Un commentaire ? (conditions, passages délicats…)"
              value={comment} onChange={e => setComment(e.target.value)} />

            <div className={styles.ratingBtns}>
              <button className={styles.cancelRate} onClick={() => setShowRating(false)}>Annuler</button>
              <button className={`${styles.saveRate} ${saved ? styles.saved : ""}`} onClick={handleSubmit} disabled={loading}>
                {loading ? "…" : saved ? "✓ Envoyé" : "Envoyer"}
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {canManage && (
        <div className={styles.publishRow}>
          <div className={styles.publishInfo}>
            <span className={styles.publishLabel}>{isPublic ? "Trace publique" : "Trace privée"}</span>
            <span className={styles.publishHint}>
              {isPublic ? "Visible par tous dans la banque" : "Visible par toi seul"}
            </span>
          </div>
          <button
            className={`${styles.publishToggle} ${isPublic ? styles.publishOn : ""}`}
            onClick={togglePublic} disabled={togglingPublic}
            aria-label="Basculer public/privé">
            <span className={styles.publishKnob} />
          </button>
        </div>
      )}

      <div className={styles.footer}>
        {!canManage ? (
          <div className={styles.readOnlyNote}>Trace de la banque publique — lecture seule</div>
        ) : !confirmDelete ? (
          <button className={styles.deleteBtn} onClick={() => setConfirmDelete(true)}>Supprimer ce sentier</button>
        ) : (
          <div className={styles.confirmRow}>
            <span>Supprimer définitivement ?</span>
            <button className={styles.confirmYes} onClick={onDelete}>Supprimer</button>
            <button className={styles.confirmNo} onClick={() => setConfirmDelete(false)}>Annuler</button>
          </div>
        )}
      </div>

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className={styles.lightboxImg} />
          <button className={styles.lightboxClose} onClick={() => setLightbox(null)} aria-label="Fermer">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
