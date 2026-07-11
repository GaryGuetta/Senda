"use client";
import { useState, useRef } from "react";
import { difficultyColor, scoreLabel } from "@/lib/difficulty";
import styles from "./GpxImport.module.css";

interface ImportResult {
  id: string;
  name: string;
  stats: { distKm: number; elevGain: number; elevLoss: number; slopeMax: number; maxAlt: number; globalScore: number };
  reasons: { icon: string; label: string; detail: string; severity: "low"|"medium"|"high" }[];
  overlapCorrectedTrails: number;
  overlapCorrectedSegments: number;
}

const SEV: Record<string, {bg:string;border:string;color:string}> = {
  high:   { bg:"var(--sev-high-bg)", border:"var(--sev-high-border)", color:"var(--sev-high-text)" },
  medium: { bg:"var(--sev-med-bg)",  border:"var(--sev-med-border)",  color:"var(--sev-med-text)" },
  low:    { bg:"var(--sev-low-bg)",  border:"var(--sev-low-border)",  color:"var(--sev-low-text)" },
};

const STEPS = ["Lecture du tracé GPX", "Altitudes NASA SRTM 30m", "Surface et terrain OSM", "Analyse des dangers", "Comparaison avec la base"];

// 4-level difficulty → number (matches the app's 1-10 scale)
const DIFF_LEVELS = [
  { key: "facile",    label: "Facile",        value: 2, color: "rgb(0,180,40)" },
  { key: "moyenne",   label: "Moyenne",       value: 5, color: "rgb(210,170,0)" },
  { key: "difficile", label: "Difficile",     value: 7, color: "rgb(230,120,0)" },
  { key: "tres",      label: "Très difficile", value: 9, color: "rgb(220,30,20)" },
] as const;

// Compress an image file to a base64 data URL (max 1400px, JPEG 0.72)
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1400;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function GpxImport({ onClose, onImported }: { onClose:()=>void; onImported:(id?:string)=>void }) {
  const [file, setFile] = useState<File|null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState<number|null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);

  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string|null>(null);
  const [result, setResult] = useState<ImportResult|null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File|null) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".gpx")) { setError("Le fichier doit être au format .gpx"); return; }
    setFile(f); setError(null);
    if (!name) setName(f.name.replace(/\.gpx$/i, "").replace(/[-_]/g, " "));
  }

  async function addPhotos(files: FileList|null) {
    if (!files || files.length === 0) return;
    setPhotoBusy(true);
    try {
      const remaining = 8 - photos.length;
      const toAdd = Array.from(files).slice(0, remaining);
      const encoded = await Promise.all(toAdd.map(compressImage));
      setPhotos(p => [...p, ...encoded].slice(0, 8));
    } catch { setError("Impossible de charger une des photos"); }
    finally { setPhotoBusy(false); }
  }

  function validate(): string | null {
    if (!file) return "Ajoutez un fichier GPX.";
    if (isPublic && description.trim().length < 10) return "Une description (10 caractères min.) est requise pour publier.";
    return null;
  }

  async function handleImport() {
    const v = validate();
    if (v) { setError(v); return; }
    setLoading(true); setError(null); setStepIdx(0);
    const iv = setInterval(() => setStepIdx(i => Math.min(i+1, STEPS.length-1)), 3600);
    try {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("name", name.trim());
      fd.append("description", description.trim());
      fd.append("isPublic", String(isPublic));
      if (difficulty != null) fd.append("difficulty", String(difficulty));
      if (photos.length) fd.append("photos", JSON.stringify(photos));
      const res = await fetch("/api/gpx", { method:"POST", body:fd });
      const data = await res.json();
      clearInterval(iv);
      if (!res.ok) throw new Error(data.error || "Erreur lors de l'analyse");
      setResult({
        id: data.trail.id, name: data.trail.name, stats: data.stats,
        reasons: data.reasons ?? [],
        overlapCorrectedTrails: data.overlapCorrectedTrails ?? 0,
        overlapCorrectedSegments: data.overlapCorrectedSegments ?? 0,
      });
    } catch(e:any) { clearInterval(iv); setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className={styles.overlay} onClick={e => e.target===e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <button className={styles.close} onClick={onClose} aria-label="Fermer">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
        </button>

        {!result ? (
          <div className={styles.form}>
            <h2 className={styles.title}>Ajouter un sentier</h2>
            <p className={styles.subtitle}>Le tracé est analysé automatiquement — altitude, pente, terrain. Ajoutez vos informations ci-dessous.</p>

            {/* GPX drop */}
            <label className={styles.fieldLabel}>Fichier GPX <span className={styles.req}>obligatoire</span></label>
            <div className={`${styles.drop} ${file ? styles.dropActive : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); pickFile(e.dataTransfer.files[0]); }}>
              <input ref={inputRef} type="file" accept=".gpx" hidden onChange={e => pickFile(e.target.files?.[0]??null)} />
              {file ? (
                <div className={styles.fileChosen}>
                  <div className={styles.fileCheck}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                  <div><div className={styles.fileName}>{file.name}</div><div className={styles.fileSize}>{(file.size/1024).toFixed(0)} Ko · prêt</div></div>
                </div>
              ) : (
                <><div className={styles.dropIcon}><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 16V4m0 0L8 8m4-4l4 4" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round"/></svg></div>
                <div className={styles.dropTitle}>Glissez votre GPX ici</div>
                <div className={styles.dropHint}>ou cliquez · Komoot, AllTrails, Garmin, Wikiloc</div></>
              )}
            </div>

            {/* Name */}
            <label className={styles.fieldLabel}>Nom du sentier</label>
            <input className={styles.input} value={name} onChange={e => setName(e.target.value)}
              placeholder="ex. Boucle du lac par la crête" />

            {/* Difficulty */}
            <label className={styles.fieldLabel}>Difficulté ressentie</label>
            <div className={styles.diffRow}>
              {DIFF_LEVELS.map(d => (
                <button key={d.key} type="button"
                  className={`${styles.diffBtn} ${difficulty === d.value ? styles.diffActive : ""}`}
                  style={difficulty === d.value ? { background: d.color, borderColor: d.color, color: "#fff" } : { borderColor: "var(--line-2)" }}
                  onClick={() => setDifficulty(difficulty === d.value ? null : d.value)}>
                  {d.label}
                </button>
              ))}
            </div>

            {/* Description */}
            <label className={styles.fieldLabel}>
              Description {isPublic ? <span className={styles.req}>obligatoire</span> : <span className={styles.opt}>optionnel</span>}
            </label>
            <textarea className={styles.textarea} rows={3} value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Décrivez l'itinéraire : points d'intérêt, passages délicats, accès, période idéale…" />

            {/* Photos */}
            <label className={styles.fieldLabel}>Photos <span className={styles.opt}>jusqu'à 8</span></label>
            <div className={styles.photoGrid}>
              {photos.map((p, i) => (
                <div key={i} className={styles.photoThumb} style={{ backgroundImage:`url(${p})` }}>
                  <button className={styles.photoRemove} onClick={() => setPhotos(ph => ph.filter((_,j)=>j!==i))} aria-label="Retirer">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
                  </button>
                </div>
              ))}
              {photos.length < 8 && (
                <button className={styles.photoAdd} onClick={() => photoRef.current?.click()} disabled={photoBusy}>
                  {photoBusy ? <span className={styles.photoSpin} /> : (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
                  )}
                </button>
              )}
              <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={e => { addPhotos(e.target.files); e.target.value=""; }} />
            </div>

            {/* Public toggle */}
            <div className={styles.publicRow}>
              <div>
                <div className={styles.publicLabel}>Publier dans la banque</div>
                <div className={styles.publicHint}>{isPublic ? "Visible par tous · description requise" : "Trace privée, visible par vous seul"}</div>
              </div>
              <button type="button" className={`${styles.toggle} ${isPublic ? styles.toggleOn : ""}`} onClick={() => setIsPublic(v => !v)} aria-label="Public/privé">
                <span className={styles.knob} />
              </button>
            </div>

            {loading && (
              <div className={styles.steps}>
                {STEPS.map((s, i) => (
                  <div key={i} className={`${styles.step} ${i < stepIdx ? styles.stepDone : i === stepIdx ? styles.stepActive : ""}`}>
                    <div className={styles.stepDot}>
                      {i < stepIdx ? <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        : i === stepIdx ? <div className={styles.stepPulse} /> : <div className={styles.stepEmpty} />}
                    </div>
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            )}

            {error && <div className={styles.error}>{error}</div>}

            {!loading && (
              <div className={styles.actions}>
                <button className={styles.cancel} onClick={onClose}>Annuler</button>
                <button className={styles.submit} onClick={handleImport} disabled={!file}>Analyser et enregistrer</button>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.result}>
            <div className={styles.resultRing}>
              <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" strokeWidth="7" />
                <circle cx="50" cy="50" r="40" fill="none" stroke={difficultyColor(result.stats.globalScore)} strokeWidth="7"
                  strokeLinecap="round" strokeDasharray={2*Math.PI*40}
                  strokeDashoffset={2*Math.PI*40 - (result.stats.globalScore/10)*2*Math.PI*40}
                  transform="rotate(-90 50 50)" style={{ transition:"stroke-dashoffset 0.8s ease" }} />
                <text x="50" y="47" textAnchor="middle" dominantBaseline="central" style={{ fontFamily:"Fraunces,serif", fontSize:"30px", fontWeight:600, fill:difficultyColor(result.stats.globalScore) }}>{result.stats.globalScore}</text>
                <text x="50" y="66" textAnchor="middle" dominantBaseline="central" style={{ fontFamily:"Inter,sans-serif", fontSize:"10px", fill:"var(--stone)" }}>/ 10</text>
              </svg>
            </div>
            <div className={styles.resultName}>{result.name}</div>
            <div className={styles.resultLabel} style={{ color: difficultyColor(result.stats.globalScore) }}>{scoreLabel(result.stats.globalScore)}</div>
            <div className={styles.resultStats}>
              <div><span className={styles.rsVal}>{result.stats.distKm}</span><span className={styles.rsUnit}>km</span></div>
              <div><span className={styles.rsVal}>+{result.stats.elevGain}</span><span className={styles.rsUnit}>m</span></div>
              <div><span className={styles.rsVal}>{result.stats.slopeMax}%</span><span className={styles.rsUnit}>pente</span></div>
              <div><span className={styles.rsVal}>{result.stats.maxAlt}</span><span className={styles.rsUnit}>m alt</span></div>
            </div>
            {result.reasons.length > 0 && (
              <div className={styles.resultSection}>
                {result.reasons.slice(0, 4).map((r, i) => {
                  const s = SEV[r.severity];
                  return (
                    <div key={i} className={styles.reasonRow} style={{ background:s.bg, borderColor:s.border }}>
                      <span className={styles.reasonIcon}>{r.icon}</span>
                      <div><div className={styles.reasonLabel} style={{ color:s.color }}>{r.label}</div><div className={styles.reasonDetail}>{r.detail}</div></div>
                    </div>
                  );
                })}
              </div>
            )}
            {result.overlapCorrectedTrails > 0 && (
              <div className={styles.overlapBanner}>
                <div className={styles.overlapIcon}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v4M16 3v4M4 11h16M7 15l2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                <div><div className={styles.overlapTitle}>Apprentissage croisé</div>
                <div className={styles.overlapText}>Partage des tronçons avec {result.overlapCorrectedTrails} sentier{result.overlapCorrectedTrails > 1 ? "s" : ""}. {result.overlapCorrectedSegments} segment{result.overlapCorrectedSegments > 1 ? "s affinés" : " affiné"}.</div></div>
              </div>
            )}
            <button className={styles.viewBtn} onClick={() => onImported(result.id)}>Voir la fiche du sentier</button>
          </div>
        )}
      </div>
    </div>
  );
}
