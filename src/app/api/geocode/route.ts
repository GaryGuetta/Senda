import { NextRequest, NextResponse } from "next/server";

// Geocode a place name (city, village…) via OSM Nominatim, server-side.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ error: "requête trop courte" }, { status: 400 });

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}` +
    `&format=json&limit=1&addressdetails=0&countrycodes=fr,ad,es`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const rep = await fetch(url, {
      headers: { "User-Agent": "Senda/1.0 (hiking app)", "Accept-Language": "fr" },
      signal: ctrl.signal,
      next: { revalidate: 86400 }, // cache a day
    });
    clearTimeout(timer);
    if (!rep.ok) return NextResponse.json({ error: "géocodage indisponible" }, { status: 502 });
    const arr = await rep.json();
    if (!Array.isArray(arr) || arr.length === 0) return NextResponse.json({ found: false });
    const r = arr[0];
    // boundingbox = [south, north, west, east]
    const bb = (r.boundingbox || []).map(Number);
    return NextResponse.json({
      found: true,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      name: r.display_name,
      bbox: bb.length === 4 ? { south: bb[0], north: bb[1], west: bb[2], east: bb[3] } : null,
    });
  } catch {
    clearTimeout(timer);
    return NextResponse.json({ error: "géocodage indisponible" }, { status: 504 });
  }
}
