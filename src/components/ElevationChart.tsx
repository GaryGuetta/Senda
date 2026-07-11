"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import { difficultyColor } from "@/lib/difficulty";

export interface HoverInfo { lat: number; lng: number; km: number; ele: number }

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371; // km
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const s = Math.sin(dLat/2)**2 + Math.cos(aLat*Math.PI/180) * Math.cos(bLat*Math.PI/180) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Nice km tick interval for a given total distance
function tickStep(totalKm: number): number {
  if (totalKm <= 6) return 1;
  if (totalKm <= 15) return 2;
  if (totalKm <= 40) return 5;
  if (totalKm <= 90) return 10;
  return 20;
}

export default function ElevationChart({ geojson, height = 200, onHover, fillColor }: {
  geojson: any; height?: number; onHover?: (h: HoverInfo | null) => void; fillColor?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hoverKm, setHoverKm] = useState<number | null>(null);
  const gradId = useMemo(() => `ec-${Math.random().toString(36).slice(2, 9)}`, []);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => { for (const e of entries) setW(e.contentRect.width); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    const coords: any[] = geojson?.geometry?.coordinates ?? [];
    const eles: number[] = geojson?.properties?.elevations ?? [];
    const segs: number[] = geojson?.properties?.segmentScores ?? [];
    if (coords.length < 2 || eles.length < 2) return null;
    const n = Math.min(coords.length, eles.length);
    const cum = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const [lng1, lat1] = coords[i-1], [lng2, lat2] = coords[i];
      cum[i] = cum[i-1] + haversine(lat1, lng1, lat2, lng2);
    }
    const totalKm = cum[n-1] || 0.001;
    const pts = [] as { km: number; ele: number; score: number; lat: number; lng: number }[];
    for (let i = 0; i < n; i++) {
      const sIdx = segs.length ? Math.min(Math.round(i * (segs.length - 1) / (n - 1)), segs.length - 1) : -1;
      pts.push({ km: cum[i], ele: eles[i], score: sIdx >= 0 ? segs[sIdx] : 5, lat: coords[i][1], lng: coords[i][0] });
    }
    const minEle = Math.min(...pts.map(p => p.ele));
    const maxEle = Math.max(...pts.map(p => p.ele));
    return { pts, totalKm, minEle, maxEle };
  }, [geojson]);

  // Report hover to parent
  const hoverPt = useMemo(() => {
    if (hoverKm == null || !data) return null;
    // nearest point by km
    let lo = 0, hi = data.pts.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (data.pts[mid].km <= hoverKm) lo = mid; else hi = mid; }
    const p = Math.abs(data.pts[lo].km - hoverKm) < Math.abs(data.pts[hi].km - hoverKm) ? data.pts[lo] : data.pts[hi];
    return p;
  }, [hoverKm, data]);

  useEffect(() => {
    if (onHover) onHover(hoverPt ? { lat: hoverPt.lat, lng: hoverPt.lng, km: hoverPt.km, ele: hoverPt.ele } : null);
  }, [hoverPt, onHover]);

  const geom = useMemo(() => {
    if (!data || w < 40) return null;
    const axisW = 42, padTop = 14, padBottom = 26, padRight = 10;
    const plotW = w - axisW - padRight;
    const plotH = height - padTop - padBottom;
    const range = Math.max(1, data.maxEle - data.minEle);
    const xOf = (km: number) => axisW + (km / data.totalKm) * plotW;
    const yOf = (ele: number) => padTop + plotH - ((ele - data.minEle) / range) * plotH * 0.9 - plotH * 0.05;

    // Downsample for the path/gradient (keep ~ plotW/2 points)
    const target = Math.max(2, Math.min(data.pts.length, Math.round(plotW / 2)));
    const step = (data.pts.length - 1) / (target - 1);
    const samples = [] as { km: number; ele: number; score: number }[];
    for (let i = 0; i < target; i++) samples.push(data.pts[Math.round(i * step)]);

    let area = `M ${xOf(samples[0].km)} ${padTop + plotH} L ${xOf(samples[0].km)} ${yOf(samples[0].ele)}`;
    let line = `M ${xOf(samples[0].km)} ${yOf(samples[0].ele)}`;
    for (let i = 1; i < samples.length; i++) {
      area += ` L ${xOf(samples[i].km)} ${yOf(samples[i].ele)}`;
      line += ` L ${xOf(samples[i].km)} ${yOf(samples[i].ele)}`;
    }
    area += ` L ${xOf(samples[samples.length-1].km)} ${padTop + plotH} Z`;

    const stops = samples.map((s, i) => ({ off: (s.km / data.totalKm) * 100, color: difficultyColor(s.score) }));

    // km ticks
    const stepKm = tickStep(data.totalKm);
    const ticks: number[] = [];
    for (let k = 0; k <= data.totalKm + 0.001; k += stepKm) ticks.push(k);

    // elevation gridlines every 250m
    const gLines: number[] = [];
    for (let e = Math.ceil(data.minEle / 250) * 250; e < data.maxEle; e += 250) gLines.push(e);

    return { axisW, padTop, padBottom, padRight, plotW, plotH, xOf, yOf, area, line, stops, ticks, gLines };
  }, [data, w, height]);

  function onMove(e: React.MouseEvent) {
    if (!data || !geom) return;
    // offsetX is in the element's own coordinate space, which matches the SVG's
    // internal units and stays correct under the global `zoom` (unlike clientX/rect).
    const mx = (e.nativeEvent as MouseEvent).offsetX;
    const km = Math.max(0, Math.min(data.totalKm, ((mx - geom.axisW) / geom.plotW) * data.totalKm));
    setHoverKm(km);
  }
  function onLeave() { setHoverKm(null); }

  return (
    <div ref={wrapRef} style={{ width: "100%", height, position: "relative", cursor: "crosshair" }}
      onMouseMove={onMove} onMouseLeave={onLeave}>
      {data && geom && (
        <svg width={w} height={height} style={{ display: "block", pointerEvents: "none" }}>
          <defs>
            {fillColor ? (
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={fillColor} stopOpacity="0.55" />
                <stop offset="100%" stopColor={fillColor} stopOpacity="0.06" />
              </linearGradient>
            ) : (
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                {geom.stops.map((s, i) => <stop key={i} offset={`${s.off}%`} stopColor={s.color} />)}
              </linearGradient>
            )}
          </defs>

          {/* elevation gridlines + labels */}
          {geom.gLines.map((e, i) => (
            <g key={i}>
              <line x1={geom.axisW} y1={geom.yOf(e)} x2={w - geom.padRight} y2={geom.yOf(e)} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 4" />
              <text x={geom.axisW - 6} y={geom.yOf(e) + 3} textAnchor="end" fontSize="9.5" fill="var(--stone-light)" fontFamily="Space Mono, monospace">{e}</text>
            </g>
          ))}

          {/* area + line */}
          <path d={geom.area} fill={`url(#${gradId})`} opacity="0.92" />
          <path d={geom.line} fill="none" stroke={fillColor ?? "rgba(22,36,28,0.4)"} strokeWidth="1.6" opacity={fillColor ? 0.9 : 1} />

          {/* km ticks */}
          {geom.ticks.map((k, i) => (
            <text key={i} x={geom.xOf(k)} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--stone)" fontFamily="Space Mono, monospace">{Math.round(k)} km</text>
          ))}

          {/* hover cursor */}
          {hoverPt && (
            <g>
              <line x1={geom.xOf(hoverPt.km)} y1={geom.padTop} x2={geom.xOf(hoverPt.km)} y2={geom.padTop + geom.plotH}
                stroke="var(--ink)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
              <circle cx={geom.xOf(hoverPt.km)} cy={geom.yOf(hoverPt.ele)} r="5" fill="var(--paper)" stroke={difficultyColor(hoverPt.score)} strokeWidth="2.5" />
            </g>
          )}
        </svg>
      )}

      {/* hover readout */}
      {hoverPt && geom && (
        <div style={{
          position: "absolute", top: 6,
          left: Math.min(Math.max(geom.xOf(hoverPt.km) - 55, 0), Math.max(0, w - 110)),
          background: "var(--forest)", color: "var(--paper)", borderRadius: 8, padding: "4px 9px",
          fontSize: 11.5, fontFamily: "Space Mono, monospace", pointerEvents: "none", whiteSpace: "nowrap",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        }}>
          {hoverPt.km.toFixed(1)} km · {Math.round(hoverPt.ele)} m
        </div>
      )}
    </div>
  );
}
