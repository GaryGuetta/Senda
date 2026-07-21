import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { getRefugeById } from "@/lib/refugesData";

// Fiche d'un refuge par id — lecture directe des données locales.
export async function GET(req: NextRequest) {
  if (!rateLimit("refuge-one:" + clientIp(req), 120, 60 * 1000)) {
    return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const refuge = getRefugeById(id);
  if (!refuge) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  return NextResponse.json({ refuge });
}
