"use client";
import { useMemo } from "react";
import { difficultyColor, scoreLabel } from "@/lib/difficulty";

// A self-contained, always-present hero visual: a synthetic mountain profile
// colored by difficulty. Used when the public bank has no trail yet, so the
// hero is never empty. Shows the core idea instantly.
const SAMPLE = (() => {
  // Build a believable Pyrenean profile: valley → forest climb → ridge → summit
  const pts: { ele: number; score: number }[] = [];
  const N = 90;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    // Elevation: rise with a couple of shoulders, peak near 80%, slight descent
    const ele =
      1150 +
      900 * Math.pow(t, 1.15) * (1 - 0.25 * Math.sin(t * Math.PI * 3)) +
      120 * Math.sin(t * Math.PI * 5);
    // Difficulty: easy in valley/forest, hard on steep ridge + scree near top
    let score = 2.5 + t * 4;
    if (t > 0.55) score += (t - 0.55) * 9;          // ridge gets steep
    if (t > 0.78 && t < 0.95) score += 1.8;          // scree band near summit
    score += 0.6 * Math.sin(t * Math.PI * 7);        // local roughness
    pts.push({ ele, score: Math.max(1, Math.min(10, score)) });
  }
  return pts;
})();

export default function HeroProfile() {
  const w = 560, h = 200;
  const axisW = 40, padTop = 14, padBottom = 26;
  const plotW = w - axisW;
  const plotH = h - padTop - padBottom;

  const { minEle, maxEle } = useMemo(() => {
    const eles = SAMPLE.map(p => p.ele);
    return { minEle: Math.min(...eles), maxEle: Math.max(...eles) };
  }, []);
  const range = Math.max(1, maxEle - minEle);
  const gradId = "hero-elev-grad";

  const x = (i: number) => axisW + (i / (SAMPLE.length - 1)) * plotW;
  const y = (ele: number) => padTop + plotH - ((ele - minEle) / range) * plotH * 0.9 - plotH * 0.05;

  let areaD = `M ${x(0)} ${padTop + plotH} L ${x(0)} ${y(SAMPLE[0].ele)}`;
  let lineD = `M ${x(0)} ${y(SAMPLE[0].ele)}`;
  for (let i = 1; i < SAMPLE.length; i++) {
    areaD += ` L ${x(i)} ${y(SAMPLE[i].ele)}`;
    lineD += ` L ${x(i)} ${y(SAMPLE[i].ele)}`;
  }
  areaD += ` L ${x(SAMPLE.length - 1)} ${padTop + plotH} Z`;

  const stops = SAMPLE.map((p, i) => (
    <stop key={i} offset={`${(i / (SAMPLE.length - 1)) * 100}%`} stopColor={difficultyColor(p.score)} />
  ));

  // Gridlines every 250m
  const gridLines: number[] = [];
  for (let e = Math.ceil(minEle / 250) * 250; e < maxEle; e += 250) gridLines.push(e);

  const peakIdx = SAMPLE.reduce((mi, p, i, a) => (p.ele > a[mi].ele ? i : mi), 0);

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block", maxWidth: 560 }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">{stops}</linearGradient>
      </defs>

      {/* gridlines */}
      {gridLines.map((e, i) => (
        <g key={i}>
          <line x1={axisW} y1={y(e)} x2={w} y2={y(e)} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 4" />
          <text x={axisW - 6} y={y(e) + 3} textAnchor="end" fontSize="9.5" fill="var(--stone-light)" fontFamily="Space Mono, monospace">{e}</text>
        </g>
      ))}

      {/* the colored silhouette */}
      <path d={areaD} fill={`url(#${gradId})`} opacity="0.92" />
      <path d={lineD} fill="none" stroke="rgba(22,36,28,0.4)" strokeWidth="1.4" />

      {/* summit marker */}
      <circle cx={x(peakIdx)} cy={y(SAMPLE[peakIdx].ele)} r="4" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.5" />
      <text x={x(peakIdx)} y={y(SAMPLE[peakIdx].ele) - 9} textAnchor="middle" fontSize="10" fill="var(--ink)" fontFamily="Space Mono, monospace" fontWeight="700">
        {Math.round(maxEle)} m
      </text>
    </svg>
  );
}
