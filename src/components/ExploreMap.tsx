"use client";
import { MapContainer, TileLayer, Polyline, Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import { useEffect, useMemo } from "react";
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
  const size = hovered ? 42 : 34;
  const ring = hovered ? "0 0 0 4px rgba(255,255,255,0.6), 0 4px 14px rgba(0,0,0,0.35)" : "0 2px 8px rgba(0,0,0,0.28)";
  return L.divIcon({
    html: `<div style="background:${color};color:#fff;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${hovered?18:15}px;font-weight:700;border:3px solid #fff;box-shadow:${ring};font-family:Inter,sans-serif;transition:all .15s;">${score ?? "?"}</div>`,
    className: "", iconAnchor: [size/2, size/2],
  });
}

// A "start of trail" teardrop pin with the score shown clearly on the coloured head.
function startPin(score: number | null, hovered = false) {
  const color = difficultyColor(score ?? 5);
  const s = hovered ? 44 : 36;
  const ring = hovered ? "0 0 0 4px rgba(255,255,255,0.55), 0 5px 14px rgba(0,0,0,0.4)" : "0 3px 9px rgba(0,0,0,0.32)";
  return L.divIcon({
    html: `<div style="position:relative;width:${s}px;height:${s + 12}px;">
      <div style="position:absolute;top:0;left:0;width:${s}px;height:${s}px;background:${color};border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:${ring};"></div>
      <div style="position:absolute;top:0;left:0;width:${s}px;height:${s}px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${hovered ? 17 : 15}px;font-family:Inter,sans-serif;">${score ?? "?"}</div>
    </div>`,
    className: "", iconSize: [s, s + 12], iconAnchor: [s / 2, s + 12],
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

type FlyBox = { south: number; north: number; west: number; east: number };
type FlyTarget = { lat: number; lng: number; zoom?: number; bbox?: FlyBox | null };

interface ExploreMapProps {
  trails: any[];
  variant?: "lines" | "markers";
  hoveredId?: string | null;
  onHoverTrail?: (id: string | null) => void;
  onBoundsChange?: (b: L.LatLngBounds) => void;
  autoFit?: boolean;
  flyTo?: FlyTarget | null;
}

// Moves the map when a target is set (e.g. after a city search).
// Instant (no animation): animating while the marker list changes can make
// Leaflet reference just-unmounted markers and crash. Snapping avoids that.
function FlyTo({ target }: { target?: FlyTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    try {
      const bb = target.bbox;
      if (bb && [bb.south, bb.north, bb.west, bb.east].every(Number.isFinite)) {
        map.fitBounds([[bb.south, bb.west], [bb.north, bb.east]], { padding: [40, 40], maxZoom: 14, animate: false });
        return;
      }
      const lat = Number(target.lat), lng = Number(target.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) map.setView([lat, lng], target.zoom ?? 13, { animate: false });
    } catch {}
  }, [target, map]);
  return null;
}

export default function ExploreMap({ trails, variant = "lines", hoveredId = null, onHoverTrail, onBoundsChange, autoFit = true, flyTo = null }: ExploreMapProps) {
  const router = useRouter();
  const shown = trails;

  // Markers are memoised on the trail set only (NOT on hover/zoom) so the cluster
  // layer isn't rebuilt on every map move — that rebuild is what broke zooming.
  const markers = useMemo(() => shown.map(t => {
    const score = trailDisplayScore(t);
    const first = t?.geojson?.geometry?.coordinates?.[0];
    const c = t.center as { lat: number; lng: number };
    const pos: [number, number] | null = first ? [first[1], first[0]] : (c ? [c.lat, c.lng] : null);
    if (!pos) return null;
    return (
      <Marker key={`m-${t.id}`} position={pos} icon={startPin(score, false)}
        eventHandlers={{
          click: () => router.push(`/sentier/${t.id}`),
          mouseover: () => onHoverTrail && onHoverTrail(t.id),
          mouseout: () => onHoverTrail && onHoverTrail(null),
        }}>
        <Tooltip direction="top" offset={[0, -40]} opacity={1} className="trail-tip">
          <PreviewCard t={t} />
        </Tooltip>
      </Marker>
    );
  }), [shown, router, onHoverTrail]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <MapContainer center={MERENS} zoom={12} style={{ width: "100%", height: "100%" }} zoomControl={true}>
      <TileLayer url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" attribution="© OpenTopoMap" maxZoom={17} />
      {autoFit && !flyTo && <FitAll trails={trails} startsOnly />}
      <FlyTo target={flyTo} />
      {onBoundsChange && <BoundsWatcher onMove={(b) => onBoundsChange(b)} />}

      {/* Clustered markers only — no trail lines (much faster; nearby trails group
          into a numbered bubble that splits apart as you zoom in). */}
      <MarkerClusterGroup chunkedLoading maxClusterRadius={55} showCoverageOnHover={false} spiderfyOnMaxZoom>
        {markers}
      </MarkerClusterGroup>
    </MapContainer>
    </div>
  );
}
