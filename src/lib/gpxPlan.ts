// gpxPlan.ts — client-side GPX parsing + Naismith multi-day trek planner

export interface GpxPoint { lat: number; lon: number; ele: number | null }

export function parseGpx(xml: string): GpxPoint[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const nodes = Array.from(doc.querySelectorAll("trkpt, rtept, wpt"));
  const pts: GpxPoint[] = [];
  for (const n of nodes) {
    const lat = parseFloat(n.getAttribute("lat") || "");
    const lon = parseFloat(n.getAttribute("lon") || "");
    if (isNaN(lat) || isNaN(lon)) continue;
    const eleEl = n.querySelector("ele");
    const ele = eleEl ? parseFloat(eleEl.textContent || "") : null;
    pts.push({ lat, lon, ele: ele != null && !isNaN(ele) ? ele : null });
  }
  return pts;
}

export function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180, dLon = (bLon - aLon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Naismith: 4 km/h * level, +1h per 300m ascent / level. Returns hours.
export function naismith(distM: number, ascentM: number, level: number): number {
  const vKmH = 4 * level;
  return distM / (vKmH * 1000) + ascentM / (300 * level);
}

// Smooth an elevation series (moving average) to remove DEM/GPS noise that
// otherwise inflates the cumulative ascent (D+). Nulls treated as neighbours.
export function smoothEles(eles: (number | null)[], win = 4): number[] {
  const e = eles.map(v => (v == null ? NaN : v));
  // fill NaNs with nearest valid value
  let last = 0;
  for (let i = 0; i < e.length; i++) { if (!isNaN(e[i])) last = e[i]; else e[i] = last; }
  const out = new Array(e.length);
  for (let i = 0; i < e.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(e.length - 1, i + win); j++) { s += e[j]; n++; }
    out[i] = s / n;
  }
  return out;
}

// Realistic cumulative ascent from an elevation series (smoothed + small threshold).
export function totalAscent(eles: (number | null)[]): number {
  const sm = smoothEles(eles);
  let asc = 0;
  for (let i = 1; i < sm.length; i++) { const de = sm[i] - sm[i-1]; if (de > 0) asc += de; }
  return Math.round(asc);
}

export interface OnRoute { refuge: any; projIdx: number; dist: number; climb: number }

// Refuges within `marginM` of the route, with their nearest route index.
export function nearRoute(points: GpxPoint[], refuges: any[], marginM: number): OnRoute[] {
  const out: OnRoute[] = [];
  // coarse sampling for speed
  const step = Math.max(1, Math.floor(points.length / 600));
  for (const r of refuges) {
    let best = Infinity, bestIdx = -1;
    for (let i = 0; i < points.length; i += step) {
      const d = haversine(r.lat, r.lon, points[i].lat, points[i].lon);
      if (d < best) { best = d; bestIdx = i; }
    }
    if (best <= marginM) {
      const trailEle = points[bestIdx]?.ele;
      const climb = (r.alt != null && trailEle != null) ? Math.max(0, r.alt - trailEle) : 0;
      out.push({ refuge: r, projIdx: bestIdx, dist: best, climb });
    }
  }
  out.sort((a, b) => a.projIdx - b.projIdx);
  return out;
}

export interface Stage {
  day: number; fromIdx: number; toIdx: number;
  distKm: number; hours: number; ascent: number;
  stop: any | null; // refuge to sleep at, or null (bivouac / arrival)
  bivouac: boolean;
  stopDist?: number;   // horizontal distance from the trail to the sleep refuge (m)
  stopClimb?: number;  // extra ascent from the trail up to the refuge (m)
}

export interface PlanOpts { hoursPerDay: number; level: number; mode: "refuge" | "tente" }

// Segment the route into daily stages, assigning a sleep refuge at each stage end.
export function planStages(points: GpxPoint[], refuges: any[], opts: PlanOpts): { stages: Stage[]; near: OnRoute[] } {
  const n = points.length;
  const MAX_CLIMB = 100; // m — max ascent from the trail up to a sleep spot
  const near = nearRoute(points, refuges, 1200);
  const sleepable = near.filter(x =>
    x.climb <= MAX_CLIMB && (opts.mode === "tente" ? true : x.refuge.cat !== "ruine")
  );

  // cumulative distance + segment metrics (elevations smoothed to avoid noise inflating D+)
  const smEle = smoothEles(points.map(p => p.ele));
  const segDist: number[] = [0], segAsc: number[] = [0];
  for (let i = 1; i < n; i++) {
    segDist[i] = haversine(points[i-1].lat, points[i-1].lon, points[i].lat, points[i].lon);
    const de = smEle[i] - smEle[i-1];
    segAsc[i] = de > 0 ? de : 0;
  }
  const timeOf = (a: number, b: number) => {
    let d = 0, asc = 0;
    for (let i = a + 1; i <= b; i++) { d += segDist[i]; asc += segAsc[i]; }
    return { hours: naismith(d, asc, opts.level), distKm: Math.round(d / 100) / 10, ascent: Math.round(asc) };
  };

  const stages: Stage[] = [];
  let start = 0, day = 1;
  // Balance days: figure out how many days we need, then target an even split.
  const totalHours = timeOf(0, n - 1).hours;
  const numDays = Math.max(1, Math.ceil(totalHours / opts.hoursPerDay));

  while (start < n - 1 && day < 40) {
    // Even split: aim for (time left ÷ days left), capped at the daily max.
    const remainingDays = Math.max(1, numDays - (day - 1));
    const remainingTime = timeOf(start, n - 1).hours;
    const targetHours = Math.min(opts.hoursPerDay, remainingTime / remainingDays);
    // walk until the balanced target is reached
    let t = 0, i = start;
    while (i < n - 1 && t < targetHours) { i++; t += naismith(segDist[i], segAsc[i], opts.level); }
    if (i >= n - 1) {
      const m = timeOf(start, n - 1);
      stages.push({ day, fromIdx: start, toIdx: n - 1, ...m, stop: null, bivouac: false });
      break;
    }
    const target = i;
    const TOL = 1.5;        // refuge mode: max deviation to accept a refuge
    const TOL_TENTE = 0.6;  // bivouac mode: only snap to a refuge if it's very close, else bivouac
    // eligible sleep spots ahead of start
    const ahead = sleepable.filter(x => x.projIdx > start + 2);
    if (ahead.length === 0) {
      // no refuge ahead at all — bivouac at target (tente) or go straight to the end
      const m = timeOf(start, opts.mode === "tente" ? target : n - 1);
      stages.push({ day, fromIdx: start, toIdx: opts.mode === "tente" ? target : n - 1, ...m, stop: null, bivouac: opts.mode === "tente" });
      if (opts.mode === "tente" && target < n - 1) { start = target; day++; continue; }
      break;
    }

    // Pick the refuge whose resulting DAY LENGTH is closest to the target hours
    let chosen: OnRoute | null = null, chosenDev = Infinity;
    for (const x of ahead) {
      const dayH = timeOf(start, x.projIdx).hours;
      const dev = Math.abs(dayH - targetHours);
      if (dev < chosenDev) { chosenDev = dev; chosen = x; }
    }

    // Bivouac mode: only accept a refuge within tolerance, else bivouac at the target time.
    // Refuge mode: always take the closest-in-time refuge (user asked for huts only).
    if (opts.mode === "tente" && (!chosen || chosenDev > TOL_TENTE)) {
      const m = timeOf(start, target);
      stages.push({ day, fromIdx: start, toIdx: target, ...m, stop: null, bivouac: true });
      start = target; day++; continue;
    }
    if (!chosen) {
      const m = timeOf(start, target);
      stages.push({ day, fromIdx: start, toIdx: target, ...m, stop: null, bivouac: true });
      start = target; day++; continue;
    }
    if (chosen.projIdx >= n - 2) {
      const m = timeOf(start, n - 1);
      stages.push({ day, fromIdx: start, toIdx: n - 1, ...m, stop: chosen.refuge, bivouac: false, stopDist: Math.round(chosen.dist), stopClimb: Math.round(chosen.climb) });
      break;
    }
    const m = timeOf(start, chosen.projIdx);
    stages.push({ day, fromIdx: start, toIdx: chosen.projIdx, ...m, stop: chosen.refuge, bivouac: false, stopDist: Math.round(chosen.dist), stopClimb: Math.round(chosen.climb) });
    start = chosen.projIdx; day++;
  }

  // Drop a pointless final "arrival" stage that is basically zero-length
  while (stages.length > 1 && stages[stages.length - 1].distKm < 0.8 && !stages[stages.length - 1].stop) {
    stages.pop();
  }
  return { stages, near };
}

// Build an ElevationChart-compatible GeoJSON from planner points (with slope-based colouring).
export function buildRouteGeojson(pts: GpxPoint[]) {
  const coordinates = pts.map(p => [p.lon, p.lat]);
  const elevations = pts.map(p => p.ele ?? 0);
  const segmentScores: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    let score = 3.5;
    if (i > 0) {
      const d = haversine(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon);
      const de = (pts[i].ele ?? 0) - (pts[i-1].ele ?? 0);
      const slope = d > 1 ? Math.abs(de) / d * 100 : 0;
      score = Math.max(1, Math.min(10, 2 + slope * 0.32));
    }
    segmentScores.push(score);
  }
  return { type: "Feature", geometry: { type: "LineString", coordinates }, properties: { elevations, segmentScores } };
}

// Add intermediate points along a drawn polyline (every ~stepM metres).
export function densify(pts: [number, number][], stepM = 250): [number, number][] {
  if (pts.length < 2) return pts.slice();
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [aLat, aLon] = pts[i - 1], [bLat, bLon] = pts[i];
    const d = haversine(aLat, aLon, bLat, bLon);
    const n = Math.max(1, Math.floor(d / stepM));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t]);
    }
  }
  return out;
}

// Fetch elevations for a list of [lat,lon] via Open-Meteo (batches of 100).
export async function fetchElevations(pts: [number, number][]): Promise<(number | null)[]> {
  const out: (number | null)[] = [];
  for (let i = 0; i < pts.length; i += 100) {
    const chunk = pts.slice(i, i + 100);
    const lat = chunk.map(p => p[0].toFixed(5)).join(",");
    const lon = chunk.map(p => p[1].toFixed(5)).join(",");
    try {
      const rep = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
      const d = await rep.json();
      const arr = d.elevation || [];
      for (let k = 0; k < chunk.length; k++) out.push(arr[k] != null ? arr[k] : null);
    } catch {
      for (let k = 0; k < chunk.length; k++) out.push(null);
    }
  }
  return out;
}

export function routeBbox(pts: [number, number][]): { minLat: number; minLon: number; maxLat: number; maxLon: number } {
  const lats = pts.map(p => p[0]), lons = pts.map(p => p[1]);
  return { minLat: Math.min(...lats), minLon: Math.min(...lons), maxLat: Math.max(...lats), maxLon: Math.max(...lons) };
}

// =============================================================================
// Water detection along the route — faithful port of the original eau.js/gpx.js
// =============================================================================

export interface WaterFeature {
  forme: "zone" | "point";
  type: string; nom: string | null; potable: boolean; saisonnier?: boolean;
  lat: number; lon: number; d: number | null;
  pk: number; pkMin: number; pkMax: number;
  ligne?: [number, number][];
}

const MARGE_GPX_WATER = 500;   // m — max distance water can be from the trail to count
const MARGE_POINT = 40;        // m — strict threshold for point sources
const MARGE_LONGE = 60;        // m — threshold for "the trail follows the water"
const COUPURE_EL = 120;        // m — gap that breaks a followed stretch
const ZONE_MIN = 250;          // m — min continuous length to be a "zone" (LONGÉ)

function typeEau(t: any): string {
  if (t.natural === "spring") return "Source";
  if (t.amenity === "drinking_water") return "Eau potable";
  if (t.man_made === "water_well") return "Puits";
  if (t.man_made === "water_tap" || t.man_made === "water_point") return "Robinet / captage";
  if (t.man_made === "reservoir_covered" || t.landuse === "reservoir" || t.water === "reservoir") return "Réservoir";
  if (t.waterway === "waterfall") return "Cascade";
  if (t.natural === "water" || t.water) {
    const nom = (t.name || "").toLowerCase();
    if (t.water === "lake" || nom.includes("lac") || nom.includes("estany") || nom.includes("ibon")) return "Lac";
    if (t.water === "pond" || nom.includes("étang") || nom.includes("etang") || nom.includes("estany")) return "Étang";
    return "Plan d'eau";
  }
  if (t.waterway === "river") return "Rivière";
  if (t.waterway === "stream") return "Ruisseau";
  if (t.waterway === "canal" || t.waterway === "drain" || t.waterway === "ditch") return "Canal";
  if (t.waterway) return "Cours d'eau";
  return "Point d'eau";
}

function distPointSegment(plat: number, plon: number, alat: number, alon: number, blat: number, blon: number): number {
  const R = 6371000, toR = (x: number) => x * Math.PI / 180, lat0 = toR(plat);
  const X = (lon: number, lat: number) => ({ x: R * toR(lon) * Math.cos(lat0), y: R * toR(lat) });
  const P = X(plon, plat), A = X(alon, alat), B = X(blon, blat);
  const dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
}

interface TraceIdx { grille: Map<string, number[]>; tailleDeg: number; trace: number[][]; cumul: number[] }

function construireIndexTrace(trace: number[][], cumul: number[]): TraceIdx {
  const tailleDeg = MARGE_GPX_WATER / 111320;
  const grille = new Map<string, number[]>();
  for (let k = 0; k < trace.length - 1; k++) {
    const x1 = Math.floor(trace[k][1] / tailleDeg), y1 = Math.floor(trace[k][0] / tailleDeg);
    const x2 = Math.floor(trace[k+1][1] / tailleDeg), y2 = Math.floor(trace[k+1][0] / tailleDeg);
    for (let gx = Math.min(x1,x2); gx <= Math.max(x1,x2); gx++)
      for (let gy = Math.min(y1,y2); gy <= Math.max(y1,y2); gy++) {
        const c = gx + "," + gy;
        if (!grille.has(c)) grille.set(c, []);
        grille.get(c)!.push(k);
      }
  }
  return { grille, tailleDeg, trace, cumul };
}

function pkSurTraceIndex(lat: number, lon: number, idx: TraceIdx) {
  const { grille, tailleDeg, trace, cumul } = idx;
  const gx = Math.floor(lon / tailleDeg), gy = Math.floor(lat / tailleDeg);
  let best = Infinity, pk = 0, plat = lat, plon = lon;
  const vus = new Set<number>();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const segs = grille.get((gx+dx) + "," + (gy+dy));
    if (!segs) continue;
    for (const k of segs) {
      if (vus.has(k)) continue; vus.add(k);
      const a = trace[k], b = trace[k+1];
      const d = distPointSegment(lat, lon, a[0], a[1], b[0], b[1]);
      if (d < best) {
        best = d;
        const R = 6371000, toR = (x: number) => x * Math.PI / 180, lat0 = toR(lat);
        const X = (lo: number, la: number) => ({ x: R * toR(lo) * Math.cos(lat0), y: R * toR(la) });
        const P = X(lon, lat), A = X(a[1], a[0]), B = X(b[1], b[0]);
        const ddx = B.x - A.x, ddy = B.y - A.y, len2 = ddx*ddx + ddy*ddy;
        let t = len2 > 0 ? ((P.x - A.x)*ddx + (P.y - A.y)*ddy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        pk = cumul[k] + t * (cumul[k+1] - cumul[k]);
        plat = a[0] + t * (b[0] - a[0]);
        plon = a[1] + t * (b[1] - a[1]);
      }
    }
  }
  return { dist: best, pk, plat, plon };
}

// Detect all water along a trace (points + followed zones), like the original app.
export async function detecterEauTrace(trace: number[][]): Promise<WaterFeature[]> {
  const cumul = [0];
  for (let k = 1; k < trace.length; k++) cumul[k] = cumul[k-1] + haversine(trace[k-1][0], trace[k-1][1], trace[k][0], trace[k][1]);

  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const [la, lo] of trace) { if (la < minLat) minLat = la; if (la > maxLat) maxLat = la; if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo; }
  const mLat = MARGE_GPX_WATER / 111320, mLon = MARGE_GPX_WATER / (111320 * Math.cos((minLat+maxLat)/2 * Math.PI/180));
  const bbox = `${(minLat-mLat).toFixed(4)},${(minLon-mLon).toFixed(4)},${(maxLat+mLat).toFixed(4)},${(maxLon+mLon).toFixed(4)}`;

  const qFinal = `[out:json][timeout:60];(` +
    `node["natural"="spring"](${bbox});` +
    `node["natural"="water"](${bbox});` +
    `node["amenity"="drinking_water"](${bbox});` +
    `node["man_made"~"water_well|water_tap|water_point|reservoir_covered"](${bbox});` +
    `node["waterway"~"waterfall|stream_end"](${bbox});` +
    `way["waterway"~"stream|river|canal|drain|ditch"](${bbox});` +
    `way["natural"="water"](${bbox});` +
    `way["water"~"lake|pond|reservoir|river|stream_pool"](${bbox});` +
    `way["landuse"="reservoir"](${bbox});` +
    `);out geom tags;`;

  // Go through our own server proxy (reliable connectivity + mirror fallback).
  let data: any = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 28000);
    const rep = await fetch("/api/overpass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: qFinal }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (rep.ok) data = await rep.json();
  } catch { /* handled below */ }
  if (!data || data.error) throw new Error("Overpass injoignable");

  const idx = construireIndexTrace(trace, cumul);
  const potables: any[] = [];
  const sortie: WaterFeature[] = [];

  for (const el of (data.elements || [])) {
    const t = el.tags || {};
    const type = typeEau(t);
    const nom = t.name || null;
    const saisonnier = t.seasonal === "yes" || t.intermittent === "yes";
    if (t.tunnel && t.tunnel !== "no") continue;
    if (t.location === "underground" || t.covered === "yes") continue;
    if (t.layer && parseInt(t.layer) < 0 && t.waterway) continue;

    // potable → strict threshold
    if (["Eau potable", "Fontaine", "Robinet / captage"].includes(type)) {
      if (el.lat != null) {
        const { dist, pk } = pkSurTraceIndex(el.lat, el.lon, idx);
        if (dist <= MARGE_POINT) potables.push({ lat: el.lat, lon: el.lon, type, nom, dist, pk });
      }
      continue;
    }
    // isolated node (spring, point source)
    if (el.type === "node" && el.lat != null) {
      const { dist, pk } = pkSurTraceIndex(el.lat, el.lon, idx);
      if (dist <= MARGE_POINT) sortie.push({ forme: "point", type, nom, potable: false, saisonnier, lat: el.lat, lon: el.lon, d: dist, pk, pkMin: pk, pkMax: pk });
      continue;
    }
    // line / surface (stream, river, lake)
    const pts = (el.geometry || []).filter((g: any) => g.lat != null);
    if (!pts.length) continue;
    const contacts: { pk: number; dist: number; lat: number; lon: number }[] = [];
    for (const g of pts) {
      const { dist, pk, plat, plon } = pkSurTraceIndex(g.lat, g.lon, idx);
      if (dist <= MARGE_GPX_WATER) contacts.push({ pk, dist, lat: plat, lon: plon });
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const d = haversine(pts[i].lat, pts[i].lon, pts[i+1].lat, pts[i+1].lon);
      const n = Math.min(20, Math.max(2, Math.ceil(d / 40)));
      for (let j = 1; j < n; j++) {
        const f = j / n;
        const la = pts[i].lat + (pts[i+1].lat - pts[i].lat) * f;
        const lo = pts[i].lon + (pts[i+1].lon - pts[i].lon) * f;
        const { dist, pk, plat, plon } = pkSurTraceIndex(la, lo, idx);
        if (dist <= MARGE_GPX_WATER) contacts.push({ pk, dist, lat: plat, lon: plon });
      }
    }
    if (!contacts.length) continue;
    const proches = contacts.filter(c => c.dist <= MARGE_LONGE);
    if (!proches.length) continue;
    proches.sort((a, b) => a.pk - b.pk);
    let grp = [proches[0]]; const grps: typeof proches[] = [];
    for (let i = 1; i < proches.length; i++) {
      if (proches[i].pk - grp[grp.length-1].pk > COUPURE_EL) { grps.push(grp); grp = []; }
      grp.push(proches[i]);
    }
    grps.push(grp);
    for (const g of grps) {
      const pkMin = g[0].pk, pkMax = g[g.length-1].pk;
      const proche = g.reduce((a, b) => b.dist < a.dist ? b : a);
      if (pkMax - pkMin >= ZONE_MIN) {
        sortie.push({ forme: "zone", type, nom, potable: false, saisonnier, lat: proche.lat, lon: proche.lon, d: proche.dist, pkMin, pkMax, pk: (pkMin+pkMax)/2, ligne: g.map(c => [c.lat, c.lon]) });
      } else {
        sortie.push({ forme: "point", type, nom, potable: false, saisonnier, lat: proche.lat, lon: proche.lon, d: proche.dist, pk: proche.pk, pkMin: proche.pk, pkMax: proche.pk });
      }
    }
  }

  // Cleanup
  const potVus: WaterFeature[] = [];
  potables.sort((a, b) => a.pk - b.pk);
  for (const pt of potables) {
    if (!potVus.find(v => Math.abs(v.pk - pt.pk) < 150))
      potVus.push({ forme: "point", type: pt.type, nom: pt.nom, potable: true, lat: pt.lat, lon: pt.lon, d: pt.dist, pk: pt.pk, pkMin: pt.pk, pkMax: pt.pk });
  }
  const zones = sortie.filter(p => !p.potable && p.forme === "zone").sort((a, b) => a.pkMin - b.pkMin);
  const points = sortie.filter(p => !p.potable && p.forme === "point");
  const zonesFuses: WaterFeature[] = [];
  for (const s of zones) {
    const prev = zonesFuses[zonesFuses.length - 1];
    const memeNom = !prev || !prev.nom || !s.nom || prev.nom === s.nom;
    if (prev && s.pkMin - prev.pkMax < 150 && memeNom) {
      prev.pkMax = Math.max(prev.pkMax, s.pkMax);
      if (s.d != null && (prev.d == null || s.d < prev.d)) { prev.d = s.d; prev.lat = s.lat; prev.lon = s.lon; }
      if (!prev.nom && s.nom) prev.nom = s.nom;
      if (s.ligne) prev.ligne = (prev.ligne || []).concat(s.ligne);
    } else zonesFuses.push({ ...s });
  }
  zonesFuses.forEach(s => { s.pk = (s.pkMin + s.pkMax) / 2; });
  const pointsFiltres = points.filter(p => !zonesFuses.some(z => p.pk >= z.pkMin - 80 && p.pk <= z.pkMax + 80));
  pointsFiltres.sort((a, b) => a.pk - b.pk);
  const pointsVus: WaterFeature[] = [];
  for (const p of pointsFiltres) if (!pointsVus.find(v => Math.abs(v.pk - p.pk) < 200)) pointsVus.push(p);

  const tout = [...zonesFuses, ...pointsVus, ...potVus];
  tout.sort((a, b) => (a.pkMin ?? a.pk) - (b.pkMin ?? b.pk));
  return tout;
}
