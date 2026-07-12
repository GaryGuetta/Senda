import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// Server-side Overpass proxy — better connectivity + mirror fallback than browser calls.
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export async function POST(req: NextRequest) {
  if (!rateLimit("overpass:" + clientIp(req), 80, 60 * 1000)) return NextResponse.json({ error: "Trop de requêtes, patientez." }, { status: 429 });
  let query = "";
  try { query = (await req.json()).query || ""; } catch { /* ignore */ }
  if (!query) return NextResponse.json({ error: "query requise" }, { status: 400 });

  for (const url of MIRRORS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const rep = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (rep.ok) {
        const data = await rep.json();
        return NextResponse.json(data);
      }
    } catch { clearTimeout(timer); /* try next mirror */ }
  }
  return NextResponse.json({ error: "Overpass indisponible" }, { status: 502 });
}
