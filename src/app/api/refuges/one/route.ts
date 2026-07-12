import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// Fetch a single refuge by id (reuses the /api/refuges list, cached).
export async function GET(req: NextRequest) {
  if (!rateLimit("refuge-one:" + clientIp(req), 120, 60 * 1000)) {
    return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  try {
    const origin = req.nextUrl.origin;
    const rep = await fetch(`${origin}/api/refuges`, { next: { revalidate: 3600 } });
    if (!rep.ok) return NextResponse.json({ error: "indisponible" }, { status: 502 });
    const list = await rep.json();
    const refuge = Array.isArray(list) ? list.find((r: any) => r.id === id) : null;
    if (!refuge) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    return NextResponse.json({ refuge });
  } catch {
    return NextResponse.json({ error: "erreur" }, { status: 500 });
  }
}
