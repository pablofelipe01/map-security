# -*- coding: utf-8 -*-
"""Convierte los censos de palma por bloque (Excel) en public/palmas-lineas-guaicaramo.geojson.

    pip install openpyxl
    python scripts/xlsx-palmas-a-geojson.py "LINEA - PALMA BLOQUE 7.xlsx" "LINEA-PALMA BLOQUE 6.xlsx" ...

Cada Excel trae UNA FILA POR PALMA: ID_LINEA ("7-1-104" = bloque 7, parcela 1,
linea 104), CONSE_PL (posicion de la palma dentro de la linea) y su coordenada
en LATITUD/LONGITUD como grados-minutos-segundos. Una linea de palma es la
polilinea que une sus palmas en orden de CONSE_PL.

Se leen LATITUD/LONGITUD y no POINT_X/POINT_Y porque el Excel no dice en que
origen estan las planas (MAGNA-SIRGAS Bogota, por los valores), y el segundo con
tres decimales ya es ~3 cm: de sobra para una capa de fondo.

Solo hay censo para algunos bloques (6, 7, 19 y 231 al escribir esto). Los
bloques que no tengan Excel simplemente no tienen lineas en el mapa; cuando el
Departamento Agronomico mande otro, se agrega a la lista de argumentos y se
vuelve a correr con TODOS los Excel (el archivo se reescribe entero).
"""
import os
import re
import sys
import json
from collections import defaultdict

import openpyxl

from pdf_geo import simplificar

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.normpath(os.path.join(AQUI, '..', 'public', 'palmas-lineas-guaicaramo.geojson'))

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

feats = []
por_bloque = defaultdict(int)
for id_linea, palmas in sorted(lineas.items()):
    # Un mismo censo puede repetir una palma (dos Excel del mismo bloque, o una
    # fila duplicada): se queda la primera de cada posición.
    vistas = {}
    for c, lon, lat in sorted(palmas):
        vistas.setdefault(c, (lon, lat))
    pts = list(vistas.values())
    if len(pts) < 2:
        continue
    por_bloque[id_linea.split('-')[0]] += 1
    feats.append({
        'type': 'Feature',
        # Solo lo que el mapa usa: son ~6.000 lineas y cada propiedad de mas se
        # paga 6.000 veces. Bloque y parcela salen del propio ID_LINEA.
        'properties': {'linea': id_linea, 'palmas': len(pts)},
        'geometry': {
            'type': 'LineString',
            'coordinates': [[round(x, 6), round(y, 6)] for x, y in simplificar(pts, TOL_M)],
        },
    })

with open(SALIDA, 'w', encoding='utf-8') as f:
    json.dump({'type': 'FeatureCollection', 'features': feats}, f,
              ensure_ascii=False, separators=(',', ':'))
print('filas descartadas (sin coordenada o sin línea):', malas)
print('líneas por bloque:', dict(sorted(por_bloque.items(), key=lambda kv: int(kv[0]))))
print('%d líneas -> %s' % (len(feats), SALIDA))
