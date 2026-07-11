import { NextRequest, NextResponse } from "next/server";

// Server-side weather proxy — better connectivity, caching, clean timeout/fallback.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get("lat") || "");
  const lon = parseFloat(sp.get("lon") || "");
  const alt = sp.get("alt");
  if (isNaN(lat) || isNaN(lon)) return NextResponse.json({ error: "lat/lon requis" }, { status: 400 });

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=5${alt ? `&elevation=${parseInt(alt)}` : ""}`;

  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 9000);
  try {
    // Cache each point for 30 min so repeat views are instant and don't re-hit Open-Meteo.
    const rep = await fetch(url, { signal: ctrl.signal, next: { revalidate: 1800 } });
    clearTimeout(id);
    if (!rep.ok) return NextResponse.json({ error: "météo indisponible" }, { status: 502 });
    const data = await rep.json();
    return NextResponse.json(data);
  } catch {
    clearTimeout(id);
    return NextResponse.json({ error: "météo indisponible" }, { status: 504 });
  }
}
