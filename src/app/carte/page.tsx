"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { LatLngBounds } from "leaflet";
import { useAuth } from "@/components/AuthProvider";
import { difficultyColor, scoreLabel, trailDisplayScore } from "@/lib/difficulty";
import DualRange from "@/components/DualRange";
import { Trail } from "@/types";
import styles from "./carte.module.css";

const ExploreMap = dynamic(() => import("@/components/ExploreMap"), { ssr: false });

function startInBounds(t: any, b: LatLngBounds): boolean {
  const first = t?.geojson?.geometry?.coordinates?.[0];
  const c = t.center as { lat: number; lng: number };
  const lat = first ? first[1] : c?.lat;
  const lng = first ? first[0] : c?.lng;
  if (lat == null || lng == null) return false;
  return b.contains([lat, lng]);
}

type Box = { south: number; north: number; west: number; east: number; name?: string };
function startInBox(t: any, box: Box): boolean {
  const first = t?.geojson?.geometry?.coordinates?.[0];
  const c = t.center as { lat: number; lng: number };
  const lat = first ? first[1] : c?.lat;
  const lng = first ? first[0] : c?.lng;
  if (lat == null || lng == null) return false;
  return lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east;
}

export default function CartePage() {
  const router = useRouter();
  const { user, requireLogin } = useAuth();
  const [view, setView] = useState<"public" | "mine">("public");
  const [trails, setTrails] = useState<Trail[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Filters
  const [diffFilter, setDiffFilter] = useState<string | null>(null); // facile|modere|difficile|tres
  const [distRange, setDistRange] = useState<[number, number]>([0, 100]);
  const [dplusRange, setDplusRange] = useState<[number, number]>([0, 3000]);
  const [liveBounds, setLiveBounds] = useState<LatLngBounds | null>(null);
  const [areaFilter, setAreaFilter] = useState<LatLngBounds | null>(null);
  const [moved, setMoved] = useState(false);
  // City search
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number; bbox?: { south: number; north: number; west: number; east: number } | null } | null>(null);
  const [cityBox, setCityBox] = useState<Box | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);

  async function goToPlace() {
    const term = query.trim();
    if (term.length < 2) return;
    setGeoLoading(true); setGeoMsg(null);
    try {
      const d = await fetch(`/api/geocode?q=${encodeURIComponent(term)}`).then(r => r.json());
      if (d?.found) {
        setFlyTo({ lat: d.lat, lng: d.lng, zoom: 13, bbox: d.bbox ?? null });
        const m = 0.11; // ~12 km margin so nearby trails show too
        const box: Box = d.bbox
          ? { south: d.bbox.south - m, north: d.bbox.north + m, west: d.bbox.west - m, east: d.bbox.east + m, name: term }
          : { south: d.lat - m, north: d.lat + m, west: d.lon - m, east: d.lon + m, name: term };
        setCityBox(box);
        setAreaFilter(null); setMoved(false);
        setQuery(""); // switch from name-filter to area view
      } else {
        setGeoMsg(`« ${term} » introuvable`);
      }
    } catch {
      setGeoMsg("Recherche indisponible");
    } finally { setGeoLoading(false); }
  }

  useEffect(() => {
    setLoading(true); setAreaFilter(null); setMoved(false);
    const endpoint = view === "mine" ? "/api/trails" : "/api/trails/public";
    fetch(endpoint).then(r => r.json()).then(d => {
      setTrails(Array.isArray(d) ? d : []); setLoading(false);
    }).catch(() => setLoading(false));
  }, [view]);

  // Max distance / D+ across the loaded set (for slider bounds)
  const bounds = useMemo(() => {
    let maxDist = 10, maxDplus = 500;
    for (const t of trails) {
      if (t.distance > maxDist) maxDist = t.distance;
      if (t.elevation > maxDplus) maxDplus = t.elevation;
    }
    return { maxDist: Math.ceil(maxDist / 5) * 5, maxDplus: Math.ceil(maxDplus / 100) * 100 };
  }, [trails]);

  // Reset ranges to full span whenever the data (view) changes
  useEffect(() => {
    setDistRange([0, bounds.maxDist]);
    setDplusRange([0, bounds.maxDplus]);
    setDiffFilter(null);
  }, [bounds.maxDist, bounds.maxDplus]);

  function diffBucket(score: number | null): string | null {
    if (score == null) return null;
    if (score <= 4) return "facile";
    if (score <= 6) return "modere";
    if (score <= 8) return "difficile";
    return "tres";
  }

  const filtersActive = diffFilter !== null || distRange[0] > 0 || distRange[1] < bounds.maxDist || dplusRange[0] > 0 || dplusRange[1] < bounds.maxDplus;
  function resetFilters() {
    setDiffFilter(null); setDistRange([0, bounds.maxDist]); setDplusRange([0, bounds.maxDplus]);
  }

  function switchTo(v: "public" | "mine") {
    if (v === "mine" && !user) { requireLogin(); return; }
    setView(v);
  }

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => trails.filter(t => {
    if (q && !t.name.toLowerCase().includes(q)) return false;
    if (t.distance < distRange[0] || t.distance > distRange[1]) return false;
    if (t.elevation < dplusRange[0] || t.elevation > dplusRange[1]) return false;
    if (diffFilter && diffBucket(trailDisplayScore(t)) !== diffFilter) return false;
    if (cityBox && !startInBox(t, cityBox)) return false;
    if (areaFilter && !startInBounds(t, areaFilter)) return false;
    return true;
  }), [trails, q, distRange, dplusRange, diffFilter, cityBox, areaFilter]);

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <div className={styles.switch}>
          <button className={`${styles.tab} ${view === "public" ? styles.tabActive : ""}`} onClick={() => switchTo("public")}>Banque publique</button>
          <button className={`${styles.tab} ${view === "mine" ? styles.tabActive : ""}`} onClick={() => switchTo("mine")}>Mes traces</button>
        </div>
        <form className={styles.searchWrap} onSubmit={e => { e.preventDefault(); goToPlace(); }}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" strokeLinecap="round"/></svg>
          <input className={styles.search} value={query} onChange={e => { setQuery(e.target.value); setGeoMsg(null); }} placeholder="Sentier par nom, ou ville (Entrée)…" />
          {geoLoading && <span className={styles.searchSpin} />}
          {query && !geoLoading && <button type="button" className={styles.searchClear} onClick={() => setQuery("")} aria-label="Effacer"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg></button>}
        </form>
      </div>

      <div className={styles.split}>
        {/* Sidebar list — synced with the map */}
        <aside className={styles.sidebar}>
          <div className={styles.filters}>
            <div className={styles.filterRow}>
              {[["facile","Facile"],["modere","Modéré"],["difficile","Difficile"],["tres","Très diff."]].map(([k, lbl]) => (
                <button key={k}
                  className={`${styles.diffPill} ${diffFilter === k ? styles.diffPillActive : ""}`}
                  onClick={() => setDiffFilter(diffFilter === k ? null : k)}>{lbl}</button>
              ))}
            </div>
            <DualRange label="Distance" unit="km" min={0} max={bounds.maxDist} step={1}
              low={distRange[0]} high={distRange[1]} onChange={(l, h) => setDistRange([l, h])} />
            <DualRange label="Dénivelé +" unit="m" min={0} max={bounds.maxDplus} step={50}
              low={dplusRange[0]} high={dplusRange[1]} onChange={(l, h) => setDplusRange([l, h])} />
            {filtersActive && <button className={styles.resetFilters} onClick={resetFilters}>Réinitialiser les filtres</button>}
          </div>
          <div className={styles.listHead}>
            {loading ? "Chargement…" : `${shown.length} sentier${shown.length > 1 ? "s" : ""}`}
            {cityBox?.name && <span className={styles.cityTag}>· autour de {cityBox.name}</span>}
            {(areaFilter || cityBox) && <button className={styles.clearArea} onClick={() => { setAreaFilter(null); setCityBox(null); setFlyTo(null); setMoved(false); }}>voir tout</button>}
          </div>
          {geoMsg && <div className={styles.geoMsg}>{geoMsg}</div>}
          {!loading && shown.length === 0 && (
            <div className={styles.emptyList}>
              {q ? `Aucun sentier ne correspond à « ${query} ».`
                 : view === "mine" ? "Aucune trace importée." : "La banque publique est encore vide."}
            </div>
          )}
          <div className={styles.list}>
            {shown.map(t => {
              const score = trailDisplayScore(t);
              const col = score != null ? difficultyColor(score) : "var(--stone-light)";
              return (
                <button key={t.id}
                  className={`${styles.item} ${hoveredId === t.id ? styles.itemHover : ""}`}
                  onMouseEnter={() => setHoveredId(t.id)} onMouseLeave={() => setHoveredId(null)}
                  onClick={() => router.push(`/sentier/${t.id}`)}>
                  <span className={styles.itemScore} style={{ background: col }}>{score ?? "?"}</span>
                  <span className={styles.itemInfo}>
                    <span className={styles.itemName}>{t.name}</span>
                    <span className={styles.itemMeta}>
                      {t.distance} km · +{t.elevation} m
                      {(t as any).completed && <span className={styles.itemDone}> · ✓ faite</span>}
                    </span>
                    <span className={styles.itemDiff} style={{ color: col }}>{score != null ? scoreLabel(score) : "Non évalué"}</span>
                  </span>
                  <svg className={styles.itemArrow} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Map */}
        <div className={styles.mapArea}>
          <ExploreMap
            trails={shown}
            variant={view === "public" ? "markers" : "lines"}
            hoveredId={hoveredId}
            onHoverTrail={setHoveredId}
            onBoundsChange={(b) => { setLiveBounds(b); setMoved(true); }}
            autoFit={!areaFilter && !cityBox}
            flyTo={flyTo}
          />
          {!loading && shown.length === 0 && (
            <div className={styles.mapNote}>Aucun sentier ici {(areaFilter || filtersActive || q) ? "avec ces critères" : ""}</div>
          )}
          {moved && (
            <button className="map-search-here" onClick={() => { if (liveBounds) { setAreaFilter(liveBounds); setMoved(false); } }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" strokeLinecap="round"/></svg>
              Rechercher dans cette zone
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
