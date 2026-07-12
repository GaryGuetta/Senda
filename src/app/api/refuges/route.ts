import { NextResponse } from "next/server";

// Source: API Refuges des Pyrénées (données déjà normalisées : refuge/libre/cabane/ruine)
const REFUGES_API = "https://refuges-pyrenees.vercel.app/api/refuges.json";

type Cat = "refuge" | "libre" | "cabane" | "ruine";
function asCat(c: any): Cat {
  return c === "refuge" || c === "libre" || c === "cabane" || c === "ruine" ? c : "cabane";
}

// `places` may come back as a number, a string, or an object {ete, hiver}.
// Normalise it to a short display string so it never lands in JSX as an object.
function fmtPlaces(p: any): string | null {
  if (p == null) return null;
  if (typeof p === "number" || typeof p === "string") return String(p);
  if (typeof p === "object") {
    const ete = p.ete ?? p["été"] ?? p.summer;
    const hiver = p.hiver ?? p.winter;
    if (ete != null && hiver != null) return `${ete} / ${hiver}`;
    const v = ete ?? hiver;
    return v != null ? String(v) : null;
  }
  return null;
}
// Same defensive treatment for any free-text field that might arrive as an object.
function asText(v: any): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
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
        places: fmtPlaces(r.places),
        eau: asText(r.eau),
        bois: asText(r.bois),
        typeNum: r.type_num ?? null,
        typeLabel: asText(r.type_libelle),
        cat: asCat(r.categorie),
        desc: asText(r.description),
        lien: r.lien ?? null,
      }));

    return NextResponse.json(refuges);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erreur" }, { status: 500 });
  }
}
