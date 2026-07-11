# TrailRate 🏔

Carte interactive de notation de sentiers de randonnée.  
Stack : Next.js 14 · PostgreSQL · Prisma · Leaflet · NextAuth

---

## Installation

### 1. Cloner et installer les dépendances

```bash
git clone <votre-repo>
cd trail-rating
npm install
```

### 2. Base de données PostgreSQL

Créez une base PostgreSQL locale ou via [Neon](https://neon.tech) (gratuit).

```bash
# Exemple avec psql local
createdb trail_rating
```

### 3. Variables d'environnement

Copiez `.env.local` et remplissez vos valeurs :

```bash
cp .env.local .env.local   # déjà présent, editez-le
```

```env
DATABASE_URL="postgresql://user:password@localhost:5432/trail_rating"
NEXTAUTH_SECRET="votre-secret-32-chars"   # openssl rand -base64 32
NEXTAUTH_URL="http://localhost:3000"
```

### 4. Initialiser la base et seeder les données

```bash
npm run db:push     # crée les tables
npm run db:seed     # insère les 5 sentiers de démonstration
```

### 5. Lancer le serveur de développement

```bash
npm run dev
# → http://localhost:3000
```

---

## Structure du projet

```
src/
├── app/
│   ├── api/
│   │   ├── trails/              # GET liste + GET/POST sentier
│   │   │   └── [id]/review/     # GET/POST note utilisateur
│   │   ├── auth/[...nextauth]/  # NextAuth
│   │   └── register/            # Inscription
│   ├── map/                     # Page principale (carte)
│   ├── login/                   # Connexion
│   └── register/                # Inscription
├── components/
│   ├── TrailMap.tsx             # Carte Leaflet + liste des sentiers
│   ├── ReviewPanel.tsx          # Sliders de notation utilisateur
│   └── Navbar.tsx               # Barre de navigation
├── lib/
│   ├── prisma.ts                # Client Prisma singleton
│   └── score.ts                 # Calcul de la note agrégée
└── types/
    └── index.ts                 # Types + constantes (critères, pondérations)

prisma/
├── schema.prisma                # Modèles User, Trail, Review
└── seed.ts                      # 5 sentiers de démonstration
```

---

## Logique de notation

Chaque `Review` stocke 5 critères notés de 1 à 10.  
La note globale d'un sentier = **moyenne de tous les avis**, pondérée :

| Critère       | Poids |
|---------------|-------|
| Relief        | 25 %  |
| Terrain       | 25 %  |
| Accessibilité | 20 %  |
| Balisage      | 15 %  |
| Paysage       | 15 %  |

La couleur sur la carte (vert / orange / rouge) est déduite de la note finale, pas du niveau déclaré.

---

## Déploiement sur Vercel

```bash
npm install -g vercel
vercel
# Ajoutez DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL dans les variables Vercel
```

Après déploiement :
```bash
DATABASE_URL="..." npm run db:push
DATABASE_URL="..." npm run db:seed
```

---

## Prochaines étapes suggérées

- Import GPX → conversion automatique en GeoJSON
- Récupération des sentiers depuis l'API Overpass (OpenStreetMap)
- Profil altimétrique via Open-Elevation API
- Page profil utilisateur avec historique des notes
- Filtres avancés (distance, dénivelé, note minimale)
