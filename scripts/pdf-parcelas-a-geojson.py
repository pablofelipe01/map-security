# -*- coding: utf-8 -*-
"""Convierte las parcelas del plano de acopios (PDF geoespacial) en dos GeoJSON:

    pip install pypdf   (lo usa scripts/pdf_geo.py)
    python scripts/pdf-parcelas-a-geojson.py "Acopios Guaicaramo 2026.pdf"

  * public/parcelas-guaicaramo.geojson: un poligono por parcela, con su codigo
    (B.10-P.9), su bloque y un `tono` 0..5 para pintarla.
  * public/parcelas-guaicaramo-etiquetas.geojson: un punto por parcela y uno por
    bloque, con el mismo esquema que antes salia del KMZ de vias (clase, texto,
    cod_bp), asi que las capas de rotulos del mapa no cambian.

Por que del PDF y no del KMZ: el KMZ de topografia solo trae vias. El plano de
acopios trae la capa PARCELA con los linderos reales, y su rotulo en otra capa;
el emparejamiento anillo-rotulo es el mismo que usa el script de acopios y vive
en scripts/pdf_geo.py.

No hay poligono de bloque en ningun plano. Tampoco se puede disolver uno a
partir de las parcelas: entre parcela y parcela pasa una via o un canal, asi que
los linderos no comparten vertices. El bloque se lee en el mapa porque todas sus
parcelas llevan el mismo tono, y los tonos se reparten para que dos bloques
vecinos nunca repitan color.

Los ~80 anillos sin rotulo adentro (casi todos de menos de 1 ha: islas, zonas
sin sembrar) se dejan por fuera: una parcela sin codigo no se puede nombrar, y
nombrarla es para lo que existe la capa.
"""
import os
import re
import sys
import json
from collections import defaultdict

from pdf_geo import (leer_capas, parcelas_con_codigo, area_m2, dentro, mlon,
                     MLAT, simplificar)

AQUI = os.path.dirname(os.path.abspath(__file__))
PUBLICO = os.path.normpath(os.path.join(AQUI, '..', 'public'))
SALIDA = os.path.join(PUBLICO, 'parcelas-guaicaramo.geojson')
SALIDA_ETIQ = os.path.join(PUBLICO, 'parcelas-guaicaramo-etiquetas.geojson')

if len(sys.argv) < 2:
    sys.exit('uso: python scripts/pdf-parcelas-a-geojson.py <plano.pdf>')

figuras, textos = leer_capas(sys.argv[1])
parcelas, cod_parcela, _ = parcelas_con_codigo(figuras, textos)

# Tolera "B.344-P8": el plano trae al menos un rotulo sin el punto.
RE_BP = re.compile(r'^B\.(\d+)-P\.?(\d+)')
# Los tonos que pinta el mapa (ver PARCELAS_COLOR en components/MapGL.tsx).
N_TONOS = 6
# El PDF dibuja con vertices cada pocos centimetros en las curvas; medio metro
# de tolerancia es invisible a cualquier zoom y reduce el archivo a la mitad.
TOL_M = 0.5


def centroide(r):
    """Centroide de area del anillo (lon, lat)."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(r, r[1:]):
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if not a:
        return (sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r))
    return (cx / (3 * a), cy / (3 * a))


def punto_interior(r):
    """Donde va el rotulo: el centroide si cae adentro; si no (parcela en L o
    en media luna), el centro del tramo interior mas ancho a esa latitud."""
    c = centroide(r)
    if dentro(c, r):
        return c
    y = c[1]
    cortes = sorted(
        x0 + (y - y0) * (x1 - x0) / (y1 - y0)
        for (x0, y0), (x1, y1) in zip(r, r[1:])
        if (y0 > y) != (y1 > y)
    )
    tramos = list(zip(cortes[0::2], cortes[1::2]))
    if not tramos:
        return c
    a, b = max(tramos, key=lambda t: t[1] - t[0])
    return ((a + b) / 2, y)


def red(p):
    return [round(p[0], 6), round(p[1], 6)]


# --- bloque de los lotes con nombre propio ---
# El plano rotula algunos lotes por su nombre ("Caimos 1 Limon Tahiti 2019",
# "Chiguiros 2 (R.)") y no por bloque, pero topografia si sabe a que bloque
# pertenecen: cada via del KMZ trae BLOQUE. Se le asigna al lote el bloque que
# tiene la mayoria de las vias que lo cruzan, y solo si es mayoria clara.
with open(os.path.join(PUBLICO, 'vias-guaicaramo.geojson'), encoding='utf-8') as f:
    VIAS = [(v['properties'].get('BLOQUE'), v['geometry']['coordinates'])
            for v in json.load(f)['features'] if v['properties'].get('BLOQUE')]


def bloque_por_vias(anillo):
    xs = [p[0] for p in anillo]
    ys = [p[1] for p in anillo]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    votos = defaultdict(int)
    for b, coords in VIAS:
        for p in coords:
            if x0 <= p[0] <= x1 and y0 <= p[1] <= y1 and dentro(p, anillo):
                votos[b] += 1
    if not votos:
        return None
    b, n = max(votos.items(), key=lambda kv: kv[1])
    return int(b) if n >= 0.6 * sum(votos.values()) else None


# --- parcelas con su bloque ---
items = []
for i, rotulo in cod_parcela.items():
    m = RE_BP.match(rotulo)
    anillo = parcelas[i]
    if m:
        bloque, parcela = int(m.group(1)), 'P.' + m.group(2)
        cod_bp = 'B.%d-%s' % (bloque, parcela)
    else:
        bloque, parcela, cod_bp = bloque_por_vias(anillo), rotulo, rotulo
    items.append({
        'anillo': anillo,
        'bloque': bloque,
        'cod_bp': cod_bp,
        'texto': parcela,
        'area': area_m2(anillo),
    })
print('lotes con nombre propio:', sum(1 for it in items if it['cod_bp'] == it['texto']),
      ' sin bloque:', sorted(it['cod_bp'] for it in items if it['bloque'] is None))

# --- tonos: coloreo voraz del grafo de bloques vecinos ---
# Dos bloques son vecinos si alguna de sus parcelas queda a menos de ~60 m de
# la otra (por caja envolvente: basta para decidir colores).
MARGEN = 60.0


def caja(r):
    xs = [p[0] for p in r]
    ys = [p[1] for p in r]
    dx = MARGEN / mlon(ys[0])
    dy = MARGEN / MLAT
    return (min(xs) - dx, min(ys) - dy, max(xs) + dx, max(ys) + dy)


cajas_bloque = defaultdict(list)
for it in items:
    if it['bloque'] is not None:
        cajas_bloque[it['bloque']].append(caja(it['anillo']))

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

# --- salida ---
feats, etiq = [], []
por_bloque = defaultdict(list)
for it in sorted(items, key=lambda it: it['cod_bp']):
    props = {'cod_bp': it['cod_bp']}
    if it['bloque'] is not None:
        props['bloque'] = it['bloque']
        props['tono'] = tono[it['bloque']]
        por_bloque[it['bloque']].append(it)
    props['ha'] = round(it['area'] / 1e4, 1)
    feats.append({
        'type': 'Feature',
        'properties': props,
        'geometry': {'type': 'Polygon',
                     'coordinates': [[red(p) for p in simplificar(it['anillo'], TOL_M)]]},
    })
    etiq.append({
        'type': 'Feature',
        'properties': {'clase': 'parcela', 'texto': it['texto'], 'cod_bp': it['cod_bp']},
        'geometry': {'type': 'Point', 'coordinates': red(punto_interior(it['anillo']))},
    })

for b, its in sorted(por_bloque.items()):
    # Promedio de los centroides pesado por area: el rotulo cae donde esta el
    # grueso del bloque. Si cae en una via o en una parcela de otro bloque, se
    # lleva adentro de la parcela mas grande del bloque.
    total = sum(it['area'] for it in its)
    cs = [(centroide(it['anillo']), it['area']) for it in its]
    c = (sum(p[0] * w for p, w in cs) / total, sum(p[1] * w for p, w in cs) / total)
    if not any(dentro(c, it['anillo']) for it in its):
        c = punto_interior(max(its, key=lambda it: it['area'])['anillo'])
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
print('%d bloques + %d parcelas -> %s' % (len(por_bloque), len(feats), SALIDA_ETIQ))
