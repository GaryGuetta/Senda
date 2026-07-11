"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/components/AuthProvider";
import TrailActions from "@/components/TrailActions";
import CommentsSection from "@/components/CommentsSection";
import ElevationChart, { HoverInfo } from "@/components/ElevationChart";
import { difficultyColor, scoreLabel, trailDisplayScore, FAMILY_COLORS, FAMILY_LABELS, estimatedWalkTime } from "@/lib/difficulty";
import { Trail } from "@/types";
import styles from "./sentier.module.css";

const TrailMapView = dynamic(() => import("@/components/TrailMapView"), { ssr: false });

interface Reason { icon: string; label: string; detail: string; severity: "low"|"medium"|"high" }
interface Similar { id: string; name: string; distance: number; elevation: number; similarity: number; communityScore: number|null; globalScore: number|null }

export default function SentierPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const { user, loading: authLoading, requireLogin } = useAuth();
  const [trail, setTrail] = useState<Trail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [similars, setSimilars] = useState<Similar[]>([]);
  const [completed, setCompleted] = useState(false);
  const [togglingDone, setTogglingDone] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  function load() {
    fetch(`/api/trails/${id}`).then(r => {
      if (!r.ok) { setNotFound(true); setLoading(false); return null; }
      return r.json();
    }).then(d => {
      if (d && !d.error) { setTrail(d); setCompleted(!!d.completed); }
      else if (d?.error) setNotFound(true);
      setLoading(false);
    }).catch(() => { setNotFound(true); setLoading(false); });
  }
  useEffect(() => { if (id && user) load(); }, [id, user]);
  useEffect(() => {
    if (id && user) fetch(`/api/trails/similar?id=${id}`).then(r => r.json()).then(d => setSimilars(Array.isArray(d) ? d : [])).catch(() => {});
  }, [id, user]);

  const isOwner = !!(trail && (trail as any).isOwner);

  async function deleteTrail() {
    await fetch(`/api/trails/${id}`, { method: "DELETE" });
    router.push("/mes-traces");
  }

  async function toggleDone() {
    if (!user) return;
    setTogglingDone(true);
    try {
      const res = await fetch(`/api/trails/${id}/completion`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !completed }),
      });
      const data = await res.json();
      if (res.ok) setCompleted(data.completed);
    } finally { setTogglingDone(false); }
  }

  // Wait for auth to resolve
  if (authLoading) return <div className={styles.state}>Chargement…</div>;

  // Detail is reserved for members — invite non-logged-in visitors to sign up
  if (!user) {
    return (
      <div className={styles.gateWrap}>
        <div className={`${styles.gate} anim-in`}>
          <div className={styles.gateIcon}>
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 12h12" strokeLinecap="round"/><rect x="15" y="4" width="6" height="16" rx="2"/></svg>
          </div>
          <h1 className={styles.gateTitle}>Ce sentier vous intéresse ?</h1>
          <p className={styles.gateText}>
            Créez un compte gratuit pour accéder au détail complet : carte interactive, profil altimétrique, terrain analysé, difficulté personnalisée selon votre ressenti, et téléchargement GPX.
          </p>
          <div className={styles.gateBtns}>
            <button className={styles.gatePrimary} onClick={() => requireLogin()}>Créer un compte gratuit</button>
            <button className={styles.gateSecondary} onClick={() => requireLogin()}>J'ai déjà un compte</button>
          </div>
          <button className={styles.gateBack} onClick={() => router.back()}>← Retour à la découverte</button>
        </div>
      </div>
    );
  }

  if (loading) return <div className={styles.state}>Chargement…</div>;
  if (notFound || !trail) return (
    <div className={styles.state}>
      <p>Ce sentier n'existe pas ou n'est plus disponible.</p>
      <button className={styles.backLink} onClick={() => router.push("/explorer")}>← Retour à l'explorateur</button>
    </div>
  );

  const props = (trail.geojson as any)?.properties ?? {};
  const stats = props.stats ?? {};
  const reasons: Reason[] = props.reasons ?? [];
  const breakdown = props.surfaceBreakdown ?? { route:0, sentier:0, rocheux:0, montagne:0 };
  const surfaceDetected: boolean = props.surfaceDetected !== false;
  const hasBreakdown = (breakdown.route + breakdown.sentier + breakdown.rocheux + breakdown.montagne) > 0;
  const photos: string[] = (trail.photos ?? []) as string[];
  const description = trail.description;
  const author = (trail as any).author as string | undefined;
  const hasElev = props.elevations?.length > 1;

  // Length-weighted average absolute slope, computed from the track itself
  function computeAvgSlope(): number | null {
    const coords: any[] = (trail!.geojson as any)?.geometry?.coordinates ?? [];
    const eles: number[] = props.elevations ?? [];
    const n = Math.min(coords.length, eles.length);
    if (n < 2) return null;
    let slopeSum = 0, distSum = 0;
    for (let i = 1; i < n; i++) {
      const [lng1, lat1] = coords[i-1], [lng2, lat2] = coords[i];
      const R = 6371000;
      const dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
      const s = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
      const d = 2 * R * Math.asin(Math.sqrt(s));
      if (d < 1) continue;
      const slope = Math.abs((eles[i]-eles[i-1]) / d) * 100;
      slopeSum += Math.min(slope, 60) * d; distSum += d;
    }
    return distSum > 0 ? Math.round(slopeSum / distSum) : null;
  }
  const avgSlope = computeAvgSlope();

  const score = trailDisplayScore(trail);
  const scoreColor = score != null ? difficultyColor(score) : "var(--stone)";
  const ringCirc = 2 * Math.PI * 34;

  const SEV: Record<string, string> = { high: "var(--sev-high-text)", medium: "var(--sev-med-text)", low: "var(--sev-low-text)" };
  const SEVBG: Record<string, string> = { high: "var(--sev-high-bg)", medium: "var(--sev-med-bg)", low: "var(--sev-low-bg)" };

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => router.back()}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Retour
      </button>

      {/* HERO */}
      <header className={`${styles.hero} anim-in`}>
        <div className={styles.heroLeft}>
          <div className={styles.eyebrow}>{trail.isPublic ? `Partagé par ${author ?? "un randonneur"}` : "Votre trace privée"}</div>
          <h1 className={styles.title}>{trail.name}</h1>
          <div className={styles.heroMeta}>
            <span className={styles.diffPill} style={{ background: scoreColor }}>{score != null ? scoreLabel(score) : "Non évalué"}</span>
            {completed && <span className={styles.doneBadge}>✓ Déjà faite</span>}
          </div>
        </div>
        {score != null && (
          <div className={styles.ring}>
            <svg width="66" height="66" viewBox="0 0 88 88">
              <circle cx="44" cy="44" r="34" fill="none" stroke="var(--line)" strokeWidth="7" />
              <circle cx="44" cy="44" r="34" fill="none" stroke={scoreColor} strokeWidth="7" strokeLinecap="round"
                strokeDasharray={ringCirc} strokeDashoffset={ringCirc - (score/10)*ringCirc}
                transform="rotate(-90 44 44)" style={{ transition: "stroke-dashoffset 0.8s ease" }} />
              <text x="44" y="42" textAnchor="middle" dominantBaseline="central" style={{ fontFamily:"Fraunces,serif", fontSize:"26px", fontWeight:600, fill:scoreColor }}>{score}</text>
              <text x="44" y="59" textAnchor="middle" dominantBaseline="central" style={{ fontFamily:"Inter,sans-serif", fontSize:"9px", fill:"var(--stone)" }}>/ 10</text>
            </svg>
          </div>
        )}
      </header>

      {/* STAT PILLS */}
      <div className={`${styles.statBar} anim-in`}>
        <div className={styles.stat}><span className={styles.statVal}>{estimatedWalkTime(trail.distance, trail.elevation)}</span><span className={styles.statLabel}>durée estimée</span></div>
        <div className={styles.stat}><span className={styles.statVal}>{trail.distance}</span><span className={styles.statLabel}>km</span></div>
        <div className={styles.stat}><span className={styles.statVal}>+{trail.elevation}</span><span className={styles.statLabel}>m dénivelé</span></div>
        {stats.elevLoss > 0 && <div className={styles.stat}><span className={styles.statVal}>−{stats.elevLoss}</span><span className={styles.statLabel}>m descente</span></div>}
        {stats.maxAlt > 0 && <div className={styles.stat}><span className={styles.statVal}>{stats.maxAlt}</span><span className={styles.statLabel}>m altitude</span></div>}
        {avgSlope != null && avgSlope > 0 && <div className={styles.stat}><span className={styles.statVal}>{avgSlope}%</span><span className={styles.statLabel}>pente moy.</span></div>}
      </div>

      {/* MAIN — two columns that fill the page */}
      <div className={styles.grid}>
        <div className={styles.main}>
          {user && (
            <button className={`${styles.doneToggle} ${completed ? styles.doneOn : ""}`} onClick={toggleDone} disabled={togglingDone}>
              <span className={styles.doneCheck}>{completed && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>}</span>
              {completed ? "Rando faite — cliquez pour retirer" : "Marquer cette rando comme faite"}
            </button>
          )}

          <section className={`${styles.mapWrap} anim-in`}>
            <TrailMapView trail={trail} height="440px" hover={hover ? [hover.lat, hover.lng] : null} />
          </section>

          {hasElev && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Profil altimétrique</h2>
              <div className={styles.elevWrap}>
                <ElevationChart geojson={trail.geojson} height={180} onHover={setHover} />
              </div>
              <div className={styles.elevLegend}>
                <span className={styles.legDot} style={{ background:"rgb(0,180,40)" }} /> Facile
                <span className={styles.legSpace} />
                <span className={styles.legDot} style={{ background:"rgb(230,140,0)" }} /> Soutenu
                <span className={styles.legSpace} />
                <span className={styles.legDot} style={{ background:"rgb(230,30,20)" }} /> Difficile
                <span style={{ marginLeft:"auto" }}>couleur = difficulté du passage</span>
              </div>
            </section>
          )}

          {description && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Description</h2>
              <p className={styles.desc}>{description}</p>
            </section>
          )}

          {photos.length > 0 && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Photos</h2>
              <div className={styles.gallery}>
                {photos.map((p, i) => (
                  <button key={i} className={styles.galleryThumb} style={{ backgroundImage:`url(${p})` }} onClick={() => setLightbox(p)} aria-label={`Photo ${i+1}`} />
                ))}
              </div>
            </section>
          )}

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Terrain</h2>
            {surfaceDetected && hasBreakdown ? (
              <>
                <div className={styles.terrainBar}>
                  {(["route","sentier","rocheux","montagne"] as const).map(k => breakdown[k] > 0 && (
                    <div key={k} style={{ width:`${breakdown[k]}%`, background: FAMILY_COLORS[k] }} title={`${FAMILY_LABELS[k]} ${breakdown[k]}%`} />
                  ))}
                </div>
                <div className={styles.terrainLegend}>
                  {(["route","sentier","rocheux","montagne"] as const).map(k => breakdown[k] > 0 && (
                    <div key={k} className={styles.terrainItem}>
                      <span className={styles.legDot} style={{ background: FAMILY_COLORS[k] }} />
                      <span>{FAMILY_LABELS[k]} <strong>{breakdown[k]}%</strong></span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className={styles.muted}>Terrain non déterminé pour ce secteur (données OpenStreetMap indisponibles).</p>
            )}
          </section>

          {reasons.length > 0 && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Analyse du terrain</h2>
              <div className={styles.reasonGrid}>
                {reasons.map((r, i) => (
                  <div key={i} className={styles.reason} style={{ background: SEVBG[r.severity] }}>
                    <span className={styles.reasonIcon}>{r.icon}</span>
                    <div>
                      <div className={styles.reasonLabel} style={{ color: SEV[r.severity] }}>{r.label}</div>
                      <div className={styles.reasonDetail}>{r.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={styles.card}>
            <CommentsSection targetType="trail" targetId={id} placeholder="Racontez votre sortie, l'état du sentier, un conseil…" />
          </section>
        </div>

        <aside className={styles.side}>
          <div className={styles.factsCard}>
            <a className={styles.gpxBtn} href={`/api/trails/${id}/gpx`} download>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Télécharger le GPX
            </a>
            <button className={styles.planLink} onClick={() => router.push(`/refuges?trail=${id}`)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 20l-5.5-3V4L9 7m0 13l6-3m-6 3V7m6 10l5.5 3V7L15 4m0 13V4m0 0L9 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Planifier l'itinéraire
            </button>
            {((trail as any).completionCount ?? 0) > 0 && (
              <div className={styles.socialProof}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {(trail as any).completionCount} randonneur{(trail as any).completionCount > 1 ? "s l'ont" : " l'a"} faite
              </div>
            )}
          </div>

          {isOwner && <TrailActions trail={trail} onSaved={load} onDelete={deleteTrail} />}

          {similars.length > 0 && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Sentiers similaires</h2>
              <div className={styles.similarList}>
                {similars.slice(0, 3).map(s => {
                  const sc = s.communityScore ?? s.globalScore;
                  const col = sc != null ? difficultyColor(sc) : "var(--stone-light)";
                  return (
                    <button key={s.id} className={styles.similarRow} onClick={() => router.push(`/sentier/${s.id}`)}>
                      <span className={styles.similarScore} style={{ background: col }}>{sc ?? "?"}</span>
                      <div className={styles.similarInfo}>
                        <div className={styles.similarName}>{s.name}</div>
                        <div className={styles.similarMeta}>{s.distance} km · +{s.elevation} m</div>
                      </div>
                      <span className={styles.similarPct}>{s.similarity}%</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </aside>
      </div>

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className={styles.lightboxImg} />
          <button className={styles.lightboxClose} onClick={() => setLightbox(null)} aria-label="Fermer"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg></button>
        </div>
      )}
    </div>
  );
}
