import "./globals.css";
import type { Metadata } from "next";
import { AuthProvider } from "@/components/AuthProvider";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  metadataBase: new URL("https://trailrate.app"),
  title: {
    default: "Senda — La difficulté des sentiers, adaptée à vous",
    template: "%s · Senda",
  },
  description:
    "Banque de sentiers des Pyrénées avec une difficulté calculée segment par segment et personnalisée selon votre ressenti. Importez vos traces GPX, notez-les, laissez le modèle apprendre.",
  keywords: ["randonnée", "Pyrénées", "difficulté sentier", "GPX", "trace GPX", "trace randonnée"],
  openGraph: {
    title: "Senda — La difficulté des sentiers, adaptée à vous",
    description:
      "La difficulté d'un sentier dépend de qui le marche. Découvrez une banque de randonnées des Pyrénées avec une note calibrée pour vous.",
    type: "website",
    locale: "fr_FR",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css" />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('trailrate-theme');if(!t){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
