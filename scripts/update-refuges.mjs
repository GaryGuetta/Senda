// =============================================================================
// update-refuges.mjs — Rafraîchit la base refuges intégrée (src/data/refuges.json)
// depuis l'API publique du site communautaire refuges-pyrenees.
// Usage : npm run data:refuges
// =============================================================================
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://refuges-pyrenees.vercel.app/api/refuges.json";
const DEST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "refuges.json");

const rep = await fetch(SOURCE, { headers: { "User-Agent": "Senda/1.0 (maj donnees)" } });
if (!rep.ok) { console.error(`✗ ${SOURCE} → HTTP ${rep.status}`); process.exit(1); }
const data = await rep.json();
const refuges = Array.isArray(data) ? data : data.refuges || [];
for (const r of refuges) delete r.url; // reconstruit côté app, inutile de le stocker
await writeFile(DEST, JSON.stringify({ meta: data.meta ?? {}, refuges }), "utf8");
console.log(`✓ ${refuges.length} refuges écrits dans src/data/refuges.json`);
