"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import CommentsSection from "@/components/CommentsSection";
import { REFUGE_COLORS, REFUGE_LABELS } from "./refugeStyles";
import styles from "./RefugeDetail.module.css";

function fetchTimeout(url: string, opts: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

const WMO: Record<number, [string, string]> = {
  0: ["☀️", "Ciel dégagé"], 1: ["🌤️", "Peu nuageux"], 2: ["⛅", "Nuageux"], 3: ["☁️", "Couvert"],
  45: ["🌫️", "Brouillard"], 48: ["🌫️", "Brouillard givrant"],
  51: ["🌦️", "Bruine"], 53: ["🌦️", "Bruine"], 55: ["🌦️", "Bruine dense"],
  61: ["🌧️", "Pluie légère"], 63: ["🌧️", "Pluie"], 65: ["🌧️", "Pluie forte"],
  71: ["🌨️", "Neige légère"], 73: ["🌨️", "Neige"], 75: ["❄️", "Neige forte"], 77: ["🌨️", "Grains"],
  80: ["🌦️", "Averses"], 81: ["🌧️", "Averses"], 82: ["⛈️", "Averses fortes"],
  85: ["🌨️", "Neige"], 86: ["❄️", "Neige forte"], 95: ["⛈️", "Orage"], 96: ["⛈️", "Orage grêle"], 99: ["⛈️", "Orage violent"],
};
const wmo = (c: number): [string, string] => WMO[c] ?? ["🌡️", "—"];
const JOURS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function fmtBool(v: any): string | null {
  if (v == null || v === "") return null;
  const s = v.toString().toLowerCase();
  if (["oui", "yes", "1", "true", "vrai", "o"].includes(s)) return "Oui";
  if (["non", "no", "0", "false", "faux", "n"].includes(s)) return "Non";
  return v.toString();
}

export default function RefugeDetail({ refuge, onBack }: { refuge: any; onBack: () => void }) {
  const [weather, setWeather] = useState<any>(null);
  const [wLoading, setWLoading] = useState(true);
  const [wError, setWError] = useState(false);
  const [water, setWater] = useState<any[] | null>(null);
  const [waterLoading, setWaterLoading] = useState(true);
  const color = REFUGE_COLORS[refuge.cat] ?? "#8A8578";

  useEffect(() => {
    setWLoading(true); setWError(false); setWeather(null);
    const url = `/api/weather?lat=${refuge.lat}&lon=${refuge.lon}${refuge.alt ? `&alt=${refuge.alt}` : ""}`;
    let cancelled = false;
    async function load(attempt = 0): Promise<void> {
      try {
        const r = await fetchTimeout(url, {}, 10000);
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok || !d?.current) throw new Error("no data");
        setWeather(d); setWLoading(false);
      } catch {
        if (cancelled) return;
        if (attempt < 1) { setTimeout(() => load(attempt + 1), 1200); return; } // one quiet retry
        setWError(true); setWLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refuge.id, refuge.lat, refuge.lon, refuge.alt]);

  // Nearby water from Overpass/OSM — springs, taps AND streams/rivers/lakes (within ~1 km)
  useEffect(() => {
    setWaterLoading(true); setWater(null);
    const R = 1000, lat = refuge.lat, lon = refuge.lon;
    const q = `[out:json][timeout:20];(` +
      `node["natural"="spring"](around:${R},${lat},${lon});` +
      `node["amenity"="drinking_water"](around:${R},${lat},${lon});` +
      `node["man_made"~"water_well|water_tap|water_point"](around:${R},${lat},${lon});` +
      `way["natural"="water"](around:${R},${lat},${lon});` +
      `way["waterway"~"stream|river|canal"](around:${R},${lat},${lon});` +
      `node["waterway"~"stream|river"](around:${R},${lat},${lon});` +
      `);out geom tags;`;
    const dist = (la: number, lo: number) => {
      const a = (la - lat) * 111320, b = (lo - lon) * 111320 * Math.cos(lat * Math.PI / 180);
      return Math.round(Math.sqrt(a * a + b * b));
    };
    const typeOf = (t: any): { type: string; potable: boolean } => {
      if (t.amenity === "drinking_water") return { type: "Eau potable", potable: true };
      if (t.man_made === "water_tap" || t.man_made === "water_point") return { type: "Robinet", potable: true };
      if (t.man_made === "water_well") return { type: "Puits", potable: false };
      if (t.natural === "spring") return { type: "Source", potable: false };
      if (t.natural === "water" || t.water) {
        const n = (t.name || "").toLowerCase();
        if (n.includes("lac") || n.includes("estany") || n.includes("ibon")) return { type: "Lac", potable: false };
        if (n.includes("étang") || n.includes("etang")) return { type: "Étang", potable: false };
        return { type: "Plan d'eau", potable: false };
      }
      if (t.waterway === "river") return { type: "Rivière", potable: false };
      if (t.waterway === "stream") return { type: "Ruisseau", potable: false };
      if (t.waterway) return { type: "Cours d'eau", potable: false };
      return { type: "Point d'eau", potable: false };
    };
    (async () => {
      const mirrors = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
      let data: any = null;
      for (const m of mirrors) { try { const rep = await fetchTimeout(m, { method: "POST", body: "data=" + encodeURIComponent(q) }, 9000); if (rep.ok) { data = await rep.json(); break; } } catch {} }
      if (!data) { setWater([]); setWaterLoading(false); return; }
      const seen = new Set<string>();
      const pts: any[] = [];
      for (const e of (data.elements || [])) {
        let d = Infinity;
        if (e.type === "node" && e.lat != null) d = dist(e.lat, e.lon);
        else if (Array.isArray(e.geometry)) { for (const g of e.geometry) { if (g.lat != null) { const dd = dist(g.lat, g.lon); if (dd < d) d = dd; } } }
        if (!isFinite(d) || d > R + 50) continue;
        const info = typeOf(e.tags || {});
        const name = e.tags?.name || null;
        const key = info.type + "|" + (name || Math.round(d / 60));
        if (seen.has(key)) continue; seen.add(key);
        pts.push({ ...info, name, dist: d });
      }
      pts.sort((a, b) => a.dist - b.dist);
      setWater(pts.slice(0, 3)); setWaterLoading(false);
    })();
  }, [refuge.id, refuge.lat, refuge.lon]);

  const { user, requireLogin } = useAuth();
  const [contrib, setContrib] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [savingInfo, setSavingInfo] = useState(false);

  useEffect(() => {
    setContrib(null); setEditing(false);
    fetch(`/api/refuges/contrib?id=${encodeURIComponent(refuge.id)}`)
      .then(r => r.json()).then(d => { setContrib(d.contribution || null); })
      .catch(() => {});
  }, [refuge.id]);

  const mAlt = contrib?.altitude ?? refuge.alt;
  const mPlaces = contrib?.places ?? refuge.places;
  const mDesc = contrib?.description ?? refuge.desc;
  const eau = fmtBool(contrib?.eau ?? refuge.eau);
  const bois = fmtBool(contrib?.bois ?? refuge.bois);

  function openEdit() {
    setForm({
      eau: fmtBool(contrib?.eau ?? refuge.eau) || "",
      bois: fmtBool(contrib?.bois ?? refuge.bois) || "",
      places: mPlaces ?? "", altitude: mAlt ?? "", description: mDesc ?? "",
    });
    setEditing(true);
  }
  async function saveInfo() {
    setSavingInfo(true);
    try {
      const r = await fetch("/api/refuges/contrib", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refugeId: refuge.id, ...form }) });
      const d = await r.json();
      if (r.ok) { setContrib(d.contribution); setEditing(false); }
      else if (r.status === 401) requireLogin();
    } finally { setSavingInfo(false); }
  }

  return (
    <div className={styles.wrap}>
      <button className={styles.back} onClick={onBack}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Retour à la liste
      </button>

      <div className={styles.head}>
        <span className={styles.typeBadge} style={{ background: color }}>{REFUGE_LABELS[refuge.cat]}</span>
        <h2 className={styles.name}>{refuge.nom}</h2>
        <div className={styles.region}>{refuge.region}{refuge.typeLabel ? ` · ${refuge.typeLabel}` : ""}</div>
      </div>

      {/* Key facts (merged with community contributions) */}
      <div className={styles.facts}>
        {mAlt && <div className={styles.fact}><span className={styles.factVal}>{mAlt}</span><span className={styles.factLbl}>m altitude</span></div>}
        {mPlaces && <div className={styles.fact}><span className={styles.factVal}>{mPlaces}</span><span className={styles.factLbl}>places</span></div>}
        {eau && <div className={styles.fact}><span className={styles.factVal} style={{ fontSize: 16 }}>{eau === "Oui" ? "💧" : "—"}</span><span className={styles.factLbl}>eau</span></div>}
        {bois && <div className={styles.fact}><span className={styles.factVal} style={{ fontSize: 16 }}>{bois === "Oui" ? "🪵" : "—"}</span><span className={styles.factLbl}>bois</span></div>}
      </div>

      {/* Coordinates */}
      <a className={styles.coords} href={`https://www.openstreetmap.org/?mlat=${refuge.lat}&mlon=${refuge.lon}#map=15/${refuge.lat}/${refuge.lon}`} target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span>{refuge.lat.toFixed(5)}, {refuge.lon.toFixed(5)}</span>
        <span className={styles.coordsLink}>ouvrir la carte →</span>
      </a>

      {/* Edit info */}
      {!editing && (
        <div className={styles.editRow}>
          <button className={styles.editBtn} onClick={() => user ? openEdit() : requireLogin()}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Corriger / compléter les infos
          </button>
          {contrib?.updatedBy && <span className={styles.editedBy}>maj par {contrib.updatedBy}</span>}
        </div>
      )}
      {editing && (
        <div className={styles.editForm}>
          <div className={styles.editGrid}>
            <label className={styles.editField}><span>Eau</span>
              <select value={form.eau} onChange={e => setForm({ ...form, eau: e.target.value })}>
                <option value="">Inconnu</option><option value="Oui">Oui</option><option value="Non">Non</option>
              </select>
            </label>
            <label className={styles.editField}><span>Bois</span>
              <select value={form.bois} onChange={e => setForm({ ...form, bois: e.target.value })}>
                <option value="">Inconnu</option><option value="Oui">Oui</option><option value="Non">Non</option>
              </select>
            </label>
            <label className={styles.editField}><span>Places</span>
              <input type="text" value={form.places} onChange={e => setForm({ ...form, places: e.target.value })} placeholder="ex. 6" />
            </label>
            <label className={styles.editField}><span>Altitude (m)</span>
              <input type="number" value={form.altitude} onChange={e => setForm({ ...form, altitude: e.target.value })} placeholder="ex. 2185" />
            </label>
          </div>
          <label className={styles.editField}><span>Description</span>
            <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="État, accès, équipement, remarques…" />
          </label>
          <div className={styles.editActions}>
            <button className={styles.editCancel} onClick={() => setEditing(false)}>Annuler</button>
            <button className={styles.editSave} onClick={saveInfo} disabled={savingInfo}>{savingInfo ? "…" : "Enregistrer"}</button>
          </div>
        </div>
      )}

      {/* Weather */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Météo · {refuge.alt ? `${refuge.alt} m` : "au refuge"}</div>
        {wLoading ? (
          <div className={styles.wLoading}><span className={styles.spin} /> Chargement de la météo…</div>
        ) : wError || !weather?.current ? (
          <div className={styles.muted}>Météo indisponible pour ce point.</div>
        ) : (
          <>
            <div className={styles.wNow}>
              <span className={styles.wIcon}>{wmo(weather.current.weather_code)[0]}</span>
              <div className={styles.wNowText}>
                <span className={styles.wTemp}>{Math.round(weather.current.temperature_2m)}°</span>
                <span className={styles.wDesc}>{wmo(weather.current.weather_code)[1]}</span>
              </div>
              <span className={styles.wWind}>💨 {Math.round(weather.current.wind_speed_10m)} km/h</span>
            </div>
            <div className={styles.wDays}>
              {weather.daily?.time?.slice(0, 5).map((t: string, i: number) => {
                const d = new Date(t);
                return (
                  <div key={t} className={styles.wDay}>
                    <span className={styles.wDayName}>{i === 0 ? "Auj." : JOURS[d.getDay()]}</span>
                    <span className={styles.wDayIcon}>{wmo(weather.daily.weather_code[i])[0]}</span>
                    <span className={styles.wDayTemp}>{Math.round(weather.daily.temperature_2m_max[i])}°<span className={styles.wDayMin}>{Math.round(weather.daily.temperature_2m_min[i])}°</span></span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Water points nearby */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Points d'eau à proximité</div>
        {waterLoading ? (
          <div className={styles.wLoading}><span className={styles.spin} /> Recherche…</div>
        ) : !water || water.length === 0 ? (
          <div className={styles.muted}>Aucun point d'eau référencé dans un rayon de 1 km (OpenStreetMap).</div>
        ) : (
          <div className={styles.waterList}>
            {water.map((w: any, i: number) => (
              <div key={i} className={styles.waterItem}>
                <span className={styles.waterIcon} style={{ filter: w.potable ? "none" : "grayscale(0.15)" }}>💧</span>
                <span className={styles.waterType}>
                  {w.name || w.type}
                  {w.name && <span className={styles.waterSub}> · {w.type}</span>}
                  {w.potable && <span className={styles.waterPotable}> · potable</span>}
                </span>
                <span className={styles.waterDist}>{w.dist < 1000 ? `${w.dist} m` : `${(w.dist / 1000).toFixed(1)} km`}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Description */}
      {mDesc && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>À propos</div>
          <p className={styles.desc}>{mDesc}</p>
        </div>
      )}

      {/* Comments & photos (shared component) */}
      <div className={styles.section}>
        <CommentsSection targetType="refuge" targetId={refuge.id} placeholder="Votre passage, l'état du refuge, un conseil…" />
      </div>

      <a className={styles.apiBtn} href={refuge.lien || "https://refuges-pyrenees.vercel.app"} target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Plus d'infos ou modifier ce lieu
      </a>

      <div className={styles.warn}>
        ⚠️ Données collectées automatiquement, non vérifiées sur le terrain. À confirmer avant de partir.
      </div>
    </div>
  );
}
