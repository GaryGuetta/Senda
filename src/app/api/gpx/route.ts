import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TrailFeatures, featuresToVector, applyWeights, vectorToString } from "@/lib/vector";
import { ScoredPoint, buildGrid, findNearest, computeOverlap, mergeScores } from "@/lib/overlap";
import { trainModel, predictScore, blendedScore, TrainingFeatures } from "@/lib/learning";
import { getCurrentUserId } from "@/lib/session";

interface TrackPoint { lat: number; lng: number; ele: number | null }

// ─── GPX parser ───────────────────────────────────────────────────────────────
function parseGPX(xml: string): { name: string; points: TrackPoint[] } | null {
  try {
    const nameMatch = xml.match(/<name[^>]*>([\s\S]*?)<\/name>/i)
    let name = nameMatch
      ? nameMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, "$1").trim()
      : "Sentier importé"
    name = name
      .replace(/&#039;/g, "'").replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"').replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&apos;/g, "'")

    const pattern = /<(?:trkpt|rtept)[^>]+lat="([^"]+)"[^>]+lon="([^"]+)"[^>]*>([\s\S]*?)<\/(?:trkpt|rtept)>/gi
    const points: TrackPoint[] = []
    let m
    while ((m = pattern.exec(xml)) !== null) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2])
      const eleMatch = m[3].match(/<ele>([\s\S]*?)<\/ele>/i)
      const ele = eleMatch ? parseFloat(eleMatch[1]) : null
      if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng, ele })
    }
    return points.length >= 2 ? { name, points } : null
  } catch { return null }
}

// ─── Haversine ────────────────────────────────────────────────────────────────
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Elevations via OpenTopo SRTM 30m ─────────────────────────────────────────
// Median filter to remove SRTM noise spikes (single-pixel errors)
function medianFilter(arr: number[], window: number): number[] {
  const half = Math.floor(window / 2)
  return arr.map((_, i) => {
    const slice: number[] = []
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) slice.push(arr[j])
    slice.sort((a, b) => a - b)
    return slice[Math.floor(slice.length / 2)]
  })
}

// Light gaussian smoothing of elevation profile (preserve real terrain, kill jitter)
function smoothElevations(arr: number[], radius: number): number[] {
  return arr.map((_, i) => {
    let sum = 0, w = 0
    for (let j = Math.max(0, i - radius); j <= Math.min(arr.length - 1, i + radius); j++) {
      const weight = Math.exp(-((j - i) ** 2) / (2 * (radius / 2) ** 2))
      sum += arr[j] * weight; w += weight
    }
    return sum / w
  })
}

// Fetch elevations with HIGHER resolution by chaining multiple OpenTopo requests
// Each request handles 100 points; we use up to 3 requests = 300 sample points
// Then interpolate to full track + median filter + smooth
async function fetchElevations(points: TrackPoint[]): Promise<number[]> {
  const PER_REQUEST = 100
  const MAX_REQUESTS = 3
  const maxSamples = PER_REQUEST * MAX_REQUESTS

  // Determine sample indices
  const sampleCount = Math.min(points.length, maxSamples)
  const indices = points.length > sampleCount
    ? Array.from({ length: sampleCount }, (_, i) => Math.round(i * (points.length - 1) / (sampleCount - 1)))
    : points.map((_, i) => i)

  // Split into batches of 100
  const batches: number[][] = []
  for (let i = 0; i < indices.length; i += PER_REQUEST) {
    batches.push(indices.slice(i, i + PER_REQUEST))
  }

  const allElevations: number[] = []
  try {
    for (const batch of batches) {
      const latlons = batch.map(i => `${points[i].lat.toFixed(6)},${points[i].lng.toFixed(6)}`).join("|")
      const res = await fetch(
        `https://api.opentopodata.org/v1/srtm30m?locations=${latlons}&interpolation=bilinear`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) }
      )
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      if (data.status !== "OK") throw new Error("non-OK")
      allElevations.push(...data.results.map((r: any) => r.elevation ?? 0))
      // Rate limit courtesy: brief pause between requests
      if (batches.length > 1) await new Promise(r => setTimeout(r, 1100))
    }

    // Clean the sampled elevations: median filter removes spikes
    const cleaned = medianFilter(allElevations, 3)

    // Interpolate back to full track
    let full: number[]
    if (points.length <= sampleCount) {
      full = cleaned
    } else {
      full = points.map((_, i) => {
        let lo = 0, hi = indices.length - 1
        while (lo < hi - 1) { const mid = Math.floor((lo + hi) / 2); if (indices[mid] <= i) lo = mid; else hi = mid }
        if (i <= indices[lo]) return cleaned[lo]
        if (i >= indices[hi]) return cleaned[hi]
        const t = (i - indices[lo]) / (indices[hi] - indices[lo])
        return cleaned[lo] + t * (cleaned[hi] - cleaned[lo])
      })
    }

    // Final light smoothing to remove interpolation steps
    const smoothRadius = Math.max(2, Math.floor(points.length * 0.01))
    return smoothElevations(full, smoothRadius)
  } catch (e) {
    console.warn("OpenTopo fallback:", e)
    // Fallback: use GPX elevations if present, smoothed
    const gpxEle = points.map(p => p.ele ?? 0)
    return gpxEle.some(e => e > 0) ? smoothElevations(medianFilter(gpxEle, 3), 3) : gpxEle
  }
}

// ─── OSM surface + SAC + visibility + landcover ───────────────────────────────
const SURFACE_SCORE: Record<string, number> = {
  paved: 0, asphalt: 0, concrete: 0, paving_stones: 1,
  compacted: 1.5, fine_gravel: 2, gravel: 2.5, wood: 1.5, boardwalk: 1,
  ground: 3, dirt: 3, earth: 3, grass: 3.5, clay: 4, sand: 4.5, pebblestone: 4,
  cobblestone: 5, sett: 4.5, rock: 7, rocks: 7, stone: 6,
  shingle: 6.5, stepping_stones: 6, mud: 7, scree: 9, ice: 10, snow: 8.5,
}
const SAC_SCORE: Record<string, number> = {
  hiking: 1.5, mountain_hiking: 4, demanding_mountain_hiking: 6.5,
  alpine_hiking: 8, demanding_alpine_hiking: 9, difficult_alpine_hiking: 10,
}
const TRACK_SCORE: Record<string, number> = { grade1: 0.5, grade2: 2, grade3: 4, grade4: 7, grade5: 9 }
const VIS_SCORE: Record<string, number> = {
  excellent: 0, good: 1, intermediate: 4, bad: 7, horrible: 9, no: 10,
}

// Landcover → description terrain + score difficulté additif
const LANDCOVER_INFO: Record<string, { label: string; terrainDesc: string; bonus: number }> = {
  // Naturel difficile
  "natural=scree":       { label: "Éboulis", terrainDesc: "terrain en éboulis, pierriers instables", bonus: 3.5 },
  "natural=bare_rock":   { label: "Roche nue", terrainDesc: "rocher nu, adhérence variable", bonus: 2.5 },
  "natural=glacier":     { label: "Glacier", terrainDesc: "glacier — crampons possiblement nécessaires", bonus: 4.0 },
  "natural=cliff":       { label: "Falaise", terrainDesc: "zone de falaises", bonus: 3.0 },
  // Végétation dense = terrain caché, humide
  "natural=scrub":       { label: "Garrigue / maquis", terrainDesc: "végétation dense, sol irrégulier caché", bonus: 1.5 },
  "natural=heath":       { label: "Lande", terrainDesc: "lande ouverte, sol inégal", bonus: 1.0 },
  "natural=wetland":     { label: "Zone humide", terrainDesc: "terrain marécageux, glissant", bonus: 2.0 },
  "natural=grassland":   { label: "Prairie alpine", terrainDesc: "herbe, sol meuble en altitude", bonus: 0.5 },
  "natural=beach":       { label: "Plage / grève", terrainDesc: "sable ou galets, instable", bonus: 1.5 },
  // Forêt = racines, humidité
  "natural=wood":        { label: "Forêt naturelle", terrainDesc: "sous-bois, racines, sol humide possible", bonus: 0.8 },
  "landuse=forest":      { label: "Forêt", terrainDesc: "chemin forestier, racines, sol variable", bonus: 0.5 },
  // Facile
  "landuse=meadow":      { label: "Prairie", terrainDesc: "herbe rase, terrain dégagé", bonus: 0.0 },
  "landuse=farmland":    { label: "Terrain agricole", terrainDesc: "chemin agricole", bonus: 0.0 },
}

// ─── Surface family classification ────────────────────────────────────────────
// Maps a raw OSM surface/landcover label to one of 4 families for the breakdown
export type SurfaceFamily = "route" | "sentier" | "rocheux" | "montagne"

const SURFACE_TO_FAMILY: Record<string, SurfaceFamily> = {
  // Routes & chemins roulants
  paved: "route", asphalt: "route", concrete: "route", paving_stones: "route",
  cobblestone: "route", sett: "route",
  // Sentiers naturels (pistes, terre, gravier — pas du bitume)
  compacted: "sentier", fine_gravel: "sentier",
  gravel: "sentier", ground: "sentier", dirt: "sentier", earth: "sentier",
  grass: "sentier", sand: "sentier", clay: "sentier", woodchips: "sentier",
  wood: "sentier", boardwalk: "sentier",
  // Terrain rocheux
  pebblestone: "rocheux", rock: "rocheux", rocks: "rocheux", stone: "rocheux",
  stepping_stones: "rocheux", shingle: "rocheux", mud: "rocheux",
  // Haute montagne
  scree: "montagne", snow: "montagne", ice: "montagne",
}

// Landcover labels → family (when surface not tagged)
const LANDCOVER_TO_FAMILY: Record<string, SurfaceFamily> = {
  "Forêt": "sentier", "Forêt naturelle": "sentier", "Prairie": "sentier",
  "Prairie alpine": "sentier", "Lande": "sentier", "Garrigue / maquis": "sentier",
  "Terrain agricole": "sentier", "Zone humide": "rocheux",
  "Roche nue": "rocheux", "Éboulis": "montagne", "Glacier": "montagne",
  "Falaise": "montagne", "Plage / grève": "sentier",
}

function classifyFamily(surfaceLabel: string, landcoverLabel: string | null): SurfaceFamily {
  const s = surfaceLabel.toLowerCase()
  if (SURFACE_TO_FAMILY[s]) return SURFACE_TO_FAMILY[s]
  if (landcoverLabel && LANDCOVER_TO_FAMILY[landcoverLabel]) return LANDCOVER_TO_FAMILY[landcoverLabel]
  // SAC-based labels (via ferrata, escaliers) → rocheux
  if (s.includes("via") || s.includes("escalier")) return "rocheux"
  if (s.includes("alpine")) return "montagne"
  if (s.includes("hiking")) return "sentier"
  return "sentier" // default
}

// ─── POIs terrain (éboulis, falaises, glaciers…) ──────────────────────────────
// ─── BULK PATH FETCH — one request gets every path in the track's bbox ────────
// Returns all OSM ways (paths/tracks/roads) with their geometry + tags, so we
// can match each segment of the user's track to the path it actually follows.
interface OSMWay {
  coords: [number, number][]  // [lat, lng] points of the way
  surface: string
  sac: string
  tracktype: string
  visibility: string
  highway: string
}

// ─── Shared Overpass runner — tries mirrors with retry ────────────────────────
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
]

async function runOverpass(query: string, label: string, timeoutMs = 40000): Promise<any | null> {
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const endpoint = OVERPASS_ENDPOINTS[i]
    const host = endpoint.split("/")[2]
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass policy requires a meaningful User-Agent — without it the
          // public servers reject with 406/429.
          "User-Agent": "Senda/1.0 (hiking difficulty app; contact: trailrate-app)",
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        const snippet = (await res.text().catch(() => "")).slice(0, 120)
        console.warn(`[${label}] ${host} → HTTP ${res.status} ${snippet}`)
        await new Promise(r => setTimeout(r, 400))
        continue
      }
      const data = await res.json()
      return data
    } catch (e: any) {
      console.warn(`[${label}] ${host} failed: ${e?.name ?? e}`)
      await new Promise(r => setTimeout(r, 400))
    }
  }
  console.warn(`[${label}] All Overpass mirrors failed`)
  return null
}

// ─── Unified OSM fetch — paths + landcover + POIs in ONE Overpass request ──────
// Combining the two former queries into one round trip roughly halves the OSM
// wait time and avoids hitting the same mirror twice (which triggered 429s).
interface OSMPoi { type: string; label: string; icon: string; lat: number; lng: number }

const POI_TAGMAP: Record<string, { label: string; icon: string; danger: number }> = {
  scree:     { label: "Éboulis",      icon: "🪨", danger: 3 },
  cliff:     { label: "Falaise",      icon: "⛰️",  danger: 4 },
  glacier:   { label: "Glacier",      icon: "🧊", danger: 4 },
  peak:      { label: "Sommet",       icon: "▲",  danger: 1 },
  saddle:    { label: "Col",          icon: "〰️", danger: 1 },
  rock:      { label: "Rocher",       icon: "🪨", danger: 2 },
  boulder:   { label: "Bloc rocher",  icon: "🪨", danger: 2 },
  waterfall: { label: "Cascade",      icon: "💧", danger: 1 },
}

async function fetchOSMBundle(bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }): Promise<{
  ways: OSMWay[]
  landcover: { coords: [number, number][]; key: string }[]
  pois: OSMPoi[]
}> {
  const b = `(${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng})`
  // One query, three output sets: walkable ways, landcover polygons, danger POIs
  const q = `[out:json][timeout:60];
(
  way["highway"~"^(path|footway|track|bridleway|steps|via_ferrata|cycleway|residential|service|unclassified|tertiary|secondary|primary|living_street|pedestrian|road)$"]${b};
);
out tags geom;
(
  way["natural"~"^(scree|bare_rock|glacier|scrub|heath|wetland|grassland|wood|beach)$"]${b};
  way["landuse"~"^(forest|meadow|farmland)$"]${b};
);
out tags geom;
(
  node["natural"~"^(scree|cliff|glacier|peak|saddle|rock|boulder)$"]${b};
  node["waterway"="waterfall"]${b};
  node["highway"="via_ferrata"]${b};
);
out center 80;`

  const data = await runOverpass(q, "OSM-bundle")
  const ways: OSMWay[] = []
  const landcover: { coords: [number, number][]; key: string }[] = []
  const pois: OSMPoi[] = []
  if (!data) return { ways, landcover, pois }

  for (const el of (data.elements ?? [])) {
    const tags = el.tags ?? {}
    // POI nodes (have lat/lon directly, or center)
    if (el.type === "node") {
      const natural = tags.natural ?? tags.waterway ?? tags.highway ?? ""
      const mapped = POI_TAGMAP[natural]
      if (mapped) {
        const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon
        if (lat && lng) pois.push({ type: natural, label: tags.name ? `${mapped.label} – ${tags.name}` : mapped.label, icon: mapped.icon, lat, lng })
      }
      continue
    }
    if (el.type !== "way" || !el.geometry) continue
    const coords: [number, number][] = el.geometry.map((g: any) => [g.lat, g.lon])
    if (tags.highway) {
      ways.push({
        coords,
        surface: (tags.surface ?? "").toLowerCase(),
        sac: (tags.sac_scale ?? "").toLowerCase(),
        tracktype: (tags.tracktype ?? "").toLowerCase(),
        visibility: (tags.trail_visibility ?? "").toLowerCase(),
        highway: (tags.highway ?? "").toLowerCase(),
      })
    } else if (tags.natural || tags.landuse) {
      const key = tags.natural ? `natural=${tags.natural}` : `landuse=${tags.landuse}`
      landcover.push({ coords, key })
    }
  }
  console.log(`[OSM-bundle] ${ways.length} ways, ${landcover.length} landcover, ${pois.length} POIs`)
  return { ways, landcover, pois }
}

// Distance from a point to a line segment (in metres, approximate via equirect)
function pointToSegmentDist(plat: number, plng: number, alat: number, alng: number, blat: number, blng: number): number {
  // Convert to local metric space (good enough at trail scale)
  const latRef = (alat + blat) / 2 * Math.PI / 180
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos(latRef)
  const px = plng * mPerDegLng, py = plat * mPerDegLat
  const ax = alng * mPerDegLng, ay = alat * mPerDegLat
  const bx = blng * mPerDegLng, by = blat * mPerDegLat
  const dx = bx - ax, dy = by - ay
  const len2 = dx*dx + dy*dy
  if (len2 === 0) return Math.sqrt((px-ax)**2 + (py-ay)**2)
  let t = ((px-ax)*dx + (py-ay)*dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t*dx, cy = ay + t*dy
  return Math.sqrt((px-cx)**2 + (py-cy)**2)
}

// For a track point, find the nearest OSM way and return its tags
// ─── Spatial grid index for fast way lookup ───────────────────────────────────
// Without this, matching 250 points against 1200+ ways is O(points × segments)
// and very slow. The grid buckets each way-segment into ~60m cells so each
// point only tests segments in its own + neighbouring cells.
const WAY_CELL = 0.0006 // ~50-65m at latitude 42°
interface WaySegRef { way: OSMWay; a: [number, number]; b: [number, number] }
type WayGrid = Map<string, WaySegRef[]>

function buildWayGrid(ways: OSMWay[]): WayGrid {
  const grid: WayGrid = new Map()
  for (const way of ways) {
    for (let i = 0; i < way.coords.length - 1; i++) {
      const a = way.coords[i], b = way.coords[i + 1]
      // Insert the segment into every cell its endpoints touch (plus a span)
      const minLat = Math.min(a[0], b[0]), maxLat = Math.max(a[0], b[0])
      const minLng = Math.min(a[1], b[1]), maxLng = Math.max(a[1], b[1])
      const c0 = Math.floor(minLat / WAY_CELL), c1 = Math.floor(maxLat / WAY_CELL)
      const d0 = Math.floor(minLng / WAY_CELL), d1 = Math.floor(maxLng / WAY_CELL)
      const ref: WaySegRef = { way, a, b }
      for (let cl = c0; cl <= c1; cl++) {
        for (let dl = d0; dl <= d1; dl++) {
          const key = `${cl},${dl}`
          const arr = grid.get(key)
          if (arr) arr.push(ref); else grid.set(key, [ref])
        }
      }
    }
  }
  return grid
}

function matchPointToWayGrid(lat: number, lng: number, grid: WayGrid, maxDistM = 40): OSMWay | null {
  const cLat = Math.floor(lat / WAY_CELL), cLng = Math.floor(lng / WAY_CELL)
  let best: OSMWay | null = null
  let bestDist = maxDistM
  const seen = new Set<WaySegRef>()
  for (let dc = -1; dc <= 1; dc++) {
    for (let dd = -1; dd <= 1; dd++) {
      const arr = grid.get(`${cLat + dc},${cLng + dd}`)
      if (!arr) continue
      for (const ref of arr) {
        if (seen.has(ref)) continue
        seen.add(ref)
        const d = pointToSegmentDist(lat, lng, ref.a[0], ref.a[1], ref.b[0], ref.b[1])
        if (d < bestDist) { bestDist = d; best = ref.way }
      }
    }
  }
  return best
}

// Check if a point is inside (or near) a landcover polygon — returns the key
// Hardness rank for prioritising overlapping/nearby landcover
const LANDCOVER_HARDNESS: Record<string, number> = {
  "natural=glacier": 5, "natural=scree": 4, "natural=bare_rock": 4,
  "natural=wetland": 3, "natural=scrub": 2,
  // cliff is an EDGE, not a walking surface — score 0 so proximity-snapping
  // never paints a whole segment as "falaise" just for passing near a cliff line
  "natural=cliff": 0,
  "natural=heath": 2, "natural=beach": 2, "natural=wood": 1,
  "landuse=forest": 1, "natural=grassland": 1, "landuse=meadow": 1, "landuse=farmland": 1,
}

function matchPointToLandcover(lat: number, lng: number, landcover: { coords: [number, number][]; key: string }[]): string | null {
  // First: collect ALL polygons the point is inside, keep the hardest terrain
  let bestInside: string | null = null
  let bestInsideHardness = -1
  for (const poly of landcover) {
    if (pointInPolygon(lat, lng, poly.coords)) {
      const h = LANDCOVER_HARDNESS[poly.key] ?? 0
      if (h > bestInsideHardness) { bestInsideHardness = h; bestInside = poly.key }
    }
  }
  if (bestInside) return bestInside

  // Second: if not inside any, find the nearest HARD-terrain polygon edge
  // within 40m (scree/rock zones are often small and the track skirts them)
  let nearestHard: string | null = null
  let nearestDist = 40
  for (const poly of landcover) {
    const h = LANDCOVER_HARDNESS[poly.key] ?? 0
    if (h < 3) continue // only snap to genuinely hard terrain (scree/rock/wetland+)
    for (let i = 0; i < poly.coords.length - 1; i++) {
      const [alat, alng] = poly.coords[i]
      const [blat, blng] = poly.coords[i + 1]
      const d = pointToSegmentDist(lat, lng, alat, alng, blat, blng)
      if (d < nearestDist) { nearestDist = d; nearestHard = poly.key }
    }
  }
  return nearestHard
}

// Ray-casting point-in-polygon
function pointInPolygon(lat: number, lng: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [iLat, iLng] = poly[i]
    const [jLat, jLng] = poly[j]
    if (((iLng > lng) !== (jLng > lng)) &&
        (lat < (jLat - iLat) * (lng - iLng) / (jLng - iLng) + iLat)) {
      inside = !inside
    }
  }
  return inside
}


// ─── Smooth ───────────────────────────────────────────────────────────────────
function gaussianSmooth(arr: number[], radius: number): number[] {
  return arr.map((_, i) => {
    let sum = 0, w = 0
    for (let j = Math.max(0, i - radius); j <= Math.min(arr.length - 1, i + radius); j++) {
      const weight = Math.exp(-((j - i) ** 2) / (2 * (radius / 2.5) ** 2))
      sum += arr[j] * weight; w += weight
    }
    return sum / w
  })
}

// ─── Global score (Schoeller + surface) ──────────────────────────────────────
// Global difficulty — accounts for effort, terrain, descent strain, and
// "saw-tooth" profiles (many small climbs are more tiring than one big one)
function computeGlobalDifficulty(
  distKm: number, elevGain: number, elevLoss: number,
  surfaceScore: number, maxAlt: number, sawtoothFactor: number
): number {
  // Base Schoeller effort: D+ + distance×10
  const effort = elevGain + distKm * 10
  let effortScore = 10 * (1 - Math.exp(-effort / 900))

  // Descent strain: steep prolonged descent adds fatigue (knees, focus)
  // Only counts when significant (>600m D-)
  const descentStrain = Math.min(0.6, Math.max(0, (elevLoss - 600) / 2000))

  // Saw-tooth penalty: a route with the same D+ split across many climbs
  // is harder than one continuous climb. sawtoothFactor is 0-1.
  const sawtoothPenalty = sawtoothFactor * 0.8

  // High-altitude global penalty: sustained effort above 2000m is harder
  const altPenalty = Math.min(0.7, Math.max(0, (maxAlt - 2000) / 1500))

  // Surface contribution
  const surfaceBonus = (surfaceScore / 10) * 1.0

  const total = effortScore + descentStrain + sawtoothPenalty + altPenalty + surfaceBonus
  return Math.min(10, Math.max(0.5, Math.round(total * 10) / 10))
}

// ─── Per-segment score (100% local) ──────────────────────────────────────────
// Segment score — distinguishes steep ascent (cardio) from steep descent
// (technical, knee strain). Both are hard but for different reasons.
function computeSegmentScore(
  signedSlopePct: number, roughness: number, surfaceScore: number, altM: number
): number {
  const slopePct = Math.abs(signedSlopePct)
  const isDescent = signedSlopePct < 0

  // Base slope difficulty curve
  let slopeScore: number
  if (slopePct <= 10)       slopeScore = slopePct * 0.45
  else if (slopePct <= 25)  slopeScore = 4.5 + (slopePct - 10) * 0.23
  else                      slopeScore = 8.0 + Math.min(2, (slopePct - 25) * 0.08)
  slopeScore = Math.min(10, slopeScore)

  // Steep descents are technically harder than the same gradient uphill
  // (loss of control, knee impact) — apply a multiplier above 18%
  if (isDescent && slopePct > 18) {
    slopeScore = Math.min(10, slopeScore * 1.15)
  }

  // Surface — on steep descent, loose/rocky surface is much more dangerous
  let surfaceContrib = (surfaceScore / 10) * 2.5
  if (isDescent && slopePct > 20 && surfaceScore >= 6) {
    surfaceContrib *= 1.3  // scree/rock on steep descent = high risk
  }

  const altBonus = Math.min(1.0, Math.max(0, (altM - 2200) / 1000))
  const roughContrib = Math.min(1.2, roughness * 0.35)

  return Math.min(10, Math.max(0, slopeScore + surfaceContrib + altBonus + roughContrib))
}

// ─── Difficulty reasons ───────────────────────────────────────────────────────
interface DifficultyReason { icon: string; label: string; detail: string; severity: "low"|"medium"|"high" }

function buildReasons(p: {
  distKm: number; elevGain: number; elevLoss: number; maxSlope: number
  avgSurface: number; surfaceLabel: string; sacLabel: string | null
  visibilityScore: number; maxAlt: number; pois: any[]; globalScore: number
  landcoverLabel?: string | null; landcoverDesc?: string | null
}): DifficultyReason[] {
  const reasons: DifficultyReason[] = []

  // Judge elevation by GRADIENT (D+ per km), not raw total.
  // +1262m over 115km is flat; +1262m over 8km is brutal.
  const gradient = p.distKm > 0 ? p.elevGain / p.distKm : 0  // m of climb per km
  if (p.elevGain > 1500 && gradient > 80)
    reasons.push({ icon:"⬆️", label:"Dénivelé très important", detail:`+${p.elevGain} m (${Math.round(gradient)} m/km) — grosse montée`, severity:"high" })
  else if (gradient > 100)
    reasons.push({ icon:"⬆️", label:"Montée raide soutenue", detail:`+${p.elevGain} m sur ${p.distKm} km (${Math.round(gradient)} m/km)`, severity:"high" })
  else if (gradient > 60)
    reasons.push({ icon:"⬆️", label:"Dénivelé important", detail:`+${p.elevGain} m (${Math.round(gradient)} m/km)`, severity:"medium" })
  else if (gradient > 35)
    reasons.push({ icon:"⬆️", label:"Dénivelé modéré", detail:`+${p.elevGain} m sur ${p.distKm} km`, severity:"low" })
  else if (p.elevGain > 600)
    // High total but spread out — note it as endurance, not steepness
    reasons.push({ icon:"⬆️", label:"Dénivelé cumulé notable", detail:`+${p.elevGain} m répartis sur ${p.distKm} km (faible pente)`, severity:"low" })

  // Descent strain: also gradient-aware
  const descGradient = p.distKm > 0 ? p.elevLoss / p.distKm : 0
  if (p.elevLoss > 1500 && descGradient > 80)
    reasons.push({ icon:"⬇️", label:"Descente très longue", detail:`-${p.elevLoss} m — impact important sur les genoux`, severity:"medium" })
  else if (descGradient > 90)
    reasons.push({ icon:"⬇️", label:"Descente raide", detail:`-${p.elevLoss} m (${Math.round(descGradient)} m/km) — sollicite les genoux`, severity:"medium" })

  if (p.maxSlope > 30)        reasons.push({ icon:"📐", label:"Pente très raide",    detail:`Passages à ${Math.round(p.maxSlope)}% de pente max`, severity:"high" })
  else if (p.maxSlope > 20)   reasons.push({ icon:"📐", label:"Pente raide",         detail:`Pente maximale ${Math.round(p.maxSlope)}%`, severity:"medium" })
  else if (p.maxSlope > 12)   reasons.push({ icon:"📐", label:"Pente soutenue",      detail:`Jusqu'à ${Math.round(p.maxSlope)}%`, severity:"low" })

  if (p.distKm > 15)          reasons.push({ icon:"📏", label:"Longue distance",     detail:`${p.distKm} km — effort d'endurance`, severity:"high" })
  else if (p.distKm > 10)     reasons.push({ icon:"📏", label:"Distance importante", detail:`${p.distKm} km`, severity:"medium" })

  if (p.maxAlt > 2500)        reasons.push({ icon:"🏔️", label:"Haute altitude",      detail:`Jusqu'à ${Math.round(p.maxAlt)} m — air raréfié, exposition`, severity:"high" })
  else if (p.maxAlt > 1800)   reasons.push({ icon:"🏔️", label:"Altitude élevée",     detail:`Point culminant à ${Math.round(p.maxAlt)} m`, severity:"medium" })

  const SAC_FR: Record<string, { label: string; detail: string; severity: "low"|"medium"|"high" }> = {
    "hiking":                    { label:"Randonnée classique",             detail:"Chemin balisé, chaussures de marche",                   severity:"low" },
    "mountain_hiking":           { label:"Randonnée montagne",              detail:"Bonne forme physique, chaussures de trekking",           severity:"medium" },
    "demanding_mountain_hiking": { label:"Montagne exigeante",              detail:"Terrain accidenté, expérience requise",                  severity:"high" },
    "alpine_hiking":             { label:"Randonnée alpine",                detail:"Mains parfois nécessaires, risque de chute",             severity:"high" },
    "demanding_alpine_hiking":   { label:"Alpinisme facile",                detail:"Passages exposés, expérience alpine indispensable",      severity:"high" },
    "difficult_alpine_hiking":   { label:"Alpinisme technique",             detail:"UIAA II-III, équipement spécialisé requis",              severity:"high" },
  }
  if (p.sacLabel && SAC_FR[p.sacLabel]) {
    const s = SAC_FR[p.sacLabel]
    reasons.push({ icon:"🧗", label:s.label, detail:s.detail, severity:s.severity })
  } else {
    const terrainDetail = p.landcoverDesc
      ?? (p.surfaceLabel !== "sentier" ? `Surface : ${p.surfaceLabel}` : null)
    if (p.avgSurface >= 8)
      reasons.push({ icon:"🪨", label:"Terrain très difficile", detail: terrainDetail ?? "Passages en rocher ou éboulis", severity:"high" })
    else if (p.avgSurface >= 5)
      reasons.push({ icon:"🥾", label:"Terrain accidenté", detail: terrainDetail ?? "Sol irrégulier, attention aux appuis", severity:"medium" })
    else if (p.avgSurface >= 3)
      reasons.push({ icon:"🌿", label: p.landcoverLabel ?? "Sentier naturel", detail: terrainDetail ?? "Chemin de montagne non aménagé", severity:"low" })
    else
      reasons.push({ icon:"🛤️", label:"Chemin aménagé", detail: terrainDetail ?? `Surface : ${p.surfaceLabel}`, severity:"low" })
  }

  const VIS_FR: Record<string, { label: string; detail: string; severity: "low"|"medium"|"high" }> = {
    "intermediate": { label:"Sentier partiellement visible", detail:"Attention à l'orientation, carte recommandée",         severity:"medium" },
    "bad":          { label:"Sentier peu visible",           detail:"Orientation difficile, carte et boussole nécessaires", severity:"high" },
    "horrible":     { label:"Trace très difficile à suivre", detail:"Hors-piste, compétences de navigation indispensables", severity:"high" },
    "no":           { label:"Pas de sentier visible",        detail:"Terrain vierge, expertise totale",                     severity:"high" },
  }
  if (p.visibilityScore >= 4 && p.sacLabel) {
    const key = Object.entries(VIS_FR).find(([,v]) => v.severity === (p.visibilityScore >= 7 ? "high" : "medium"))?.[0]
    if (key) reasons.push({ icon:"👁️", ...VIS_FR[key] })
  }

  const poiTypes = new Set(p.pois.map((x: any) => x.type))
  if (poiTypes.has("scree"))      reasons.push({ icon:"🪨", label:"Éboulis",         detail:"Zone d'éboulis à proximité du tracé", severity:"high" })
  if (poiTypes.has("cliff"))      reasons.push({ icon:"⛰️", label:"Falaises",        detail:"Passages exposés, risque de chute",   severity:"high" })
  if (poiTypes.has("glacier"))    reasons.push({ icon:"🧊", label:"Glacier",         detail:"Zone glaciaire — crampons possibles", severity:"high" })
  if (poiTypes.has("via_ferrata")) reasons.push({ icon:"⛏️", label:"Via ferrata",    detail:"Matériel spécifique requis",          severity:"high" })
  if (poiTypes.has("waterfall"))  reasons.push({ icon:"💧", label:"Cascade",         detail:"Passage potentiellement glissant",    severity:"medium" })

  if (reasons.length === 0) reasons.push({ icon:"✅", label:"Randonnée accessible", detail:"Terrain facile, convient à tous", severity:"low" })

  const order = { high: 0, medium: 1, low: 2 }
  return reasons.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 8)
}

// ─── Similarity score adjustment ─────────────────────────────────────────────
// Finds the N nearest trails in vector space and adjusts the calculated score
// toward the community-rated score of similar trails.
async function adjustScoreFromSimilars(
  trailId: string,
  vector: number[],
  calculatedScore: number,
  ownerId: string
): Promise<{ adjustedScore: number; similarTrails: any[] }> {
  const vecStr = vectorToString(vector)
  try {
    // Fetch 6 most similar trails (excluding current) that have user reviews
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        t.id,
        t.name,
        t.distance,
        t.elevation,
        (t."featureVector" <-> ${vecStr}::vector) as cosine_distance,
        AVG(r.difficulty) as community_score,
        COUNT(r.id) as review_count
      FROM trails t
      LEFT JOIN reviews r ON r."trailId" = t.id
      WHERE t.id != ${trailId}
        AND t."featureVector" IS NOT NULL
        AND t."userId" = ${ownerId}
      GROUP BY t.id, t.name, t.distance, t.elevation, t."featureVector"
      ORDER BY t."featureVector" <-> ${vecStr}::vector
      LIMIT 6
    `

    if (!rows.length) return { adjustedScore: calculatedScore, similarTrails: [] }

    // Weight each similar trail by inverse cosine distance and review count
    let weightedSum = 0, totalWeight = 0
    const similarTrails: any[] = []

    for (const row of rows) {
      const dist = parseFloat(row.cosine_distance)
      // Convert euclidean distance to similarity score
      // With normalised vectors (0-1 per dim), max distance ≈ sqrt(16) ≈ 4
      // We scale so distance=0 → similarity=1, distance>0.5 → similarity<0
      const similarity = Math.max(0, 1 - dist * 2.5)
      const reviewCount = parseInt(row.review_count)
      const communityScore = row.community_score ? parseFloat(row.community_score) : null

      similarTrails.push({
        id: row.id,
        name: row.name,
        distance: parseFloat(row.distance),
        elevation: parseInt(row.elevation),
        similarity: Math.round(similarity * 100),
        communityScore: communityScore ? Math.round(communityScore * 10) / 10 : null,
        reviewCount,
      })

      // Only use trails with actual reviews for score adjustment
      if (communityScore !== null && reviewCount > 0 && similarity > 0.7) {
        const weight = similarity * Math.log(1 + reviewCount)
        weightedSum += communityScore * weight
        totalWeight += weight
      }
    }

    // Blend: if we have strong similar trails with reviews, adjust toward them
    let adjustedScore = calculatedScore
    if (totalWeight > 0) {
      const neighborScore = weightedSum / totalWeight
      // Blend factor: more similar trails = more trust in neighbor score
      const blendFactor = Math.min(0.4, totalWeight / 10)
      adjustedScore = calculatedScore * (1 - blendFactor) + neighborScore * blendFactor
      adjustedScore = Math.round(adjustedScore * 10) / 10
      console.log(`[ML] calc=${calculatedScore} → neighbors=${neighborScore.toFixed(1)} blend=${blendFactor.toFixed(2)} → adjusted=${adjustedScore}`)
    }

    return { adjustedScore, similarTrails }
  } catch (e) {
    console.warn("[ML] similarity query failed:", e)
    return { adjustedScore: calculatedScore, similarTrails: [] }
  }
}

// ─── Process geographic overlap with existing trails ──────────────────────────
// Detects shared path segments and merges scores both ways:
//   - corrects the NEW trail's segments using existing data
//   - corrects EXISTING trails' segments using the new data
// This is the permanent learning loop — every import refines crossing trails.
async function processOverlaps(
  newTrailId: string,
  newPoints: ScoredPoint[],
  newSegmentScores: number[],
  newCoords: [number, number][],
  ownerId: string
): Promise<{ correctedTrails: number; correctedSegments: number; newScoresAdjusted: number[] }> {
  try {
    // Load all other trails with their geojson (points + segment scores)
    const others: any[] = await prisma.$queryRaw`
      SELECT id, name, geojson FROM trails WHERE id != ${newTrailId} AND "userId" = ${ownerId}
    `
    if (!others.length) {
      return { correctedTrails: 0, correctedSegments: 0, newScoresAdjusted: newSegmentScores }
    }

    const adjustedNewScores = [...newSegmentScores]
    let correctedTrails = 0
    let totalCorrectedSegments = 0

    for (const other of others) {
      const props = other.geojson?.properties
      const otherCoords: [number, number][] = other.geojson?.geometry?.coordinates ?? []
      const otherScores: number[] = props?.segmentScores ?? []
      const confirmCounts: number[] = props?.confirmCounts ?? otherCoords.map(() => 1)
      if (otherCoords.length < 2 || !otherScores.length) continue

      // Build scored points for the OTHER trail
      const otherPoints: ScoredPoint[] = otherCoords.map(([lng, lat], i) => {
        const sIdx = Math.min(Math.round(i * (otherScores.length - 1) / Math.max(otherCoords.length - 1, 1)), otherScores.length - 1)
        return { lat, lng, score: otherScores[sIdx] }
      })
      const otherGrid = buildGrid(otherPoints)

      // Track which other-points get corrected
      const otherUpdates = new Map<number, number>() // coordIdx -> new score
      let sharedCount = 0

      // For each point of the NEW trail, look for a match in the OTHER trail
      for (let i = 0; i < newPoints.length; i++) {
        const np = newPoints[i]
        const match = findNearest(otherGrid, np.lat, np.lng, 25)
        if (!match) continue
        sharedCount++

        // Find the other-trail coord index closest to this match
        let otherIdx = -1, bestD = 26
        const cLat = Math.round(match.lat / 0.0003), cLng = Math.round(match.lng / 0.0003)
        for (let oi = 0; oi < otherCoords.length; oi++) {
          const [olng, olat] = otherCoords[oi]
          const d = Math.abs(olat - match.lat) + Math.abs(olng - match.lng)
          if (d < bestD) { bestD = d; otherIdx = oi }
        }

        // Merge: the new trail's segment score for this point
        const newSegIdx = Math.min(Math.round(i * (adjustedNewScores.length - 1) / Math.max(newPoints.length - 1, 1)), adjustedNewScores.length - 1)
        const newScore = adjustedNewScores[newSegIdx]
        const existingScore = match.score
        const confirms = otherIdx >= 0 && confirmCounts[otherIdx] ? confirmCounts[otherIdx] : 1

        // Pull the new score toward the confirmed existing score
        const merged = mergeScores(existingScore, confirms, newScore)

        // Update both: new trail moves toward merged, other trail moves toward merged
        adjustedNewScores[newSegIdx] = (newScore + merged) / 2
        if (otherIdx >= 0) otherUpdates.set(otherIdx, merged)
      }

      // If meaningful overlap, persist the OTHER trail's corrections
      if (sharedCount >= 5 && otherUpdates.size >= 3) {
        const updatedOtherScores = [...otherScores]
        const updatedConfirms = [...confirmCounts]
        for (const [coordIdx, newSc] of otherUpdates) {
          const sIdx = Math.min(Math.round(coordIdx * (updatedOtherScores.length - 1) / Math.max(otherCoords.length - 1, 1)), updatedOtherScores.length - 1)
          updatedOtherScores[sIdx] = Math.round(newSc * 100) / 100
          updatedConfirms[coordIdx] = (updatedConfirms[coordIdx] ?? 1) + 1
        }

        // Recompute the other trail's global score as mean of its segments
        const otherGlobal = Math.round(updatedOtherScores.reduce((a, b) => a + b, 0) / updatedOtherScores.length * 10) / 10

        const updatedGeojson = {
          ...other.geojson,
          properties: {
            ...props,
            segmentScores: updatedOtherScores,
            confirmCounts: updatedConfirms,
            globalScore: otherGlobal,
            overlapLearned: true,
          },
        }
        await prisma.$executeRaw`
          UPDATE trails SET geojson = ${JSON.stringify(updatedGeojson)}::jsonb WHERE id = ${other.id}
        `
        correctedTrails++
        totalCorrectedSegments += otherUpdates.size
        console.log(`[OVERLAP] "${other.name}": ${sharedCount} shared pts, ${otherUpdates.size} segments corrected → global ${otherGlobal}`)
      }
    }

    return { correctedTrails, correctedSegments: totalCorrectedSegments, newScoresAdjusted: adjustedNewScores }
  } catch (e) {
    console.warn("[OVERLAP] failed:", e)
    return { correctedTrails: 0, correctedSegments: 0, newScoresAdjusted: newSegmentScores }
  }
}

// ─── Apply the learned model to predict difficulty ────────────────────────────
// Trains on-the-fly from all reviewed trails, then blends the learned
// prediction with the formula score based on how much data we have.
async function applyLearnedModel(
  features: TrainingFeatures,
  formulaScore: number,
  userId: string
): Promise<{ finalScore: number; modelInfo: any }> {
  try {
    // Train ONLY on this user's own reviews — the model is personal
    const trails: any[] = await prisma.$queryRaw`
      SELECT t.geojson,
        AVG(r.difficulty) as avg_score
      FROM trails t
      INNER JOIN reviews r ON r."trailId" = t.id
      WHERE r."userId" = ${userId}
      GROUP BY t.id, t.geojson
      HAVING COUNT(r.id) >= 1
    `

    const samples: { features: TrainingFeatures; targetScore: number }[] = []
    for (const t of trails) {
      const props = t.geojson?.properties
      const f = props?.features
      const stats = props?.stats
      if ((f || stats) && t.avg_score != null) {
        samples.push({
          features: {
            effortIndex: f?.effortIndex ?? stats?.effortIndex ?? 0,
            slopeMax: f?.slopeMax ?? stats?.slopeMax ?? 0,
            slopeAvg: f?.slopeAvg ?? 0,
            pctSteep: f?.pctSteep ?? 0,
            surfaceScore: f?.surfaceScore ?? props?.surfaceScore ?? 5,
            maxAlt: f?.altMax ?? stats?.maxAlt ?? 0,
            pctHighAlt: f?.pctHighAlt ?? 0,
            sacScore: f?.sacScore ?? 0,
            poiDanger: f?.poiDangerCount ?? 0,
            distKm: f?.distKm ?? stats?.distKm ?? 0,
          },
          targetScore: parseFloat(t.avg_score),
        })
      }
    }

    // Not enough data yet — trust the formula entirely
    if (samples.length < 5) {
      return { finalScore: formulaScore, modelInfo: { trained: false, samples: samples.length } }
    }

    const model = trainModel(samples)
    const learnedScore = predictScore(model, features)
    const finalScore = blendedScore(formulaScore, learnedScore, samples.length)

    console.log(`[LEARN] formula=${formulaScore} learned=${learnedScore.toFixed(1)} samples=${samples.length} MAE=${model.meanError} → final=${finalScore}`)

    return {
      finalScore,
      modelInfo: {
        trained: true,
        samples: samples.length,
        learnedScore: Math.round(learnedScore * 10) / 10,
        formulaScore,
        meanError: model.meanError,
      },
    }
  } catch (e) {
    console.warn("[LEARN] failed:", e)
    return { finalScore: formulaScore, modelInfo: { trained: false, error: true } }
  }
}

// ─── Get the auto-calibration offset ──────────────────────────────────────────
// Returns a global correction if the formula systematically over/under-rates
// vs real user scores. Damped to avoid overcorrection.
async function getCalibrationOffset(userId: string): Promise<number> {
  try {
    const trails: any[] = await prisma.$queryRaw`
      SELECT t.geojson,
        AVG(r.difficulty) as user_score,
        COUNT(r.id) as rc
      FROM trails t
      INNER JOIN reviews r ON r."trailId" = t.id
      WHERE r."userId" = ${userId}
      GROUP BY t.id, t.geojson
      HAVING COUNT(r.id) >= 1
    `
    const pairs: { diff: number; weight: number }[] = []
    for (const t of trails) {
      const calc = t.geojson?.properties?.calculatedScore ?? t.geojson?.properties?.globalScore
      const user = t.user_score != null ? parseFloat(t.user_score) : null
      if (calc != null && user != null) {
        pairs.push({ diff: user - calc, weight: Math.log(1 + parseInt(t.rc)) })
      }
    }
    if (pairs.length < 3) return 0
    let ws = 0, wsum = 0
    for (const p of pairs) { ws += p.diff * p.weight; wsum += p.weight }
    const offset = ws / wsum
    // Damp the correction to 70% to avoid oscillation
    return Math.round(offset * 0.7 * 100) / 100
  } catch { return 0 }
}

// ─── Main POST ────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: "Connecte-toi pour importer une trace" }, { status: 401 })

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 })
    if (!file.name.toLowerCase().endsWith(".gpx"))
      return NextResponse.json({ error: "Format GPX requis" }, { status: 400 })

    const xml = await file.text()
    const parsed = parseGPX(xml)
    if (!parsed) return NextResponse.json({ error: "Impossible de lire le GPX" }, { status: 422 })
    const points = parsed.points

    // ── Metadata from the creation form ──────────────────────────────────
    const nameInput = (formData.get("name") as string | null)?.trim()
    const name = nameInput && nameInput.length > 0 ? nameInput : parsed.name
    const description = (formData.get("description") as string | null)?.trim() || null
    const isPublic = formData.get("isPublic") === "true"
    const difficultyRaw = formData.get("difficulty") as string | null
    const creatorDifficulty = difficultyRaw ? Math.max(1, Math.min(10, parseInt(difficultyRaw, 10))) : null
    let photos: string[] = []
    const photosRaw = formData.get("photos") as string | null
    if (photosRaw) {
      try { const arr = JSON.parse(photosRaw); if (Array.isArray(arr)) photos = arr.filter(p => typeof p === "string").slice(0, 8) } catch {}
    }
    // Description is mandatory for public traces
    if (isPublic && (!description || description.length < 10)) {
      return NextResponse.json({ error: "Une description d'au moins 10 caractères est requise pour publier une trace." }, { status: 400 })
    }
    console.log(`[GPX] "${name}" — ${points.length} pts · public=${isPublic} · ${photos.length} photos`)

    // 1+2. Fetch elevations (NASA SRTM) AND OSM data (paths+landcover+POIs) IN
    //       PARALLEL. They hit different servers, so total wait ≈ max(a,b)
    //       instead of a+b. This roughly halves the import time.
    const trackLats = points.map(p => p.lat), trackLngs = points.map(p => p.lng)
    const osmBbox = {
      minLat: Math.min(...trackLats) - 0.003, maxLat: Math.max(...trackLats) + 0.003,
      minLng: Math.min(...trackLngs) - 0.003, maxLng: Math.max(...trackLngs) + 0.003,
    }
    const [elevations, osmBundle] = await Promise.all([
      fetchElevations(points),
      fetchOSMBundle(osmBbox),
    ])
    const { ways: osmWays, landcover: osmLandcover, pois: bundlePois } = osmBundle

    // Per-point surface resolution along the whole track
    // We sample every Nth point (every ~15-20m of track) to keep it fast but dense
    const pointStep = Math.max(1, Math.floor(points.length / 250)) // up to 250 lookups
    const familyCounts: Record<SurfaceFamily, number> = { route: 0, sentier: 0, rocheux: 0, montagne: 0 }
    let surfaceSum = 0, sacSum = 0, visSum = 0, resolvedCount = 0
    const sacLabelCounts: Record<string, number> = {}
    let midSurfaceLabel = "sentier", midLandcoverLabel: string | null = null, midLandcoverDesc: string | null = null
    const midPointIdx = Math.floor(points.length / 2)

    // Per-point surface score (sampled at pointStep, interpolated to all points after)
    const sampledSurface: { idx: number; score: number }[] = []

    // Build spatial index once — turns the matching from O(points×segments)
    // into roughly O(points), a big speedup on dense areas (1000+ ways).
    const wayGrid = buildWayGrid(osmWays)

    for (let i = 0; i < points.length; i += pointStep) {
      const p = points[i]
      const way = matchPointToWayGrid(p.lat, p.lng, wayGrid, 40)
      const landKey = matchPointToLandcover(p.lat, p.lng, osmLandcover)

      let surfaceScore = 3.5, surfaceLabel = "sentier"
      let sac = "", vis = ""
      let family: SurfaceFamily | null = null   // explicit family decision
      let hasExplicitSurface = false

      if (way) {
        sac = way.sac; vis = way.visibility
        const hw = way.highway

        // (a) Explicit surface tag — most reliable
        if (way.surface && SURFACE_SCORE[way.surface] !== undefined) {
          surfaceScore = SURFACE_SCORE[way.surface]; surfaceLabel = way.surface
          family = SURFACE_TO_FAMILY[way.surface] ?? null
          hasExplicitSurface = true
        }
        // (b) Track grade
        else if (way.tracktype && TRACK_SCORE[way.tracktype] !== undefined) {
          surfaceScore = TRACK_SCORE[way.tracktype]; surfaceLabel = "piste " + way.tracktype
          family = way.tracktype === "grade1" ? "route" : "sentier"
          hasExplicitSurface = true
        }
        // (c) Paved road types → route
        else if (["residential","service","unclassified","tertiary","secondary","primary","cycleway"].includes(hw)) {
          surfaceScore = 0.5; surfaceLabel = "route"; family = "route"; hasExplicitSurface = true
        }
        // (d) Technical path types
        else if (hw === "via_ferrata") { surfaceScore = 10; surfaceLabel = "via ferrata"; family = "montagne"; hasExplicitSurface = true }
        else if (hw === "steps") { surfaceScore = 6; surfaceLabel = "escaliers"; family = "rocheux"; hasExplicitSurface = true }
      }

      // (e) SAC scale — heavily used in the Pyrenees, strong difficulty signal
      if (!hasExplicitSurface && sac && SAC_SCORE[sac] !== undefined) {
        const sc = SAC_SCORE[sac]
        if (sc >= 8) { family = "montagne"; surfaceScore = Math.max(surfaceScore, 8) }
        else if (sc >= 6) { family = "rocheux"; surfaceScore = Math.max(surfaceScore, 6) }
        else if (sc >= 4) { family = family ?? "sentier"; surfaceScore = Math.max(surfaceScore, 4) }
      }

      // (f) Landcover — covers the "no surface tag" case (forest, scree, rock…)
      let landLabel: string | null = null, landDesc: string | null = null
      if (landKey && LANDCOVER_INFO[landKey]) {
        const info = LANDCOVER_INFO[landKey]
        landLabel = info.label; landDesc = info.terrainDesc
        const landFam = LANDCOVER_TO_FAMILY[info.label] ?? null
        // Landcover decides the family when the path didn't have an explicit one,
        // OR when the landcover is harder (scree/rock/glacier override soft paths)
        if (!hasExplicitSurface) {
          surfaceScore = Math.min(10, surfaceScore + info.bonus * 0.6)
          if (landFam && (family === null || landFam === "montagne" || landFam === "rocheux")) {
            family = landFam
          }
          if (surfaceLabel === "sentier") surfaceLabel = info.label
        }
      }

      // Final family decision (cascade fallback)
      const fam = family ?? classifyFamily(surfaceLabel, landLabel)
      familyCounts[fam]++
      surfaceSum += surfaceScore
      sacSum += sac && SAC_SCORE[sac] !== undefined ? SAC_SCORE[sac] : 0
      visSum += vis && VIS_SCORE[vis] !== undefined ? VIS_SCORE[vis] : 0
      resolvedCount++
      if (sac) sacLabelCounts[sac] = (sacLabelCounts[sac] ?? 0) + 1
      sampledSurface.push({ idx: i, score: surfaceScore })

      if (Math.abs(i - midPointIdx) < pointStep) {
        midSurfaceLabel = surfaceLabel; midLandcoverLabel = landLabel; midLandcoverDesc = landDesc
      }
    }

    // Interpolate surface score to EVERY point so segments use real local surface
    const perPointSurface: number[] = new Array(points.length).fill(avgSurfaceTemp())
    function avgSurfaceTemp() { return resolvedCount > 0 ? surfaceSum / resolvedCount : 3.5 }
    if (sampledSurface.length >= 2) {
      for (let i = 0; i < points.length; i++) {
        // find surrounding sampled points
        let lo = 0, hi = sampledSurface.length - 1
        while (lo < hi - 1) { const mid = Math.floor((lo+hi)/2); if (sampledSurface[mid].idx <= i) lo = mid; else hi = mid }
        if (i <= sampledSurface[lo].idx) perPointSurface[i] = sampledSurface[lo].score
        else if (i >= sampledSurface[hi].idx) perPointSurface[i] = sampledSurface[hi].score
        else {
          const t = (i - sampledSurface[lo].idx) / (sampledSurface[hi].idx - sampledSurface[lo].idx)
          perPointSurface[i] = sampledSurface[lo].score + t * (sampledSurface[hi].score - sampledSurface[lo].score)
        }
      }
    }

    const denom = Math.max(1, resolvedCount)
    const avgSurface = surfaceSum / denom
    const avgSAC = sacSum / denom
    const avgVis = visSum / denom
    const sacLabel = Object.keys(sacLabelCounts).length
      ? Object.entries(sacLabelCounts).sort((a, b) => b[1] - a[1])[0][0] : null

    // Surface breakdown percentages
    const totalSamples = Math.max(1, familyCounts.route + familyCounts.sentier + familyCounts.rocheux + familyCounts.montagne)
    const surfaceBreakdown = {
      route: Math.round(familyCounts.route / totalSamples * 100),
      sentier: Math.round(familyCounts.sentier / totalSamples * 100),
      rocheux: Math.round(familyCounts.rocheux / totalSamples * 100),
      montagne: Math.round(familyCounts.montagne / totalSamples * 100),
    }
    const sumPct = surfaceBreakdown.route + surfaceBreakdown.sentier + surfaceBreakdown.rocheux + surfaceBreakdown.montagne
    if (sumPct !== 100 && sumPct > 0) {
      const families = ["route", "sentier", "rocheux", "montagne"] as const
      const biggest = families.reduce((a, b) => surfaceBreakdown[a] >= surfaceBreakdown[b] ? a : b)
      surfaceBreakdown[biggest] += (100 - sumPct)
    }

    // Build a midOSM-compatible object for the rest of the pipeline
    const midOSM = { surfaceLabel: midSurfaceLabel, landcoverLabel: midLandcoverLabel, landcoverDesc: midLandcoverDesc }
    const matchedWays = osmWays.length, matchedLand = osmLandcover.length
    const surfaceDetected = matchedWays > 0 || matchedLand > 0
    console.log(`[SURFACE] ${resolvedCount} pts · ${matchedWays} ways/${matchedLand} landcover in zone · route ${surfaceBreakdown.route}% sentier ${surfaceBreakdown.sentier}% rocheux ${surfaceBreakdown.rocheux}% montagne ${surfaceBreakdown.montagne}%`)
    if (!surfaceDetected) console.warn("[SURFACE] ⚠ No OSM data found — Overpass unavailable, surface left undetermined")

    // 3. Terrain stats
    let totalDist = 0, totalGain = 0, totalLoss = 0, totalSlope = 0, maxAlt = 0, minAlt = Infinity
    const n = points.length - 1
    const allSlopes: number[] = []
    const roughSlopes: number[] = []

    for (let i = 0; i < n; i++) {
      const distH = haversine(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng)
      const dEle = elevations[i + 1] - elevations[i]
      totalDist += Math.sqrt(distH * distH + dEle * dEle)
      if (dEle > 0) totalGain += dEle
      if (dEle < 0) totalLoss += Math.abs(dEle)
      const slopePct = distH > 5 ? Math.abs(dEle / distH) * 100 : 0
      if (slopePct > 0) allSlopes.push(slopePct)
      totalSlope += slopePct
      if (elevations[i] > maxAlt) maxAlt = elevations[i]
      if (elevations[i] < minAlt) minAlt = elevations[i]
      if (i > 0) {
        const prevDistH = haversine(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng)
        const prevSlope = prevDistH > 5 ? (elevations[i] - elevations[i-1]) / prevDistH : 0
        const currSlope = distH > 5 ? dEle / distH : 0
        roughSlopes.push(Math.abs(currSlope - prevSlope))
      }
    }

    allSlopes.sort((a, b) => a - b)
    const slopeMax = allSlopes.length ? Math.min(70, allSlopes[Math.floor(allSlopes.length * 0.95)]) : 0
    const slopeAvg = allSlopes.length ? totalSlope / n : 0
    const slopeP75 = allSlopes.length ? allSlopes[Math.floor(allSlopes.length * 0.75)] : 0
    const pctSteep = allSlopes.length ? allSlopes.filter(s => s > 20).length / allSlopes.length : 0
    const pctHighAlt = elevations.filter(e => e > 2000).length / elevations.length
    const roughness = roughSlopes.length
      ? roughSlopes.reduce((a, b) => a + b * b, 0) / roughSlopes.length  // variance-like
      : 0

    const distKm = Math.round(totalDist / 10) / 100
    const elevGain = Math.round(totalGain)
    const elevLoss = Math.round(totalLoss)
    const effortIndex = elevGain + distKm * 10

    // Saw-tooth factor: count direction changes in elevation profile
    // Many up-down transitions = tiring rolling terrain
    let directionChanges = 0
    let lastDir = 0
    const smoothEleForSaw = elevations
    for (let i = 1; i < smoothEleForSaw.length; i++) {
      const diff = smoothEleForSaw[i] - smoothEleForSaw[i-1]
      const dir = diff > 1 ? 1 : diff < -1 ? -1 : 0
      if (dir !== 0 && dir !== lastDir && lastDir !== 0) directionChanges++
      if (dir !== 0) lastDir = dir
    }
    // Normalise: changes per km. >8 changes/km = very rolling = factor 1
    const changesPerKm = distKm > 0 ? directionChanges / distKm : 0
    const sawtoothFactor = Math.min(1, changesPerKm / 8)

    // 4. POIs — already fetched in the parallel bundle above (no extra request)
    const allPois = bundlePois

    // CRITICAL: only keep POIs actually NEAR the track (within 150m), not just
    // anywhere in the bbox. On a 115km route the bbox is huge and would include
    // cliffs/peaks kilometres away from where you actually walk.
    const POI_PROXIMITY_M = 150
    const nearbyPois = allPois.filter((poi: any) => {
      // Check distance from the POI to the nearest track point (sampled)
      const step = Math.max(1, Math.floor(points.length / 400))
      let minDist = Infinity
      for (let i = 0; i < points.length; i += step) {
        const d = haversine(poi.lat, poi.lng, points[i].lat, points[i].lng)
        if (d < minDist) minDist = d
        if (minDist < POI_PROXIMITY_M) break
      }
      return minDist < POI_PROXIMITY_M
    })

    // Recompute danger score from only the nearby POIs
    const POI_DANGER: Record<string, number> = {
      scree: 3, cliff: 4, glacier: 4, peak: 1, saddle: 1, rock: 2, boulder: 2, waterfall: 1,
    }
    const dangerScore = Math.min(20, nearbyPois.reduce((s: number, p: any) => s + (POI_DANGER[p.type] ?? 0), 0))
    const pois = nearbyPois
    console.log(`[POIS] ${allPois.length} in bbox → ${nearbyPois.length} within ${POI_PROXIMITY_M}m of track`)

    // 5. Build feature vector (16D)
    const features: TrailFeatures = {
      distKm, dPlus: elevGain, dMinus: elevLoss,
      altMax: maxAlt, altStart: minAlt,
      slopeMax, slopeAvg, slopeP75,
      pctSteep, pctHighAlt,
      sacScore: avgSAC, surfaceScore: avgSurface, visibilityScore: avgVis,
      poiDangerCount: dangerScore,
      effortIndex, roughness,
    }
    const rawVector = featuresToVector(features)
    const weightedVector = applyWeights(rawVector)

    // 6. Global difficulty score
    const globalScore = computeGlobalDifficulty(distKm, elevGain, elevLoss, avgSurface, maxAlt, sawtoothFactor)

    // 7. Per-segment scores
    const rawScores: number[] = []
    for (let i = 0; i < n; i++) {
      const distH = haversine(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng)
      const dEle = elevations[i + 1] - elevations[i]
      // Signed slope: positive = uphill, negative = downhill
      const signedSlopePct = distH > 3 ? (dEle / distH) * 100 : 0
      let roughness = 0
      if (i > 0) {
        const pd = haversine(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng)
        const prevSlope = pd > 3 ? (elevations[i] - elevations[i-1]) / pd : 0
        const currSlope = distH > 3 ? dEle / distH : 0
        roughness = Math.min(3, Math.abs(currSlope - prevSlope) * 6)
      }
      rawScores.push(computeSegmentScore(signedSlopePct, roughness, perPointSurface[i] ?? avgSurface, elevations[i]))
    }
    const smoothR = Math.max(5, Math.floor(n * 0.04))
    const segmentScores = gaussianSmooth(rawScores, smoothR)

    // 8. Difficulty reasons
    const reasons = buildReasons({
      distKm, elevGain, elevLoss, maxSlope: slopeMax,
      avgSurface, surfaceLabel: midOSM.surfaceLabel,
      sacLabel, visibilityScore: avgVis, maxAlt, pois,
      globalScore,
      landcoverLabel: midOSM.landcoverLabel,
      landcoverDesc: midOSM.landcoverDesc,
    })

    // 9. Store trail first (need ID for similarity query)
    const coords = points.map(p => [p.lng, p.lat] as [number, number])
    const geojson = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        segmentScores: segmentScores.map(s => Math.round(s * 100) / 100),
        confirmCounts: coords.map(() => 1),
        elevations: elevations.map(e => Math.round(e)),
        surfaceScore: Math.round(avgSurface * 10) / 10,
        surfaceLabel: midOSM.surfaceLabel,
        surfaceBreakdown,
        surfaceDetected,
        sacLabel,
        globalScore: Math.round(globalScore * 10) / 10,
        reasons, pois: pois.slice(0, 10),
        features,
        stats: { distKm, elevGain, elevLoss, slopeMax: Math.round(slopeMax), maxAlt: Math.round(maxAlt), effortIndex: Math.round(effortIndex) },
      },
    }
    const midIdx = Math.floor(points.length / 2)
    const center = { lat: points[midIdx].lat, lng: points[midIdx].lng }
    const vecStr = vectorToString(weightedVector)

    const trail = await prisma.$queryRaw<any[]>`
      INSERT INTO trails (id, name, description, distance, elevation, geojson, center, "isPublic", difficulty, photos, "featureVector", "userId", "createdAt")
      VALUES (
        gen_random_uuid()::text,
        ${name},
        ${description},
        ${distKm},
        ${elevGain},
        ${JSON.stringify(geojson)}::jsonb,
        ${JSON.stringify(center)}::jsonb,
        ${isPublic},
        ${creatorDifficulty},
        ${JSON.stringify(photos)}::jsonb,
        ${vecStr}::vector,
        ${userId},
        NOW()
      )
      RETURNING id, name, distance, elevation, center
    `
    const createdTrail = trail[0]

    // Record the creator's stated difficulty as their own review, so it feeds
    // the community aggregation and their personal model.
    if (creatorDifficulty != null) {
      try {
        await prisma.review.create({
          data: { trailId: createdTrail.id, userId, difficulty: creatorDifficulty,
                   pctRoute: 0, pctSentier: 0, pctRocheux: 0, pctMontagne: 0 },
        })
      } catch (e) { console.warn("[GPX] could not create creator review:", e) }
    }

    // 10. GEOGRAPHIC OVERLAP — detect shared path segments with existing trails
    // and correct BOTH the new trail and the existing ones (permanent learning)
    const scoredPoints: ScoredPoint[] = coords.map(([lng, lat], i) => {
      const sIdx = Math.min(Math.round(i * (segmentScores.length - 1) / Math.max(coords.length - 1, 1)), segmentScores.length - 1)
      return { lat, lng, score: segmentScores[sIdx] }
    })
    const { correctedTrails, correctedSegments, newScoresAdjusted } = await processOverlaps(
      createdTrail.id, scoredPoints, segmentScores, coords, userId
    )

    // If overlap corrected the new trail's segments, persist them
    let finalSegmentScores = segmentScores
    if (correctedSegments > 0) {
      finalSegmentScores = newScoresAdjusted.map(s => Math.round(s * 100) / 100)
      const overlapGeojson = {
        ...geojson,
        properties: { ...geojson.properties, segmentScores: finalSegmentScores },
      }
      await prisma.$executeRaw`
        UPDATE trails SET geojson = ${JSON.stringify(overlapGeojson)}::jsonb WHERE id = ${createdTrail.id}
      `
      console.log(`[OVERLAP] New trail: ${correctedSegments} segments adjusted from ${correctedTrails} crossing trails`)
    }

    // 11. Adjust GLOBAL score using similar trails (profile-based)
    const { adjustedScore, similarTrails } = await adjustScoreFromSimilars(
      createdTrail.id, weightedVector, globalScore, userId
    )

    // 12. LEARNED MODEL — train on all reviewed trails and blend prediction
    const learnFeatures: TrainingFeatures = {
      effortIndex, slopeMax, slopeAvg,
      pctSteep, surfaceScore: avgSurface,
      maxAlt, pctHighAlt, sacScore: avgSAC,
      poiDanger: dangerScore, distKm,
    }
    const { finalScore: learnedFinal, modelInfo } = await applyLearnedModel(learnFeatures, adjustedScore, userId)

    // 13. AUTO-CALIBRATION — apply systematic offset if formula is biased
    const calibrationOffset = await getCalibrationOffset(userId)
    const finalScore = Math.min(10, Math.max(0.5, Math.round((learnedFinal + calibrationOffset) * 10) / 10))
    if (calibrationOffset !== 0) {
      console.log(`[CALIB] offset=${calibrationOffset} → ${learnedFinal} becomes ${finalScore}`)
    }

    // Persist the final blended score
    if (finalScore !== globalScore) {
      const updatedGeojson = {
        ...geojson,
        properties: {
          ...geojson.properties,
          globalScore: finalScore,
          calculatedScore: globalScore,
          similarityScore: adjustedScore !== globalScore ? adjustedScore : undefined,
          modelInfo: { ...modelInfo, calibrationOffset },
        },
      }
      await prisma.$executeRaw`
        UPDATE trails SET geojson = ${JSON.stringify(updatedGeojson)}::jsonb WHERE id = ${createdTrail.id}
      `
    }

    return NextResponse.json({
      trail: createdTrail,
      stats: { distKm, elevGain, elevLoss, slopeMax: Math.round(slopeMax), maxAlt: Math.round(maxAlt), globalScore: finalScore, calculatedScore: globalScore, effortIndex: Math.round(effortIndex) },
      modelInfo: { ...modelInfo, calibrationOffset },
      reasons,
      pois,
      similarTrails,
      overlapCorrectedTrails: correctedTrails,
      overlapCorrectedSegments: correctedSegments,
      surfaceScore: Math.round(avgSurface * 10) / 10,
      surfaceLabel: midOSM.surfaceLabel,
      surfaceBreakdown,
      surfaceDetected,
      sacLabel,
      pointCount: points.length,
      vectorDimensions: 16,
    })
  } catch (e: any) {
    console.error("[GPX]", e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
