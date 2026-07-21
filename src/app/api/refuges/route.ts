import { NextResponse } from "next/server";
import { getAllRefuges } from "@/lib/refugesData";

// Base refuges intégrée (fusion du projet refuges-pyrenees) : les 1 622
// refuges, cabanes et abris des Pyrénées sont servis depuis les données
// locales de Senda — instantané, disponible hors API externe, et avec tous
// les champs (cheminée, couchage, commune, itinéraire, mois avec eau…).
export const dynamic = "force-static";

export async function GET() {
  try {
    return NextResponse.json(getAllRefuges(), {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erreur" }, { status: 500 });
  }
}
