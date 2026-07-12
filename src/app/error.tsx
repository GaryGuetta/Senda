"use client";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "40px 24px", gap: 16 }}>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, color: "var(--ink, #21402E)" }}>Oups, un souci est survenu</div>
      <p style={{ fontSize: 15, color: "var(--stone, #6b7280)", maxWidth: 440, lineHeight: 1.6 }}>
        Une erreur inattendue s'est produite sur cette page. Vous pouvez réessayer — vos données sont en sécurité.
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={reset} style={{ background: "#21402E", color: "#fff", padding: "10px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" }}>Réessayer</button>
        <a href="/" style={{ background: "transparent", color: "#21402E", padding: "10px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: "none", border: "1px solid #d6d3c7" }}>Accueil</a>
      </div>
    </div>
  );
}
