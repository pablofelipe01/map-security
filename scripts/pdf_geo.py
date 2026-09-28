# -*- coding: utf-8 -*-
"""Lector de PDF geoespaciales del Departamento Agronomico de Guaicaramo.

Los planos que publica el SIG de Guaicaramo son PDF geoespaciales: traen un
/Measure /GEO que amarra la pagina a coordenadas y capas de contenido opcional
(OCG) que separan acopios, parcelas, vias y canales. Por eso se pueden leer como
un SIG y no como un dibujo.

    from pdf_geo import leer_capas
    figuras, textos = leer_capas("plano.pdf")

  * figuras: capa -> [{'t': 'S'|'F', 'p': [[(lon, lat), ...], ...]}]
             ('S' trazo, 'F' relleno; 'p' son los subtrazos de la figura)
  * textos:  capa -> [(lon, lat, texto)]; los rotulos de una capa suelen venir
             en su propio OCG, "<capa> - Default" o "<capa> - Predeterminado".

Lo usan scripts/pdf-acopios-a-geojson.py y scripts/pdf-parcelas-a-geojson.py.
"""
import re
import math

import pypdf

# --- tokenizador del flujo de contenido ---
TOK = re.compile(
    rb"(?P<cad>\((?:\\.|[^()\\])*\))"
    rb"|(?P<hex><[0-9A-Fa-f\s]*>)"
    rb"|(?P<dic><<|>>)"
    rb"|(?P<arr>\[|\])"
    rb"|(?P<nom>/[^\s/\[\]<>(){}%]*)"
    rb"|(?P<num>[-+]?(?:\d+\.?\d*|\.\d+))"
    rb"|(?P<op>[A-Za-z'\"*][A-Za-z0-9*'\"]*)"
)

ESCAPES = {'n': '\n', 'r': '', 't': ' ', 'b': '', 'f': ''}
# Las cadenas del PDF traen escapes de control (\n, \() y octales (\050 = "(").
RE_ESC = re.compile(rb"\\([0-7]{1,3}|[nrtbf()\\])")


def _desescapar(g):
    s = g.group(1).decode('latin-1')
    if s[0] in '01234567':
        return bytes([int(s, 8) & 0xFF])
    return ESCAPES.get(s, s).encode('latin-1')


IDENT = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def mul(a, b):
    return (a[0] * b[0] + a[1] * b[2],
            a[0] * b[1] + a[1] * b[3],
            a[2] * b[0] + a[3] * b[2],
            a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4],
            a[4] * b[1] + a[5] * b[3] + b[5])


def aplicar(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def leer_capas(ruta):
    """Lee la primera pagina del PDF y devuelve (figuras, textos) por capa."""
    lector = pypdf.PdfReader(ruta)
    pagina = lector.pages[0]
    datos = pagina['/Contents'].get_object().get_data()

    # --- georreferencia (viewport /Measure /GEO) ---
    vp = pagina['/VP'][0]
    medida = vp['/Measure'].get_object()
    bx = [float(v) for v in vp['/BBox']]
    X0, Y0, X1, Y1 = bx[0], bx[1], bx[2], bx[3]
    gpts = [float(v) for v in medida['/GPTS']]   # lat, lon por esquina
    lpts = [float(v) for v in medida['/LPTS']]   # u, v por esquina
    esquinas = {}
    for i in range(4):
        u, v = lpts[2 * i], lpts[2 * i + 1]
        lat, lon = gpts[2 * i], gpts[2 * i + 1]
        esquinas[(round(u), round(v))] = (lon, lat)
    P00, P10, P01, P11 = esquinas[(0, 0)], esquinas[(1, 0)], esquinas[(0, 1)], esquinas[(1, 1)]


    def a_lonlat(px, py):
        """Coordenada de pagina -> (lon, lat), bilineal entre las 4 esquinas del /VP."""
        u = (px - X0) / (X1 - X0)
        v = (py - Y0) / (Y1 - Y0)
        lon = (1 - u) * (1 - v) * P00[0] + u * (1 - v) * P10[0] + (1 - u) * v * P01[0] + u * v * P11[0]
        lat = (1 - u) * (1 - v) * P00[1] + u * (1 - v) * P10[1] + (1 - u) * v * P01[1] + u * v * P11[1]
        return (round(lon, 7), round(lat, 7))


    # --- nombre de capa por recurso /OCn ---
    props_res = pagina['/Resources'].get_object()['/Properties'].get_object()
    NOMBRE_OC = {k.lstrip('/'): str(props_res[k].get_object().get('/Name')) for k in props_res.keys()}

    ctm = IDENT
    pila_ctm = []
    capas = []        # pila de OCG activos
    pila_mc = []      # marca si cada BDC/BMC abrio una capa
    operandos = []

    figuras = {}      # capa -> [{'t': 'S'|'F', 'p': [[(lon, lat), ...], ...]}]
    textos = {}       # capa -> [(lon, lat, texto)]

    sub, act, inicio = [], [], None
    tm = tlm = IDENT
    tfs = 1.0
    buf_txt, buf_pos = [], None


    def capa_actual():
        return capas[-1] if capas else None


    def cerrar_sub():
        nonlocal sub, act
        if len(act) > 1:
            sub.append(act)
        act = []


    def emitir(tipo):
        nonlocal sub, act
        cerrar_sub()
        c = capa_actual()
        if c and sub:
            figuras.setdefault(c, []).append({'t': tipo, 'p': sub})
        sub, act = [], []


    def punto(x, y):
        return a_lonlat(*aplicar(ctm, x, y))


    for m in TOK.finditer(datos):
        tipo = m.lastgroup
        bruto = m.group()
        if tipo == 'cad':
            operandos.append(('s', bruto[1:-1]))
            continue
        if tipo == 'hex':
            operandos.append(('s', b''))
            continue
        if tipo in ('dic', 'arr'):
            operandos.append(('x', bruto))
            continue
        if tipo == 'nom':
            operandos.append(('n', bruto.decode('latin-1')[1:]))
            continue
        if tipo == 'num':
            operandos.append(('f', float(bruto)))
            continue

        op = bruto.decode('latin-1')
        nums = [o[1] for o in operandos if o[0] == 'f']
        noms = [o[1] for o in operandos if o[0] == 'n']

        if op == 'q':
            pila_ctm.append(ctm)
        elif op == 'Q':
            if pila_ctm:
                ctm = pila_ctm.pop()
        elif op == 'cm' and len(nums) >= 6:
            ctm = mul(tuple(nums[-6:]), ctm)
        elif op == 'BDC':
            if noms and noms[0] == 'OC' and len(noms) > 1:
                capas.append(NOMBRE_OC.get(noms[1], noms[1]))
                pila_mc.append(True)
            else:
                pila_mc.append(False)
        elif op == 'BMC':
            pila_mc.append(False)
        elif op == 'EMC':
            if pila_mc and pila_mc.pop() and capas:
                capas.pop()
        elif op == 'm' and len(nums) >= 2:
            cerrar_sub()
            inicio = (nums[-2], nums[-1])
            act = [punto(*inicio)]
        elif op == 'l' and len(nums) >= 2:
            if act:
                act.append(punto(nums[-2], nums[-1]))
        elif op in ('c', 'v', 'y') and len(nums) >= 4:
            # Las curvas Bezier se aproximan por sus puntos de control: a esta escala
            # la diferencia es muy inferior al ancho del trazo.
            pts = nums[-6:] if op == 'c' else nums[-4:]
            if act:
                for i in range(0, len(pts) - 1, 2):
                    act.append(punto(pts[i], pts[i + 1]))
        elif op == 'h':
            if act and inicio:
                act.append(punto(*inicio))
        elif op == 're' and len(nums) >= 4:
            cerrar_sub()
            x, y, w, h = nums[-4:]
            act = [punto(x, y), punto(x + w, y), punto(x + w, y + h), punto(x, y + h), punto(x, y)]
            cerrar_sub()
        elif op in ('S', 's'):
            if op == 's' and act and inicio:
                act.append(punto(*inicio))
            emitir('S')
        elif op in ('f', 'F', 'f*', 'B', 'B*', 'b', 'b*'):
            emitir('F')
        elif op == 'n':
            sub, act = [], []
        elif op == 'BT':
            tm = tlm = IDENT
            buf_txt, buf_pos = [], None
        elif op == 'Tf' and nums:
            tfs = nums[-1]
        elif op == 'Tm' and len(nums) >= 6:
            tm = tlm = tuple(nums[-6:])
            if buf_pos is None:
                buf_pos = aplicar(mul(tm, ctm), 0, 0)
        elif op in ('Td', 'TD') and len(nums) >= 2:
            tm = tlm = mul((1, 0, 0, 1, nums[-2], nums[-1]), tlm)
        elif op == 'T*':
            tm = tlm = mul((1, 0, 0, 1, 0, -tfs), tlm)
        elif op in ('Tj', 'TJ', "'", '"'):
            for o in operandos:
                if o[0] == 's':
                    buf_txt.append(RE_ESC.sub(_desescapar, o[1]).decode('latin-1'))
            if buf_pos is None:
                buf_pos = aplicar(mul(tm, ctm), 0, 0)
        elif op == 'ET':
            c = capa_actual()
            if c and buf_txt and buf_pos:
                s = ''.join(buf_txt).strip()
                if s:
                    lon, lat = a_lonlat(*buf_pos)
                    textos.setdefault(c, []).append((lon, lat, s))
            buf_txt, buf_pos = [], None

        operandos = []

    return figuras, textos


# ============================ geometria en metros ============================

MLAT = 110540.0


def mlon(lat):
    return 111320.0 * math.cos(math.radians(lat))


def dist_m(a, b):
    return math.hypot((a[0] - b[0]) * mlon(a[1]), (a[1] - b[1]) * MLAT)


def centro(anillo):
    return (sum(p[0] for p in anillo) / len(anillo), sum(p[1] for p in anillo) / len(anillo))


def area_m2(r):
    k = mlon(sum(p[1] for p in r) / len(r))
    a = 0.0
    for i in range(len(r) - 1):
        a += r[i][0] * k * r[i + 1][1] * MLAT - r[i + 1][0] * k * r[i][1] * MLAT
    return abs(a) / 2


def dentro(pt, anillo):
    x, y = pt
    dent = False
    n = len(anillo)
    j = n - 1
    for i in range(n):
        xi, yi = anillo[i]
        xj, yj = anillo[j]
        if (yi > y) != (yj > y):
            if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                dent = not dent
        j = i
    return dent


def simplificar(linea, tol_m):
    """Douglas-Peucker con tolerancia en metros. Conserva siempre los extremos,
    asi que un anillo cerrado sigue cerrado."""
    if len(linea) < 3:
        return list(linea)
    k = mlon(linea[0][1])
    xy = [(p[0] * k, p[1] * MLAT) for p in linea]
    marca = [False] * len(linea)
    marca[0] = marca[-1] = True
    pila = [(0, len(linea) - 1)]
    while pila:
        a, b = pila.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        largo = math.hypot(dx, dy)
        peor, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            if largo:
                d = abs(dy * (px - ax) - dx * (py - ay)) / largo
            else:
                d = math.hypot(px - ax, py - ay)
            if d > peor:
                peor, idx = d, i
        if idx > 0 and peor > tol_m:
            marca[idx] = True
            pila += [(a, idx), (idx, b)]
    return [p for p, m in zip(linea, marca) if m]


# ================= parcelas: anillo cerrado + codigo B.x-P.y =================

RE_COD = re.compile(r'^B\.\d+-P\.\d+$')


def parcelas_con_codigo(figuras, textos):
    """Anillos de la capa PARCELA y el codigo de cada uno.

    Devuelve (parcelas, cod_parcela, parcela_en):
      * parcelas: lista de anillos cerrados de mas de 0.2 ha, en (lon, lat).
      * cod_parcela: indice de anillo -> rotulo ("B.6-P.4", a veces con sufijo
        como "B.6-P.4 (R.)"). Los anillos sin rotulo dentro no aparecen.
      * parcela_en(pt): indice del anillo que contiene el punto (el mas pequeno
        si hay varios), o None.

    El rotulo de la parcela vive en otra capa ("PARCELA - Predeterminado"), sin
    vinculo con el anillo: se empareja por que caiga adentro.
    """
    parcelas = [sp for it in figuras['PARCELA'] for sp in it['p']
                if len(sp) > 3 and sp[0] == sp[-1] and area_m2(sp) > 2000]
    print('parcelas cerradas > 0.2 ha:', len(parcelas))

    CEL = 0.004
    rej = {}
    for idx, an in enumerate(parcelas):
        xs = [p[0] for p in an]
        ys = [p[1] for p in an]
        for cx in range(int(min(xs) / CEL), int(max(xs) / CEL) + 1):
            for cy in range(int(min(ys) / CEL), int(max(ys) / CEL) + 1):
                rej.setdefault((cx, cy), []).append(idx)

    def parcela_en(pt):
        """Indice de la parcela que contiene el punto; la mas pequena si hay varias."""
        hits = [i for i in rej.get((int(pt[0] / CEL), int(pt[1] / CEL)), ()) if dentro(pt, parcelas[i])]
        return min(hits, key=lambda i: area_m2(parcelas[i])) if hits else None

    frag = {}
    for lon, lat, txt in textos['PARCELA - Predeterminado']:
        i = parcela_en((lon, lat))
        if i is not None:
            frag.setdefault(i, []).append((lat, lon, txt))

    cod_parcela = {}
    for i, fs in frag.items():
        # Un rotulo puede venir partido en varias lineas ("B.6-P.4" y "(R.)"), pero a
        # veces tambien cae dentro del anillo el rotulo del lote vecino. Si hay mas
        # de un codigo completo, manda el mas cercano al centro del lote.
        codigos = [f for f in fs if RE_COD.match(f[2])]
        if len(codigos) > 1:
            c = centro(parcelas[i])
            elegido = min(codigos, key=lambda f: dist_m((f[1], f[0]), c))
            fs = [f for f in fs if f is elegido or not RE_COD.match(f[2])]
        cod_parcela[i] = ' '.join(f[2] for f in sorted(fs, key=lambda f: (-f[0], f[1]))).strip()
    print('parcelas con codigo:', len(cod_parcela))

    return parcelas, cod_parcela, parcela_en
