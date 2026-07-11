"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import TrailCard from "@/components/TrailCard";
import ElevationProfile from "@/components/ElevationProfile";
import HeroProfile from "@/components/HeroProfile";
import { Trail } from "@/types";
import styles from "./home.module.css";

export default function Home() {
  const router = useRouter();
  const { user, requireLogin } = useAuth();
  const [featured, setFeatured] = useState<Trail[]>([]);
  const [refugeCount, setRefugeCount] = useState<number | null>(null);
  const hasFeatured = featured[0] && (featured[0].geojson as any)?.properties?.elevations?.length > 1;

  useEffect(() => {
    fetch("/api/trails/public").then(r => r.json()).then(d => {
      if (Array.isArray(d)) setFeatured(d.slice(0, 6));
    }).catch(() => {});
    fetch("/api/refuges").then(r => r.json()).then(d => {
      if (Array.isArray(d)) setRefugeCount(d.length);
    }).catch(() => {});
  }, []);

  return (
    <div className={styles.page}>
      {/* ───── Hero ───── */}
      <section className={styles.hero}>
        <svg className={styles.contours} viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden>
          {[...Array(9)].map((_, i) => (
            <path key={i}
              d={`M-50 ${120 + i * 55} C 200 ${80 + i * 55}, 400 ${180 + i * 55}, 620 ${120 + i * 55} S 1000 ${60 + i * 55}, 1250 ${140 + i * 55}`}
              fill="none" stroke="var(--sage)" strokeWidth="1" opacity={0.14 - i * 0.008} />
          ))}
        </svg>

        <div className={styles.heroInner}>
          <div className={styles.heroText}>
            <div className={styles.eyebrow}>Randonnée &amp; refuges · Pyrénées</div>
            <h1 className={styles.title}>
              Explorez, notez, planifiez.<br />
              <span className={styles.titleAccent}>Toute votre montagne, dans Senda.</span>
            </h1>
            <p className={styles.lede}>
              Senda calcule la difficulté réelle de chaque sentier et l'adapte à votre ressenti,
              cartographie les refuges et cabanes des Pyrénées, et planifie vos randos sur plusieurs
              jours — étapes, couchage et points d'eau compris.
            </p>
            <div className={styles.heroActions}>
              <button className={styles.primaryBtn} onClick={() => router.push("/explorer")}>Explorer les sentiers</button>
              <button className={styles.ghostBtn} onClick={() => router.push("/refuges")}>Planifier une rando</button>
            </div>
          </div>

          <div className={styles.heroProfile}>
            <div className={styles.heroProfileCard}>
              <div className={styles.heroProfileHead}>
                <span className={styles.heroProfileName}>{hasFeatured ? featured[0].name : "Tracé d'exemple"}</span>
                <span className={styles.heroProfileMeta}>{hasFeatured ? `${featured[0].distance} km · +${featured[0].elevation} m` : "exemple de profil"}</span>
              </div>
              {hasFeatured
                ? <ElevationProfile geojson={featured[0].geojson} width={520} height={130} showAxis />
                : <HeroProfile />}
              <div className={styles.heroProfileFoot}>
                <span className={styles.heroDot} style={{ background: "rgb(0,180,40)" }} /> Facile
                <span className={styles.heroProfileFootSpacer} />
                <span className={styles.heroDot} style={{ background: "rgb(230,140,0)" }} /> Soutenu
                <span className={styles.heroProfileFootSpacer} />
                <span className={styles.heroDot} style={{ background: "rgb(230,30,20)" }} /> Difficile
                <span style={{ marginLeft: "auto" }}>couleur = difficulté du passage</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───── Stats band ───── */}
      <section className={styles.stats}>
        <div className={styles.statsInner}>
          <div className={styles.statCell}>
            <span className={styles.statNum}>{featured.length > 0 ? `${Math.max(featured.length, 6)}+` : "—"}</span>
            <span className={styles.statLbl}>sentiers analysés</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statCell}>
            <span className={styles.statNum}>{refugeCount != null ? refugeCount.toLocaleString("fr-FR") : "1 000+"}</span>
            <span className={styles.statLbl}>refuges &amp; cabanes</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statCell}>
            <span className={styles.statNum}>3</span>
            <span className={styles.statLbl}>régions des Pyrénées</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statCell}>
            <span className={styles.statNum}>100 %</span>
            <span className={styles.statLbl}>gratuit &amp; sans pub</span>
          </div>
        </div>
      </section>

      {/* ───── Feature 1 · Difficulté ───── */}
      <section className={styles.feature}>
        <div className={styles.featureText}>
          <div className={styles.featureTag} style={{ color: "var(--pine)" }}>Difficulté personnalisée</div>
          <h2 className={styles.featureTitle}>La difficulté d'un sentier dépend de qui le marche.</h2>
          <p className={styles.featureLede}>
            Senda analyse chaque trace segment par segment — pente, terrain, altitude, dénivelé — puis
            adapte la note à votre ressenti au fil de vos randos. Le même sentier, une difficulté juste pour vous.
          </p>
          <button className={styles.featureLink} onClick={() => router.push("/explorer")}>Voir les sentiers →</button>
        </div>
        <div className={styles.featureVisual}>
          <div className={styles.visualCard}>
            <HeroProfile />
            <div className={styles.visualCaption}>Profil coloré selon la difficulté réelle du passage</div>
          </div>
        </div>
      </section>

      {/* ───── Feature 2 · Refuges ───── */}
      <section className={`${styles.feature} ${styles.featureAlt}`}>
        <div className={styles.featureVisual}>
          <div className={styles.visualCard}>
            <svg viewBox="0 0 460 250" className={styles.mockSvg} aria-hidden>
              <rect width="460" height="250" rx="14" fill="var(--paper-2)" />
              {[...Array(6)].map((_, i) => <line key={i} x1="0" y1={40 + i * 38} x2="460" y2={40 + i * 38} stroke="var(--line)" strokeWidth="1" />)}
              {[...Array(9)].map((_, i) => <line key={i} x1={50 + i * 48} y1="0" x2={50 + i * 48} y2="250" stroke="var(--line)" strokeWidth="1" />)}
              {[["#1B9E4B", 110, 90], ["#1E7FE0", 230, 150], ["#F07316", 320, 80], ["#1B9E4B", 380, 180], ["#6B7280", 160, 190]].map(([c, x, y], i) => (
                <g key={i} transform={`translate(${x},${y})`}>
                  <path d="M0 0 C-9 -9 -9 -22 0 -30 C9 -22 9 -9 0 0 Z" fill={c as string} transform="translate(0,0) scale(1)" />
                  <circle cx="0" cy="-20" r="4.5" fill="#fff" />
                </g>
              ))}
              <g transform="translate(300,150)">
                <rect x="0" y="0" width="120" height="54" rx="10" fill="var(--paper)" stroke="var(--line-2)" />
                <text x="12" y="22" fontFamily="Inter, sans-serif" fontSize="12" fontWeight="600" fill="var(--ink)">Refuge du Rulhe</text>
                <text x="12" y="40" fontFamily="Inter, sans-serif" fontSize="11" fill="var(--stone)">2 185 m · ☀️ 12°</text>
              </g>
            </svg>
          </div>
        </div>
        <div className={styles.featureText}>
          <div className={styles.featureTag} style={{ color: "#1B9E4B" }}>Refuges &amp; cabanes</div>
          <h2 className={styles.featureTitle}>Tous les abris des Pyrénées, sur une carte.</h2>
          <p className={styles.featureLede}>
            Refuges gardés, cabanes ouvertes, abris et ruines — repérés par type et par couleur.
            Chaque fiche affiche l'altitude, la capacité, l'eau, et la <strong>météo en direct</strong> à
            l'altitude du refuge, plus les points d'eau à proximité.
          </p>
          <button className={styles.featureLink} onClick={() => router.push("/refuges")}>Parcourir les refuges →</button>
        </div>
      </section>

      {/* ───── Feature 3 · Planificateur ───── */}
      <section className={styles.feature}>
        <div className={styles.featureText}>
          <div className={styles.featureTag} style={{ color: "var(--terra)" }}>Planificateur d'itinéraire</div>
          <h2 className={styles.featureTitle}>Votre trek sur plusieurs jours, calculé pour vous.</h2>
          <p className={styles.featureLede}>
            Importez un GPX ou tracez votre parcours à la main. Senda le découpe en étapes équilibrées
            selon votre rythme, trouve <strong>où dormir</strong> chaque soir (refuge ou bivouac), et repère
            les <strong>points d'eau</strong> tout le long du chemin.
          </p>
          <button className={styles.featureLink} onClick={() => router.push("/refuges")}>Planifier une rando →</button>
        </div>
        <div className={styles.featureVisual}>
          <div className={styles.visualCard}>
            <svg viewBox="0 0 460 250" className={styles.mockSvg} aria-hidden>
              <rect width="460" height="250" rx="14" fill="var(--paper-2)" />
              {[...Array(6)].map((_, i) => <line key={i} x1="0" y1={40 + i * 38} x2="460" y2={40 + i * 38} stroke="var(--line)" strokeWidth="1" />)}
              {/* route */}
              <path d="M40 210 C120 190 100 120 180 120 C260 120 240 70 340 60 L420 40" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" opacity="0.7" />
              <path d="M40 210 C120 190 100 120 180 120 C260 120 240 70 340 60 L420 40" fill="none" stroke="#ff5d73" strokeWidth="4.5" strokeLinecap="round" />
              {/* day markers */}
              {[["1", 180, 120], ["2", 340, 60]].map(([n, x, y], i) => (
                <g key={i} transform={`translate(${x},${y})`}>
                  <circle r="15" fill="var(--pine)" stroke="#fff" strokeWidth="3" />
                  <text y="5" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="14" fontWeight="700" fill="#fff">{n}</text>
                </g>
              ))}
              {/* water drops */}
              {[[110, 165], [265, 92]].map(([x, y], i) => (
                <g key={i} transform={`translate(${x},${y})`}>
                  <path d="M0 -10 C6 -3 6 3 0 6 C-6 3 -6 -3 0 -10 Z" fill="#0ea5e9" stroke="#fff" strokeWidth="1.5" />
                </g>
              ))}
            </svg>
          </div>
        </div>
      </section>

      {/* ───── How it works ───── */}
      <section className={styles.how}>
        <h2 className={styles.howHeading}>Comment ça marche</h2>
        <div className={styles.howGrid}>
          <div className={styles.howItem}>
            <div className={styles.howNum}>1</div>
            <h3 className={styles.howTitle}>Importez ou tracez</h3>
            <p className={styles.howText}>Déposez un fichier GPX ou dessinez votre parcours sur la carte. L'altitude et le terrain sont récupérés automatiquement.</p>
          </div>
          <div className={styles.howItem}>
            <div className={styles.howNum}>2</div>
            <h3 className={styles.howTitle}>Senda analyse</h3>
            <p className={styles.howText}>Difficulté segment par segment, durée estimée, étapes journalières, refuges de couchage et points d'eau le long du chemin.</p>
          </div>
          <div className={styles.howItem}>
            <div className={styles.howNum}>3</div>
            <h3 className={styles.howTitle}>Partez sereinement</h3>
            <p className={styles.howText}>Téléchargez le GPX, suivez votre profil et vos étapes. Plus vous notez vos randos, plus la difficulté colle à votre ressenti.</p>
          </div>
        </div>
      </section>

      {/* ───── Featured trails ───── */}
      {featured.length > 0 && (
        <section className={styles.featured}>
          <div className={styles.featuredHead}>
            <h2 className={styles.featuredTitle}>Dans la banque publique</h2>
            <button className={styles.seeAll} onClick={() => router.push("/explorer")}>Tout voir →</button>
          </div>
          <div className={`${styles.grid} stagger`}>
            {featured.map(t => <TrailCard key={t.id} trail={t} />)}
          </div>
        </section>
      )}

      {/* ───── Final CTA ───── */}
      <section className={styles.cta}>
        <div className={styles.ctaCard}>
          <h2 className={styles.ctaTitle}>Prêt à préparer votre prochaine rando ?</h2>
          <p className={styles.ctaText}>Créez un compte gratuit pour enregistrer vos traces, votre modèle de difficulté et vos itinéraires.</p>
          <div className={styles.ctaActions}>
            {user
              ? <button className={styles.primaryBtn} onClick={() => router.push("/mes-traces")}>Mes traces</button>
              : <button className={styles.primaryBtn} onClick={() => requireLogin()}>Créer un compte gratuit</button>}
            <button className={styles.ghostBtn} onClick={() => router.push("/explorer")}>Explorer d'abord</button>
          </div>
        </div>
      </section>

      {/* ───── Footer ───── */}
      <footer className={styles.footer}>
        <div className={styles.footInner}>
          <div className={styles.footBrandCol}>
            <span className={styles.footBrand}>Senda</span>
            <span className={styles.footNote}>Randonnée &amp; refuges dans les Pyrénées — difficulté personnalisée, planification et couchage.</span>
          </div>
          <div className={styles.footLinks}>
            <button onClick={() => router.push("/explorer")}>Explorer</button>
            <button onClick={() => router.push("/carte")}>Carte</button>
            <button onClick={() => router.push("/refuges")}>Planifier</button>
          </div>
        </div>
        <div className={styles.footBottom}>© {new Date().getFullYear()} Senda · Fait dans les Pyrénées</div>
      </footer>
    </div>
  );
}
