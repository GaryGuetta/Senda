"use client";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { Trail } from "@/types";
import ReviewPanel from "./ReviewPanel";
import GpxImport from "./GpxImport";
import ModelInsight from "./ModelInsight";
import { useAuth } from "./AuthGate";
import styles from "./TrailMap.module.css";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export function difficultyColor(score: number): string {
  const t = Math.max(0, Math.min(1, score / 10));
  // High-contrast, fully saturated difficulty ramp
  // Pure green → lime → yellow → orange → red → dark crimson
  const stops = [
    {t:0.00,r:0,   g:180, b:40 },  // vivid green (très facile)
    {t:0.18,r:120, g:200, b:0  },  // lime
    {t:0.36,r:210, g:215, b:0  },  // bright yellow
    {t:0.52,r:255, g:165, b:0  },  // strong orange
    {t:0.68,r:255, g:95,  b:0  },  // vivid orange-red
    {t:0.84,r:230, g:30,  b:20 },  // pure red
    {t:1.00,r:150, g:0,   b:10 },  // dark crimson (très difficile)
  ];
  let lo = 0;
  while (lo < stops.length-2 && t > stops[lo+1].t) lo++;
  const a = stops[lo], b = stops[lo+1];
  const u = (t-a.t)/((b.t-a.t)||1), e = u*u*(3-2*u);
  return `rgb(${Math.round(a.r+(b.r-a.r)*e)},${Math.round(a.g+(b.g-a.g)*e)},${Math.round(a.b+(b.b-a.b)*e)})`;
}

export function scoreLabel(s: number) {
  if (s <= 2) return "Très facile";
  if (s <= 4) return "Facile";
  if (s <= 6) return "Modéré";
  if (s <= 8) return "Difficile";
  return "Très difficile";
}

export function trailDisplayScore(trail: Trail): number | null {
  const props = (trail.geojson as any)?.properties ?? {};
  const autoScore: number | null = props.globalScore ?? null;
  const communityScore = trail.score?.global ?? null;
  const reviewCount = trail.score?.count ?? 0;
  if (autoScore != null && communityScore != null && reviewCount > 0) {
    const blend = Math.min(0.35, reviewCount / 15);
    return Math.round((autoScore * (1 - blend) + communityScore * blend) * 10) / 10;
  }
  if (autoScore != null) return autoScore;
  if (communityScore != null) return communityScore;
  return null;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function gaussianSmooth(arr: number[], radius: number): number[] {
  return arr.map((_, i) => {
    let sum = 0, w = 0;
    for (let j = Math.max(0,i-radius); j <= Math.min(arr.length-1,i+radius); j++) {
      const weight = Math.exp(-((j-i)**2)/(2*(radius/2.5)**2));
      sum += arr[j]*weight; w += weight;
    }
    return sum/w;
  });
}

function buildSegmentScores(trail: Trail): number[] | null {
  const props = (trail.geojson as any)?.properties;
  const coords: any[] = (trail.geojson as any)?.geometry?.coordinates ?? [];
  if (coords.length < 2) return null;
  const n = coords.length - 1;
  if (props?.segmentScores?.length >= 2) {
    const stored: number[] = props.segmentScores;
    return Array.from({ length: n }, (_, i) => {
      const idx = Math.round(i * (stored.length-1) / Math.max(n-1,1));
      return stored[Math.min(idx, stored.length-1)];
    });
  }
  return null;
}

function FlyTo({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (center) map.flyTo(center, 14, { duration: 0.8 }); }, [center, map]);
  return null;
}

function makeBadge(score: number | null) {
  const color = difficultyColor(score ?? 5);
  const label = score !== null ? `${score}` : "?";
  return L.divIcon({
    html: `<div style="background:${color};color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.25);font-family:Inter,sans-serif;">${label}</div>`,
    className: "", iconAnchor: [17, 17],
  });
}

function SmoothTrail({ trail, onClick, dimmed }: { trail: Trail; onClick: () => void; dimmed: boolean }) {
  const coords: any[] = (trail.geojson as any).geometry.coordinates;
  if (coords.length < 2) return null;
  const pts: [number, number][] = coords.map(([lng, lat]: any) => [lat, lng]);
  const n = pts.length - 1;
  const segScores = buildSegmentScores(trail);
  const globalScore = trailDisplayScore(trail) ?? 5;
  const raw = segScores ?? Array.from({ length: n }, () => globalScore);
  const smooth = raw.map((_, i) => {
    const r = 2; let s = 0, w = 0;
    for (let j = Math.max(0,i-r); j<=Math.min(n-1,i+r); j++) { const wt = 1-Math.abs(j-i)/(r+1); s += raw[j]*wt; w += wt; }
    return s/w;
  });
  const opacity = dimmed ? 0.4 : 1;
  return (
    <>
      {/* Dark outline for maximum contrast against the map */}
      {smooth.map((s, i) => (
        <Polyline key={`sh-${trail.id}-${i}`} positions={[pts[i], pts[i+1]]}
          pathOptions={{ color:"rgba(20,20,20,0.55)", weight:s*0.5+10, opacity:opacity, lineCap:"round", lineJoin:"round" }}
          eventHandlers={{ click: onClick }} />
      ))}
      {/* Fully saturated color core */}
      {smooth.map((s, i) => (
        <Polyline key={`co-${trail.id}-${i}`} positions={[pts[i], pts[i+1]]}
          pathOptions={{ color:difficultyColor(s), weight:s*0.5+6.5, opacity, lineCap:"round", lineJoin:"round" }}
          eventHandlers={{ click: onClick }} />
      ))}
    </>
  );
}

const MERENS: [number, number] = [42.6473, 1.8387];

export default function TrailMap() {
  const { user, logout } = useAuth();
  const [trails, setTrails] = useState<Trail[]>([]);
  const [view, setView] = useState<"mine" | "public">("mine");
  const [reviewVersion, setReviewVersion] = useState(0);
  const [selected, setSelected] = useState<Trail | null>(null);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(true);

  async function fetchTrails() {
    try {
      const endpoint = view === "public" ? "/api/trails/public" : "/api/trails";
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const data: Trail[] = await res.json();
      setTrails(data);
      if (selected) { const u = data.find(t => t.id === selected.id); if (u) setSelected(u); }
      setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Reload whenever the view (mine/public) changes
  useEffect(() => { setLoading(true); setSelected(null); fetchTrails(); }, [view]);

  function selectTrail(trail: Trail) {
    setSelected(trail);
    const c = trail.center as { lat:number; lng:number };
    setFlyTarget([c.lat, c.lng]);
  }

  async function deleteTrail(id: string) {
    await fetch(`/api/trails/${id}`, { method: "DELETE" });
    setSelected(null); fetchTrails();
  }

  return (
    <div className={styles.app}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <svg className={styles.logo} viewBox="0 0 24 24" fill="none">
            <path d="M3 20L9 8l4 7 2-3 6 8z" fill="currentColor" opacity="0.9"/>
            <circle cx="17" cy="6" r="2.5" fill="currentColor"/>
          </svg>
          <span className={styles.brandName}>TrailRate</span>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.userChip}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" strokeLinecap="round"/>
            </svg>
            <span className={styles.userName}>{user?.username}</span>
            <button className={styles.logoutBtn} onClick={logout} title="Se déconnecter">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          <button className={styles.importBtn} onClick={() => setShowImport(true)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
            </svg>
            Ajouter un GPX
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          {!selected && (
            <div className={styles.viewSwitch}>
              <button
                className={`${styles.viewTab} ${view === "mine" ? styles.viewTabActive : ""}`}
                onClick={() => setView("mine")}>
                Mes traces
              </button>
              <button
                className={`${styles.viewTab} ${view === "public" ? styles.viewTabActive : ""}`}
                onClick={() => setView("public")}>
                Banque publique
              </button>
            </div>
          )}
          {loading ? (
            <div className={styles.loadingState}>Chargement…</div>
          ) : error ? (
            <div className={styles.errorState}>
              <strong>Connexion impossible</strong>
              <span>{error}</span>
            </div>
          ) : trails.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIllus}>
                <svg viewBox="0 0 48 48" fill="none">
                  <path d="M6 40L18 16l8 14 4-6 12 16z" fill="var(--sage)" opacity="0.25"/>
                  <path d="M6 40L18 16l8 14" stroke="var(--sage)" strokeWidth="1.5" fill="none"/>
                </svg>
              </div>
              <div className={styles.emptyTitle}>{view === "public" ? "Banque vide" : "Aucun sentier"}</div>
              <div className={styles.emptyText}>
                {view === "public"
                  ? "Aucune trace publique pour le moment. Publie une de tes traces pour la partager ici."
                  : "Importez un fichier GPX pour voir sa difficulté analysée segment par segment."}
              </div>
              {view === "mine" && <button className={styles.emptyBtn} onClick={() => setShowImport(true)}>Importer un GPX</button>}
            </div>
          ) : !selected ? (
            <>
              <div className={styles.listHeader}>
                <span className={styles.listTitle}>
                  {trails.length} sentier{trails.length > 1 ? "s" : ""}
                  {view === "public" ? " · partagés par la communauté" : ""}
                </span>
              </div>
              <div className={styles.trailList}>
                {trails.map(t => {
                  const score = trailDisplayScore(t);
                  const color = difficultyColor(score ?? 5);
                  return (
                    <button key={t.id} className={styles.trailCard} onClick={() => selectTrail(t)}>
                      <div className={styles.cardScore} style={{ background: color }}>
                        {score ?? "?"}
                      </div>
                      <div className={styles.cardInfo}>
                        <div className={styles.cardNameRow}>
                          <span className={styles.cardName}>{t.name}</span>
                          {view === "mine" && t.isPublic && (
                            <span className={styles.publicBadge} title="Visible dans la banque publique">public</span>
                          )}
                        </div>
                        <div className={styles.cardMeta}>
                          {view === "public" && t.author ? <span className={styles.cardAuthor}>{t.author} · </span> : null}
                          {t.distance} km · +{t.elevation} m
                          {t.score?.count ? <span className={styles.cardReviews}> · {t.score.count} avis</span> : null}
                        </div>
                      </div>
                      <svg className={styles.cardArrow} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  );
                })}
              </div>
              {view === "mine" && <ModelInsight refreshKey={reviewVersion} />}
            </>
          ) : (
            <>
              <button className={styles.backBtn} onClick={() => setSelected(null)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Tous les sentiers
              </button>
              <ReviewPanel trail={selected} canManage={view === "mine"} onReviewSaved={() => { fetchTrails(); setReviewVersion(v => v + 1); }} onDelete={() => deleteTrail(selected.id)} />
            </>
          )}
        </aside>

        {/* Map */}
        <main className={styles.mapWrap}>
          <MapContainer center={MERENS} zoom={13} style={{ width:"100%", height:"100%" }} zoomControl={false}>
            <TileLayer
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
              attribution='© OpenTopoMap'
              maxZoom={17}
            />
            <FlyTo center={flyTarget} />
            {trails.map(trail => (
              <SmoothTrail key={trail.id} trail={trail} onClick={() => selectTrail(trail)}
                dimmed={selected != null && selected.id !== trail.id} />
            ))}
            {trails.map(trail => {
              const center = trail.center as { lat:number; lng:number };
              const score = trailDisplayScore(trail);
              const isDim = selected != null && selected.id !== trail.id;
              return (
                <Marker key={`m-${trail.id}`} position={[center.lat, center.lng]}
                  icon={makeBadge(score)} opacity={isDim ? 0.5 : 1}
                  eventHandlers={{ click: () => selectTrail(trail) }}>
                  <Popup>
                    <div style={{ fontFamily:"Inter,sans-serif", minWidth:170, textAlign:"center" }}>
                      <div style={{ fontFamily:"Fraunces,serif", fontWeight:600, fontSize:15, marginBottom:8, color:"#1C2B21" }}>{trail.name}</div>
                      {score != null && (
                        <div style={{ fontSize:28, fontWeight:600, color:difficultyColor(score), lineHeight:1 }}>{score}<span style={{fontSize:14,opacity:0.5}}>/10</span></div>
                      )}
                      <div style={{ fontSize:12, color:difficultyColor(score??5), fontWeight:500, marginTop:2 }}>{score != null ? scoreLabel(score) : ""}</div>
                      <div style={{ fontSize:11, color:"#8A8578", marginTop:6 }}>{trail.distance} km · +{trail.elevation} m</div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

          {/* Floating legend */}
          <div className={styles.legend}>
            <span className={styles.legendLabel}>Facile</span>
            <div className={styles.legendBar}>
              {Array.from({ length: 40 }, (_, i) => (
                <div key={i} style={{ flex:1, background:difficultyColor(i/39*10) }} />
              ))}
            </div>
            <span className={styles.legendLabel}>Difficile</span>
          </div>
        </main>
      </div>

      {showImport && (
        <GpxImport onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); fetchTrails(); }} />
      )}
    </div>
  );
}
