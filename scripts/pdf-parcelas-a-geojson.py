# -*- coding: utf-8 -*-
"""Arma las parcelas de Guaicaramo a partir de dos planos PDF geoespaciales:

    pip install pypdf shapely   (pypdf lo usa scripts/pdf_geo.py)
    python scripts/pdf-parcelas-a-geojson.py "Acopios Guaicaramo 2026.pdf" "GUAICARAMO SATELITAL.pdf"

  * El PRIMERO pone la geometria: su capa PARCELA trae los linderos.
  * El SEGUNDO pone los rotulos ("PARCELA - Predeterminado"). Si se omite, se
    usan los del primero.

Salen dos archivos:

  * public/parcelas-guaicaramo.geojson: un poligono por parcela, con su codigo
    (B.10-P.9), su bloque, su area y un `tono` 0..5 para pintarla.
  * public/parcelas-guaicaramo-etiquetas.geojson: un punto por parcela y uno por
    bloque (clase, texto, cod_bp), que es lo que leen las capas de rotulos.

POR QUE DOS PLANOS. El plano satelital (septiembre 2026) es el mas reciente y
es el que usa el Departamento Agronomico, pero solo trae los rotulos: su capa
PARCELA no tiene trazos. El de acopios (enero 2026) si trae los linderos, pero
algunos de sus rotulos estan corridos a la parcela vecina: en el B.342 el
"P.9" quedo dentro de P.8 y la franja que de verdad es P.9 quedo sin nombre.
Los dos planos estan amarrados a la misma georreferencia (las vias de uno caen
a ~30 cm de las del otro), asi que se pueden cruzar sin corregir nada.

POR QUE POLIGONIZAR. En el PDF no todos los linderos son anillos cerrados:
algunas parcelas se parten con un trazo suelto dibujado encima de otra. Tomar
solo los anillos cerrados junta dos parcelas en una. Por eso se cortan todos
los trazos entre si y se toman las caras que forman, como haria un SIG.

Lo que el plano no resuelve se reporta, no se inventa:

  * Una cara con dos o mas codigos (el plano no dibuja el lindero entre ellas)
    sale como una sola parcela con los codigos juntos ("B.16-P.3 / P.4 / P.8")
    y `varios: true`.
  * Un codigo que no cae en ninguna cara se lista al final y no se dibuja.
  * Las caras sin rotulo (islas, zonas sin sembrar) se dejan por fuera: una
    parcela sin codigo no se puede nombrar, y nombrarla es para lo que existe
    la capa.

No hay poligono de bloque en ningun plano, y no se puede disolver uno: entre
parcela y parcela pasa una via o un canal. El bloque se lee en el mapa porque
todas sus parcelas llevan el mismo tono, y los tonos se reparten para que dos
bloques vecinos nunca repitan color.
"""
import os
import re
import sys
import json
from collections import defaultdict

from shapely.geometry import LineString, Point
from shapely.ops import polylabel, polygonize, unary_union
from shapely.strtree import STRtree

from pdf_geo import leer_capas, mlon, MLAT, simplificar

AQUI = os.path.dirname(os.path.abspath(__file__))
PUBLICO = os.path.normpath(os.path.join(AQUI, '..', 'public'))
SALIDA = os.path.join(PUBLICO, 'parcelas-guaicaramo.geojson')
SALIDA_ETIQ = os.path.join(PUBLICO, 'parcelas-guaicaramo-etiquetas.geojson')

if len(sys.argv) < 2:
    sys.exit('uso: python scripts/pdf-parcelas-a-geojson.py <plano con linderos.pdf> [<plano con rotulos.pdf>]')

figuras, textos = leer_capas(sys.argv[1])
if len(sys.argv) > 2:
    _, textos_rot = leer_capas(sys.argv[2])
    rotulos = textos_rot['PARCELA - Predeterminado']
else:
    rotulos = textos['PARCELA - Predeterminado']

# Tolera "B.344-P8": el plano trae al menos un rotulo sin el punto.
RE_BP = re.compile(r'^B\.(\d+)-P\.?(\d+)')
# Los tonos que pinta el mapa (ver PARCELAS_COLOR en components/MapGL.tsx).
N_TONOS = 6
# El PDF dibuja con vertices cada pocos centimetros en las curvas; medio metro
# de tolerancia es invisible a cualquier zoom y reduce el archivo a la mitad.
TOL_M = 0.5
# Caras mas chicas que esto son astillas entre dos trazos casi superpuestos.
MIN_M2 = 2000
K = mlon(4.45)   # metros por grado de longitud en el predio


def m2(geom):
    return geom.area * K * MLAT


def red(p):
    return [round(p[0], 6), round(p[1], 6)]


def punto_rotulo(poly):
    """El punto mas adentro del poligono (polo de inaccesibilidad): en una
    parcela en L o en media luna el centroide cae afuera."""
    return polylabel(poly, tolerance=0.00001).coords[0]


# --- 1. caras: todos los trazos de PARCELA cortados entre si ---
trazos = [LineString(sp) for it in figuras['PARCELA'] for sp in it['p'] if len(sp) >= 2]
caras = [c for c in polygonize(unary_union(trazos)) if m2(c) > MIN_M2]
arbol = STRtree(caras)
print('caras de mas de %.1f ha: %d' % (MIN_M2 / 1e4, len(caras)))


def cara_en(x, y):
    """La cara mas chica que contiene el punto (las caras no se solapan, pero
    un anillo dibujado dos veces puede dejar una duplicada)."""
    p = Point(x, y)
    hits = [i for i in arbol.query(p) if caras[i].contains(p)]
    return min(hits, key=lambda i: caras[i].area) if hits else None


# --- 2. rotulos por cara ---
frag = defaultdict(list)
sin_cara = []
for lon, lat, txt in rotulos:
    i = cara_en(lon, lat)
    if i is None:
        if RE_BP.match(txt):
            sin_cara.append(txt)
        continue
    frag[i].append((lat, lon, txt.strip()))

# --- 3. bloque de los lotes con nombre propio ---
# Algunos lotes se rotulan por su nombre ("Caimos 1 Limon Tahiti 2019",
# "Chiguiros 2 (R.)") y no por bloque, pero topografia si sabe a que bloque
# pertenecen: cada via del KMZ trae BLOQUE. Se le asigna al lote el bloque que
# tiene la mayoria de los vertices de via que caen adentro, y solo si es
# mayoria clara.
with open(os.path.join(PUBLICO, 'vias-guaicaramo.geojson'), encoding='utf-8') as f:
    VIAS = [(int(v['properties']['BLOQUE']), Point(p))
            for v in json.load(f)['features'] if v['properties'].get('BLOQUE')
            for p in v['geometry']['coordinates']]
arbol_vias = STRtree([p for _, p in VIAS])


def bloque_por_vias(poly):
    votos = defaultdict(int)
    for j in arbol_vias.query(poly):
        if poly.contains(VIAS[j][1]):
            votos[VIAS[j][0]] += 1
    if not votos:
        return None
    b, n = max(votos.items(), key=lambda kv: kv[1])
    return b if n >= 0.6 * sum(votos.values()) else None


# --- 4. una parcela por cara rotulada ---
items = []
varios = []
for i, fs in frag.items():
    # De arriba abajo y de izquierda a derecha: asi se leen los rotulos partidos
    # en varias lineas ("Caimos 3" / "N. Valencia" / "2009").
    fs.sort(key=lambda f: (-f[0], f[1]))
    codigos = []
    for _, _, txt in fs:
        m = RE_BP.match(txt)
        if m and (int(m.group(1)), int(m.group(2))) not in codigos:
            codigos.append((int(m.group(1)), int(m.group(2))))
    cara = caras[i]
    if len(codigos) == 1:
        b, p = codigos[0]
        bloque, texto, cod_bp = b, 'P.%d' % p, 'B.%d-P.%d' % (b, p)
    elif codigos:
        codigos.sort()
        bs = {b for b, _ in codigos}
        bloque = bs.pop() if len(bs) == 1 else None
        if bloque is not None:
            texto = ' / '.join('P.%d' % p for _, p in codigos)
            cod_bp = 'B.%d-%s' % (bloque, texto)
        else:
            texto = cod_bp = ' / '.join('B.%d-P.%d' % c for c in codigos)
        varios.append(cod_bp)
    else:
        nombre = ' '.join(t for _, _, t in fs)
        bloque, texto, cod_bp = bloque_por_vias(cara), nombre, nombre
    items.append({
        'poly': cara,
        'bloque': bloque,
        'cod_bp': cod_bp,
        'texto': texto,
        'varios': len(codigos) > 1,
        'area': m2(cara),
    })

# Un mismo codigo puede quedar en dos caras (parcela partida por una via). Se
# dibujan las dos, pero el rotulo va solo en la mas grande.
por_cod = defaultdict(list)
for it in items:
    por_cod[it['cod_bp']].append(it)
for its in por_cod.values():
    mayor = max(its, key=lambda it: it['area'])
    for it in its:
        it['rotular'] = it is mayor

nombres = [it for it in items if not RE_BP.match(it['cod_bp'])]
print('parcelas: %d (%d codigos distintos)' % (len(items), len(por_cod)))
print('lotes con nombre propio: %d  sin bloque: %s'
      % (len(nombres), sorted(it['cod_bp'] for it in nombres if it['bloque'] is None)))
print('caras con varios codigos (el plano no dibuja el lindero):', sorted(varios))
print('codigos sin cara:', sorted(sin_cara))

# --- 5. tonos: coloreo voraz del grafo de bloques vecinos ---
# Dos bloques son vecinos si alguna de sus parcelas queda a menos de ~60 m de
# la otra (por caja envolvente: basta para decidir colores).
MARGEN = 60.0


def caja(poly):
    x0, y0, x1, y1 = poly.bounds
    dx, dy = MARGEN / K, MARGEN / MLAT
    return (x0 - dx, y0 - dy, x1 + dx, y1 + dy)


cajas_bloque = defaultdict(list)
for it in items:
    if it['bloque'] is not None:
        cajas_bloque[it['bloque']].append(caja(it['poly']))

bloques = sorted(cajas_bloque)
vecinos = defaultdict(set)
for ai, a in enumerate(bloques):
    for b in bloques[ai + 1:]:
        if any(p[0] < q[2] and q[0] < p[2] and p[1] < q[3] and q[1] < p[3]
               for p in cajas_bloque[a] for q in cajas_bloque[b]):
            vecinos[a].add(b)
            vecinos[b].add(a)

tono = {}
# Primero los bloques con mas vecinos: son los que se quedan sin color libre.
for b in sorted(bloques, key=lambda b: -len(vecinos[b])):
    usados = {tono[v] for v in vecinos[b] if v in tono}
    libres = [t for t in range(N_TONOS) if t not in usados]
    # Si un bloque tiene seis vecinos con seis tonos distintos, se repite el
    # menos usado entre ellos; no ha pasado con el plano actual.
    tono[b] = libres[0] if libres else min(range(N_TONOS), key=lambda t: sum(
        1 for v in vecinos[b] if tono.get(v) == t))
choques = sum(1 for b in bloques for v in vecinos[b] if tono[b] == tono[v]) // 2
print('bloques:', len(bloques), ' vecinos con el mismo tono:', choques)

# --- 6. salida ---
feats, etiq = [], []
por_bloque = defaultdict(list)
for it in sorted(items, key=lambda it: it['cod_bp']):
    props = {'cod_bp': it['cod_bp']}
    if it['bloque'] is not None:
        props['bloque'] = it['bloque']
        props['tono'] = tono[it['bloque']]
        por_bloque[it['bloque']].append(it)
    if it['varios']:
        props['varios'] = True
    props['ha'] = round(it['area'] / 1e4, 1)
    anillos = [it['poly'].exterior] + list(it['poly'].interiors)
    feats.append({
        'type': 'Feature',
        'properties': props,
        'geometry': {'type': 'Polygon', 'coordinates': [
            [red(p) for p in simplificar(list(a.coords), TOL_M)] for a in anillos]},
    })
    if it['rotular']:
        etiq.append({
            'type': 'Feature',
            'properties': {'clase': 'parcela', 'texto': it['texto'], 'cod_bp': it['cod_bp']},
            'geometry': {'type': 'Point', 'coordinates': red(punto_rotulo(it['poly']))},
        })

for b, its in sorted(por_bloque.items()):
    # Promedio de los centroides pesado por area: el rotulo cae donde esta el
    # grueso del bloque. Si cae en una via o en una parcela de otro bloque, se
    # lleva adentro de la parcela mas grande del bloque.
    total = sum(it['area'] for it in its)
    c = (sum(it['poly'].centroid.x * it['area'] for it in its) / total,
         sum(it['poly'].centroid.y * it['area'] for it in its) / total)
    if not any(it['poly'].contains(Point(c)) for it in its):
        c = punto_rotulo(max(its, key=lambda it: it['area'])['poly'])
    etiq.append({
        'type': 'Feature',
        'properties': {'clase': 'bloque', 'texto': 'B.%d' % b},
        'geometry': {'type': 'Point', 'coordinates': red(c)},
    })


def escribir(ruta, fs):
    with open(ruta, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': fs}, f,
                  ensure_ascii=False, separators=(',', ':'))


escribir(SALIDA, feats)
escribir(SALIDA_ETIQ, etiq)
print('%d parcelas -> %s' % (len(feats), SALIDA))
print('%d bloques + %d rotulos de parcela -> %s'
      % (len(por_bloque), sum(1 for e in etiq if e['properties']['clase'] == 'parcela'), SALIDA_ETIQ))
