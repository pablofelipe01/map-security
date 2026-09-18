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

### Capa de vías de Guaicaramo

El mapa **siempre** superpone la malla vial del predio sobre el satélite: sin
ella no se puede leer por cuál ruta va un tractor, porque en la imagen de Esri
muchos caminos balastrados se confunden con los linderos de lote. No tiene
interruptor — se declara dentro del estilo inicial de MapLibre, debajo de los
rastros y los marcadores, así que nunca tapa la flota.

El origen es el KMZ de topografía (`Vias Guaicaramo/vias.kmz`, 1.666 tramos).
Se convierte a GeoJSON estático servido desde `public/`:

```bash
node scripts/kmz-a-geojson.mjs "<ruta>/vias.kmz" public/vias-guaicaramo.geojson
```

El script no tiene dependencias (descomprime el KMZ con `zlib` y lee el KML con
expresiones regulares) porque el archivo se actualiza una o dos veces al año y
no vale la pena arrastrar un parser de KML al proyecto. Cuando topografía mande
un KMZ nuevo, se vuelve a correr ese comando y se commitea el `.geojson`.

Convenciones de color en el mapa: **ámbar** balastrada, **blanco** pavimentada
o ruta, **gris punteado** proyectada (todavía no construida).

#### Los rastros se rutean por las vías

Entre dos fixes pasan ~10 minutos, y a la velocidad de un tractor eso son cientos
de metros o kilómetros. Uniéndolos con una recta, el rastro cortaba lotes en
diagonal y atravesaba potreros por donde ninguna máquina pasó: el dibujo era más
falso que el dato, porque el tractor casi siempre va por una vía.

`lib/rutas.ts` arma un grafo con este mismo GeoJSON y busca, entre cada par de
fixes consecutivos, el camino más corto por la malla (A\* con techo de
distancia). El rastro queda pegado a las vías reales y el marcador del replay
recorre esa polilínea en vez de la diagonal, girando en las curvas.

El GeoJSON viene de topografía, no de un grafo de navegación: dos vías que se
cruzan en el terreno pueden no compartir un vértice. Por eso el grafo se **cose**
antes de usarse — se parten los segmentos en sus cruces reales y se unen los
extremos que caen a menos de 3 m del cuerpo de otra vía. Sin coser, cada vía es
una isla y no hay ruta posible; cosido, el 96,8 % de la malla queda en una sola
componente conectada. Se construye en el navegador (~160 ms, una vez por sesión)
y no en un archivo precalculado, para que no exista una segunda copia de las vías
que pueda quedar desfasada de la que se pinta.

**Esto sigue siendo una reconstrucción, no una medición.** Entre dos fixes nadie
sabe por dónde pasó el tractor; el camino más corto es apenas la hipótesis más
razonable. El ruteo se abstiene —y deja la recta de antes— en los tres casos
donde inventaría más de lo que aporta:

| Caso | Umbral | Por qué |
| --- | --- | --- |
| El fix está lejos de cualquier vía | `RADIO_SNAP_M` = 35 m | La máquina está labrando dentro del lote, no transitando. Es el mismo umbral que `MOVIMIENTO_M`: por debajo, dos posiciones no se distinguen del error del GPS. |
| El desplazamiento es mínimo | 35 m | Rutear ruido del GPS sólo produce zigzag sobre la vía. |
| El camino por vías da un rodeo desproporcionado | `> 2,2 × recta + 250 m` | Probablemente falta una vía en el KMZ y el algoritmo está dando media vuelta al predio. |

Ningún fix se mueve de su lugar: la polilínea entra y sale del punto medido, y
lo único que se rellena es el silencio entre dos mediciones. Cada tramo lleva un
`porVia` que dice si se resolvió por la malla o quedó recto.

#### Rótulos de bloque y parcela

El mismo script deja un segundo archivo, `vias-guaicaramo-etiquetas.geojson`,
con un punto por bloque (48) y uno por parcela (494). El KMZ **no trae polígonos
de parcela**: cada vía sabe a qué bloque y parcela sirve, así que la etiqueta se
pone en el promedio de los vértices de las vías de ese código. No es el centroide
topográfico —si una parcela sólo tiene vía por un costado, el punto cae sobre esa
vía— pero ubica bien de qué parcela se habla. El día que topografía mande los
polígonos, se reemplaza por centroides reales sin tocar el mapa.

Se rotulan a zooms distintos porque cumplen funciones distintas:

| | zoom | texto |
|---|---|---|
| Bloque | 12–16 | `B.21` |
| Parcela | 15–16 | `P.12` |
| Parcela | 16+ | `B.21-P.12` |

El código completo aparece de cerca porque **el número de parcela se repite entre
bloques** (hay un `P.10` en el B.4 y otro en el B.5): a secas es ambiguo, y de
cerca es justo cuando alguien lo va a usar para decir dónde está la máquina.

### Capa de acopios

Los **845 acopios** del predio —los puntos donde se junta el fruto para
recogerlo— salen del plano del Departamento Agronómico *Acopios Guaicaramo*
(enero 23 de 2026). Como las vías, son infraestructura fija: van declarados en el
estilo inicial y no tienen interruptor. Aparecen desde z12 (más lejos son una
mancha) y muestran su número desde z15.

El origen es un **PDF geoespacial**, no un KMZ: el plano trae un diccionario
`/Measure /GEO` que amarra la página a coordenadas y capas de contenido opcional
(OCG) que separan acopios, parcelas, vías y canales. Eso permite leerlo como un
SIG. La conversión pide `pypdf`:

```bash
pip install pypdf
python scripts/pdf-acopios-a-geojson.py "<ruta>/Acopios Guaicaramo 2026.pdf"
```

Dos cosas del plano explican por qué el script no es un volcado directo:

- **Cada acopio es un símbolo, no un polígono.** Está dibujado como un anillo de
  ~18 vértices de área siempre idéntica (~7.100 m²), que es el tamaño del ícono,
  no del acopio. Lo que significa el dato es su centro, y eso es lo que se guarda.
- **El número vive en otra capa.** Los rótulos están sueltos, sin vínculo con el
  símbolo, así que el script los vuelve a emparejar por cercanía, resolviendo
  primero los pares más próximos. Quedan 836 de 845 con número; los 9 restantes
  no tienen rótulo en el plano.

**Control de calidad.** El plano también trae las vías, así que hay cómo
verificar la georreferencia contra una fuente independiente: las vías extraídas
del PDF caen a **1,0 m de mediana** (p99: 2,0 m) de las del KMZ de topografía. El
segundo control lo imprime el propio script: el número de acopio se repite entre
lotes pero debe ser único dentro de uno, y sólo hay **1 par `(lote, num)`
repetido** en 836 — si ese número crece, el emparejamiento se desalineó.

Cada acopio lleva `num`, y además `lote` y `bloque` resueltos por punto‑en‑
polígono contra las parcelas del mismo plano (801 de 845). Ojo: esos códigos son
**del plano 2026**, que renombró lotes que el KMZ todavía llama por código
(`B.91-P.116` es hoy `Lejanias`); contra los rótulos del KMZ coinciden 384 de
442, y casi toda la diferencia son esos renombres, no errores de ubicación. El
`lote` es contexto, no una clave: la identidad del acopio es su posición.

El plano tiene además **polígonos de parcela reales** (581 lotes cerrados, 11.322
ha) y las redes de canales primarios y secundarios, que hoy no se dibujan. El
script ya los extrae — están en `figuras['PARCELA']`, `['CanPrimarios']` y
`['CanSecundarios']`— si algún día se quieren como capa.

Los rótulos de bloque se dibujan con `text-allow-overlap`, los de parcela no: 48
etiquetas siempre valen la pena, 494 encimadas no se leen.

La fuente va **auto-hospedada** en `public/fonts/Open Sans Semibold/0-255.pbf`
(77 KB). MapLibre necesita glifos en PBF para cualquier capa de texto, y usar un
servidor público de glifos metería otra dependencia de red que puede caerse — el
mismo criterio que con las teselas. Ese rango cubre ASCII y Latin-1, que alcanza
para `B.21-P.12`; un rótulo con acentos pediría un rango que no está y no se
dibujaría.

#### Hasta dónde se puede acercar

La imagen de Esri sobre Guaicaramo llega hasta **z18**. De z19 en adelante el
servidor no da 404: responde 200 con un mosaico gris que dice "Map data not yet
available", así que el mapa se llenaba de ese texto al acercarse. La fuente
declara `maxzoom: 18` —MapLibre estira la última tesela buena en vez de pedir
las que no existen— y el mapa topa en `maxZoom: 19`, un estirón de 2x que
todavía deja distinguir palmas. Las vías y los marcadores no se degradan al
acercarse porque son vectores, no imagen.

#### El worker de MapLibre se sirve desde `public/`

MapLibre arranca su worker con `new Worker(new URL("./maplibre-gl-worker.mjs",
import.meta.url))`. Turbopack reescribe el bundle pero **no** emite ese archivo
hermano, así que el navegador pide una URL que Next contesta con el HTML de 404
y el worker nunca arranca. El síntoma es engañoso: el satélite se sigue viendo
(el ráster va por el hilo principal) pero **ninguna** fuente GeoJSON se procesa
— ni las vías ni los rastros del histórico — sin ningún error a la vista.

Por eso `npm run dev` y `npm run build` corren antes
`scripts/copiar-worker-maplibre.mjs`, que copia el worker y su chunk compartido
a `public/`, y `MapGL.tsx` lo apunta con `setWorkerUrl()`. Los dos archivos
copiados están en `.gitignore`: se regeneran desde la versión instalada de
maplibre-gl para que no se desincronicen al actualizar la librería. Si alguna vez
se levanta el server sin pasar por esos scripts, `npm run copiar-worker` lo arregla.

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

`tipo` acepta `tractor | camion | volqueta | aspersora | retro | porteria` y
define el ícono. Mientras el registro esté vacío, el panel lo avisa en pantalla
y las máquinas usan su nombre de fábrica. **Ojo:** `operador` y `labor` son
configuración, no telemetría — la UI los rotula como tal.

### Puestos fijos (portería)

No todos los nodos van montados en una máquina: algunos están instalados en un
sitio. Esos viven en **`lib/puestos.ts`**, con su coordenada escrita a mano:

```ts
export const PUESTOS: Record<string, Puesto> = {
  "<node_id>": { nombre: "Portería", codigo: "PORT",
                 lat: <lat>, lon: <lon>, color: "#7b4fd0" },
};
```

⚠️ **Pendiente de seguridad:** este archivo todavía lleva la coordenada real
escrita en el código, y el repositorio es público. Tiene que salir de aquí, como
ya salió la de las antenas — ver abajo.

Un nodo listado ahí cambia de comportamiento en tres cosas, y las tres por la
misma razón —su posición se declara, no se mide—:

1. se dibuja con el ícono de **vigilante** en la coordenada del archivo, no en su
   último fix, y se dibuja aunque nunca haya reportado;
2. no se le pinta rastro ni se le cuentan kilómetros: sus fixes se mueven ±20-30
   m por ruido del GPS, y eso no es un recorrido;
3. su ficha omite recorrido, operador al mando y video, porque nada de eso
   aplica a un poste.

El estado y la hora del último fix **sí** siguen siendo del nodo: sirven para
saber si el aparato está vivo. Si una portería se traslada, hay que corregir la
coordenada aquí — el nodo no lo va a avisar.

### Red mesh — los 7 nodos fijos

Las antenas del predio se leen de Supabase (`mesh_sites` → `v_mesh_health`) y se
dibujan siempre —en los dos modos— con ícono de antena, el nombre del sitio y una
línea punteada al gateway rotulada con la distancia.

⚠️ **Las coordenadas no van en el código ni en el repositorio.** La ubicación de
las antenas es infraestructura de seguridad, y este repositorio es público:
cualquier cosa que se escriba en un `.ts` viaja además en el bundle que descarga
el navegador. `lib/red.ts` define la forma de un sitio y cómo se pinta; el dato
llega en tiempo de ejecución. La carga inicial de `mesh_sites` vive en
`supabase/mesh-sitios.local.sql`, fuera de git.

Consecuencia asumida: si la consulta falla, el mapa no dibuja antenas. Antes
había una lista de respaldo escrita a mano para que nunca faltaran; se quitó a
propósito.

La línea es **punteada a propósito**: es la topología *declarada* (radial desde
la torre de oficinas), no la medida. La real tiene saltos que ese modelo no
contempla — el nodo solar `11bb` ya aparece repitiendo tráfico ajeno, y Forsoza
está a 15 km. Cuando el traceroute periódico entregue la ruta real, se reemplaza
por los saltos medidos y ahí sí se dibuja continua.

Las coordenadas se verifican contra las distancias del acta de instalación con la
vista `v_mesh_sites_check`:

```sql
select * from v_mesh_sites_check;   -- cuadra = false → revisar ese sitio
```

Un dígito transpuesto mueve un nodo kilómetros sin que se note sobre la imagen
satelital; contra la distancia al gateway, salta. Si falla **una**, es esa
coordenada; si fallan **todas**, la mala es la del gateway, que es el centro del
que cuelgan las demás. La comprobación vive en la base y no en un script del
repo, porque es donde viven los datos.

El esquema está en **`supabase/mesh.sql`** (pegar en el SQL
Editor de Supabase): `mesh_sites` con las coordenadas de instalación,
`traceroutes` con un registro por sondeo —incluidos los fallidos, que son los
que permiten calcular disponibilidad— y `traceroute_hops` con la topología
medida. Es puramente aditivo: no toca `nodes`, `node_positions` ni las tablas de
flota. La vista `v_mesh_health` es la que pintará el mapa.

El estado sale de `v_mesh_health` y son cuatro:

| estado | color | qué significa |
|---|---|---|
| `activa` | verde | respondió el último sondeo, o se oyó su anuncio hace poco |
| `sin_respuesta` | ámbar | 1–2 sondeos fallidos: puede ser una colisión del canal |
| `inactiva` | rojo | 3 o más seguidos sin responder — hay que ir al sitio |
| `sin_datos` | gris | aún no se ha sondeado, o no llegó la consulta |

Los umbrales viven en la vista, no en la app, para poder calibrarlos sin
desplegar. El precio es que la base puede devolver un estado que la app todavía
no conozca: `metaDe()` cae a "sin datos" en vez de romper el mapa.

Si la consulta falla, el mapa no dibuja antenas: no hay lista de respaldo en el
código, a propósito.

## Qué hace

- **EN VIVO**: un marcador por máquina coloreado por estado, con anillo animado
  y espejado según el rumbo; rastro del día de cada una **ruteado por la malla
  vial del predio**; panel con contadores
  por estado y lista ordenada por criticidad. Clic = seleccionar y encuadrar,
  doble clic = abrir el universo de la máquina.
- **HISTÓRICO**: selector de día, recorridos con marcas de inicio/fin y barra de
  replay (play/pausa, ×5–×60, slider acotado a las horas con datos). Toda
  máquina con fixes ese día tiene marcador durante todo el replay: atenuado y
  sin anillo mientras está fuera de su jornada —esperando en su primer fix o
  detenido en el último—, para que la flota no se encoja según la hora. Al elegir
  una máquina —en la lista o en el mapa— el panel muestra su ficha de ese día
  (recorrido, labor, detenciones, jornada y quién la manejó) y desde ahí se
  entra a su universo. Doble clic en el marcador del replay hace lo mismo.
- **Universo de máquina** (`#/m/<node_id>`, o `#/m/<node_id>/<YYYY-MM-DD>`):
  totales de 14 días, gráficas de km/día y horas en labor/día, y tabla de
  jornadas con primer y último fix. Con fecha, la ventana cierra ese día y no
  hoy: se omite el estado en vivo —que es un dato del ahora— y se resalta el día
  por el que se entró.
- **Video del recorrido**: cada nodo se puede exportar como un `.mp4` con su
  jornada animada. Ver abajo.
- **Frescura del dato** siempre visible, con detección de poller caído.
- Auto-refresco cada 60 s. Horas en **America/Bogota (UTC-5)**.

### Video del recorrido por nodo

El botón de cámara de cada fila del panel —y el botón del panel de la máquina
seleccionada— exporta la jornada de ese nodo como video (`lib/video.ts`).

Cómo funciona, y por qué así:

- **Se captura el canvas del mapa**, no se renderiza aparte. La alternativa
  obligaría a redibujar teselas, vías y rótulos por nuestra cuenta: sería un
  segundo renderizador que se iría desincronizando del real. Capturando el
  canvas, el video muestra literalmente lo que la app muestra.
- Por eso el mapa se crea con `canvasContextAttributes.preserveDrawingBuffer`:
  sin eso el buffer de WebGL se limpia al componer el cuadro y el archivo sale
  en negro.
- El recorrido se recorre con **la misma `positionAt` del replay**, así que el
  video no puede contar una historia distinta de la barra de replay. Hereda sus
  límites: entre fix y fix la posición es interpolada. Esa advertencia va
  **escrita dentro del video**, porque el archivo se comparte suelto y ahí ya no
  hay app alrededor que la muestre.
- Los marcadores del mapa son HTML sobre el canvas y **no entran en la
  captura**: la máquina del video se dibuja a mano con el mismo `machineSVG` del
  marcador, sobre un lienzo 2D que además lleva el HUD (nombre, hora, km).
- La grabación va **cuadro a cuadro sobre el mapa real**, así que tarda un rato
  parecido a lo que dura el video y el mapa no se puede usar mientras tanto
  (tampoco se puede cambiar de pestaña: el navegador congela el renderizado de
  las pestañas ocultas). El sondeo automático se pausa para que no cambien los
  rastros a mitad de la captura. Al terminar —o al cancelar, o al fallar— el
  mapa vuelve a su cámara y sus capas originales.
- **Formato MP4 (H.264), no WebM.** El video se comparte y se ve en teléfonos, y
  iOS no reproduce WebM: en un iPhone el archivo sencillamente no abre. La
  codificación va por **WebCodecs** (`VideoEncoder`) y el empaquetado por
  `mp4-muxer`, con:
  - Perfil **Baseline** primero (el que reproduce cualquier iPhone, incluso
    viejo), y sólo Main o High si el codificador de la máquina no ofrece
    Baseline. Verificado en Chrome: sale `Constrained Baseline`, nivel 4.1,
    `yuv420p`.
  - `fastStart: 'in-memory'`, que deja el `moov` **antes** del `mdat`. Es lo que
    permite que un iPhone o WhatsApp empiecen a reproducir sin bajarlo entero y
    que QuickTime no lo declare corrupto.
  - Lados pares y ~0.15 bits por píxel y cuadro (≈9 Mb/s en 1080p30): la imagen
    satelital es ruido de alta frecuencia y con un bitrate de videollamada se
    convierte en bloques.
- **`isConfigSupported` no basta.** Se lo vio responder que sí y después tragarse
  los cuadros sin devolver ninguno (codificador por hardware no disponible de
  verdad). Antes de grabar se le pasa **un cuadro de prueba**: si no produce
  nada en 4 s, se descarta ese perfil. Así el respaldo entra antes de grabar y
  no a la mitad.
- **Respaldo**: `MediaRecorder` en MP4 (Chrome y Edge recientes lo soportan) y,
  como último recurso, WebM — que la UI marca explícitamente como "no abre en
  iPhone" en vez de entregarlo como si nada.
- Con WebCodecs las marcas de tiempo las pone la app, no el reloj de pared, así
  que la exportación no depende de ir exactamente a 30 cuadros por segundo. El
  respaldo por `MediaRecorder` sí, y por eso el bucle consulta `tiempoReal`.

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
              VideoModal (diálogo de exportación de video)
lib/          fleet (estados) · replay (interpolación) · tractores (registro)
              puestos (nodos fijos: portería) · red (estado de la malla mesh)
              rutas (grafo vial + A*) · useRutas (hook que lo aplica al rastro)
              video (graba el recorrido) · capas (ids compartidos con el mapa)
              icons (SVG de máquinas) · queries · geo · ranges · types
public/       vias-guaicaramo.geojson + -etiquetas.geojson (capa fija de vías)
              acopios-guaicaramo.geojson (845 acopios, capa fija)
              fonts/ (glifos de los rótulos) · worker de maplibre
scripts/      kmz-a-geojson.mjs (regenera las vías desde el KMZ)
              pdf-acopios-a-geojson.py (regenera los acopios desde el plano PDF)
              copiar-worker-maplibre.mjs (corre solo en predev/prebuild)
```

## Seguridad

Solo se usa la **anon key** (lectura pública vía RLS). No hay `service_role` en
el bundle. La app nunca escribe en la base.
