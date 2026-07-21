// =============================================================================
// refugesData.ts — Base refuges intégrée à Senda (fusion du projet
// refuges-pyrenees). 1 622 refuges, cabanes et abris des deux versants des
// Pyrénées (Occitanie, Nouvelle-Aquitaine, Aragon, Catalogne, Navarre, Andorre),
// servis en local : plus aucune dépendance réseau à l'exécution.
//
// Origine des données : pyrenees-refuges.com, enrichies par la communauté
// refuges-pyrenees. Merci de conserver l'attribution en cas de réutilisation.
// =============================================================================
import raw from "@/data/refuges.json";

export type Cat = "refuge" | "libre" | "cabane" | "ruine";

export type Refuge = {
  id: string;
  nom: string;
  lat: number;
  lon: number;
  alt: number | null;
  region: string;
  ville: string | null;
  cat: Cat;
  typeNum: number | null;
  typeLabel: string | null;
  /** Places affichables ("8 / 4" = été / hiver) */
  places: string | null;
  placesEte: number | null;
  placesHiver: number | null;
  eau: string | null;
  bois: string | null;
  cheminee: string | null;
  couchage: string | null;
  /** Mois (0-11) où l'eau est disponible, si renseigné */
  eauMois: number[] | null;
  desc: string | null;
  /** Itinéraire connu passant à proximité (ex. "gr10") */
  rando: string | null;
  /** Fiche d'origine sur pyrenees-refuges.com */
  lienSource: string | null;
  /** Fiche sur le site communautaire refuges-pyrenees */
  lien: string | null;
  communaute: boolean;
  majLe: string | null;
};

const SITE_COMMUNAUTE = "https://refuges-pyrenees.vercel.app";

function asText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v || null;
  if (typeof v === "number") return String(v);
  return null;
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
  return null;
}

// L'export public marque presque tout en "cabane" (type_num perdu à la
// source). On restaure des catégories utiles à partir du nom / des indices :
//  - "ruine"  → ruine
//  - "refuge/refugio/refugi" gardé (mention dans la description ou grosse
//    capacité) → refuge gardé ; sinon → cabane ouverte ("libre")
//  - le reste → cabane / abri
function deriveCat(nom: string, desc: string | null, placesEte: number | null, brut: unknown): Cat {
  if (brut === "refuge" || brut === "libre" || brut === "ruine") return brut;
  const n = nom.toLowerCase();
  const d = (desc || "").toLowerCase();
  if (/\bruine?s?\b|\bruina\b/.test(n)) return "ruine";
  if (/\brefuge\b|\brefugio\b|\brefugi\b/.test(n)) {
    if (/gard[ée]/.test(d) || (placesEte ?? 0) >= 15) return "refuge";
    return "libre";
  }
  return "cabane";
}

function normalize(r: any): Refuge | null {
  if (!r || typeof r.lat !== "number" || typeof r.lon !== "number") return null;
  const nom = asText(r.nom) || "Sans nom";
  const desc = asText(r.description);
  const placesEte = asNum(r.places?.ete ?? r.places);
  const placesHiver = asNum(r.places?.hiver);
  let places: string | null = null;
  if (placesEte != null && placesHiver != null && placesHiver !== placesEte) places = `${placesEte} / ${placesHiver}`;
  else if (placesEte != null) places = String(placesEte);
  else if (placesHiver != null) places = String(placesHiver);

  const eauMois = Array.isArray(r.eau_mois)
    ? r.eau_mois.filter((m: any) => Number.isInteger(m) && m >= 0 && m <= 11)
    : null;

  return {
    id: String(r.id ?? `${nom}|${r.lat.toFixed(4)},${r.lon.toFixed(4)}`),
    nom,
    lat: r.lat,
    lon: r.lon,
    alt: asNum(r.altitude),
    region: asText(r.region) || "",
    ville: asText(r.ville),
    cat: deriveCat(nom, desc, placesEte, r.categorie),
    typeNum: asNum(r.type_num),
    typeLabel: asText(r.type_libelle),
    places,
    placesEte,
    placesHiver,
    eau: asText(r.eau),
    bois: asText(r.bois),
    cheminee: asText(r.cheminee),
    couchage: asText(r.couchage),
    eauMois: eauMois && eauMois.length ? eauMois : null,
    desc,
    rando: asText(r.rando),
    lienSource: asText(r.lien_source),
    lien: `${SITE_COMMUNAUTE}/index.html?refuge=${encodeURIComponent(String(r.id ?? ""))}`,
    communaute: r.modifie_par_la_communaute === true,
    majLe: asText(r.maj_le),
  };
}

// Chargées une fois par instance serveur, puis servies depuis la mémoire.
let cache: Refuge[] | null = null;
let byId: Map<string, Refuge> | null = null;

export function getAllRefuges(): Refuge[] {
  if (!cache) {
    const src: any[] = Array.isArray(raw) ? raw : (raw as any).refuges || [];
    cache = src.map(normalize).filter((r): r is Refuge => r !== null);
  }
  return cache;
}

export function getRefugeById(id: string): Refuge | null {
  if (!byId) {
    byId = new Map(getAllRefuges().map(r => [r.id, r]));
  }
  return byId.get(id) ?? null;
}

export function getRefugesMeta() {
  const meta = (raw as any).meta || {};
  return {
    source: meta.source || "pyrenees-refuges.com",
    genereLe: meta.genere_le || null,
    nombre: getAllRefuges().length,
    regions: meta.regions || [],
  };
}
