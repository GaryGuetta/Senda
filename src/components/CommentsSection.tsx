"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import styles from "./CommentsSection.module.css";

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1200;
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
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return ""; }
}

export default function CommentsSection({ targetType, targetId, placeholder }: {
  targetType: "trail" | "refuge"; targetId: string; placeholder?: string;
}) {
  const { user, requireLogin } = useAuth();
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [photos, setPhotos] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    setComments([]); setText(""); setPhotos([]); setDate(today);
    fetch(`/api/comments?type=${targetType}&id=${encodeURIComponent(targetId)}`)
      .then(r => r.json()).then(d => setComments(d.comments || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType, targetId]);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const arr = Array.from(files).slice(0, 4 - photos.length);
    try { const enc = await Promise.all(arr.map(compressImage)); setPhotos(p => [...p, ...enc].slice(0, 4)); } catch {}
  }
  async function post() {
    if (!text.trim() && photos.length === 0) return;
    setPosting(true);
    try {
      const r = await fetch("/api/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, text, visitDate: date, photos }),
      });
      const d = await r.json();
      if (r.ok) { setComments(c => [d.comment, ...c]); setText(""); setPhotos([]); }
      else if (r.status === 401) requireLogin();
    } finally { setPosting(false); }
  }
  async function del(id: string) {
    const r = await fetch(`/api/comments?id=${id}`, { method: "DELETE" });
    if (r.ok) setComments(c => c.filter(x => x.id !== id));
  }

  return (
    <div className={styles.wrap}>
      <h2 className={styles.title}>Commentaires {comments.length > 0 && <span className={styles.count}>({comments.length})</span>}</h2>

      {user ? (
        <div className={styles.form}>
          <div className={styles.dateRow}>
            <label className={styles.dateLbl}>Date de sortie</label>
            <input type="date" className={styles.dateInput} value={date} max={today} onChange={e => setDate(e.target.value)} />
          </div>
          <textarea className={styles.input} rows={2} value={text} onChange={e => setText(e.target.value)}
            placeholder={placeholder || "Partagez votre sortie, un conseil, l'état du terrain…"} />
          {photos.length > 0 && (
            <div className={styles.thumbs}>
              {photos.map((p, i) => (
                <div key={i} className={styles.thumb} style={{ backgroundImage: `url(${p})` }}>
                  <button onClick={() => setPhotos(photos.filter((_, j) => j !== i))} aria-label="Retirer">×</button>
                </div>
              ))}
            </div>
          )}
          <div className={styles.actions}>
            <label className={styles.photoBtn}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Photo{photos.length ? ` (${photos.length}/4)` : ""}
              <input type="file" accept="image/*" multiple hidden disabled={photos.length >= 4} onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
            <button className={styles.postBtn} onClick={post} disabled={posting || (!text.trim() && photos.length === 0)}>{posting ? "…" : "Publier"}</button>
          </div>
        </div>
      ) : (
        <button className={styles.login} onClick={requireLogin}>Connectez-vous pour laisser un commentaire</button>
      )}

      <div className={styles.list}>
        {comments.length === 0 ? (
          <div className={styles.empty}>Aucun commentaire pour l'instant. Partagez votre sortie&nbsp;!</div>
        ) : comments.map((c: any) => (
          <div key={c.id} className={styles.comment}>
            <div className={styles.head}>
              <span className={styles.author}>{c.username}</span>
              <span className={styles.date}>{c.visitDate ? `sortie du ${fmtDate(c.visitDate)}` : fmtDate(c.createdAt)}</span>
              {user && c.userId === user.id && <button className={styles.del} onClick={() => del(c.id)} aria-label="Supprimer">×</button>}
            </div>
            {c.text && <p className={styles.text}>{c.text}</p>}
            {Array.isArray(c.photos) && c.photos.length > 0 && (
              <div className={styles.photos}>
                {c.photos.map((p: string, i: number) => (
                  <button key={i} className={styles.photo} style={{ backgroundImage: `url(${p})` }} onClick={() => setLightbox(p)} aria-label="Agrandir" />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className={styles.lightboxImg} />
          <button className={styles.lightboxClose} onClick={() => setLightbox(null)} aria-label="Fermer">×</button>
        </div>
      )}
    </div>
  );
}
