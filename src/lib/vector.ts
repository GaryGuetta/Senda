// ─── Feature vector for trail similarity ─────────────────────────────────────
// 16 dimensions, all normalised 0–1 before storage
// [0]  dist_km          distance totale en km
// [1]  d_plus           dénivelé positif en m
// [2]  d_minus          dénivelé négatif en m
// [3]  alt_max          altitude maximale en m
// [4]  alt_start        altitude de départ en m
// [5]  slope_max        pente maximale (95e percentile) en %
// [6]  slope_avg        pente moyenne en %
// [7]  slope_p75        75e percentile des pentes en %
// [8]  pct_steep        % du tracé avec pente >20%
// [9]  pct_high_alt     % du tracé au-dessus de 2000m
// [10] sac_score        difficulté SAC (0–10)
// [11] surface_score    difficulté surface OSM (0–10)
// [12] visibility_score difficulté visibilité sentier (0–10)
// [13] poi_danger       nb de POIs dangereux normalisé (éboulis, falaises…)
// [14] effort_index     index Schoeller normalisé (D+ + dist×10)
// [15] roughness        irrégularité du terrain (variance des pentes)

export interface TrailFeatures {
  distKm: number
  dPlus: number
  dMinus: number
  altMax: number
  altStart: number
  slopeMax: number      // 95th percentile
  slopeAvg: number
  slopeP75: number
  pctSteep: number      // % of segments with slope >20%
  pctHighAlt: number    // % of track above 2000m
  sacScore: number
  surfaceScore: number
  visibilityScore: number
  poiDangerCount: number
  effortIndex: number
  roughness: number
}

// Normalisation ranges — chosen from real Pyrenean hiking data
// Each value is clamped then divided by its max to give 0–1
const NORM = {
  distKm:          { min: 0,  max: 50  },
  dPlus:           { min: 0,  max: 3000 },
  dMinus:          { min: 0,  max: 3000 },
  altMax:          { min: 0,  max: 3500 },
  altStart:        { min: 0,  max: 2500 },
  slopeMax:        { min: 0,  max: 70  },
  slopeAvg:        { min: 0,  max: 30  },
  slopeP75:        { min: 0,  max: 40  },
  pctSteep:        { min: 0,  max: 1   },   // already 0–1
  pctHighAlt:      { min: 0,  max: 1   },
  sacScore:        { min: 0,  max: 10  },
  surfaceScore:    { min: 0,  max: 10  },
  visibilityScore: { min: 0,  max: 10  },
  poiDangerCount:  { min: 0,  max: 20  },
  effortIndex:     { min: 0,  max: 3500 },
  roughness:       { min: 0,  max: 0.15 },
}

type NormKey = keyof typeof NORM

function norm(key: NormKey, val: number): number {
  const { min, max } = NORM[key]
  return Math.max(0, Math.min(1, (val - min) / (max - min)))
}

export function featuresToVector(f: TrailFeatures): number[] {
  return [
    norm('distKm',          f.distKm),
    norm('dPlus',           f.dPlus),
    norm('dMinus',          f.dMinus),
    norm('altMax',          f.altMax),
    norm('altStart',        f.altStart),
    norm('slopeMax',        f.slopeMax),
    norm('slopeAvg',        f.slopeAvg),
    norm('slopeP75',        f.slopeP75),
    norm('pctSteep',        f.pctSteep),
    norm('pctHighAlt',      f.pctHighAlt),
    norm('sacScore',        f.sacScore),
    norm('surfaceScore',    f.surfaceScore),
    norm('visibilityScore', f.visibilityScore),
    norm('poiDangerCount',  f.poiDangerCount),
    norm('effortIndex',     f.effortIndex),
    norm('roughness',       f.roughness),
  ]
}

export function vectorToString(v: number[]): string {
  return `[${v.map(x => x.toFixed(6)).join(',')}]`
}

// ─── Weighted cosine similarity ───────────────────────────────────────────────
// Some dimensions matter more than others for perceived difficulty.
// Weights reflect field experience — elevation and slope dominate.
// Poids calibrés pour que les différences perçues sur le terrain
// se reflètent dans la similarité vectorielle.
// Principe : deux traces sont vraiment similaires seulement si
// le randonneur ressentirait le même effort et les mêmes dangers.
export const FEATURE_WEIGHTS: number[] = [
  0.08,  // dist_km          — distance : facteur effort majeur
  0.18,  // d_plus           — dénivelé+ : facteur dominant absolu
  0.06,  // d_minus          — dénivelé- : fatigue musculaire
  0.05,  // alt_max          — altitude max
  0.02,  // alt_start        — point de départ (peu discriminant)
  0.14,  // slope_max        — pente max : passages techniques
  0.10,  // slope_avg        — effort soutenu
  0.08,  // slope_p75        — 75e percentile pente
  0.09,  // pct_steep        — proportion terrain raide
  0.04,  // pct_high_alt     — temps en altitude
  0.10,  // sac_score        — classification SAC officielle
  0.08,  // surface_score    — type terrain
  0.03,  // visibility_score — orientation
  0.04,  // poi_danger       — dangers naturels
  0.08,  // effort_index     — Schoeller global
  0.03,  // roughness        — irrégularité
]
// Sum = 1.04 → normalisé implicitement par cosinus

// Apply weights before cosine similarity
export function applyWeights(v: number[]): number[] {
  return v.map((x, i) => x * FEATURE_WEIGHTS[i])
}
