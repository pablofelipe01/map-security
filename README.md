# Map Security — Rastreo de nodos mesh

App web **solo lectura** que visualiza el recorrido GPS de nodos mesh (Meshtastic)
sobre un mapa satélite/3D tipo Google Earth. Lee de Supabase (vista `v_node_track`)
y resalta dónde el vigilante **se quedó quieto** vs dónde **hizo recorrido**.

> Stack: Next.js 14 (App Router, TS strict) · Tailwind · `@vis.gl/react-google-maps`
> · `@supabase/supabase-js` · framer-motion · lucide-react.

## Puesta en marcha

```bash
npm install
# 1) Edita .env.local y pega tu Google Maps API key (ya trae Supabase URL + anon key)
npm run dev          # http://localhost:3000
```

### Variables (`.env.local`)

| Variable | Estado |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ ya configurada |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ ya configurada (anon, solo lectura) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | ⚠️ **pégala tú** |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | opcional |

### Conseguir la Google Maps API key

1. [Google Cloud Console](https://console.cloud.google.com/) → crea/elige un proyecto.
2. Activa **billing** (Maps requiere tarjeta; hay cupo gratis mensual).
3. Habilita **Maps JavaScript API** (y **Map Tiles API** si quieres el 3D fotorrealista).
4. **APIs y servicios → Credenciales → Crear credencial → Clave de API**.
5. Restríngela por *HTTP referrers* (ej. `http://localhost:3000/*` y tu dominio).
6. Pégala en `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` y reinicia `npm run dev`.

Sin la key, la app corre pero el mapa muestra un aviso; los paneles de datos sí cargan.

## Qué hace

- **Mapa satélite/híbrido** con toggle **2D / 3D** (3D = vista oblicua con tilt+heading).
- **Trayectoria** con gradiente por recencia (cian apagado → verde-lima brillante) y
  **flechas de rumbo**. Como `ground_track_deg` viene `null` en la data real, el rumbo
  se **calcula** entre fixes consecutivos.
- **Huecos sin reporte** (>35 min entre fixes) se dibujan **punteados**, no en línea
  recta — el nodo se calla hasta ~77 min cuando está parado.
- **Paradas** (`is_stationary`) en **ámbar** con el **tiempo de permanencia** (suma de
  `min_since_prev_fix` de la racha).
- **Marcador "en vivo"** (última posición real) en verde.
- **Playback** tipo replay de Google Earth (play/pausa, velocidad 1–8×, slider).
- **Selector de nodo**, **filtro de rango** (24h / hoy / ayer / 7d / custom).
- **HUD**: distancia total, # paradas, tiempo en movimiento vs quieto, inicio/fin, batería.
- **Auto-refresh** cada 45 s (polling).
- Horas en **America/Bogota (UTC-5)**.

## Notas de datos (críticas)

- Solo se pintan fixes con **`nuevo_fix = true`** (los `false` repiten posición).
- **`is_stationary`** define "quieto" (distancia <35 m), **no** `ground_speed` (no fiable).
- `alt_m`, `pdop`, `rssi`, `battery` pueden venir `null` → la UI muestra "—".
- **Multinodo**: nada está hardcodeado a `!86591d35`; el selector lista la tabla `nodes`.

## Estructura

```
app/         layout.tsx · page.tsx (dashboard) · globals.css
components/   MapView · TrackPlayback · NodeSelector · TimeRangePicker · PointDetail · StatsHUD
lib/          supabase · queries · geo · ranges · types
```

## Seguridad

Solo se usa la **anon key** (lectura pública vía RLS). No hay `service_role` en el bundle.
La app nunca escribe en la base.
