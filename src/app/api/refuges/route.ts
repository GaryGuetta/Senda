import { NextResponse } from "next/server";

const REGIONS = ["Andorre", "Occitanie", "Nouvelle-Aquitaine"];

// type_lieu → category
function categorie(t: number | null): "refuge" | "libre" | "cabane" | "ruine" {
  if (t === 5 || t === 6) return "refuge";
  if (t === 2 || t === 3) return "libre";
  if (t === 7) return "ruine";
  return "cabane"; // 1, 4, or unknown
}

function readCoord(geom: any): { lat: number; lon: number; alt: number | null } | null {
  if (!geom) return null;
  const c = geom.coordinates;
  if (!Array.isArray(c)) return null;
  // Point: [lon, lat, (alt)]
  if (typeof c[0] === "number" && typeof c[1] === "number") {
    return { lat: c[1], lon: c[0], alt: c[2] != null ? Math.round(c[2]) : null };
  }
  return null;
}

export async function GET() {
  try {
    const results = await Promise.all(REGIONS.map(async region => {
      const url = `https://www.pyrenees-refuges.com/api.php?type_fichier=GEOJSON&region=${encodeURIComponent(region)}`;
      try {
        const rep = await fetch(url, { next: { revalidate: 3600 }, headers: { "User-Agent": "Senda/1.0" } });
        if (!rep.ok) return [];
        const data = await rep.json();
        return (data.features || []).map((f: any) => {
          const c = readCoord(f.geometry);
          if (!c) return null;
          const p = f.properties || {};
          const t = p.type_lieu ?? p.type ?? p.categorie;
          const typeNum = Number(t) || null;
          const desc = (p.description || p.commentaire || p.info || "").toString().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          return {
            id: `${p.nom || p.name || "x"}|${c.lat.toFixed(4)},${c.lon.toFixed(4)}`,
            nom: p.nom || p.name || p.title || "Sans nom",
            lat: c.lat, lon: c.lon,
            alt: p.altitude || p.alt || c.alt || null,
            region,
            places: p.places || p.capacite || null,
            eau: p.eau || p.eau_proximite || p.point_eau || p.water || null,
            bois: p.bois || p.bois_proximite || p.foret || p.wood || null,
            typeNum,
            cat: categorie(typeNum),
            desc,
            lien: p.url || p.lien || null,
          };
        }).filter(Boolean);
      } catch { return []; }
    }));

    const refuges = results.flat().filter((r: any) => r && r.lat && r.lon);
    return NextResponse.json(refuges);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
