"use client";
export const dynamic = "force-dynamic";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import RefugeDetail from "@/components/RefugeDetail";
import styles from "./refuge-page.module.css";

export default function RefugePage() {
  const params = useParams();
  const router = useRouter();
  const id = decodeURIComponent(String(params.id || ""));
  const [refuge, setRefuge] = useState<any>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/refuges/one?id=${encodeURIComponent(id)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { setRefuge(d.refuge); setState("ok"); })
      .catch(() => setState("error"));
  }, [id]);

  if (state === "loading") return <div className={styles.state}>Chargement du refuge…</div>;
  if (state === "error" || !refuge) return (
    <div className={styles.state}>
      Ce refuge est introuvable.
      <button className={styles.back} onClick={() => router.push("/refuges")}>← Retour à la carte</button>
    </div>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <RefugeDetail
          refuge={refuge}
          onBack={() => router.push("/refuges")}
          moreHref={refuge.lien || undefined}
          moreLabel="Voir la source externe"
        />
      </div>
    </div>
  );
}
