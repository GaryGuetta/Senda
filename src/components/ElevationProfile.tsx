"use client";
import { useMemo } from "react";
import { difficultyColor } from "@/lib/difficulty";

interface Props {
  geojson: any;
  width?: number;
  height?: number;
  showAxis?: boolean;   // show altitude labels + baseline (used on detail page)
  compact?: boolean;    // thinner styling for cards
}

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ─── The signature element ────────────────────────────────────────────────────
// A cross-section of the trail's elevation, with the area under the curve filled
// by the LOCAL difficulty at each point (green → red).
//
// Geometrically honest: the x-axis is the REAL cumulative distance along the
// track (not the GPX point index — points are denser in switchbacks, which used
// to stretch climbs and shift the colors). The silhouette is resampled at
// uniform distance steps, then snapped to the track's true summit and low point
// so no peak is missed by sampling.
export default function ElevationProfile({ geojson, width = 300, height = 64, showAxis = false, compact = false }: Props) {
  const data = useMemo(() => {
    const props = geojson?.properties ?? {};
    const elevations: number[] = props.elevations ?? [];
    const segScores: number[] = props.segmentScores ?? [];
    const coords: number[][] = geojson?.geometry?.coordinates ?? [];
    const n = elevations.length;
    if (n < 2) return null;

    // Cumulative distance along the track. Falls back to index spacing if the
    // coordinates are missing or don't line up with the elevation array.
    const cum = new Array(n).fill(0);
    const hasCoords = Array.isArray(coords) && coords.length === n;
    for (let i = 1; i < n; i++) {
      cum[i] = cum[i - 1] + (hasCoords ? Math.max(0.01, haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0])) : 1);
    }
    const total = cum[n - 1] || 1;

    // Resample at uniform DISTANCE steps (linear interpolation between points).
    const target = Math.min(Math.max(n, 2), 160);
    const pts: { ele: number; score: number }[] = [];
    let j = 0;
    for (let i = 0; i < target; i++) {
      const d = (i / (target - 1)) * total;
      while (j < n - 2 && cum[j + 1] < d) j++;
      const span = cum[j + 1] - cum[j] || 1;
      const t = Math.min(1, Math.max(0, (d - cum[j]) / span));
      const ele = elevations[j] + (elevations[j + 1] - elevations[j]) * t;
      const sIdx = segScores.length
        ? Math.min(Math.round((t < 0.5 ? j : j + 1) * (segScores.length - 1) / (n - 1)), segScores.length - 1)
        : -1;
      pts.push({ ele, score: sIdx >= 0 ? segScores[sIdx] : 5 });
    }

    // Snap the samples nearest to the track's real extremes, so the summit and
    // the low point are always exactly represented (sampling can't miss them).
    let iMax = 0, iMin = 0;
    for (let i = 1; i < n; i++) {
      if (elevations[i] > elevations[iMax]) iMax = i;
      if (elevations[i] < elevations[iMin]) iMin = i;
    }
    const snap = (rawIdx: number) => {
      const k = Math.round((cum[rawIdx] / total) * (target - 1));
      pts[Math.min(k, target - 1)].ele = elevations[rawIdx];
    };
    snap(iMax); snap(iMin);

    const minEle = Math.min(...pts.map(p => p.ele));
    const maxEle = Math.max(...pts.map(p => p.ele));
    return { pts, minEle, maxEle };
  }, [geojson]);

  // Stable gradient id — declared before any early return (hooks rule)
  const gradId = useMemo(() => `elev-grad-${Math.random().toString(36).slice(2, 9)}`, []);

  if (!data) return null;
  const { pts, minEle, maxEle } = data;
  const pad = showAxis ? 4 : 0;
  const axisW = showAxis ? 34 : 0;
  const plotW = width - axisW - pad;
  const plotH = height - pad * 2;
  // Minimum vertical span: a near-flat walk should LOOK flat, not like the Alps.
  const range = Math.max(80, maxEle - minEle);

  const x = (i: number) => axisW + (i / (pts.length - 1)) * plotW;
  const y = (ele: number) => pad + plotH - ((ele - minEle) / range) * plotH * 0.92 - plotH * 0.04;

  // Build gradient stops from local difficulty along the track (distance-aligned)
  const stops = pts.map((p, i) => (
    <stop key={i} offset={`${(i / (pts.length - 1)) * 100}%`} stopColor={difficultyColor(p.score)} />
  ));

  // Area path (filled) + top line
  let areaD = `M ${x(0)} ${pad + plotH} L ${x(0)} ${y(pts[0].ele)}`;
  let lineD = `M ${x(0)} ${y(pts[0].ele)}`;
  for (let i = 1; i < pts.length; i++) {
    areaD += ` L ${x(i)} ${y(pts[i].ele)}`;
    lineD += ` L ${x(i)} ${y(pts[i].ele)}`;
  }
  areaD += ` L ${x(pts.length - 1)} ${pad + plotH} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">{stops}</linearGradient>
      </defs>
      {/* filled area — the difficulty-colored silhouette */}
      <path d={areaD} fill={`url(#${gradId})`} opacity={compact ? 0.85 : 0.9} />
      {/* crisp top line */}
      <path d={lineD} fill="none" stroke="rgba(22,36,28,0.35)" strokeWidth={compact ? 1 : 1.3} vectorEffect="non-scaling-stroke" />
      {showAxis && (
        <>
          <line x1={axisW} y1={pad} x2={axisW} y2={pad + plotH} stroke="var(--line-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <text x={axisW - 5} y={y(maxEle) + 3} textAnchor="end" fontSize="9" fill="var(--stone)" fontFamily="Space Mono, monospace">{Math.round(maxEle)}</text>
          <text x={axisW - 5} y={y(minEle)} textAnchor="end" fontSize="9" fill="var(--stone)" fontFamily="Space Mono, monospace">{Math.round(minEle)}</text>
        </>
      )}
    </svg>
  );
}
