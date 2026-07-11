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

// ─── The signature element ────────────────────────────────────────────────────
// A cross-section of the trail's elevation, with the area under the curve filled
// by the LOCAL difficulty at each point (green → red). This is the artifact that
// makes each trail instantly recognisable — topography + per-segment difficulty
// in one silhouette. Built entirely from data the app already computes.
export default function ElevationProfile({ geojson, width = 300, height = 64, showAxis = false, compact = false }: Props) {
  const data = useMemo(() => {
    const props = geojson?.properties ?? {};
    const elevations: number[] = props.elevations ?? [];
    const segScores: number[] = props.segmentScores ?? [];
    if (elevations.length < 2) return null;

    // Downsample to a manageable number of points for a clean silhouette
    const target = Math.min(elevations.length, 120);
    const step = (elevations.length - 1) / (target - 1);
    const pts: { ele: number; score: number }[] = [];
    for (let i = 0; i < target; i++) {
      const idx = Math.round(i * step);
      const ele = elevations[idx] ?? 0;
      const sIdx = segScores.length ? Math.min(Math.round(idx * (segScores.length - 1) / (elevations.length - 1)), segScores.length - 1) : -1;
      const score = sIdx >= 0 ? segScores[sIdx] : 5;
      pts.push({ ele, score });
    }
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
  const range = Math.max(1, maxEle - minEle);

  const x = (i: number) => axisW + (i / (pts.length - 1)) * plotW;
  const y = (ele: number) => pad + plotH - ((ele - minEle) / range) * plotH * 0.92 - plotH * 0.04;

  // Build gradient stops from local difficulty along the track
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
