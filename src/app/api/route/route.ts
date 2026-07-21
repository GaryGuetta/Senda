import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// Pedestrian routing proxy — snaps drawn waypoints onto real paths/trails.
// BRouter's hiking profile comes FIRST: it strongly favours footpaths and
// mountain trails. OSRM foot is only a fallback (its urban profile treats
// roads and trails alike, which used to route hikes along switchback roads).
export async function POST(req: NextRequest) {
  if (!rateLimit("route:" + clientIp(req), 80, 60 * 1000)) return NextResponse.json({ error: "Trop de requêtes, patientez." }, { status: 429 });
  let points: [number, number][] = [];
  try { points = (await req.json()).points || []; } catch { /* ignore */ }
  if (!Array.isArray(points) || points.length < 2) {
    return NextResponse.json({ error: "au moins 2 points" }, { status: 400 });
  }

  // 1) BRouter hiking (lonlats separated by '|') — prefers real trails
  const brouter = points.map(([lat, lon]) => `${lon},${lat}`).join("|");
  const brUrl = `https://brouter.de/brouter?lonlats=${brouter}&profile=hiking-beta&alternativeidx=0&format=geojson`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const rep = await fetch(brUrl, { headers: { "User-Agent": "Senda/1.0" }, signal: ctrl.signal });
    clearTimeout(t);
    if (rep.ok) {
      const d = await rep.json();
      const g = d?.features?.[0]?.geometry?.coordinates;
      if (Array.isArray(g) && g.length > 1) {
        return NextResponse.json({ coords: g.map((c: number[]) => [c[1], c[0]]) }); // -> [lat,lon]
      }
    }
  } catch { /* try fallback */ }

  // 2) OSRM foot fallback: coordinates are lon,lat separated by ';'
  const osrmCoords = points.map(([lat, lon]) => `${lon},${lat}`).join(";");
  const osrmUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${osrmCoords}?overview=full&geometries=geojson&continue_straight=false`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const rep = await fetch(osrmUrl, { headers: { "User-Agent": "Senda/1.0" }, signal: ctrl.signal });
    clearTimeout(t);
    if (rep.ok) {
      const d = await rep.json();
      const g = d?.routes?.[0]?.geometry?.coordinates;
      if (Array.isArray(g) && g.length > 1) {
        return NextResponse.json({ coords: g.map((c: number[]) => [c[1], c[0]]) });
      }
    }
  } catch { /* give up -> straight line client-side */ }

  return NextResponse.json({ coords: null });
}
