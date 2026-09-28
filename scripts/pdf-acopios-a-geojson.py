# -*- coding: utf-8 -*-
"""Convierte el plano de acopios (PDF geoespacial) en public/acopios-guaicaramo.geojson.

    pip install pypdf   (lo usa scripts/pdf_geo.py)
    python scripts/pdf-acopios-a-geojson.py "Acopios Guaicaramo 2026.pdf"

El plano lo publica el Departamento Agronomico de Guaicaramo. Es un PDF
geoespacial: trae un /Measure /GEO que amarra la pagina a coordenadas y capas de
contenido opcional (OCG) que separan acopios, parcelas, vias y canales. Por eso
se puede leer como un SIG y no como un dibujo.

Dos detalles del plano explican casi todo el codigo:

  * Cada acopio es un simbolo de tamano fijo -un anillo de ~18 vertices, siempre
    la misma area- y no un poligono real. El dato es su centro.
  * El numero del acopio vive en otra capa (la de rotulos), sin ningun vinculo
    con el simbolo. Hay que volver a emparejarlos por cercania.

Control de calidad: contra public/vias-guaicaramo.geojson -que sale del KMZ de
topografia, una fuente independiente- las vias extraidas de este PDF caen a 1.0 m
de mediana. La georreferencia esta bien.
"""
import os
import re
import sys
import json
from collections import Counter

from pdf_geo import leer_capas, parcelas_con_codigo, dist_m, centro

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.normpath(os.path.join(AQUI, '..', 'public', 'acopios-guaicaramo.geojson'))

if len(sys.argv) < 2:
    sys.exit('uso: python scripts/pdf-acopios-a-geojson.py <plano.pdf>')
PDF = sys.argv[1]

# ======================== 1. leer el PDF por capas ========================

figuras, textos = leer_capas(PDF)
for k in sorted(figuras, key=lambda k: -len(figuras[k])):
    print('capa %-24s %5d figuras %5d rotulos' % (k, len(figuras[k]), len(textos.get(k + ' - Default', textos.get(k, ())))))

# ============== 2. armar los acopios como puntos con numero ==============

# --- parcelas: se usan sólo para decirle a cada acopio en qué lote cae ---
parcelas, cod_parcela, parcela_en = parcelas_con_codigo(figuras, textos)

RE_BP = re.compile(r'^B\.(\d+)-P\.(\d+)')

# --- acopios ---
puntos = [centro(max(it['p'], key=len)) for it in figuras['Acopios (39)']]
rotulos = textos['Acopios (39) - Default']
print('acopios:', len(puntos), ' rotulos:', len(rotulos))

CELR = 0.002
rej_pt = {}
for i, p in enumerate(puntos):
    rej_pt.setdefault((int(p[0] / CELR), int(p[1] / CELR)), []).append(i)

# Emparejamiento codicioso por cercania: se resuelven primero los pares mas
# proximos, de modo que un rotulo ambiguo entre dos simbolos se quede con el que
# no tenga mejor candidato.
pares = []
for ri, (lon, lat, t) in enumerate(rotulos):
    cx, cy = int(lon / CELR), int(lat / CELR)
    mejor = None
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            for i in rej_pt.get((cx + a, cy + b), ()):
                dd = dist_m((lon, lat), puntos[i])
                if mejor is None or dd < mejor[0]:
                    mejor = (dd, i)
    if mejor:
        pares.append((mejor[0], ri, mejor[1]))
pares.sort()

num_de = {}
usado = set()
for dd, ri, pi in pares:
    if pi in num_de or ri in usado:
        continue
    num_de[pi] = rotulos[ri][2]
    usado.add(ri)
print('acopios con numero:', len(num_de))

feats = []
for i, p in enumerate(puntos):
    pi = parcela_en(p)
    lote = cod_parcela.get(pi) if pi is not None else None
    # Las claves sin valor se omiten en vez de escribirse como null: en MapLibre
    # `["has", "num"]` es cierto para una clave presente aunque valga null, y el
    # rotulo saldria vacio.
    props = {}
    if num_de.get(i):
        props['num'] = num_de[i]
    if lote:
        props['lote'] = lote
        m = RE_BP.match(lote)
        if m:
            props['bloque'] = 'B.' + m.group(1)
    feats.append({
        'type': 'Feature',
        'properties': props,
        'geometry': {'type': 'Point', 'coordinates': [round(p[0], 6), round(p[1], 6)]},
    })

with open(SALIDA, 'w', encoding='utf-8') as f:
    json.dump({'type': 'FeatureCollection', 'features': feats}, f,
              ensure_ascii=False, separators=(',', ':'))
print('escrito', SALIDA)

# Control: el numero de acopio se repite entre lotes, pero dentro de un mismo
# lote tiene que ser unico. Si esto crece, el emparejamiento se desalineo.
dup = Counter()
for ft in feats:
    pr = ft['properties']
    if pr.get('num') and pr.get('lote'):
        dup[(pr['lote'], pr['num'])] += 1
print('pares (lote, num) repetidos:', sum(1 for v in dup.values() if v > 1))
