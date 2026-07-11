// Shared difficulty helpers — used across cards, pages, and the map.

export function difficultyColor(score: number): string {
  const t = Math.max(0, Math.min(1, score / 10));
  const stops = [
    {t:0.00,r:0,   g:180, b:40 },
    {t:0.18,r:120, g:200, b:0  },
    {t:0.36,r:210, g:215, b:0  },
    {t:0.52,r:255, g:165, b:0  },
    {t:0.68,r:255, g:95,  b:0  },
    {t:0.84,r:230, g:30,  b:20 },
    {t:1.00,r:150, g:0,   b:10 },
  ];
  let lo = 0;
  while (lo < stops.length - 2 && t > stops[lo + 1].t) lo++;
  const a = stops[lo], b = stops[lo + 1];
  const u = (t - a.t) / ((b.t - a.t) || 1), e = u * u * (3 - 2 * u);
  return `rgb(${Math.round(a.r+(b.r-a.r)*e)},${Math.round(a.g+(b.g-a.g)*e)},${Math.round(a.b+(b.b-a.b)*e)})`;
}

export function scoreLabel(s: number): string {
  if (s <= 2) return "Très facile";
  if (s <= 4) return "Facile";
  if (s <= 6) return "Modéré";
  if (s <= 8) return "Difficile";
  return "Très difficile";
}

// The single source of truth for a trail's displayed score.
export function trailDisplayScore(trail: any): number | null {
  const props = trail?.geojson?.properties ?? {};
  const autoScore: number | null = props.globalScore ?? null;
  const communityScore = trail?.score?.global ?? null;
  const reviewCount = trail?.score?.count ?? 0;
  if (autoScore != null && communityScore != null && reviewCount > 0) {
    const blend = Math.min(0.35, reviewCount / 15);
    return Math.round((autoScore * (1 - blend) + communityScore * blend) * 10) / 10;
  }
  if (autoScore != null) return autoScore;
  if (communityScore != null) return communityScore;
  return null;
}

// Surface family colors (matches SURFACE_FAMILIES)
export const FAMILY_COLORS: Record<string, string> = {
  route: "#185FA5", sentier: "#639922", rocheux: "#BA7517", montagne: "#A32D2D",
};
export const FAMILY_LABELS: Record<string, string> = {
  route: "Route", sentier: "Sentier", rocheux: "Rocheux", montagne: "Montagne",
};

// Estimated walking time (Naismith's rule + Tranter-ish flat pace).
// Base: ~4 km/h on flat, +1h per 600m of ascent. Returns a compact "4h30" label.
export function estimatedWalkTime(distanceKm: number, elevationGain: number): string {
  const flatHours = distanceKm / 4;
  const climbHours = elevationGain / 600;
  let hours = flatHours + climbHours;
  hours *= 1.1; // small buffer for terrain/breaks
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60 / 5) * 5; // round to 5 min
  if (m === 60) return `${h + 1}h00`;
  if (h === 0) return `${m} min`;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

// Rough difficulty estimate (0–10) for a planned route from its raw stats.
// Used before the user has a personal model (needs 5 rated trails).
export function estimateRouteDifficulty(distanceKm: number, elevationGain: number, maxSlopePct: number): number {
  let s = distanceKm * 0.15 + elevationGain / 400;
  if (maxSlopePct > 30) s += 2; else if (maxSlopePct > 20) s += 1.2; else if (maxSlopePct > 12) s += 0.5;
  return Math.max(1, Math.min(10, Math.round(s * 10) / 10));
}
