import { NextResponse } from "next/server";

// Source: API Refuges des Pyrénées (données déjà normalisées : refuge/libre/cabane/ruine)
const REFUGES_API = "https://refuges-pyrenees.vercel.app/api/refuges.json";

type Cat = "refuge" | "libre" | "cabane" | "ruine";
function asCat(c: any): Cat {
  return c === "refuge" || c === "libre" || c === "cabane" || c === "ruine" ? c : "cabane";
}

export async function GET() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const rep = await fetch(REFUGES_API, {
      next: { revalidate: 60 },
      headers: { "User-Agent": "Senda/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!rep.ok) return NextResponse.json({ error: "API refuges indisponible" }, { status: 502 });

    const data = await rep.json();
    const source: any[] = Array.isArray(data) ? data : (data.refuges || []);

    const refuges = source
      .filter(r => r && typeof r.lat === "number" && typeof r.lon === "number")
      .map(r => ({
        id: r.id ?? `${r.nom || "x"}|${r.lat.toFixed(4)},${r.lon.toFixed(4)}`,
        nom: r.nom || "Sans nom",
        lat: r.lat,
        lon: r.lon,
        alt: r.altitude ?? null,
        region: r.region ?? "",
        places: r.places ?? null,
        eau: r.eau ?? null,
        bois: r.bois ?? null,
        typeNum: r.type_num ?? null,
        typeLabel: r.type_libelle ?? null,
        cat: asCat(r.categorie),
        desc: r.description ?? null,
        lien: r.lien ?? null,
      }));

    return NextResponse.json(refuges);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erreur" }, { status: 500 });
  }
}
