"use client";
import { useRouter } from "next/navigation";
import { Trail, SurfaceBreakdown } from "@/types";
import { difficultyColor, scoreLabel, trailDisplayScore, FAMILY_COLORS, estimatedWalkTime } from "@/lib/difficulty";
import ElevationProfile from "./ElevationProfile";
import styles from "./TrailCard.module.css";

export default function TrailCard({ trail }: { trail: Trail }) {
  const router = useRouter();
  const score = trailDisplayScore(trail);
  const color = score != null ? difficultyColor(score) : "#A8A597";
  const props = (trail.geojson as any)?.properties ?? {};
  const breakdown: SurfaceBreakdown | null = props.surfaceBreakdown ?? null;

  return (
    <button className={styles.card} onClick={() => router.push(`/sentier/${trail.id}`)}>
      {/* Score chip */}
      <div className={styles.top}>
        <div className={styles.scoreChip} style={{ background: color }}>
          <span className={styles.scoreNum}>{score ?? "?"}</span>
        </div>
        <div className={styles.topText}>
          <div className={styles.name}>{trail.name}</div>
          <div className={styles.label} style={{ color }}>{score != null ? scoreLabel(score) : "Non calculé"}</div>
        </div>
      </div>

      {/* Stats */}
      <div className={styles.stats}>
        <div className={styles.stat}><span className={`${styles.statVal} mono`}>{trail.distance}</span><span className={styles.statUnit}>km</span></div>
        <div className={styles.stat}><span className={`${styles.statVal} mono`}>+{trail.elevation}</span><span className={styles.statUnit}>m D+</span></div>
        <div className={styles.stat}><span className={`${styles.statVal} mono`}>{estimatedWalkTime(trail.distance, trail.elevation)}</span><span className={styles.statUnit}>durée</span></div>
      </div>

      {/* Signature: elevation profile colored by local difficulty */}
      <div className={styles.profile}>
        <ElevationProfile geojson={trail.geojson} width={300} height={54} compact />
      </div>

      {/* Terrain breakdown strip */}
      {breakdown && (breakdown.route + breakdown.sentier + breakdown.rocheux + breakdown.montagne) > 0 && (
        <div className={styles.terrainBar}>
          {(["route","sentier","rocheux","montagne"] as const).map(k =>
            breakdown[k] > 0 ? <div key={k} style={{ width: `${breakdown[k]}%`, background: FAMILY_COLORS[k] }} title={`${k} ${breakdown[k]}%`} /> : null
          )}
        </div>
      )}

      {/* Footer */}
      <div className={styles.footer}>
        {trail.author && <span className={styles.author}>{trail.author}</span>}
        <span className={styles.footerRight}>
          {((trail as any).completionCount ?? 0) > 0 && (
            <span className={styles.doneCount}>✓ {(trail as any).completionCount}</span>
          )}
          {trail.score?.count ? <span className={styles.reviews}>{trail.score.count} avis</span> : <span className={styles.reviews}>Calcul auto</span>}
        </span>
      </div>
    </button>
  );
}
