"use client";
import { MapContainer, TileLayer, Marker, Tooltip, Polyline, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import { useEffect, Fragment } from "react";

import { REFUGE_COLORS, REFUGE_LABELS } from "./refugeStyles";

function pin(cat: string, active: boolean) {
  const color = REFUGE_COLORS[cat] ?? "#8A8578";
  const s = active ? 34 : 26;
  const ring = active ? "0 0 0 4px rgba(255,255,255,0.55), 0 4px 12px rgba(0,0,0,0.4)" : "0 2px 6px rgba(0,0,0,0.35)";
  return L.divIcon({
    html: `<div style="position:relative;width:${s}px;height:${s + 8}px;">
      <div style="position:absolute;top:0;left:0;width:${s}px;height:${s}px;background:${color};border:2.5px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:${ring};"></div>
      <svg style="position:absolute;top:${active ? 8 : 6}px;left:${active ? 8 : 6}px;width:${active ? 18 : 14}px;height:${active ? 18 : 14}px;" viewBox="0 0 24 24" fill="#fff"><path d="M12 3 L22 21 H2 Z M12 9 L7.5 17 H16.5 Z" fill-rule="evenodd"/></svg>
    </div>`,
    className: "", iconSize: [s, s + 8], iconAnchor: [s / 2, s + 8],
  });
}

function FitAll({ refuges, enabled }: { refuges: any[]; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || refuges.length === 0) return;
    const lats = refuges.map(r => r.lat), lons = refuges.map(r => r.lon);
    map.fitBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { padding: [50, 50] });
  }, [refuges, map, enabled]);
  return null;
}

function ClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function RouteFit({ route }: { route: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (route.length < 2) return;
    const lats = route.map(p => p[0]), lons = route.map(p => p[1]);
    map.fitBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { padding: [50, 50] });
  }, [route, map]);
  return null;
}

function BoundsWatcher({ onMove }: { onMove: (b: L.LatLngBounds) => void }) {
  const map = useMapEvents({ moveend: () => onMove(map.getBounds()), zoomend: () => onMove(map.getBounds()) });
  return null;
}

interface Props {
  refuges: any[];
  selectedId?: string | null;
  hoveredId?: string | null;
  onSelect?: (r: any) => void;
  onHover?: (id: string | null) => void;
  onBoundsChange?: (b: L.LatLngBounds) => void;
  autoFit?: boolean;
  route?: [number, number][] | null;      // imported GPX track
  planStops?: { lat: number; lon: number; day: number; name: string; bivouac?: boolean }[]; // sleep stages
  daySegments?: { pts: [number, number][]; color: string }[]; // route coloured per day
  drawing?: boolean;                      // draw mode active
  drawPts?: [number, number][];           // in-progress drawn points
  onMapClick?: (lat: number, lon: number) => void;
  waterPoints?: { lat: number; lon: number; type: string; potable?: boolean; nom?: string | null }[];
  waterZones?: { ligne: [number, number][]; type: string; nom?: string | null }[];
  hover?: [number, number] | null;
}

function dayIcon(day: number, bivouac = false) {
  const bg = bivouac ? "#B45309" : "var(--pine,#21402E)";
  const inner = bivouac
    ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"><path d="M12 4 L3 20 h18 Z M12 4 v16"/></svg>`
    : `${day}`;
  return L.divIcon({
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;font-weight:700;font-size:14px;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.4);">${inner}</div>`,
    className: "", iconAnchor: [15, 15],
  });
}

function waterIcon(potable?: boolean) {
  const color = potable ? "#10b981" : "#0ea5e9";
  return L.divIcon({
    html: `<div style="position:relative;width:24px;height:30px;">
      <div style="position:absolute;top:0;left:0;width:24px;height:24px;background:${color};border:2.5px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>
      <svg style="position:absolute;top:5px;left:5px;width:14px;height:14px;" viewBox="0 0 24 24" fill="#fff"><path d="M12 3s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11z"/></svg>
    </div>`,
    className: "", iconSize: [24, 30], iconAnchor: [12, 30],
  });
}

const PYRENEES: [number, number] = [42.72, 0.55];

export default function RefugesMap({ refuges, selectedId = null, hoveredId = null, onSelect, onHover, onBoundsChange, autoFit = true, route = null, planStops = [], daySegments = [], drawing = false, drawPts = [], onMapClick, waterPoints = [], waterZones = [], hover = null }: Props) {
  return (
    <MapContainer center={PYRENEES} zoom={8} style={{ width: "100%", height: "100%" }} zoomControl={true}>
      <TileLayer url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" attribution="© OpenTopoMap" maxZoom={17} />
      <FitAll refuges={refuges} enabled={autoFit} />
      {route && route.length > 1 && <RouteFit route={route} />}
      {onBoundsChange && <BoundsWatcher onMove={onBoundsChange} />}

      {drawing && onMapClick && <ClickHandler onClick={onMapClick} />}

      {/* In-progress drawn route */}
      {drawing && drawPts.length > 0 && (
        <>
          <Polyline positions={drawPts} pathOptions={{ color: "#ff5d73", weight: 3.5, opacity: 0.95, dashArray: "7 7" }} />
          {drawPts.map((p, i) => (
            <CircleMarker key={`dp-${i}`} center={p} radius={i === 0 || i === drawPts.length - 1 ? 6 : 4}
              pathOptions={{ color: "#fff", weight: 2, fillColor: "#ff5d73", fillOpacity: 1 }} />
          ))}
        </>
      )}

      {/* Finalised route */}
      {route && route.length > 1 && daySegments.length === 0 && (
        <>
          <Polyline positions={route} pathOptions={{ color: "#ffffff", weight: 8, opacity: 0.75 }} />
          <Polyline positions={route} pathOptions={{ color: "#ff5d73", weight: 4.5, opacity: 0.98 }} />
        </>
      )}
      {/* Route coloured per day */}
      {daySegments.map((seg, i) => seg.pts.length > 1 && (
        <Fragment key={`day-seg-${i}`}>
          <Polyline positions={seg.pts} pathOptions={{ color: "#ffffff", weight: 8, opacity: 0.7 }} />
          <Polyline positions={seg.pts} pathOptions={{ color: seg.color, weight: 4.5, opacity: 0.98 }} />
        </Fragment>
      ))}

      {/* Hover cursor linked to the elevation profile */}
      {hover && (
        <>
          <CircleMarker center={hover} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: "#16241C", fillOpacity: 1 }} />
          <CircleMarker center={hover} radius={4} pathOptions={{ color: "#fff", weight: 0, fillColor: "#fff", fillOpacity: 1 }} />
        </>
      )}

      {/* Water zones: the trail follows the water (LONGÉ) — blue line + halo */}
      {waterZones.map((z, i) => z.ligne.length > 1 && (
        <Fragment key={`wz-${i}`}>
          <Polyline positions={z.ligne} pathOptions={{ color: "#38bdf8", weight: 12, opacity: 0.18, lineCap: "round" }} />
          <Polyline positions={z.ligne} pathOptions={{ color: "#0ea5e9", weight: 5, opacity: 0.95, lineCap: "round" }}>
            <Tooltip direction="top" opacity={1} className="trail-tip">
              <div style={{ fontFamily: "Inter,sans-serif", fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>💧 {z.nom || z.type} · longé</div>
            </Tooltip>
          </Polyline>
        </Fragment>
      ))}

      {/* Water points along the route — visible coloured droplets */}
      {waterPoints.map((w, i) => (
        <Marker key={`w-${i}`} position={[w.lat, w.lon]} icon={waterIcon(w.potable)}>
          <Tooltip direction="top" offset={[0, -18]} opacity={1} className="trail-tip">
            <div style={{ fontFamily: "Inter,sans-serif", fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>💧 {w.nom || w.type}{w.potable ? " · potable" : ""}</div>
          </Tooltip>
        </Marker>
      ))}
      {planStops.map(s => (
        <Marker key={`day-${s.day}`} position={[s.lat, s.lon]} icon={dayIcon(s.day, s.bivouac)} zIndexOffset={2000}>
          <Tooltip direction="top" offset={[0, -14]} opacity={1} className="trail-tip">
            <div style={{ fontFamily: "Inter,sans-serif" }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "var(--stone)" }}>Nuit {s.day}</div>
              <div style={{ fontFamily: "Fraunces,serif", fontWeight: 600, fontSize: 13.5, color: "var(--ink)" }}>{s.name}</div>
            </div>
          </Tooltip>
        </Marker>
      ))}

      <MarkerClusterGroup chunkedLoading maxClusterRadius={50} showCoverageOnHover={false}>
        {refuges.map(r => {
          const active = hoveredId === r.id || selectedId === r.id;
          return (
            <Marker key={r.id} position={[r.lat, r.lon]} icon={pin(r.cat, active)}
              zIndexOffset={active ? 1000 : 0}
              eventHandlers={{
                click: () => onSelect && onSelect(r),
                mouseover: () => onHover && onHover(r.id),
                mouseout: () => onHover && onHover(null),
              }}>
              <Tooltip direction="top" offset={[0, -30]} opacity={1} className="trail-tip">
                <div style={{ fontFamily: "Inter,sans-serif", minWidth: 130 }}>
                  <div style={{ fontFamily: "Fraunces,serif", fontWeight: 600, fontSize: 13.5, color: "var(--ink)" }}>{r.nom}</div>
                  <div style={{ fontSize: 11.5, color: REFUGE_COLORS[r.cat], fontWeight: 600, marginTop: 3 }}>{REFUGE_LABELS[r.cat]}</div>
                  {r.alt && <div style={{ fontSize: 11, color: "var(--stone)", marginTop: 3 }}>{r.alt} m</div>}
                </div>
              </Tooltip>
            </Marker>
          );
        })}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
