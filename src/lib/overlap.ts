// ─── Geographic overlap detection between trails ──────────────────────────────
// When two trails physically share a path segment, we detect the common GPS
// points and merge their difficulty scores. This makes a segment walked by
// many trails progressively more accurate.

export interface ScoredPoint {
  lat: number
  lng: number
  score: number   // local difficulty 0-10 at this point
}

// Haversine distance in metres
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Spatial grid for fast neighbour lookup ───────────────────────────────────
// Bucket points into a grid keyed by rounded lat/lng. At latitude ~42.6°,
// 0.0003° ≈ 25-33m, a good cell size for "same path" tolerance.
const CELL = 0.0003

function cellKey(lat: number, lng: number): string {
  return `${Math.round(lat / CELL)},${Math.round(lng / CELL)}`
}

// Build a grid index from a set of scored points
export function buildGrid(points: ScoredPoint[]): Map<string, ScoredPoint[]> {
  const grid = new Map<string, ScoredPoint[]>()
  for (const p of points) {
    const key = cellKey(p.lat, p.lng)
    const arr = grid.get(key)
    if (arr) arr.push(p)
    else grid.set(key, [p])
  }
  return grid
}

// For a query point, find the nearest scored point within tolerance (metres)
export function findNearest(
  grid: Map<string, ScoredPoint[]>,
  lat: number, lng: number,
  toleranceM = 25
): ScoredPoint | null {
  const cLat = Math.round(lat / CELL)
  const cLng = Math.round(lng / CELL)
  let best: ScoredPoint | null = null
  let bestDist = toleranceM

  // Check the 3×3 neighbourhood of cells
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      const arr = grid.get(`${cLat + dLat},${cLng + dLng}`)
      if (!arr) continue
      for (const p of arr) {
        const d = haversine(lat, lng, p.lat, p.lng)
        if (d < bestDist) { bestDist = d; best = p }
      }
    }
  }
  return best
}

// ─── Overlap result ───────────────────────────────────────────────────────────
export interface OverlapResult {
  trailId: string
  overlapCount: number       // number of shared points
  overlapRatio: number       // fraction of the OTHER trail that overlaps
  avgScoreDiff: number       // mean (otherScore - thisScore) on shared points
  correctedPoints: { idx: number; oldScore: number; newScore: number }[]
}

// Compare a new trail's scored points against an existing trail's grid.
// Returns which points overlap and how the scores should merge.
//
// mergeWeight: how much the OTHER trail's score pulls this one (0-1).
// Typically weighted by how many trails already agree on that point.
export function computeOverlap(
  newPoints: ScoredPoint[],
  existingGrid: Map<string, ScoredPoint[]>,
  existingTrailId: string,
  toleranceM = 25
): OverlapResult {
  let overlapCount = 0
  let scoreDiffSum = 0
  const correctedPoints: { idx: number; oldScore: number; newScore: number }[] = []

  for (let i = 0; i < newPoints.length; i++) {
    const np = newPoints[i]
    const match = findNearest(existingGrid, np.lat, np.lng, toleranceM)
    if (match) {
      overlapCount++
      scoreDiffSum += match.score - np.score
    }
  }

  return {
    trailId: existingTrailId,
    overlapCount,
    overlapRatio: newPoints.length > 0 ? overlapCount / newPoints.length : 0,
    avgScoreDiff: overlapCount > 0 ? scoreDiffSum / overlapCount : 0,
    correctedPoints,
  }
}

// ─── Merge two scores on a shared point ───────────────────────────────────────
// The more times a point has been confirmed, the more stable its score.
// confirmCount = how many trails have already contributed to this point.
export function mergeScores(
  existingScore: number,
  existingConfirms: number,
  newScore: number
): number {
  // Weighted average: existing score has weight = confirmCount, new has weight 1
  const totalWeight = existingConfirms + 1
  return (existingScore * existingConfirms + newScore) / totalWeight
}

export { haversine }
