"use client";
import { useEffect, useMemo, useState } from "react";
import TrailCard from "@/components/TrailCard";
import DualRange from "@/components/DualRange";
import { Trail } from "@/types";
import { trailDisplayScore } from "@/lib/difficulty";
import styles from "./explorer.module.css";

type SortKey = "recent" | "easy" | "hard" | "long" | "short";
type DiffFilter = "all" | "facile" | "modere" | "difficile";

export default function ExplorerPage() {
  const [trails, setTrails] = useState<Trail[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [diff, setDiff] = useState<DiffFilter>("all");
  const [distRange, setDistRange] = useState<[number, number]>([0, 100]);
  const [dplusRange, setDplusRange] = useState<[number, number]>([0, 3000]);

  useEffect(() => {
    fetch("/api/trails/public").then(r => r.json()).then(d => {
      setTrails(Array.isArray(d) ? d : []); setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Slider bounds from the loaded set
  const bounds = useMemo(() => {
    let maxDist = 10, maxDplus = 500;
    for (const t of trails) {
      if (t.distance > maxDist) maxDist = t.distance;
      if (t.elevation > maxDplus) maxDplus = t.elevation;
    }
    return { maxDist: Math.ceil(maxDist / 5) * 5, maxDplus: Math.ceil(maxDplus / 100) * 100 };
  }, [trails]);

  useEffect(() => {
    setDistRange([0, bounds.maxDist]);
    setDplusRange([0, bounds.maxDplus]);
  }, [bounds.maxDist, bounds.maxDplus]);

  const rangesActive = distRange[0] > 0 || distRange[1] < bounds.maxDist || dplusRange[0] > 0 || dplusRange[1] < bounds.maxDplus;

  const filtered = useMemo(() => {
    let list = [...trails];
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(t => t.name.toLowerCase().includes(q) || (t.author ?? "").toLowerCase().includes(q));
    }
    if (diff !== "all") {
      list = list.filter(t => {
        const s = trailDisplayScore(t) ?? 5;
        if (diff === "facile") return s <= 4;
        if (diff === "modere") return s > 4 && s <= 6;
        return s > 6;
      });
    }
    list = list.filter(t => t.distance >= distRange[0] && t.distance <= distRange[1]);
    list = list.filter(t => t.elevation >= dplusRange[0] && t.elevation <= dplusRange[1]);
    list.sort((a, b) => {
      const sa = trailDisplayScore(a) ?? 5, sb = trailDisplayScore(b) ?? 5;
      switch (sort) {
        case "easy": return sa - sb;
        case "hard": return sb - sa;
        case "long": return b.distance - a.distance;
        case "short": return a.distance - b.distance;
        default: return 0; // recent = API order
      }
    });
    return list;
  }, [trails, query, sort, diff, distRange, dplusRange]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headText}>
          <h1 className={styles.title}>Explorer les sentiers</h1>
          <p className={styles.subtitle}>La banque partagée par la communauté. Chaque fiche montre une difficulté générale — connectez-vous pour la voir adaptée à vous.</p>
        </div>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.search}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--stone)" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4" strokeLinecap="round"/></svg>
          <input type="text" placeholder="Rechercher un sentier ou un auteur…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className={styles.filters}>
          <div className={styles.chipGroup}>
            {([["all","Tous"],["facile","Facile"],["modere","Modéré"],["difficile","Difficile"]] as [DiffFilter,string][]).map(([k, l]) => (
              <button key={k} className={`${styles.chip} ${diff === k ? styles.chipActive : ""}`} onClick={() => setDiff(k)}>{l}</button>
            ))}
          </div>
          <select className={styles.select} value={sort} onChange={e => setSort(e.target.value as SortKey)}>
            <option value="recent">Plus récents</option>
            <option value="hard">Plus difficiles</option>
            <option value="easy">Plus faciles</option>
            <option value="long">Plus longs</option>
            <option value="short">Plus courts</option>
          </select>
        </div>
        <div className={styles.ranges}>
          <DualRange label="Distance" unit="km" min={0} max={bounds.maxDist} step={1}
            low={distRange[0]} high={distRange[1]} onChange={(l, h) => setDistRange([l, h])} />
          <DualRange label="Dénivelé +" unit="m" min={0} max={bounds.maxDplus} step={50}
            low={dplusRange[0]} high={dplusRange[1]} onChange={(l, h) => setDplusRange([l, h])} />
          {rangesActive && (
            <button className={styles.resetRanges} onClick={() => { setDistRange([0, bounds.maxDist]); setDplusRange([0, bounds.maxDplus]); }}>
              Réinitialiser distance & D+
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className={styles.state}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className={styles.state}>
          {trails.length === 0
            ? "La banque est encore vide. Les premières traces publiées apparaîtront ici."
            : "Aucun sentier ne correspond à votre recherche."}
        </div>
      ) : (
        <>
          <div className={styles.count}>{filtered.length} sentier{filtered.length > 1 ? "s" : ""}</div>
          <div className={`${styles.grid} stagger`}>
            {filtered.map(t => <TrailCard key={t.id} trail={t} />)}
          </div>
        </>
      )}
    </div>
  );
}
