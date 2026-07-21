"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { LatLngBounds } from "leaflet";
import { useAuth } from "@/components/AuthProvider";
import { REFUGE_COLORS, REFUGE_LABELS } from "@/components/refugeStyles";
import RefugeDetail from "@/components/RefugeDetail";
import { parseGpx, planStages, densify, fetchElevations, routeBbox, haversine, naismith, totalAscent, buildRouteGeojson, detecterEauTrace, WaterFeature, GpxPoint, Stage } from "@/lib/gpxPlan";
import { difficultyColor, scoreLabel, estimateRouteDifficulty } from "@/lib/difficulty";
import ElevationChart, { HoverInfo } from "@/components/ElevationChart";
import styles from "./refuges.module.css";

const RefugesMap = dynamic(() => import("@/components/RefugesMap"), { ssr: false });

const TYPES = [
  { key: "refuge", label: "Refuge gardé" }, { key: "libre", label: "Cabane ouverte" },
  { key: "cabane", label: "Cabane / abri" }, { key: "ruine", label: "Ruine" },
];
const LEVELS = [{ v: 0.85, l: "Tranquille" }, { v: 1, l: "Normal" }, { v: 1.25, l: "Sportif" }];

function inBounds(r: any, b: LatLngBounds) { return b.contains([r.lat, r.lon]); }

export default function PlanifierPage() {
  const [refuges, setRefuges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [liveBounds, setLiveBounds] = useState<LatLngBounds | null>(null);
  const [areaFilter, setAreaFilter] = useState<LatLngBounds | null>(null);
  const [moved, setMoved] = useState(false);

  // Entry + modes
  const [showEntry, setShowEntry] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const router = useRouter();
  const { user, requireLogin } = useAuth();
  const [savingProj, setSavingProj] = useState(false);
  const [drawPts, setDrawPts] = useState<[number, number][]>([]);
  const [routedPath, setRoutedPath] = useState<[number, number][]>([]);
  const [snap, setSnap] = useState(true);              // accrochage aux sentiers on/off
  const [undoStack, setUndoStack] = useState<[number, number][][]>([]);
  const [redoStack, setRedoStack] = useState<[number, number][][]>([]);

  // Every edit goes through this so undo/redo stays consistent.
  function commitPts(next: [number, number][] | ((p: [number, number][]) => [number, number][])) {
    setDrawPts(prev => {
      const value = typeof next === "function" ? (next as any)(prev) : next;
      setUndoStack(s => [...s.slice(-49), prev]);
      setRedoStack([]);
      return value;
    });
  }
  function undo() {
    setUndoStack(s => {
      if (!s.length) return s;
      const prev = s[s.length - 1];
      setDrawPts(cur => { setRedoStack(r => [...r, cur]); return prev; });
      return s.slice(0, -1);
    });
  }
  function redo() {
    setRedoStack(r => {
      if (!r.length) return r;
      const next = r[r.length - 1];
      setDrawPts(cur => { setUndoStack(s => [...s, cur]); return next; });
      return r.slice(0, -1);
    });
  }
  const [routingLive, setRoutingLive] = useState(false);

  // Live pedestrian routing: when snap is ON, snap the drawn waypoints onto
  // real paths/trails. When OFF, the route is the straight polyline (waypoints).
  useEffect(() => {
    if (drawPts.length < 2) { setRoutedPath(drawPts); return; }
    if (!snap) { setRoutedPath(drawPts); return; }   // mode point-par-point : ligne directe
    let cancelled = false;
    setRoutingLive(true);
    (async () => {
      try {
        const r = await fetch("/api/route", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: drawPts }),
        });
        const d = await r.json();
        if (cancelled) return;
        setRoutedPath(Array.isArray(d?.coords) && d.coords.length > 1 ? d.coords : drawPts);
      } catch {
        if (!cancelled) setRoutedPath(drawPts); // fallback: straight
      } finally {
        if (!cancelled) setRoutingLive(false);
      }
    })();
    return () => { cancelled = true; };
  }, [drawPts, snap]);

  // Keyboard shortcuts while drawing: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z = redo.
  useEffect(() => {
    if (!drawing) return;
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingTrail, setLoadingTrail] = useState(false);

  // Live stats while drawing: distance is instant (from the routed path),
  // D+ and estimated time arrive once elevations are fetched (debounced).
  const [drawStats, setDrawStats] = useState<{ distKm: number; dplus: number | null; hours: number | null } | null>(null);
  const [drawProfileGeojson, setDrawProfileGeojson] = useState<any>(null);
  useEffect(() => {
    if (!drawing || routedPath.length < 2) { setDrawStats(null); setDrawProfileGeojson(null); return; }
    let distM = 0;
    for (let i = 1; i < routedPath.length; i++) {
      distM += haversine(routedPath[i - 1][0], routedPath[i - 1][1], routedPath[i][0], routedPath[i][1]);
    }
    const distKm = distM / 1000;
    setDrawStats({ distKm, dplus: null, hours: null });
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        // Adaptive sampling: ~200 elevation points max, whatever the length.
        const step = Math.max(120, Math.round(distM / 200));
        const pts = densify(routedPath, step);
        const eles = await fetchElevations(pts);
        if (cancelled) return;
        const dplus = totalAscent(eles);
        setDrawStats({ distKm, dplus, hours: naismith(distM, dplus, 1) });
        // Feed the live elevation profile shown in the drawing panel.
        const gpxPts: GpxPoint[] = pts.map((p, i) => ({ lat: p[0], lon: p[1], ele: eles[i] ?? null }));
        setDrawProfileGeojson(buildRouteGeojson(gpxPts));
      } catch { /* keep distance-only stats */ }
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [routedPath, drawing]);

  // Planner
  const [planning, setPlanning] = useState(false);
  const [route, setRoute] = useState<[number, number][] | null>(null);
  const [gpxPoints, setGpxPoints] = useState<GpxPoint[] | null>(null);
  const [hoursPerDay, setHoursPerDay] = useState(7);
  const [level, setLevel] = useState(1);
  const [mode, setMode] = useState<"refuge" | "tente">("refuge");
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [nearRefuges, setNearRefuges] = useState<any[] | null>(null);
  const [water, setWater] = useState<WaterFeature[]>([]);
  const [waterLoading, setWaterLoading] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/refuges").then(r => r.json()).then(d => {
      if (Array.isArray(d)) setRefuges(d); else setError(true);
      setLoading(false);
    }).catch(() => { setError(true); setLoading(false); });
  }, []);

  // If arriving with ?trail=<id> (from a trail's page), load that trace straight into the planner.
  useEffect(() => {
    const trailId = new URLSearchParams(window.location.search).get("trail");
    if (!trailId) return;
    setShowEntry(false); setLoadingTrail(true);
    fetch(`/api/trails/${trailId}/gpx`)
      .then(r => r.ok ? r.text() : Promise.reject())
      .then(xml => {
        const pts = parseGpx(xml);
        setLoadingTrail(false);
        if (pts.length >= 2) startFromGpxPoints(pts);
        else { alert("Trace introuvable."); setShowEntry(true); }
      })
      .catch(() => { setLoadingTrail(false); alert("Impossible de charger la trace du sentier."); setShowEntry(true); });
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => refuges.filter(r => {
    if (q && !r.nom.toLowerCase().includes(q) && !r.region.toLowerCase().includes(q) && !(r.ville || "").toLowerCase().includes(q)) return false;
    if (typeFilter && r.cat !== typeFilter) return false;
    if (areaFilter && !inBounds(r, areaFilter)) return false;
    return true;
  }).sort((a, b) => (b.alt || 0) - (a.alt || 0)), [refuges, q, typeFilter, areaFilter]);

  const counts = useMemo(() => ({
    total: refuges.length,
    refuge: refuges.filter(r => r.cat === "refuge").length,
    cabane: refuges.filter(r => r.cat === "cabane" || r.cat === "libre").length,
  }), [refuges]);

  // ── Water along the route — faithful port of the original detector ──
  async function fetchWaterAlong(coords: [number, number][]) {
    setWaterLoading(true); setWater([]);
    try {
      const eaux = await detecterEauTrace(coords.map(c => [c[0], c[1]]));
      setWater(eaux);
    } catch { setWater([]); }
    setWaterLoading(false);
  }

  function startFromGpxPoints(pts: GpxPoint[]) {
    setGpxPoints(pts);
    const coords = pts.map(p => [p.lat, p.lon] as [number, number]);
    setRoute(coords);
    setStages(null); setNearRefuges(null); setSelected(null);
    setDrawing(false); setPlanning(true); setShowEntry(false);
    fetchWaterAlong(coords);
  }

  function importGpx(file: File | null) {
    if (!file) { setShowEntry(true); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const pts = parseGpx(reader.result as string);
      if (pts.length < 2) { alert("Fichier GPX illisible ou vide."); setShowEntry(true); return; }
      startFromGpxPoints(pts);
    };
    reader.readAsText(file);
  }

  async function finishDraw() {
    if (drawPts.length < 2) { alert("Cliquez au moins 2 points sur la carte."); return; }
    setBusy("Calcul des altitudes…");
    // Use the routed path (following trails) when available, else straight waypoints.
    const base = routedPath.length >= 2 ? routedPath : drawPts;
    const dense = densify(base, 250);
    const eles = await fetchElevations(dense);
    const pts: GpxPoint[] = dense.map((p, i) => ({ lat: p[0], lon: p[1], ele: eles[i] ?? null }));
    setBusy(null); setDrawPts([]); setRoutedPath([]);
    startFromGpxPoints(pts);
  }

  async function saveAsProjet() {
    if (!gpxPoints || gpxPoints.length < 2) return;
    if (!user) { requireLogin(); return; }
    const name = prompt("Nom du projet :", "Mon projet de rando");
    if (!name || !name.trim()) return;
    setSavingProj(true);
    try {
      const safe = name.replace(/[<>&]/g, "");
      const trkpts = gpxPoints.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.ele != null ? `<ele>${p.ele}</ele>` : ""}</trkpt>`).join("");
      const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Senda"><trk><name>${safe}</name><trkseg>${trkpts}</trkseg></trk></gpx>`;
      const fd = new FormData();
      fd.append("file", new Blob([gpx], { type: "application/gpx+xml" }), "projet.gpx");
      fd.append("name", name.trim());
      fd.append("status", "projet");
      const r = await fetch("/api/gpx", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.trail?.id) { router.push("/mes-projets"); }
      else if (r.status === 401) requireLogin();
      else alert(d.error || "Échec de l'enregistrement du projet.");
    } finally { setSavingProj(false); }
  }

  function calculate() {
    if (!gpxPoints) return;
    const { stages, near } = planStages(gpxPoints, refuges, { hoursPerDay, level, mode });
    setStages(stages);
    setNearRefuges(near.map(x => x.refuge));
  }

  function reset() {
    setPlanning(false); setDrawing(false); setDrawPts([]); setRoutedPath([]); setRoute(null);
    setUndoStack([]); setRedoStack([]);
    setGpxPoints(null); setStages(null); setNearRefuges(null); setWater([]);
    setShowEntry(true);
  }

  const DAY_PALETTE = ["#E11D48", "#2563EB", "#16A34A", "#EA580C", "#7C3AED", "#0891B2", "#DB2777", "#0D9488"];
  const planStops = (stages && gpxPoints)
    ? stages.filter(s => s.stop || s.bivouac).map(s => s.stop
        ? { lat: s.stop.lat, lon: s.stop.lon, day: s.day, name: s.stop.nom, bivouac: false }
        : { lat: gpxPoints[s.toIdx].lat, lon: gpxPoints[s.toIdx].lon, day: s.day, name: "Bivouac", bivouac: true })
    : [];
  const daySegments = (stages && gpxPoints)
    ? stages.map((s, i) => ({ pts: gpxPoints.slice(s.fromIdx, s.toIdx + 1).map(p => [p.lat, p.lon] as [number, number]), color: DAY_PALETTE[i % DAY_PALETTE.length] }))
    : [];
  const mapRefuges = (planning || drawing) ? (nearRefuges ?? []) : shown;
  const routeGeojson = useMemo(() => (gpxPoints && gpxPoints.length > 1 ? buildRouteGeojson(gpxPoints) : null), [gpxPoints]);

  // Route summary: distance, duration, difficulty, water coverage
  const routeInfo = useMemo(() => {
    if (!gpxPoints || gpxPoints.length < 2) return null;
    let len = 0, maxSlope = 0;
    for (let i = 1; i < gpxPoints.length; i++) {
      const d = haversine(gpxPoints[i-1].lat, gpxPoints[i-1].lon, gpxPoints[i].lat, gpxPoints[i].lon);
      len += d;
      const de = (gpxPoints[i].ele ?? 0) - (gpxPoints[i-1].ele ?? 0);
      if (d > 3) { const sl = Math.abs(de) / d * 100; if (sl > maxSlope && sl < 120) maxSlope = sl; }
    }
    const asc = totalAscent(gpxPoints.map(p => p.ele));  // smoothed D+ (no noise inflation)
    const distKm = len / 1000;
    const hours = naismith(len, asc, 1);
    const score = estimateRouteDifficulty(distKm, asc, maxSlope);
    // Coverage = portion of the trail with water within ~150 m (at the edge of the path).
    const REACH = 150; // m
    const BUCKET = 50; // m resolution
    const nb = Math.max(1, Math.ceil(len / BUCKET));
    const cov = new Uint8Array(nb);
    const mark = (a: number, b: number) => {
      for (let x = Math.max(0, Math.floor(a / BUCKET)); x <= Math.min(nb - 1, Math.floor(b / BUCKET)); x++) cov[x] = 1;
    };
    for (const w of water) {
      if (w.forme === "zone") {
        mark(w.pkMin, w.pkMax); // trail follows the water — covered along its whole length
      } else {
        const d = w.d ?? 0;
        if (d <= REACH) { const half = Math.sqrt(REACH * REACH - d * d); mark(w.pk - half, w.pk + half); }
      }
    }
    let c = 0; for (let x = 0; x < nb; x++) c += cov[x];
    const waterPct = Math.round(c / nb * 100);
    return { distKm, asc: Math.round(asc), hours, score, waterPct };
  }, [gpxPoints, water]);
  const fmtH = (h: number) => `${Math.floor(h)}h${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

  return (
    <div className={styles.page}>
      <div className={styles.split}>
        <aside className={styles.sidebar}>
          {loadingTrail ? (
            <div className={styles.state}><span className={styles.spin} /> Chargement de la trace…</div>
          ) : selected ? (
            <RefugeDetail refuge={selected} onBack={() => setSelected(null)}
              moreHref={`/refuge/${encodeURIComponent(selected.id)}`} moreLabel="Voir la fiche complète" />
          ) : drawing ? (
            <div className={styles.planner}>
              <button className={styles.back} onClick={reset}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>Annuler</button>
              <h2 className={styles.title}>Tracer l'itinéraire</h2>

              {/* Snap mode toggle */}
              <div className={styles.modeToggle}>
                <button className={`${styles.modeBtn} ${snap ? styles.modeBtnActive : ""}`} onClick={() => setSnap(true)}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 20l-5.5-3V4L9 7m0 13l6-3m-6 3V7m6 10l5.5 3V7L15 4m0 13V4m0 0L9 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Suivre les sentiers
                </button>
                <button className={`${styles.modeBtn} ${!snap ? styles.modeBtnActive : ""}`} onClick={() => setSnap(false)}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20L20 4M4 4l16 16" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Ligne droite
                </button>
              </div>
              <p className={styles.subtitle}>
                {snap
                  ? "Cliquez sur la carte : le tracé suit automatiquement les chemins et sentiers entre vos points."
                  : "Cliquez sur la carte : les points sont reliés en ligne droite (utile hors sentier)."}
                <br /><span className={styles.hintLine}>Glissez un point pour le déplacer · cliquez sur la trace pour insérer un point · clic droit sur un point pour le supprimer.</span>
              </p>

              <div className={styles.drawInfo}>
                {drawPts.length} point{drawPts.length > 1 ? "s" : ""} placé{drawPts.length > 1 ? "s" : ""}
                {routingLive && <span className={styles.routingLive}><span className={styles.spinMini} /> calcul du chemin…</span>}
              </div>
              {drawStats && (
                <div className={styles.drawStats}>
                  <div className={styles.drawStat}>
                    <span className={styles.drawStatVal}>{drawStats.distKm.toFixed(drawStats.distKm >= 10 ? 1 : 2)}</span>
                    <span className={styles.drawStatLbl}>km</span>
                  </div>
                  <div className={styles.drawStat}>
                    <span className={styles.drawStatVal}>{drawStats.dplus != null ? `+${drawStats.dplus}` : "…"}</span>
                    <span className={styles.drawStatLbl}>m D+</span>
                  </div>
                  <div className={styles.drawStat}>
                    <span className={styles.drawStatVal}>{drawStats.hours != null ? fmtH(drawStats.hours) : "…"}</span>
                    <span className={styles.drawStatLbl}>durée est.</span>
                  </div>
                </div>
              )}

              {/* Live elevation profile while drawing */}
              {drawProfileGeojson && (
                <div className={styles.drawProfile}>
                  <ElevationChart geojson={drawProfileGeojson} height={96} onHover={setHover} fillColor="#5E7A55" />
                </div>
              )}

              <div className={styles.editRow2}>
                <button className={styles.iconBtn} onClick={undo} disabled={!undoStack.length} title="Annuler (Ctrl+Z)">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 14L4 9l5-5" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 9h11a5 5 0 015 5v0a5 5 0 01-5 5H9" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Annuler
                </button>
                <button className={styles.iconBtn} onClick={redo} disabled={!redoStack.length} title="Rétablir (Ctrl+Maj+Z)">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 14l5-5-5-5" strokeLinecap="round" strokeLinejoin="round"/><path d="M20 9H9a5 5 0 00-5 5v0a5 5 0 005 5h6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Rétablir
                </button>
                <button className={styles.drawClear} onClick={() => commitPts([])} disabled={!drawPts.length}>Tout effacer</button>
              </div>
              <button className={styles.calcBtn} onClick={finishDraw} disabled={drawPts.length < 2 || !!busy}>
                {busy || "Terminer et planifier"}
              </button>
            </div>
          ) : planning ? (
            <div className={styles.planner}>
              <button className={styles.back} onClick={reset}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>Nouveau parcours</button>
              <h2 className={styles.title}>Planifier ma rando</h2>
              <p className={styles.subtitle}>Découpe ton itinéraire en étapes et trouve où dormir.</p>

              {routeInfo && (
                <div className={styles.summary}>
                  <div className={styles.summaryTop}>
                    <div className={styles.summaryScore} style={{ background: difficultyColor(routeInfo.score) }}>
                      {routeInfo.score}<span>/10</span>
                    </div>
                    <p className={styles.summaryText}>
                      Votre parcours fait <b>{routeInfo.distKm.toFixed(1)} km</b> (+{routeInfo.asc} m) pour environ <b>{fmtH(routeInfo.hours)}</b> de marche,
                      difficulté <b>{scoreLabel(routeInfo.score)}</b>. Vous trouverez de l'eau sur <b>{routeInfo.waterPct}%</b> du chemin.
                    </p>
                  </div>
                  <div className={styles.summaryNote}>Note estimée — elle s'affinera avec ton profil après 5 traces notées.</div>
                </div>
              )}

              <div className={styles.planControls}>
                <div className={styles.planField}>
                  <label className={styles.planLabel}>Heures de marche par jour <strong>{hoursPerDay}h</strong></label>
                  <input type="range" min={4} max={12} step={1} value={hoursPerDay} onChange={e => setHoursPerDay(Number(e.target.value))} className={styles.planRange} />
                </div>
                <div className={styles.planField}>
                  <label className={styles.planLabel}>Rythme</label>
                  <div className={styles.segRow}>{LEVELS.map(l => <button key={l.v} className={`${styles.seg} ${level === l.v ? styles.segActive : ""}`} onClick={() => setLevel(l.v)}>{l.l}</button>)}</div>
                </div>
                <div className={styles.planField}>
                  <label className={styles.planLabel}>Où dormir</label>
                  <div className={styles.segRow}>
                    <button className={`${styles.seg} ${mode === "refuge" ? styles.segActive : ""}`} onClick={() => setMode("refuge")}>Refuge / cabane</button>
                    <button className={`${styles.seg} ${mode === "tente" ? styles.segActive : ""}`} onClick={() => setMode("tente")}>Bivouac permis</button>
                  </div>
                </div>
                <button className={styles.calcBtn} onClick={calculate}>Calculer l'itinéraire</button>
                <button className={styles.saveProjBtn} onClick={saveAsProjet} disabled={savingProj || !gpxPoints || gpxPoints.length < 2}>
                  {savingProj ? "Enregistrement…" : "💾 Enregistrer comme projet"}
                </button>
              </div>
              {stages && (
                <div className={styles.stages}>
                  <div className={styles.stagesHead}>{stages.length} jour{stages.length > 1 ? "s" : ""} · {water.length} point{water.length > 1 ? "s" : ""} d'eau</div>
                  {stages.map(s => (
                    <div key={s.day} className={styles.stage}>
                      <div className={styles.stageDay}>J{s.day}</div>
                      <div className={styles.stageBody}>
                        <div className={styles.stageStats}>{s.distKm} km · {Math.floor(s.hours)}h{String(Math.round((s.hours % 1) * 60)).padStart(2, "0")} · +{s.ascent} m</div>
                        {s.stop ? <>
                            <button className={styles.stageStop} onClick={() => setSelected(s.stop)}>🛏️ Nuit : <strong>{s.stop.nom}</strong> <span style={{ color: REFUGE_COLORS[s.stop.cat] }}>({REFUGE_LABELS[s.stop.cat]})</span></button>
                            {(s.stopDist ?? 0) > 100 && <div className={styles.horsTrace}>↗ Hors trace : ~{s.stopDist} m à parcourir pour le rejoindre{(s.stopClimb ?? 0) > 20 ? ` (+${s.stopClimb} m)` : ""}</div>}
                          </>
                          : s.bivouac ? <div className={styles.stageBiv}>⛺ Bivouac à ce point</div>
                          : <div className={styles.stageEnd}>🏁 Arrivée</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className={styles.header}>
                <h1 className={styles.title}>Refuges & cabanes</h1>
                <p className={styles.subtitle}>1 622 abris des deux versants — France, Espagne, Andorre</p>
                {!loading && !error && (
                  <div className={styles.stats}>
                    <div className={styles.stat}><span className={styles.statNum}>{counts.total}</span><span className={styles.statLbl}>lieux</span></div>
                    <div className={styles.stat}><span className={styles.statNum} style={{ color: REFUGE_COLORS.refuge }}>{counts.refuge}</span><span className={styles.statLbl}>refuges</span></div>
                    <div className={styles.stat}><span className={styles.statNum} style={{ color: REFUGE_COLORS.cabane }}>{counts.cabane}</span><span className={styles.statLbl}>cabanes</span></div>
                  </div>
                )}
                <button className={styles.planBtn} onClick={() => setShowEntry(true)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 20l-5.5-3V4L9 7m0 13l6-3m-6 3V7m6 10l5.5 3V7L15 4m0 13V4m0 0L9 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Planifier une rando
                </button>
              </div>
              <div className={styles.filters}>
                <div className={styles.searchWrap}>
                  <svg className={styles.searchIcon} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" strokeLinecap="round"/></svg>
                  <input className={styles.search} value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un lieu, une commune, une région…" />
                  {query && <button className={styles.searchClear} onClick={() => setQuery("")}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg></button>}
                </div>
                <div className={styles.typeRow}>
                  {TYPES.map(t => (
                    <button key={t.key} className={`${styles.typePill} ${typeFilter === t.key ? styles.typePillActive : ""}`}
                      style={typeFilter === t.key ? { background: REFUGE_COLORS[t.key], borderColor: REFUGE_COLORS[t.key], color: "#fff" } : {}}
                      onClick={() => setTypeFilter(typeFilter === t.key ? null : t.key)}>
                      <span className={styles.typeDot} style={{ background: REFUGE_COLORS[t.key] }} />{t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.listHead}>
                {loading ? "Chargement…" : error ? "Erreur" : `${shown.length} lieu${shown.length > 1 ? "x" : ""}`}
                {areaFilter && <button className={styles.clearArea} onClick={() => { setAreaFilter(null); setMoved(false); }}>voir tout</button>}
              </div>
              {loading ? <div className={styles.state}><span className={styles.spin} /> Chargement des refuges…</div>
                : error ? <div className={styles.state}>Impossible de charger les refuges.</div>
                : shown.length === 0 ? <div className={styles.state}>Aucun lieu ne correspond.</div>
                : (
                  <div className={`${styles.list} stagger`}>
                    {shown.slice(0, 400).map(r => (
                      <button key={r.id} className={`${styles.item} ${hoveredId === r.id ? styles.itemHover : ""}`}
                        onMouseEnter={() => setHoveredId(r.id)} onMouseLeave={() => setHoveredId(null)} onClick={() => setSelected(r)}>
                        <span className={styles.itemDot} style={{ background: REFUGE_COLORS[r.cat] }} />
                        <span className={styles.itemInfo}>
                          <span className={styles.itemName}>{r.nom}</span>
                          <span className={styles.itemMeta}>{REFUGE_LABELS[r.cat]}{r.alt ? ` · ${r.alt} m` : ""}</span>
                        </span>
                        <svg className={styles.itemArrow} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    ))}
                    {shown.length > 400 && <div className={styles.more}>+ {shown.length - 400} autres sur la carte</div>}
                  </div>
                )}
            </>
          )}
        </aside>

        <div className={styles.mapArea}>
          <RefugesMap
            refuges={mapRefuges} selectedId={selected?.id ?? null} hoveredId={hoveredId}
            onSelect={(r) => setSelected(r)} onHover={setHoveredId}
            onBoundsChange={(b) => { setLiveBounds(b); setMoved(true); }}
            autoFit={!areaFilter && !selected && !route && !drawing}
            route={route} planStops={planStops} daySegments={daySegments}
            drawing={drawing} drawPts={drawPts} drawRouted={routedPath} snap={snap}
            onMapClick={(lat, lon) => commitPts(p => [...p, [lat, lon]])}
            onDragPoint={(i, lat, lon) => commitPts(p => p.map((pt, j) => j === i ? [lat, lon] : pt))}
            onDeletePoint={(i) => commitPts(p => p.filter((_, j) => j !== i))}
            onInsertPoint={(routedIdx, lat, lon) => {
              // Map the clicked routed-vertex to the waypoint segment it belongs to,
              // then insert the new waypoint between the right pair.
              commitPts(p => {
                if (p.length < 2) return [...p, [lat, lon]];
                // Nearest waypoint to the click decides the insertion segment.
                let best = 0, bestD = Infinity;
                for (let k = 0; k < p.length; k++) {
                  const dLat = p[k][0] - lat, dLon = p[k][1] - lon;
                  const d = dLat * dLat + dLon * dLon;
                  if (d < bestD) { bestD = d; best = k; }
                }
                // Insert after `best` unless the click is clearly before the first point.
                const insertAt = best === 0 ? 1 : Math.min(best + 1, p.length);
                const next = p.slice();
                next.splice(insertAt, 0, [lat, lon]);
                return next;
              });
            }}
            waterPoints={water.filter(w => w.forme === "point").map(w => ({ lat: w.lat, lon: w.lon, type: w.type, potable: w.potable, nom: w.nom }))}
            waterZones={water.filter(w => w.forme === "zone").map(w => ({ ligne: w.ligne || [], type: w.type, nom: w.nom }))}
            hover={hover ? [hover.lat, hover.lng] : null}
          />
          {drawing && (
            <div className="map-search-here" style={{ pointerEvents: "none" }}>
              ✏️ Cliquez sur la carte pour tracer
            </div>
          )}
          {routeGeojson && !drawing && (
            <div className={styles.profileOverlay}>
              <div className={styles.profileTitle}>Profil du parcours</div>
              <ElevationChart geojson={routeGeojson} height={130} onHover={setHover} fillColor="#5E7A55" />
            </div>
          )}
          {!loading && !planning && !drawing && shown.length === 0 && <div className={styles.mapNote}>Aucun refuge ici avec ces critères</div>}
          {moved && !selected && !planning && !drawing && (
            <button className="map-search-here" onClick={() => { if (liveBounds) { setAreaFilter(liveBounds); setMoved(false); } }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" strokeLinecap="round"/></svg>Rechercher dans cette zone
            </button>
          )}
        </div>
      </div>

      {/* Entry choice popup */}
      {showEntry && (
        <div className={styles.entryOverlay} onClick={e => e.target === e.currentTarget && setShowEntry(false)}>
          <div className={styles.entryModal}>
            <button className={styles.entryClose} onClick={() => setShowEntry(false)} aria-label="Fermer"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg></button>
            <h2 className={styles.entryTitle}>Planifier votre rando</h2>
            <p className={styles.entryText}>Importez votre trace ou dessinez votre parcours — on trouve les refuges où dormir, les étapes et les points d'eau.</p>
            <div className={styles.entryChoices}>
              <button className={styles.entryChoice} onClick={() => { setShowEntry(false); fileRef.current?.click(); }}>
                <span className={styles.entryIcon}>📁</span>
                <span className={styles.entryChoiceTitle}>Importer un GPX</span>
                <span className={styles.entryChoiceText}>Depuis Komoot, Wikiloc, AllTrails…</span>
              </button>
              <button className={styles.entryChoice} onClick={() => { setShowEntry(false); setDrawing(true); setDrawPts([]); }}>
                <span className={styles.entryIcon}>✏️</span>
                <span className={styles.entryChoiceTitle}>Tracer sur la carte</span>
                <span className={styles.entryChoiceText}>Dessinez votre itinéraire à la main</span>
              </button>
            </div>
            <button className={styles.entryBrowse} onClick={() => setShowEntry(false)}>Ou simplement parcourir les refuges →</button>
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".gpx" hidden onChange={e => { importGpx(e.target.files?.[0] ?? null); e.target.value = ""; }} />
    </div>
  );
}
