"use client";
import { MapContainer, TileLayer, Polyline, Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { difficultyColor, scoreLabel, trailDisplayScore } from "@/lib/difficulty";

delete (L.Icon.Default.prototype as any)._getIconUrl;

function buildSeg(trail: any): number[] | null {
  const props = trail?.geojson?.properties;
  const coords: any[] = trail?.geojson?.geometry?.coordinates ?? [];
  if (coords.length < 2) return null;
  const n = coords.length - 1;
  if (props?.segmentScores?.length >= 2) {
    const stored: number[] = props.segmentScores;
    return Array.from({ length: n }, (_, i) => stored[Math.min(Math.round(i * (stored.length - 1) / Math.max(n - 1, 1)), stored.length - 1)]);
  }
  return null;
}

function badge(score: number | null, hovered = false) {
  const color = difficultyColor(score ?? 5);
  const size = hovered ? 40 : 32;
  const ring = hovered ? "0 0 0 4px rgba(255,255,255,0.6), 0 4px 14px rgba(0,0,0,0.35)" : "0 2px 8px rgba(0,0,0,0.25)";
  return L.divIcon({
    html: `<div style="background:${color};color:#fff;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${hovered?15:13}px;font-weight:600;border:3px solid #fff;box-shadow:${ring};font-family:Inter,sans-serif;transition:all .15s;">${score ?? "?"}</div>`,
    className: "", iconAnchor: [size/2, size/2],
  });
}

// A "start of trail" pin (teardrop) with the difficulty color
function startPin(score: number | null, hovered = false) {
  const color = difficultyColor(score ?? 5);
  const s = hovered ? 38 : 30;
  const inner = hovered ? 18 : 14;
  const off = hovered ? 10 : 8;
  const ring = hovered ? "0 0 0 4px rgba(255,255,255,0.55), 0 4px 12px rgba(0,0,0,0.4)" : "0 3px 8px rgba(0,0,0,0.3)";
  return L.divIcon({
    html: `<div style="position:relative;width:${s}px;height:${s+10}px;">
      <div style="position:absolute;top:0;left:0;width:${s}px;height:${s}px;background:${color};border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:${ring};"></div>
      <div style="position:absolute;top:${off}px;left:${off}px;width:${inner}px;height:${inner}px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${hovered?11:9}px;font-weight:700;color:${color};font-family:Inter,sans-serif;">${score ?? "?"}</div>
    </div>`,
    className: "", iconSize: [s, s+10], iconAnchor: [s/2, s+10],
  });
}

function FitAll({ trails, startsOnly }: { trails: any[]; startsOnly?: boolean }) {
  const map = useMap();
  useEffect(() => {
    const all: [number, number][] = [];
    for (const t of trails) {
      if (startsOnly) {
        const c = t.center as { lat: number; lng: number };
        const first = t?.geojson?.geometry?.coordinates?.[0];
        if (first) all.push([first[1], first[0]]);
        else if (c) all.push([c.lat, c.lng]);
      } else {
        const c = t?.geojson?.geometry?.coordinates ?? [];
        for (const [lng, lat] of c) all.push([lat, lng]);
      }
    }
    if (all.length >= 2) {
      const lats = all.map(c => c[0]), lngs = all.map(c => c[1]);
      map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [60, 60] });
    } else if (all.length === 1) {
      map.setView(all[0], 13);
    }
  }, [trails, map, startsOnly]);
  return null;
}

function TrailLine({ trail }: { trail: any }) {
  const router = useRouter();
  const coords: any[] = trail?.geojson?.geometry?.coordinates ?? [];
  if (coords.length < 2) return null;
  const pts: [number, number][] = coords.map(([lng, lat]: any) => [lat, lng]);
  const n = pts.length - 1;
  const segScores = buildSeg(trail);
  const global = trailDisplayScore(trail) ?? 5;
  const raw = segScores ?? Array.from({ length: n }, () => global);
  const smooth = raw.map((_, i) => {
    const r = 2; let s = 0, w = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) { const wt = 1 - Math.abs(j - i) / (r + 1); s += raw[j] * wt; w += wt; }
    return s / w;
  });
  const go = () => router.push(`/sentier/${trail.id}`);
  return (
    <>
      {smooth.map((s, i) => (
        <Polyline key={`sh-${trail.id}-${i}`} positions={[pts[i], pts[i + 1]]}
          pathOptions={{ color: "rgba(20,20,20,0.45)", weight: s * 0.4 + 8, opacity: 0.9, lineCap: "round" }} eventHandlers={{ click: go }} />
      ))}
      {smooth.map((s, i) => (
        <Polyline key={`co-${trail.id}-${i}`} positions={[pts[i], pts[i + 1]]}
          pathOptions={{ color: difficultyColor(s), weight: s * 0.4 + 5, opacity: 1, lineCap: "round" }} eventHandlers={{ click: go }} />
      ))}
    </>
  );
}

// Hover-preview card shown in a Leaflet Tooltip
function PreviewCard({ t }: { t: any }) {
  const score = trailDisplayScore(t);
  return (
    <div style={{ fontFamily: "Inter,sans-serif", minWidth: 170 }}>
      <div style={{ fontFamily: "Fraunces,serif", fontWeight: 600, fontSize: 14, marginBottom: 5, color: "var(--ink)" }}>{t.name}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {score != null && (
          <span style={{ background: difficultyColor(score), color: "#fff", borderRadius: 7, padding: "3px 8px", fontSize: 14, fontWeight: 700 }}>{score}</span>
        )}
        <span style={{ fontSize: 12, color: difficultyColor(score ?? 5), fontWeight: 600 }}>{score != null ? scoreLabel(score) : ""}</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--stone)", marginTop: 6 }}>{t.distance} km · +{t.elevation} m{t.author ? ` · ${t.author}` : ""}</div>
      {t.completed && <div style={{ fontSize: 11, color: "#5E7A55", fontWeight: 600, marginTop: 4 }}>✓ déjà faite</div>}
      <div style={{ fontSize: 11, color: "#5E7A55", fontWeight: 500, marginTop: 6 }}>cliquer pour voir la fiche →</div>
    </div>
  );
}

// Watches map movement so the "search this area" button can appear
function BoundsWatcher({ onMove }: { onMove: (b: L.LatLngBounds) => void }) {
  const map = useMapEvents({
    moveend: () => onMove(map.getBounds()),
    zoomend: () => onMove(map.getBounds()),
  });
  return null;
}

// Is a trail's start point inside the given bounds?
function startInBounds(t: any, b: L.LatLngBounds): boolean {
  const first = t?.geojson?.geometry?.coordinates?.[0];
  const c = t.center as { lat: number; lng: number };
  const lat = first ? first[1] : c?.lat;
  const lng = first ? first[0] : c?.lng;
  if (lat == null || lng == null) return false;
  return b.contains([lat, lng]);
}

const MERENS: [number, number] = [42.6473, 1.8387];

interface ExploreMapProps {
  trails: any[];
  variant?: "lines" | "markers";
  hoveredId?: string | null;
  onHoverTrail?: (id: string | null) => void;
  onBoundsChange?: (b: L.LatLngBounds) => void;
  autoFit?: boolean;
  flyTo?: { lat: number; lng: number; zoom?: number } | null;
}

// Smoothly moves the map when a target is set (e.g. after a city search).
function FlyTo({ target }: { target?: { lat: number; lng: number; zoom?: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom ?? 12, { duration: 0.8 });
  }, [target, map]);
  return null;
}

export default function ExploreMap({ trails, variant = "lines", hoveredId = null, onHoverTrail, onBoundsChange, autoFit = true, flyTo = null }: ExploreMapProps) {
  const router = useRouter();
  const markersOnly = variant === "markers";
  const shown = trails;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <MapContainer center={MERENS} zoom={12} style={{ width: "100%", height: "100%" }} zoomControl={true}>
      <TileLayer url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" attribution="© OpenTopoMap" maxZoom={17} />
      {autoFit && !flyTo && <FitAll trails={trails} startsOnly={markersOnly} />}
      <FlyTo target={flyTo} />
      {onBoundsChange && <BoundsWatcher onMove={(b) => onBoundsChange(b)} />}

      {/* Full colored lines — only when not in markers mode */}
      {!markersOnly && shown.map(t => <TrailLine key={t.id} trail={t} />)}

      {shown.map(t => {
        const score = trailDisplayScore(t);
        // Marker position: START of trail in markers mode, else center
        let pos: [number, number] | null = null;
        const first = t?.geojson?.geometry?.coordinates?.[0];
        if (markersOnly && first) pos = [first[1], first[0]];
        else {
          const c = t.center as { lat: number; lng: number };
          if (c) pos = [c.lat, c.lng];
          else if (first) pos = [first[1], first[0]];
        }
        if (!pos) return null;

        const isHovered = hoveredId === t.id;
        return (
          <Marker key={`m-${t.id}`} position={pos}
            icon={markersOnly ? startPin(score, isHovered) : badge(score, isHovered)}
            zIndexOffset={isHovered ? 1000 : 0}
            eventHandlers={{
              click: () => router.push(`/sentier/${t.id}`),
              mouseover: () => onHoverTrail && onHoverTrail(t.id),
              mouseout: () => onHoverTrail && onHoverTrail(null),
            }}>
            {markersOnly ? (
              <Tooltip direction="top" offset={[0, -38]} opacity={1} className="trail-tip">
                <PreviewCard t={t} />
              </Tooltip>
            ) : (
              <Popup>
                <div style={{ fontFamily: "Inter,sans-serif", minWidth: 160, textAlign: "center" }}>
                  <div style={{ fontFamily: "Fraunces,serif", fontWeight: 600, fontSize: 14, marginBottom: 6, color: "var(--ink)" }}>{t.name}</div>
                  {score != null && <div style={{ fontSize: 24, fontWeight: 600, color: difficultyColor(score), lineHeight: 1 }}>{score}<span style={{ fontSize: 13, opacity: 0.5 }}>/10</span></div>}
                  <div style={{ fontSize: 12, color: difficultyColor(score ?? 5), fontWeight: 500, marginTop: 2 }}>{score != null ? scoreLabel(score) : ""}</div>
                  <div style={{ fontSize: 11, color: "var(--stone)", marginTop: 6 }}>{t.distance} km · +{t.elevation} m</div>
                  <div style={{ marginTop: 8, fontSize: 12, color: "#5E7A55", fontWeight: 500, cursor: "pointer" }} onClick={() => router.push(`/sentier/${t.id}`)}>Voir la fiche →</div>
                </div>
              </Popup>
            )}
          </Marker>
        );
      })}
    </MapContainer>
    </div>
  );
}
