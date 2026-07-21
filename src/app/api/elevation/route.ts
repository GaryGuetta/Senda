import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// Server-side elevation proxy. Calling Open-Meteo directly from the browser is
// blocked by CORS (the response is silently dropped → D+ = 0, flat profile).
// Going through the server fixes that, adds caching, and falls back to a second
// provider (Open-Topo-Data / SRTM) when the first one is unavailable.
//
// POST { points: [[lat, lon], ...] }  ->  { elevations: [number|null, ...] }
export async function POST(req: NextRequest) {
  if (!rateLimit("elev:" + clientIp(req), 60, 60 * 1000)) {
    return NextResponse.json({ error: "Trop de requêtes, patientez." }, { status: 429 });
  }
  let points: [number, number][] = [];
  try { points = (await req.json()).points || []; } catch { /* ignore */ }
  if (!Array.isArray(points) || points.length === 0) {
    return NextResponse.json({ error: "points requis" }, { status: 400 });
  }
  // Guard against oversized payloads.
  if (points.length > 2000) points = points.slice(0, 2000);

  const out: (number | null)[] = new Array(points.length).fill(null);

  // Provider 1 — Open-Meteo elevation (batches of 100).
  async function tryOpenMeteo(): Promise<boolean> {
    let anyOk = false;
    for (let i = 0; i < points.length; i += 100) {
      const chunk = points.slice(i, i + 100);
      const lat = chunk.map(p => p[0].toFixed(5)).join(",");
      const lon = chunk.map(p => p[1].toFixed(5)).join(",");
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      try {
        const rep = await fetch(
          `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`,
          { signal: ctrl.signal, headers: { "User-Agent": "Senda/1.0" }, next: { revalidate: 86400 } },
        );
        clearTimeout(t);
        if (!rep.ok) continue;
        const d = await rep.json();
        const arr: any[] = d?.elevation || [];
        for (let k = 0; k < chunk.length; k++) {
          if (arr[k] != null && isFinite(arr[k])) { out[i + k] = arr[k]; anyOk = true; }
        }
      } catch { clearTimeout(t); }
    }
    return anyOk;
  }

  // Provider 2 — Open-Topo-Data SRTM (batches of 100, locations lat,lon|lat,lon).
  async function tryOpenTopo(): Promise<boolean> {
    let anyOk = false;
    for (let i = 0; i < points.length; i += 100) {
      if (out[i] != null) continue; // already filled by provider 1
      const chunk = points.slice(i, i + 100);
      const locs = chunk.map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join("|");
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      try {
        const rep = await fetch(
          `https://api.opentopodata.org/v1/srtm30m?locations=${locs}`,
          { signal: ctrl.signal, headers: { "User-Agent": "Senda/1.0" }, next: { revalidate: 86400 } },
        );
        clearTimeout(t);
        if (!rep.ok) continue;
        const d = await rep.json();
        const results: any[] = d?.results || [];
        for (let k = 0; k < chunk.length; k++) {
          const e = results[k]?.elevation;
          if (e != null && isFinite(e)) { out[i + k] = e; anyOk = true; }
        }
      } catch { clearTimeout(t); }
    }
    return anyOk;
  }

  const ok1 = await tryOpenMeteo();
  // If the first provider returned nothing usable, try the fallback.
  if (!ok1 || out.every(v => v == null)) await tryOpenTopo();

  return NextResponse.json({ elevations: out });
}
