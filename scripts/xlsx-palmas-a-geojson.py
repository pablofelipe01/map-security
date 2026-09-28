# -*- coding: utf-8 -*-
"""Convierte los censos de palma por bloque (Excel) en public/palmas/<bloque>.geojson.

    pip install openpyxl
    python scripts/xlsx-palmas-a-geojson.py "LINEA - PALMA BLOQUE 7.xlsx" "LINEA-PALMA BLOQUE 6.xlsx" ...

Cada Excel trae UNA FILA POR PALMA: ID_LINEA ("7-1-104" = bloque 7, parcela 1,
linea 104), CONSE_PL (posicion de la palma dentro de la linea) y su coordenada
en LATITUD/LONGITUD como grados-minutos-segundos. Una linea de palma es la
polilinea que une sus palmas en orden de CONSE_PL.

Se leen LATITUD/LONGITUD y no POINT_X/POINT_Y porque el Excel no dice en que
origen estan las planas (MAGNA-SIRGAS Bogota, por los valores), y el segundo con
tres decimales ya es ~3 cm: de sobra para una capa de fondo.

Escribe un archivo por bloque (el mapa sólo baja el bloque que se elige en el
control de capas) y reescribe sólo los bloques que vienen en los Excel dados.
Después hay que rehacer el índice que lee el mapa:

    node scripts/kmz-palmas-a-geojson.mjs --indice

Los bloques que llegan en KMZ (p. ej. el 9) salen de ese mismo script.
"""
import os
import re
import sys
import json
from collections import defaultdict

import openpyxl

from pdf_geo import simplificar

AQUI = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.normpath(os.path.join(AQUI, '..', 'public', 'palmas'))

if len(sys.argv) < 2:
    sys.exit('uso: python scripts/xlsx-palmas-a-geojson.py <bloque.xlsx> [<bloque.xlsx> ...]')

# 4° 28' 30.382" N  /  72°59' 51.387" O. El símbolo de grado llega con cualquier
# codificación (el Excel lo guarda mal), así que se leen sólo los tres números y
# el hemisferio.
RE_DMS = re.compile(r'(\d+)\D+(\d+)\D+([\d.]+)\D*([NSEOW])', re.I)
# Las palmas van a ~9 m en triángulo: una línea es casi recta. Con 0.3 m de
# tolerancia queda en 2-4 vértices y no se ve la diferencia a ningún zoom.
TOL_M = 0.3


def grados(s):
    m = RE_DMS.search(str(s or ''))
    if not m:
        return None
    g = int(m.group(1)) + int(m.group(2)) / 60 + float(m.group(3)) / 3600
    return -g if m.group(4).upper() in 'SOW' else g


lineas = defaultdict(list)   # ID_LINEA -> [(conse, lon, lat)]
malas = 0
for ruta in sys.argv[1:]:
    hoja = openpyxl.load_workbook(ruta, read_only=True, data_only=True).worksheets[0]
    filas = hoja.iter_rows(values_only=True)
    col = {str(c).strip(): i for i, c in enumerate(next(filas)) if c}
    n = 0
    for f in filas:
        lat, lon = grados(f[col['LATITUD']]), grados(f[col['LONGITUD']])
        id_linea, conse = f[col['ID_LINEA']], f[col['CONSE_PL']]
        if lat is None or lon is None or not id_linea or conse is None:
            malas += 1
            continue
        lineas[str(id_linea)].append((int(conse), lon, lat))
        n += 1
    print('%-36s %6d palmas' % (os.path.basename(ruta), n))

feats = defaultdict(list)   # bloque -> features
for id_linea, palmas in sorted(lineas.items()):
    # Un mismo censo puede repetir una palma (dos Excel del mismo bloque, o una
    # fila duplicada): se queda la primera de cada posición.
    vistas = {}
    for c, lon, lat in sorted(palmas):
        vistas.setdefault(c, (lon, lat))
    pts = list(vistas.values())
    if len(pts) < 2:
        continue
    bloque, parcela = id_linea.split('-')[:2]
    feats[bloque].append({
        'type': 'Feature',
        # Solo lo que el mapa usa: cada propiedad de mas se paga en cada línea.
        'properties': {'linea': id_linea, 'parcela': bloque + '-' + parcela, 'palmas': len(pts)},
        'geometry': {
            'type': 'LineString',
            'coordinates': [[round(x, 6), round(y, 6)] for x, y in simplificar(pts, TOL_M)],
        },
    })

os.makedirs(DIR, exist_ok=True)
for bloque, fs in sorted(feats.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 0):
    salida = os.path.join(DIR, bloque + '.geojson')
    with open(salida, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': fs}, f,
                  ensure_ascii=False, separators=(',', ':'))
    print('bloque %-4s %5d líneas -> %s' % (bloque, len(fs), salida))
print('filas descartadas (sin coordenada o sin línea):', malas)
print('Falta el índice: node scripts/kmz-palmas-a-geojson.mjs --indice')
