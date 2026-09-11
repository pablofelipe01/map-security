# SiriusFleet — Torre de control de tractores

App web **solo lectura** que muestra el estado y el recorrido de una flota de
tractores rastreados con nodos mesh (Meshtastic). Lee de Supabase
(`v_node_track` + `v_node_estadias`) y responde tres preguntas de supervisión:
**¿qué máquinas están trabajando?**, **dónde está cada una** y **qué recorrido
hizo en la jornada**.

Sigue el patrón de diseño **SiriusFleet**: tema Sirius claro, topbar con toggle
EN VIVO / HISTÓRICO, *fleet strip* de chips, panel lateral derecho colapsable,
barra de replay y "universo de máquina".

> Stack: Next.js (App Router, TS strict) · Tailwind · **MapLibre GL JS + Esri
> World Imagery** · `@supabase/supabase-js`.

## ⚠️ Qué tan "en tiempo real" es (leer esto primero)

**El techo no está en la app, está en la fuente.** Medido contra la base:

- El poller de Supabase corre **cada 10 minutos** (144 filas/día por nodo, en
  `:00 :10 :20…`).
- El nodo Meshtastic entrega un fix GPS **cada ~9 minutos**.

Es decir: **la posición más fresca que puede existir tiene entre 0 y ~10 minutos
de atraso.** Un tractor a 6 km/h avanza ~1 km en ese lapso. La app no puede —y no
finge— mostrar un punto que se desliza en vivo.

De ahí la decisión de diseño: **la app nunca afirma "está aquí ahora"**. Muestra
la última posición *confirmada* con su edad, visible en el topbar y por máquina
en el panel. Subir la frecuencia real exige cambiar la config del nodo
Meshtastic y la cadencia del poller — es trabajo de backend, no de esta app.

### Dos umbrales del patrón que hubo que retunear

El demo de SiriusFleet simula telemetría cada 3 segundos, así que dos de sus
reglas no sobreviven al contacto con la data real:

| Regla del patrón | Qué pasaría aquí | Valor adoptado |
|---|---|---|
| `offline` a los **3 min** sin reporte | Las 6 máquinas quedarían en "Sin señal" permanente | **25 min** (`SIN_SENAL_MIN`, ≈2.5 ciclos del poller) |
| Replay no interpola huecos **> 10 min** | Casi todos los huecos son de ~9-10 min → replay a saltos secos | **20 min** (`GAP_INTERPOLA_MIN`) |

El replay interpola en línea recta entre fixes, y **la barra lo dice en
pantalla**: entre dos fixes nadie sabe por dónde pasó la máquina. Pasado el
umbral el marcador se queda en el último fix en vez de inventar trayecto.

## Estados de una máquina

Los deriva `lib/fleet.ts` a partir del **último fix GPS real**, nunca de que
exista una fila. Las claves coinciden con las clases CSS del patrón:

| Estado | Significado |
|---|---|
| **Activa** | Fix de menos de 25 min y desplazamiento ≥ 35 m contra el fix anterior. |
| **Detenida** | Fix reciente, pero sin moverse del sitio. |
| **Sin señal** | Su último fix tiene más de 25 min. El pin del mapa es el último lugar conocido, **no** el actual. |
| **Sin GPS** | El nodo está en la red pero nunca entregó coordenadas. |

El patrón tiene un cuarto estado `mantenimiento` (rojo) alimentado por tickets;
aquí no hay esa fuente, así que el rojo queda reservado para el aviso de
**poller caído**, que es la única falla de esa gravedad que la app puede
detectar (todos los nodos viejos a la vez = se cayó la plataforma, no la flota).

## Puesta en marcha

```bash
npm install
npm run dev          # http://localhost:3000
```

### Variables (`.env.local`)

| Variable | Estado |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ ya configurada |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ ya configurada (anon, solo lectura) |

**No hace falta API key de mapas.** Se usa MapLibre GL JS con teselas de *Esri
World Imagery*, que no piden clave ni facturación: la app no puede quedarse en
blanco porque venció una tarjeta o se agotó una cuota.

### Por qué MapLibre y no Leaflet

Se empezó con Leaflet y se cambió por dos motivos concretos:

1. Leaflet pinta cada tesela como un `<img>` en el DOM, y su hoja de estilos
   1.9.x aplica `mix-blend-mode: plus-lighter` a esas imágenes. Junto con el
   preflight de Tailwind eso producía teselas lavadas, costuras visibles y
   parpadeo al hacer zoom. MapLibre dibuja todo en un canvas WebGL, así que
   ninguna regla de CSS de la app puede interferir con el mapa.
2. El zoom es continuo en vez de por pasos, que es lo que se necesita para
   seguir un rastro de labor sin perder de vista el lote.

**Requisito:** MapLibre necesita WebGL. En un navegador o equipo sin
aceleración por hardware no hay mapa (no existe respaldo en 2D). En cualquier
navegador de escritorio o móvil actual esto no es un problema.

El precio de no usar Google Maps es que no hay 3D fotorrealista, que para
supervisar labores no aporta nada.

### Bautizar la flota — paso pendiente

La tabla `nodes` sólo trae nombres de fábrica (`"Meshtastic 1d35"`) y ninguno de
los atributos que el patrón muestra. Como la app es de solo lectura, ese
registro vive en **`lib/tractores.ts`**:

```ts
export const MAQUINAS: Record<string, Maquina> = {
  "!79350d77": { codigo: "T-01", nombre: "Rocinante", tipo: "tractor",
                 color: "#0a55a5", operador: "Éider Rojas", labor: "Poda · Lote 12" },
};
```

`tipo` acepta `tractor | aspersora | retro` y define el ícono. Mientras el
registro esté vacío, el panel lo avisa en pantalla y las máquinas usan su nombre
de fábrica. **Ojo:** `operador` y `labor` son configuración, no telemetría — la
UI los rotula como tal.

## Qué hace

- **EN VIVO**: un marcador por máquina coloreado por estado, con anillo animado
  y espejado según el rumbo; rastro del día de cada una; panel con contadores
  por estado y lista ordenada por criticidad. Clic = seleccionar y encuadrar,
  doble clic = abrir el universo de la máquina.
- **HISTÓRICO**: selector de día, recorridos con marcas de inicio/fin y barra de
  replay (play/pausa, ×5–×60, slider acotado a las horas con datos).
- **Universo de máquina** (`#/m/<node_id>`): totales de 14 días, gráficas de
  km/día y horas en labor/día, y tabla de jornadas con primer y último fix.
- **Frescura del dato** siempre visible, con detección de poller caído.
- Auto-refresco cada 60 s. Horas en **America/Bogota (UTC-5)**.

## Lo que el patrón tiene y aquí no

Estos bloques del demo se omiten porque **no existe la fuente**, y mostrarlos en
cero haría creer que la máquina nunca ha consumido ni se ha reparado:

| Bloque | Por qué falta |
|---|---|
| Horómetro y "horas encendida" | La máquina no reporta encendido/apagado. Lo medible es de primer a último fix, que es la "jornada". |
| Combustible (tanqueos) | No hay tabla. Son eventos, no configuración: no sirve un archivo en el frontend. |
| Mantenimiento (tickets) | Igual que el anterior, y además exige que la app **escriba**. |

Para tenerlos hace falta crear tablas propias en Supabase y definir su RLS.

## Notas de datos (críticas)

Cuatro trampas de esta data, con la corrección que aplica el código:

1. **`nodes.last_seen` NO es cuándo se vio el nodo** — guarda cuándo corrió el
   poller, y sale idéntico en los 6 nodos. Usarlo mostraba "visto hace 0 min"
   para un nodo congelado desde mayo. La frescura se mide contra `gps_time`.
2. **`en_estadia` no se puede usar para filtrar el rastro.** Pedir
   `en_estadia = false` borraba recorrido real: en el nodo `0d77`, 4 de 9 fixes
   en movimiento —uno con 84 m en 8.6 min e `is_stationary = false`— vienen
   marcados `en_estadia = true`. Hoy `fetchTrack` sólo descarta lo que no es fix
   (`nuevo_fix`) y el ruido (`es_outlier`).
3. **`ground_speed` no es confiable** (valores 0–14 sin unidad coherente). Toda
   velocidad se calcula como distancia/tiempo entre fixes reales.
4. **PostgREST corta en 1000 filas sin avisar.** La serie de 14 días sumaba
   exactamente 1000 fixes y los dos días más recientes salían en cero, con
   gráficas de ceros perfectamente creíbles. `fetchTrack` pagina explícitamente.

Además: el ~81 % de las filas son `nuevo_fix = false` (el poller corrió pero el
nodo no reportó posición nueva); `alt_m`, `pdop`, `rssi` y `battery` pueden venir
`null`. Nada está hardcodeado a un `node_id`.

## Estructura

```
app/          layout.tsx · page.tsx (orquestación + ruta #/m/) · globals.css
components/   MapGL · TopBar · SidePanel · ReplayBar · MachineView · BarChart
lib/          fleet (estados) · replay (interpolación) · tractores (registro)
              icons (SVG de máquinas) · queries · geo · ranges · types
```

## Seguridad

Solo se usa la **anon key** (lectura pública vía RLS). No hay `service_role` en
el bundle. La app nunca escribe en la base.
