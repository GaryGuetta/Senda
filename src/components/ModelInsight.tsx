"use client";
import { useEffect, useState } from "react";
import styles from "./ModelInsight.module.css";

interface FeatureImportance { feature: string; weight: number }
interface ModelData {
  trained: boolean;
  trainedOn?: number;
  meanError?: number;
  featureImportance?: FeatureImportance[];
  samplesHave?: number;
  samplesNeeded?: number;
}

const FEATURE_LABELS: Record<string, string> = {
  effortIndex: "Effort (D+ & distance)",
  slopeMax: "Pente maximale",
  slopeAvg: "Pente moyenne",
  pctSteep: "Proportion raide",
  surfaceScore: "Type de terrain",
  maxAlt: "Altitude maximale",
  pctHighAlt: "Temps en altitude",
  sacScore: "Difficulté SAC",
  poiDanger: "Dangers (éboulis…)",
  distKm: "Distance",
};

export default function ModelInsight({ refreshKey = 0 }: { refreshKey?: number }) {
  const [model, setModel] = useState<ModelData | null>(null);
  const [calib, setCalib] = useState<any>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // POST forces a fresh retrain (bypasses the 60s cache) so the bar updates
    // immediately after a new rating is saved.
    fetch("/api/model", { method: refreshKey > 0 ? "POST" : "GET" }).then(r => r.json()).then(setModel).catch(() => {});
    fetch("/api/calibration").then(r => r.json()).then(setCalib).catch(() => {});
  }, [refreshKey]);

  if (!model) return null;
  if ((model as any).reason === "not_logged_in") return null;

  if (!model.trained) {
    const have = model.samplesHave ?? 0;
    const need = model.samplesNeeded ?? 5;
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.iconML}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
              <path d="M12 7v4M10.5 13l-3.5 4M13.5 13l3.5 4" strokeLinecap="round"/>
            </svg>
          </div>
          <span className={styles.title}>Ton modèle personnel</span>
        </div>
        <div className={styles.notReady}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${Math.min(100, have/need*100)}%` }} />
          </div>
          <span className={styles.notReadyText}>
            {have} / {need} sentiers notés pour activer l'apprentissage
          </span>
        </div>
      </div>
    );
  }

  const maxWeight = Math.max(...(model.featureImportance?.map(f => Math.abs(f.weight)) ?? [1]));

  return (
    <div className={styles.card}>
      <button className={styles.header} onClick={() => setOpen(!open)}>
        <div className={styles.iconML}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
            <path d="M12 7v4M10.5 13l-3.5 4M13.5 13l3.5 4" strokeLinecap="round"/>
          </svg>
        </div>
        <span className={styles.title}>Ton modèle personnel</span>
        <span className={styles.chevron}>{open ? "▲" : "▼"}</span>
      </button>

      <div className={styles.summary}>
        <span>Entraîné sur {model.trainedOn} sentiers</span>
        <span className={styles.error}>±{model.meanError} précision</span>
      </div>

      {open && model.featureImportance && (
        <div className={styles.weights}>
          <div className={styles.weightsTitle}>Ce que le modèle a appris</div>
          <div className={styles.weightsGrid}>
            {model.featureImportance.slice(0, 8).map(f => (
              <div key={f.feature} className={styles.weightRow}>
                <span className={styles.weightLabel}>{FEATURE_LABELS[f.feature] ?? f.feature}</span>
                <div className={styles.weightBarTrack}>
                  <div className={styles.weightBarFill}
                    style={{ width: `${Math.abs(f.weight)/maxWeight*100}%`,
                      background: f.weight >= 0 ? "var(--sage)" : "var(--stone-light)" }} />
                </div>
              </div>
            ))}
          </div>
          <div className={styles.weightsNote}>
            Plus la barre est longue, plus ce facteur pèse dans la difficulté que TU ressens.
          </div>

          {calib?.calibrated && (
            <div className={styles.calibBlock}>
              <div className={styles.calibTitle}>Auto-calibration</div>
              <div className={styles.calibRow}>
                <span>Corrélation calcul / réel</span>
                <span className={styles.calibVal}>{Math.round(calib.correlation * 100)}%</span>
              </div>
              <div className={styles.calibRow}>
                <span>Écart moyen</span>
                <span className={styles.calibVal}>±{calib.meanAbsError}</span>
              </div>
              {calib.bias !== "neutral" && (
                <div className={styles.calibBias}>
                  {calib.bias === "underrates"
                    ? `La formule sous-estimait de ${Math.abs(calib.meanOffset)} pts — corrigé automatiquement`
                    : `La formule surestimait de ${Math.abs(calib.meanOffset)} pts — corrigé automatiquement`}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
