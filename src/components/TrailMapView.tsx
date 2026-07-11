"use client";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import { useEffect } from "react";
import { difficultyColor, trailDisplayScore } from "@/lib/difficulty";

function buildSegmentScores(trail: any): number[] | null {
  const props = trail?.geojson?.properties;
  const coords: any[] = trail?.geojson?.geometry?.coordinates ?? [];
  if (coords.length < 2) return null;
  const n = coords.length - 1;
  if (props?.segmentScores?.length >= 2) {
    const stored: number[] = props.segmentScores;
    return Array.from({ length: n }, (_, i) => {
      const idx = Math.round(i * (stored.length - 1) / Math.max(n - 1, 1));
      return stored[Math.min(idx, stored.length - 1)];
    });
  }
  return null;
}

function FitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length >= 2) {
      const lats = coords.map(c => c[0]), lngs = coords.map(c => c[1]);
      map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [40, 40] });
    }
  }, [coords, map]);
  return null;
}

export default function TrailMapView({ trail, height = "100%", hover = null }: { trail: any; height?: string; hover?: [number, number] | null }) {
  const coords: any[] = trail?.geojson?.geometry?.coordinates ?? [];
  if (coords.length < 2) return <div style={{ height, background: "var(--sand-2)" }} />;
  const pts: [number, number][] = coords.map(([lng, lat]: any) => [lat, lng]);
  const n = pts.length - 1;
  const segScores = buildSegmentScores(trail);
  const global = trailDisplayScore(trail) ?? 5;
  const raw = segScores ?? Array.from({ length: n }, () => global);
  const smooth = raw.map((_, i) => {
    const r = 2; let s = 0, w = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) { const wt = 1 - Math.abs(j - i) / (r + 1); s += raw[j] * wt; w += wt; }
    return s / w;
  });
  const center: [number, number] = pts[Math.floor(pts.length / 2)];

  return (
    <MapContainer center={center} zoom={13} style={{ width: "100%", height }} zoomControl={true} scrollWheelZoom={false}>
      <TileLayer url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" attribution="© OpenTopoMap" maxZoom={17} />
      <FitBounds coords={pts} />
      {smooth.map((s, i) => (
        <Polyline key={`sh-${i}`} positions={[pts[i], pts[i + 1]]}
          pathOptions={{ color: "rgba(20,20,20,0.5)", weight: s * 0.5 + 10, opacity: 1, lineCap: "round", lineJoin: "round" }} />
      ))}
      {smooth.map((s, i) => (
        <Polyline key={`co-${i}`} positions={[pts[i], pts[i + 1]]}
          pathOptions={{ color: difficultyColor(s), weight: s * 0.5 + 6.5, opacity: 1, lineCap: "round", lineJoin: "round" }} />
      ))}
      {hover && (
        <>
          <CircleMarker center={hover} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: "#16241C", fillOpacity: 1 }} />
          <CircleMarker center={hover} radius={4} pathOptions={{ color: "#fff", weight: 0, fillColor: "#fff", fillOpacity: 1 }} />
        </>
      )}
    </MapContainer>
  );
}
