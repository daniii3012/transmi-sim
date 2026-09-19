"""Velocidad de marcha y tiempo detenido, medidos trecho a trecho sobre el corredor troncal.

El simulador rodaba a un crucero único y gastaba el tiempo sobrante del horario quedándose quieto.
Eso dejaba a la mitad de la flota parada en cualquier instante, contra el 28 % que se observa en el
las lecturas, y ponía la espera donde no está: en los últimos 440 m antes de la estación.

La captura dice dónde se pierde el tiempo de verdad, y dice que el lugar manda sobre todo lo demás:

  * La velocidad media de un trecho de 110 m va de 10 a 44 km/h entre el percentil 10 y el 90. Cuatro
    veces de diferencia según dónde esté el bus.
  * El mismo trecho, a distintas horas de la tarde del sábado, varía entre 0,97 y 1,06 de su propia
    media. La hora casi no mueve nada dentro de la ventana medida.
  * Tener seis buses cerca, comparando cada trecho consigo mismo, cuesta un 8 %. La correlación
    fuerte que se ve al mezclar trechos —de 31 a 16 km/h— es de composición: los sitios con muchos
    buses son los sitios lentos, no al revés.

Así que el campo se indexa por lugar: corredor, sentido y cubeta de 100 m. Cada cubeta guarda a qué
velocidad se rueda ahí y qué parte del tiempo se está quieto ahí. El motor toma de aquí la forma del
movimiento y sigue tomando del horario publicado el total, de modo que ninguna llegada se mueve.

Una distinción que hay que hacer en el origen. Un bus quieto en una estación puede estarlo por dos
razones muy distintas: está atendiendo pasajeros, o está atascado. La diferencia importa porque el
simulador ya modela la atención aparte, y porque un servicio expreso que cruza esa estación sin parar
no debe heredar la atención de los locales —haciéndolo, un expreso de 15 km acumulaba 19 minutos de
espera que no son suyos—. Las lecturas traen la parada a la que cada vehículo se dirige: si está
quieto a menos de ATENCION_M de ella, es atención y se contabiliza aparte de `stop_share`, que queda
reservado a lo que de verdad detiene a cualquiera que pase por ahí.

Un día con el corredor bloqueado no describe ese corredor: describe ese día. Por eso `--exclude`
aparta jornadas enteras y deja escrito en la salida el motivo —una manifestación dejó la Calle 80 a
8,4 km/h con el 60 % del tiempo detenido, contra los 23 km/h y 17 % del resto de las lecturas—.

Lo que esto no es. No es un aforo de tráfico ni una medida de congestión por hora: son las jornadas
que se listan en la salida, aplicadas a todas las horas y tipos de día. El reparto entre rodar y estar
quieto arrastra además el sesgo conocido de las lecturas de posición —un vehículo que no refresca repite posición
y parece detenido—, que infla `stop_share` y la cola alta de `v_roll_kmh`; la velocidad de travesía,
que es distancia sobre tiempo, no se ve afectada. Las suposiciones vigentes van escritas en la
cabecera del propio archivo para que se vean sin abrir esta herramienta.

Necesita el Python geográfico (shapely/pyproj), como build_services.py.
"""
import argparse
import csv
import gzip
import hashlib
import json
import math
import re
from collections import defaultdict
from pathlib import Path

from geo import PROJECT

ROOT = Path(__file__).resolve().parents[1]
CAPTURA = ROOT / 'data/raw/rt_capture'
SERVICIOS = ROOT / 'app/dist/services.json'
SALIDA = ROOT / 'data/curated/speed_field.json'
TRONCAL = '1'

CUBETA = 100          # metros de cada trecho del campo
ENGANCHE = 25         # distancia máxima al eje del corredor para aceptar una lectura
REJILLA = 250         # celda del índice espacial
PASO_MAX = 60         # segundos entre dos lecturas del mismo bus
SALTO_MAX = 1500      # metros entre dos lecturas; por encima es error de posición
QUIETO_KMH = 2        # por debajo de esto la lectura cuenta como detenido
ATENCION_M = 60       # quieto a menos de esto de su parada destino es atención
ESTACION_M = 120      # quieto a esta distancia de cualquier estación es andén, no corredor
SEMAFORO_M = 45       # quieto a esta distancia de un semáforo corroborado es el rojo, no el corredor
MINIMO_OBSERVADO = 300    # segundos medidos para usar una cubeta tal cual
MINIMO_SUAVIZADO = 60     # segundos para promediarla con sus vecinas
VECINAS = 2               # cubetas a cada lado al suavizar


def corredores(servicios):
    """Ejes troncales partidos en segmentos con su abscisa acumulada."""
    ejes = []
    for corredor in servicios['corridors']:
        if corredor['kind'] != 'trunk':
            continue
        for indice, linea in enumerate(corredor['components']):
            segmentos, acumulado = [], 0.0
            for (x1, y1), (x2, y2) in zip(linea, linea[1:]):
                largo = math.hypot(x2 - x1, y2 - y1)
                if largo > 0:
                    segmentos.append((x1, y1, x2, y2, largo, acumulado))
                    acumulado += largo
            if segmentos:
                ejes.append({'id': f"{corredor['id']}:{indice}", 'corridor': corredor['id'],
                             'name': corredor['name'], 'zone': corredor['zone'],
                             'length': acumulado, 'segments': segmentos})
    return ejes


def indice(ejes):
    """Celdas de REJILLA metros -> segmentos que las tocan. Un enganche mira nueve celdas."""
    malla = defaultdict(list)
    for eje in ejes:
        for segmento in eje['segments']:
            x1, y1, x2, y2 = segmento[:4]
            for paso in range(int(segmento[4] // REJILLA) + 2):
                t = min(1.0, paso * REJILLA / segmento[4])
                celda = (int((x1 + (x2 - x1) * t) // REJILLA), int((y1 + (y2 - y1) * t) // REJILLA))
                if (eje['id'], segmento) not in malla[celda]:
                    malla[celda].append((eje['id'], segmento))
    return malla


def enganchar(malla, x, y):
    """(eje, abscisa) del punto más cercano del corredor, o None si está a más de ENGANCHE."""
    mejor, mejor_d2 = None, ENGANCHE * ENGANCHE
    cx, cy = int(x // REJILLA), int(y // REJILLA)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for eje, (x1, y1, x2, y2, largo, base) in malla.get((cx + dx, cy + dy), ()):
                t = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (largo * largo)
                t = 0.0 if t < 0 else 1.0 if t > 1 else t
                px, py = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
                d2 = (x - px) ** 2 + (y - py) ** 2
                if d2 < mejor_d2:
                    mejor, mejor_d2 = (eje, base + largo * t), d2
    return mejor


def repartir(desde, hasta, distancia, tiempo):
    """Distribuye distancia y tiempo entre las cubetas que el bus atravesó, a prorrata."""
    bajo, alto = (desde, hasta) if desde <= hasta else (hasta, desde)
    primera, ultima = int(bajo // CUBETA), int(alto // CUBETA)
    if primera == ultima:
        return [(primera, distancia, tiempo)]
    tramo = alto - bajo
    partes = []
    for cubeta in range(primera, ultima + 1):
        inicio, fin = max(bajo, cubeta * CUBETA), min(alto, (cubeta + 1) * CUBETA)
        parte = (fin - inicio) / tramo
        partes.append((cubeta, distancia * parte, tiempo * parte))
    return partes


def paraderos(ruta):
    """{stop_id: (x, y)} del GTFS publicado, proyectado al marco del simulador."""
    if not ruta or not ruta.exists():
        return {}
    salida = {}
    with ruta.open(encoding='utf-8-sig') as entrada:
        for fila in csv.DictReader(entrada):
            try:
                salida[fila['stop_id']] = PROJECT.transform(float(fila['stop_lon']), float(fila['stop_lat']))
            except (KeyError, TypeError, ValueError):
                continue
    return salida


def lecturas(carpeta, rutas, excluidos=()):
    """{bus: [(sello, x, y, parada)]} de los vehículos troncales, ya proyectados a metros."""
    por_bus = defaultdict(list)
    archivos = []
    for archivo in sorted(carpeta.glob('rt_detalle_*.csv.gz')):
        fecha = re.search(r'(\d{8})', archivo.name)
        if fecha and fecha.group(1) in excluidos:
            continue
        archivos.append(archivo.name)
        with gzip.open(archivo, 'rt', encoding='utf-8', newline='') as entrada:
            for fila in csv.DictReader(entrada):
                if rutas.get(fila['ruta']) != TRONCAL or not fila['lat']:
                    continue
                x, y = PROJECT.transform(float(fila['lon']), float(fila['lat']))
                por_bus[fila['bus']].append((int(fila['build']), x, y, fila.get('parada') or ''))
    for v in por_bus.values():
        v.sort()
    return por_bus, archivos


def semaforos(ruta):
    """[(x, y)] de los semáforos corroborados, en el mismo marco métrico."""
    if not ruta or not ruta.exists():
        return []
    return [tuple(s['xy']) for s in json.loads(ruta.read_text()).get('signals', []) if s.get('xy')]


def cerca_de(puntos, x, y, radio):
    return any(abs(px - x) <= radio and abs(py - y) <= radio and math.hypot(px - x, py - y) <= radio
               for px, py in puntos)


def estaciones(servicios):
    """[(x, y)] de las estaciones troncales, en el marco métrico del simulador."""
    return [tuple(s['xy']) for s in servicios['stations'] if s.get('kind') == 'station' and s.get('xy')]


def medir(por_bus, malla, paradas, luces=(), andenes=()):
    """Acumula por (eje, sentido, cubeta) lo rodado, lo detenido en tráfico y la atención."""
    campo = defaultdict(lambda: {'t': 0.0, 'd': 0.0, 'stop_t': 0.0, 'dwell_t': 0.0, 'queue_t': 0.0,
                                 'signal_t': 0.0, 'move_t': 0.0, 'move_d': 0.0, 'buses': set()})
    usadas = descartadas = 0
    for bus, v in por_bus.items():
        for (t1, x1, y1, parada), (t2, x2, y2, _) in zip(v, v[1:]):
            dt = t2 - t1
            if not 0 < dt <= PASO_MAX:
                continue
            distancia = math.hypot(x2 - x1, y2 - y1)
            if distancia > SALTO_MAX:
                continue
            a, b = enganchar(malla, x1, y1), enganchar(malla, x2, y2)
            if not a or not b or a[0] != b[0]:
                descartadas += 1
                continue
            usadas += 1
            eje, sentido = a[0], (1 if b[1] >= a[1] else -1)
            quieto = distancia / dt * 3.6 < QUIETO_KMH
            destino = paradas.get(parada)
            propia = math.hypot(x1 - destino[0], y1 - destino[1]) if quieto and destino else None
            atendiendo = propia is not None and propia <= ATENCION_M
            # El motor modela los semáforos aparte: si su rojo se quedara aquí dentro, se contaría
            # dos veces y el viaje saldría tarde.
            # Un bus quieto en un andén no dice nada del corredor: puede ser el suyo o el de otro
            # servicio, y las dos cosas las modela el motor aparte —atención y cola por el vagón—.
            # Lo que queda en `v_kmh` es lo que consigue quien pasa de largo.
            en_anden = quieto and not atendiendo and cerca_de(andenes, x1, y1, ESTACION_M)
            en_rojo = quieto and not atendiendo and not en_anden and cerca_de(luces, x1, y1, SEMAFORO_M)
            for cubeta, parte_d, parte_t in repartir(a[1], b[1], distancia, dt):
                celda = campo[(eje, sentido, cubeta)]
                celda['t'] += parte_t
                celda['d'] += parte_d
                celda['buses'].add(bus)
                if atendiendo:
                    celda['dwell_t'] += parte_t
                elif en_anden:
                    celda['queue_t'] += parte_t
                elif en_rojo:
                    celda['signal_t'] += parte_t
                elif quieto:
                    celda['stop_t'] += parte_t
                else:
                    celda['move_t'] += parte_t
                    celda['move_d'] += parte_d
    return campo, usadas, descartadas


def rellenar(campo, ejes):
    """Cubeta observada, suavizada con sus vecinas o, en último caso, mediana de su corredor."""
    crudo = {k: v for k, v in campo.items()}
    por_eje = defaultdict(list)
    for (eje, sentido, _), v in crudo.items():
        util = v['t'] - v['dwell_t'] - v['queue_t'] - v['signal_t']
        if v['t'] >= MINIMO_OBSERVADO and v['move_t'] > 0 and util > 0:
            por_eje[(eje, sentido)].append((v['move_d'] / v['move_t'] * 3.6, v['stop_t'] / util,
                                            v['d'] / util * 3.6))
    def mediana(valores):
        s = sorted(valores)
        return s[len(s) // 2] if s else None
    respaldo = {k: (mediana([x[0] for x in v]), mediana([x[1] for x in v]), mediana([x[2] for x in v]))
                for k, v in por_eje.items()}
    global_v = mediana([v[0] for v in respaldo.values() if v[0]]) or 25.0
    global_s = mediana([v[1] for v in respaldo.values() if v[1] is not None]) or 0.15
    salida, conteo = {}, defaultdict(int)
    for eje in ejes:
        for sentido in (1, -1):
            for cubeta in range(int(eje['length'] // CUBETA) + 1):
                clave = (eje['id'], sentido, cubeta)
                v = crudo.get(clave)
                propio = v['dwell_t'] + v['queue_t'] + v['signal_t'] if v else 0
                if v and v['t'] >= MINIMO_OBSERVADO and v['move_t'] > 0 and v['t'] > propio:
                    origen, vel = 'observed', v['move_d'] / v['move_t'] * 3.6
                    quieto = v['stop_t'] / (v['t'] - propio)
                    travesia = v['d'] / (v['t'] - propio) * 3.6
                    horas, buses = v['t'] / 3600, len(v['buses'])
                else:
                    vecinas = [crudo.get((eje['id'], sentido, cubeta + p))
                               for p in range(-VECINAS, VECINAS + 1)]
                    vecinas = [n for n in vecinas if n and n['move_t'] > 0]
                    tiempo = sum(n['t'] - n['dwell_t'] - n['queue_t'] - n['signal_t'] for n in vecinas)
                    if tiempo >= MINIMO_SUAVIZADO:
                        origen = 'smoothed'
                        vel = sum(n['move_d'] for n in vecinas) / sum(n['move_t'] for n in vecinas) * 3.6
                        quieto = sum(n['stop_t'] for n in vecinas) / tiempo
                        travesia = sum(n['d'] for n in vecinas) / tiempo * 3.6
                        horas, buses = (v['t'] / 3600 if v else 0.0), (len(v['buses']) if v else 0)
                    else:
                        origen = 'corridor_default'
                        base = respaldo.get((eje['id'], sentido)) or (None, None, None)
                        vel, quieto = base[0] or global_v, base[1] if base[1] is not None else global_s
                        travesia = (base[2] if len(base) > 2 and base[2] else None) or vel * (1 - quieto)
                        horas, buses = (v['t'] / 3600 if v else 0.0), (len(v['buses']) if v else 0)
                conteo[origen] += 1
                salida[f'{eje["id"]}|{sentido}|{cubeta}'] = {
                    'v_kmh': round(max(3.0, travesia), 1),
                    'v_roll_kmh': round(vel, 1), 'stop_share': round(min(0.95, quieto), 3),
                    'hours': round(horas, 2), 'buses': buses, 'source': origen}
    return salida, conteo, round(global_v, 1), round(global_s, 3)


def construir(carpeta, servicios, excluidos=(), motivo=''):
    rutas = {r['route_id']: r['agency_id']
             for r in csv.DictReader((carpeta / 'routes.txt').open(encoding='utf-8-sig'))}
    ejes = corredores(servicios)
    malla = indice(ejes)
    por_bus, archivos = lecturas(carpeta, rutas, excluidos)
    gtfs = sorted((ROOT / 'data/raw/gtfs').glob('*/stops.txt'))
    paradas = paraderos(gtfs[-1] if gtfs else None)
    luces = semaforos(ROOT / 'app/dist/busway_signals.json')
    campo, usadas, descartadas = medir(por_bus, malla, paradas, luces, estaciones(servicios))
    cubetas, conteo, global_v, global_s = rellenar(campo, ejes)
    dias = sorted({m.group(1) for m in (re.search(r'(\d{8})', n) for n in archivos) if m})
    return {
        'schema_version': 1,
        'observed_from': f'{dias[0][:4]}-{dias[0][4:6]}-{dias[0][6:]}' if dias else None,
        'assumptions': {
            'applies_to': 'todas las horas y tipos de día',
            'measured_window': 'la ventana que cubran las lecturas, no el día entero',
            'agency': 'solo troncal; duales y calle conservan el modelo continuo',
            'v_kmh': ('velocidad de travesía: distancia sobre el tiempo que el trecho consume a un bus '
                      'que pasa, sin contar la atención ni la cola de su propio servicio. Es la que usa '
                      'el motor, y tampoco cuenta la espera en los semáforos corroborados, que el '
                      'motor añade por su cuenta. Un trecho congestionado se ve como bus lento y no como bus '
                      'plantado: en calzada segregada un bus solo se detiene por andén ocupado o por '
                      'semáforo'),
            'stop_share': ('tiempo detenido que no es de su propio servicio: se descuenta la atención '
                           'en la parada destino y la cola por su andén, que el motor ya modela aparte. '
                           'Queda lo que detiene a cualquiera que pase por ahí, que es lo que un '
                           'expreso sí hereda al cruzar el trecho'),
            'known_bias': ('el vehículo que no refresca su posición repite la anterior y parece '
                           'detenido: infla stop_share y la cola alta de v_roll_kmh'),
            'review': ('nivel por hora y tipo de día: no hace falta en el campo. Medido sobre las lecturas, '
                       'la forma del corredor apenas cambia entre franjas —correlación 0,93 a 0,97 entre '
                       'punta, valle, sábado y domingo— y el nivel que sí cambia ya lo lleva el tiempo '
                       'publicado de cada tramo, cuyas columnas por tipo de día coinciden con lo medido')},
        'excluded_reason': motivo or None,
        'parameters': {'dwell_radius_m': ATENCION_M, 'station_radius_m': ESTACION_M, 'signal_radius_m': SEMAFORO_M, 'bucket_m': CUBETA, 'snap_m': ENGANCHE, 'max_step_s': PASO_MAX,
                       'max_jump_m': SALTO_MAX, 'stopped_below_kmh': QUIETO_KMH,
                       'observed_min_s': MINIMO_OBSERVADO, 'smoothed_min_s': MINIMO_SUAVIZADO},
        'sources': {'routes_sha256': hashlib.sha256((carpeta / 'routes.txt').read_bytes()).hexdigest(),
                    'corridors': 'app/dist/services.json · corridors kind=trunk',
                    'feed': 'Lecturas de posición de la flota'},
        'coverage': {'pairs_used': usadas, 'pairs_off_corridor': descartadas,
                     'buckets': sum(conteo.values()), **{k: conteo[k] for k in sorted(conteo)},
                     'trunk_km': round(sum(e['length'] for e in ejes) / 1000, 1),
                     'gtfs_stops': len(paradas),
                     'dwell_hours': round(sum(v['dwell_t'] for v in campo.values()) / 3600, 1),
                     'platform_hours': round(sum(v['queue_t'] for v in campo.values()) / 3600, 1),
                     'signal_hours': round(sum(v['signal_t'] for v in campo.values()) / 3600, 1),
                     'signals': len(luces),
                     'traffic_stop_hours': round(sum(v['stop_t'] for v in campo.values()) / 3600, 1),
                     'moving_hours': round(sum(v['move_t'] for v in campo.values()) / 3600, 1)},
        'fallback': {'v_roll_kmh': global_v, 'stop_share': global_s},
        'axes': {e['id']: {'corridor': e['corridor'], 'name': e['name'], 'zone': e['zone'],
                           'length_m': round(e['length'], 1)} for e in ejes},
        'buckets': cubetas,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--capture', default=str(CAPTURA))
    parser.add_argument('--services', default=str(SERVICIOS))
    parser.add_argument('--out', default=str(SALIDA))
    parser.add_argument('--exclude', action='append', default=[], metavar='AAAAMMDD',
                        help='Día que no entra al campo; se anota en la salida con su motivo')
    parser.add_argument('--exclude-note', default='', help='Por qué se excluyen esos días')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    datos = construir(Path(args.capture), json.loads(Path(args.services).read_text()),
                      set(args.exclude), args.exclude_note)
    c = datos['coverage']
    print(f"{c['trunk_km']} km de eje troncal · {c['buckets']} cubetas")
    print(f"  observadas {c.get('observed', 0)} ({100 * c.get('observed', 0) / c['buckets']:.0f} %) · "
          f"suavizadas {c.get('smoothed', 0)} · por defecto del corredor {c.get('corridor_default', 0)}")
    print(f"  pares usados {c['pairs_used']} · fuera del eje {c['pairs_off_corridor']}")
    observadas = [v for v in datos['buckets'].values() if v['source'] == 'observed']
    if observadas:
        trav = sorted(v['v_kmh'] for v in observadas)
        q0 = lambda a, x: a[min(len(a) - 1, int(len(a) * x))]
        print(f"  travesía p10 {q0(trav, .1)} · mediana {q0(trav, .5)} · p90 {q0(trav, .9)} km/h")
        vel = sorted(v['v_roll_kmh'] for v in observadas)
        quieto = sorted(v['stop_share'] for v in observadas)
        q = lambda a, x: a[min(len(a) - 1, int(len(a) * x))]
        print(f"  rodando  p10 {q(vel, .1)} · mediana {q(vel, .5)} · p90 {q(vel, .9)} km/h")
        print(f"  detenido p10 {q(quieto, .1) * 100:.0f} % · mediana {q(quieto, .5) * 100:.0f} % · "
              f"p90 {q(quieto, .9) * 100:.0f} %")
    if not args.dry_run:
        Path(args.out).write_text(json.dumps(datos, ensure_ascii=False, separators=(',', ':')) + '\n',
                                  encoding='utf-8')
        print('escrito', args.out)


if __name__ == '__main__':
    main()
