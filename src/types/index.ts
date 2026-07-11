export interface Trail {
  id: string;
  name: string;
  description?: string | null;
  distance: number;
  elevation: number;
  geojson: GeoJSONFeature;
  center: { lat: number; lng: number };
  createdAt: string;
  score?: TrailScore | null;
  isPublic?: boolean;
  author?: string;       // username of the owner (shown in the public bank)
  difficulty?: number | null;  // creator's stated difficulty (1-10)
  photos?: string[];     // base64 data URLs (only on detail endpoint)
  completed?: boolean;   // has the current user done this hike
  completionCount?: number;  // how many users have done this hike
  isOwner?: boolean;     // is the current user the owner
}

export interface SurfaceBreakdown {
  route: number;
  sentier: number;
  rocheux: number;
  montagne: number;
}

export interface TrailScore {
  global: number;
  surfaceBreakdown: SurfaceBreakdown;
  count: number;
}

export interface GeoJSONFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties?: any;
}

// ─── Surface families for the breakdown ───────────────────────────────────────
export const SURFACE_FAMILIES = [
  {
    key: "route",
    label: "Route / chemin roulant",
    hint: "Asphalte, piste, gravier compacté",
    color: "#185FA5",
  },
  {
    key: "sentier",
    label: "Sentier naturel",
    hint: "Terre, herbe, gravier, sable",
    color: "#639922",
  },
  {
    key: "rocheux",
    label: "Terrain rocheux",
    hint: "Pierres, rocher, boue, racines",
    color: "#BA7517",
  },
  {
    key: "montagne",
    label: "Haute montagne",
    hint: "Éboulis, neige, glace",
    color: "#A32D2D",
  },
] as const;

export type SurfaceKey = typeof SURFACE_FAMILIES[number]["key"];
