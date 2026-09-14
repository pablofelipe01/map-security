/**
 * Copia el worker de MapLibre a `public/`.
 *
 * MapLibre 6 arranca su worker con `new Worker(new URL("./maplibre-gl-worker.mjs",
 * import.meta.url), { type: "module" })`. Turbopack reescribe el bundle a
 * `/_next/static/chunks/...` pero no emite ese archivo hermano, así que el
 * navegador pide una URL que no existe, Next responde el HTML de 404 y el worker
 * muere con "non-JavaScript MIME type". Sin worker, MapLibre no procesa NINGUNA
 * fuente GeoJSON —ni las vías ni los rastros del histórico— y falla en silencio:
 * el satélite se sigue viendo porque el ráster va por el hilo principal.
 *
 * La solución es servir el worker desde `public/` y apuntarlo con `setWorkerUrl`
 * (ver components/MapGL.tsx). Se copia en `predev`/`prebuild` en vez de
 * versionarlo para que no se desincronice de la versión instalada de maplibre-gl.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const origen = join(raiz, "node_modules", "maplibre-gl", "dist");
const destino = join(raiz, "public");

// El worker importa `./maplibre-gl-shared.mjs` por ruta relativa, así que los dos
// tienen que quedar uno al lado del otro en la raíz de `public/`.
const archivos = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

await mkdir(destino, { recursive: true });
for (const archivo of archivos) {
  await copyFile(join(origen, archivo), join(destino, archivo));
}
console.log(`worker de maplibre -> public/ (${archivos.join(", ")})`);
