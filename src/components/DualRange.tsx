"use client";
import styles from "./DualRange.module.css";

interface Props {
  min: number; max: number; step?: number;
  low: number; high: number;
  onChange: (low: number, high: number) => void;
  unit?: string; label: string;
}

// Two-thumb range slider — lets the user pick a min–max band.
export default function DualRange({ min, max, step = 1, low, high, onChange, unit = "", label }: Props) {
  const span = Math.max(1, max - min);
  const pct = (v: number) => ((v - min) / span) * 100;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.vals}>{Math.round(low)} – {Math.round(high)} {unit}</span>
      </div>
      <div className={styles.track}>
        <div className={styles.rail} />
        <div className={styles.fill} style={{ left: `${pct(low)}%`, right: `${100 - pct(high)}%` }} />
        <input type="range" min={min} max={max} step={step} value={low}
          className={styles.range}
          onChange={e => onChange(Math.min(Number(e.target.value), high), high)} />
        <input type="range" min={min} max={max} step={step} value={high}
          className={`${styles.range} ${styles.rangeHigh}`}
          onChange={e => onChange(low, Math.max(Number(e.target.value), low))} />
      </div>
    </div>
  );
}
