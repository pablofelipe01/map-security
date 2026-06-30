# Prompt para Claude Code — App de mapa de rastreo de nodos mesh ("map-security")

> Pásale este archivo completo a Claude Code como contexto/spec. Está pensado para
> arrancar un proyecto Next.js nuevo desde cero.
>
> **Directorio del proyecto: `~/map-security-app`** (ya existe, vacío). Crea ahí el
> proyecto Next.js (ej. `npx create-next-app@latest ~/map-security-app --ts --app
> --tailwind`) y trabaja dentro de esa carpeta. No crees el proyecto en otro lado.

---

## 1. Objetivo

Construir una **aplicación web muy visual** que muestre en un mapa el recorrido GPS de
nodos de una red mesh (Meshtastic) usados para vigilancia/seguridad. La data ya está
en **Supabase** (un punto cada ~15 min). Quiero algo **bonito, tipo Google Earth**:
vista satelital/3D, trayectoria animada, marcadores con dirección, y resaltar dónde el
vigilante **se quedó quieto** vs dónde **hizo recorrido**.

El backend YA EXISTE y está corriendo (no hay que crearlo). Esta app es **solo
lectura** sobre Supabase. NO escribas en la base.

## 2. Stack obligatorio

- **Next.js 14+** con **App Router** y **TypeScript** (strict).
- **Tailwind CSS** + componentes propios (puedes usar shadcn/ui si ayuda).
- **@supabase/supabase-js** para leer datos (clave anónima, solo lectura).
- **Mapa: Google Maps Platform.** Quiero el look "Google Earth":
  - Primario: **Google Maps JavaScript API** vía **`@vis.gl/react-google-maps`**, en
    modo **satélite/híbrido**.
  - Hero opcional: **Photorealistic 3D Tiles** (vista 3D tipo Google Earth) con
    `google.maps.maps3d.Map3DElement` o **deck.gl + Google 3D Tiles**. Si el 3D
    complica demasiado, deja un toggle 2D-satélite/3D y que el 3D sea progresivo.
- Animaciones suaves (framer-motion o CSS). Diseño **dark, moderno, premium**.

## 3. Backend Supabase (ya existe — datos reales)

- **Project URL:** `https://jqhpmlmtopmtgxqxfyab.supabase.co`
- **Anon key:** está en el archivo `/home/pfac/guaica-health/supabase.env`
  (variable `SUPABASE_ANON_KEY`). Cópiala al `.env.local` del proyecto.
  **NUNCA** uses la `service_role key` en el frontend.
- **RLS:** lectura pública habilitada para `anon` sobre las tablas y la vista. La
  escritura está bloqueada para el frontend (correcto, es solo-lectura).

### Variables de entorno del proyecto (`.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=https://jqhpmlmtopmtgxqxfyab.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<copiar de supabase.env>
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<tu key de Google Maps Platform>
```
> Para el 3D fotorrealista hay que habilitar en Google Cloud: **Maps JavaScript API**
> y **Map Tiles API** (y tener billing activo).

### Modelo de datos

**Tabla `nodes`** (dimensión, 1 fila por nodo):
`node_id` (PK, ej. `!86591d35`), `num`, `long_name`, `short_name`, `hw_model`,
`macaddr`, `public_key`, `first_seen`, `last_seen`, `updated_at`.

**Vista `v_node_track`** (USAR ESTA para el mapa — ya trae los campos derivados).
Columnas:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigint | PK del punto |
| `node_id` | text | ej. `!86591d35` |
| `sample_local` | timestamptz | cuándo corrió el poller |
| `gps_time` | timestamptz | timestamp del fix GPS (UTC) |
| `lat`, `lon` | double | **usar estos para pintar** (no `geom`) |
| `geom` | geography | ignorar en el front (viene como WKB) |
| `alt_m` | int | altitud (ruidosa con pocos satélites) |
| `location_source` | text | ej. `LOC_INTERNAL` |
| `pdop` | numeric | calidad del fix (menor = mejor; <2 excelente) |
| `ground_speed` | numeric | velocidad reportada — **NO confiable** (ver §5) |
| `ground_track_deg` | numeric | **rumbo/dirección 0–360°** → flechas en el mapa |
| `sats` | int | satélites a la vista |
| `precision_bits` | int | 32 = precisión completa |
| `snr`, `rx_rssi`, `rx_snr` | numeric/int | señal/cobertura mesh |
| `hops_away`, `hop_limit`, `relay_node` | int | topología mesh |
| `transport` | text | ej. `TRANSPORT_LORA` |
| `last_heard` | timestamptz | último oído del nodo |
| `battery_level`, `voltage` | int/numeric | nullable (solo si el nodo manda Telemetry) |
| `channel_util`, `air_util_tx` | numeric | uso del canal |
| `nuevo_fix` | boolean | **true = fix GPS nuevo** (ver §5) |
| `dist_prev_fix_m` | double | metros desde el fix distinto anterior |
| `min_since_prev_fix` | numeric | minutos desde el fix distinto anterior |
| `is_stationary` | boolean | **true = se quedó quieto** (<35 m del fix anterior) |

## 4. Cómo consultar (ejemplos con supabase-js)

```ts
// Recorrido LIMPIO de un nodo en un rango (para la polyline del mapa):
const { data } = await supabase
  .from('v_node_track')
  .select('id,node_id,sample_local,gps_time,lat,lon,alt_m,ground_speed,' +
          'ground_track_deg,sats,pdop,rx_rssi,battery_level,' +
          'nuevo_fix,dist_prev_fix_m,min_since_prev_fix,is_stationary')
  .eq('node_id', '!86591d35')
  .eq('nuevo_fix', true)                 // <-- clave: solo fixes reales
  .gte('sample_local', desde)            // ISO string
  .lte('sample_local', hasta)
  .order('sample_local', { ascending: true })

// Lista de nodos disponibles (para el selector):
const { data: nodes } = await supabase
  .from('nodes')
  .select('node_id,long_name,short_name,last_seen')
  .order('last_seen', { ascending: false })

// Última posición de cada nodo (para el marcador "en vivo"):
//   query v_node_track ordenado por sample_local desc, limit 1 por nodo.
```
> Nota: `node_id` lleva `!` — con supabase-js no hay que escapar nada, va tal cual.

## 5. Semántica de los datos (CRÍTICO — léelo antes de diseñar)

Esto sale de analizar la data real; respétalo o el mapa mentirá:

1. **Filtra `nuevo_fix = true` para el recorrido.** Las filas con `nuevo_fix=false`
   son "el poller corrió pero el nodo no reportó posición nueva" → repiten el punto
   anterior. Si no filtras, la trayectoria se ve pegada/duplicada.
2. **`ground_speed` NO es fiable como "parado".** El radio reporta velocidad > 0
   (ej. 3) aunque el nodo esté físicamente quieto. **Para "se quedó quieto" usa
   `is_stationary`** (que se basa en distancia entre fixes, no en velocidad).
3. **El nodo se calla hasta ~77 min cuando está parado** (no rebroadcastea seguido).
   Por eso entre dos fixes reales puede haber huecos largos (`min_since_prev_fix`).
   No interpoles en línea recta asumiendo movimiento constante en esos huecos; es más
   honesto mostrar el hueco (línea punteada o gap) o marcar "sin reporte".
4. **Tiempos:** `gps_time`/`sample_local` vienen en **UTC**. Muéstralos en
   **America/Bogota (UTC-5)**.
5. **`alt_m` es ruidosa** (a veces negativa con pocos satélites). No la uses como dato
   duro; sí puedes mostrarla como informativa.
6. **Multinodo:** hoy hay 1 nodo activo (`!86591d35`) pero la app debe soportar varios
   (selector de nodo / varios trazos a la vez). No hardcodees un solo node_id.

## 6. Funcionalidad (qué debe hacer)

- **Mapa satelital/3D bonito** centrado en el nodo (zona: Guaicaramo, Colombia,
  ~`4.48, -72.95`).
- **Trayectoria (polyline)** del recorrido del nodo en el rango seleccionado, con
  gradiente por tiempo (más reciente más brillante) y flechas de dirección usando
  `ground_track_deg`.
- **Marcadores de "quieto":** resaltar los puntos `is_stationary = true` (pin distinto
  o círculo), y al pasar el mouse mostrar **cuánto tiempo estuvo ahí** (suma de
  `min_since_prev_fix` de la racha quieta).
- **Marcador "en vivo":** la última posición del nodo, con su info (hora del fix,
  velocidad, sats, PDOP, batería, RSSI).
- **Popup/panel de detalle** al hacer click en un punto: todos los campos útiles
  (hora local, lat/lon, alt, sats, pdop, rumbo, rssi/snr, hops, batería).
- **Selector de nodo** (de la tabla `nodes`).
- **Filtro de fecha/hora** (rango): hoy, últimas 24h, ayer, custom.
- **Línea de tiempo / playback (animación):** un slider que "reproduzca" el recorrido
  punto por punto (tipo replay de Google Earth). Es la feature estrella visualmente.
- **Auto-refresh:** como la data entra cada 15 min, refresca cada ~30–60 s
  (polling simple). Realtime de Supabase es opcional (requiere habilitar replicación en
  la tabla `node_positions`); si lo haces, suscríbete a inserts, si no, polling.
- **Panel lateral / HUD** con stats del recorrido: distancia total, # de paradas,
  tiempo en movimiento vs quieto, hora de inicio/fin, batería actual.

## 7. Estética (esto importa mucho)

- **Dark theme premium**, tipo dashboard de seguridad / mission control.
- Mapa satélite o **3D fotorrealista** como protagonista; UI flotante en vidrio
  (glassmorphism sutil), no cajas planas feas.
- Transiciones suaves al cambiar de nodo/rango; cámara que vuela al punto (fly-to).
- Paleta: fondo casi negro, acentos en cian/verde-lima para "vivo", ámbar para "quieto",
  rojo para alertas (fix viejo, batería baja).
- Responsive, pero priorizar desktop (es un panel de monitoreo).
- Iconografía limpia (lucide-react).

## 8. Estructura sugerida

```
app/
  layout.tsx          # dark theme, fonts
  page.tsx            # dashboard principal (mapa + paneles)
components/
  Map3D.tsx           # mapa Google (satélite/3D), polyline, markers, fly-to
  TrackPlayback.tsx   # slider/timeline de reproducción
  NodeSelector.tsx
  TimeRangePicker.tsx
  PointDetail.tsx     # popup/panel de un punto
  StatsHUD.tsx        # distancia, paradas, tiempo quieto/movimiento, batería
lib/
  supabase.ts         # cliente (anon)
  queries.ts          # funciones de consulta tipadas (ver §4)
  geo.ts              # helpers: distancia, agrupar paradas, formatear tz Bogota
  types.ts            # tipos de v_node_track / nodes
```

## 9. Criterios de aceptación

- [ ] Carga el recorrido real de `!86591d35` desde Supabase y lo pinta sobre satélite.
- [ ] La trayectoria usa solo `nuevo_fix=true` y muestra flechas de dirección.
- [ ] Los puntos `is_stationary` se ven distintos y muestran el tiempo de permanencia.
- [ ] Hay selector de nodo, filtro de rango y playback animado del recorrido.
- [ ] Horas mostradas en America/Bogota.
- [ ] Solo usa la anon key; no hay secretos en el bundle del cliente.
- [ ] Se ve **bonito** (dark, 3D/satélite, animaciones), no un mapa pelado.

## 10. Notas finales

- Si Google Photorealistic 3D te da problemas de costo/billing, arranca en 2D
  satélite-híbrido y deja el 3D detrás de un toggle.
- Maneja el caso "sin datos en el rango" y "nodo sin posición" con estados vacíos
  elegantes.
- El backend puede sumar más nodos en el futuro (editan `WATCH_NODE_IDS` en la Pi):
  la app no debe asumir un único nodo.
