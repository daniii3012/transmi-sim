"""Record the official GTFS-Realtime feed of TRANSMILENIO, for days, without any credential.

This reads the vehicle positions of the GTFS-Realtime feed published by TRANSMILENIO S.A. —open
data, no credential, address configured in tools/gtfs.local.json— which returns every vehicle in
the system —about 5.500— in one request of
some 700 kB, instead of asking bounding box by bounding box and coming back truncated.

Two things come out of it:

  rt.jsonl                     one line per feed build: counts by agency and by trunk line, plus
                               the distribution of observed speed against the previous build.
  rt_detalle_AAAAMMDD.csv.gz   one row per vehicle per build, so the running times, the dwell at
                               stations and the bunching can be recomputed later from the raw
                               readings instead of being trusted from the summary. Incluye la
                               etiqueta de flota que el bus lleva pintada, de la que sale el tipo
                               de carrocería (docs/TIPOS_DE_BUS_20260912.md).
  rt_detalle_AAAAMMDD.json     which published package that day's readings belong to, so a capture
                               is never compared against a timetable it did not run under.

Two traps in the feed, both worked around here:

  * FeedHeader.timestamp is frozen —it has been stuck on the same value for days—, so it is
    ignored. VehiclePosition.timestamp does advance and is used as the clock.
  * That stamp is identical for all 5.500 vehicles: it is when the feed was built, not when each
    bus reported. So a speed computed here is an average over the interval between builds, and
    the age of each individual GPS fix is not knowable from this source. Each bus refreshes on its
    own cadence and the feed repeats its last known position meanwhile, so between two builds a
    vehicle may show no movement and then a jump that is catching up, not speed. The summary's
    percentiles carry that noise; the stop-to-stop times recomputed from the detail do not.

Standard library only, so it runs on Windows with a plain Python install and on macOS with the
system one. Append-only: stopping it and starting it again loses nothing and repeats nothing. Dos
capturas a la vez sobre la misma carpeta sí se estorban —se vio el 12 de septiembre: uno de los dos
recreó el csv.gz, la cabecera quedó en medio del archivo y un lote entero salió duplicado—, así que
la segunda se niega a arrancar en vez de mezclarse con la primera.
"""
import argparse
import atexit
import csv
import gzip
import io
import json
import math
import os
import socket
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gtfs_rt import AGENCIES, GTFS, MANIFEST, POSITIONS, TRUNK, posiciones

ROOT = Path(__file__).resolve().parents[1]
BOGOTA = timezone(timedelta(hours=-5))
TIMEOUT = 45
AGENT = 'BogotaTransmi-rt-capture/0.1'
# Un bus no pasa de 120 km/h ni salta 15 km entre dos lecturas: por encima de eso la pareja es un
# error de posición, no un movimiento, y contarla envenenaría los percentiles.
MAX_KMH = 120
MAX_JUMP_M = 15000

# --- Lectura del feed -----------------------------------------------------------------------------

def descargar(url, cabeceras=None, intentos=3):
    peticion = urllib.request.Request(url, headers={'User-Agent': AGENT, **(cabeceras or {})})
    for intento in range(intentos):
        try:
            with urllib.request.urlopen(peticion, timeout=TIMEOUT) as respuesta:
                return respuesta.read(200_000_000)
        except urllib.error.HTTPError as error:
            if error.code < 500 or intento == intentos - 1:
                raise
            time.sleep(10 * (intento + 1))

def vehiculos():
    """(build stamp, list of vehicles) from one reading of positions.pb."""
    return posiciones(descargar(POSITIONS))

def rango(url, desde, hasta):
    return descargar(url, {'Range': f'bytes={desde}-{hasta}'})

def routes_txt():
    """routes.txt pulled out of GTFS.zip with Range requests: 13 kB instead of 121 MB.

    Se necesita para saber qué ruta es troncal y cuál zonal. Bajar el paquete entero cada vez que
    se arranca la captura sería un cuarto de hora de espera para leer sesenta kilobytes.
    """
    peticion = urllib.request.Request(GTFS, method='HEAD', headers={'User-Agent': AGENT})
    with urllib.request.urlopen(peticion, timeout=TIMEOUT) as respuesta:
        total = int(respuesta.headers['Content-Length'])
    cola = rango(GTFS, max(0, total - 70000), total - 1)
    fin = cola.rfind(b'PK\x05\x06')
    if fin < 0:
        raise ValueError('No se encontró el directorio del zip')
    tamano, posicion = struct.unpack('<II', cola[fin + 12:fin + 20])
    directorio, p = rango(GTFS, posicion, posicion + tamano - 1), 0
    while p < len(directorio) and directorio[p:p + 4] == b'PK\x01\x02':
        comprimido = struct.unpack('<I', directorio[p + 20:p + 24])[0]
        nl, el, cl = struct.unpack('<HHH', directorio[p + 28:p + 34])
        local = struct.unpack('<I', directorio[p + 42:p + 46])[0]
        nombre = directorio[p + 46:p + 46 + nl].decode()
        if nombre == 'routes.txt':
            cabecera = rango(GTFS, local, local + 29)
            nl2, el2 = struct.unpack('<HH', cabecera[26:30])
            inicio = local + 30 + nl2 + el2
            datos = rango(GTFS, inicio, inicio + comprimido - 1)
            return zlib.decompress(datos, -15).decode('utf-8-sig')
        p += 46 + nl + el + cl
    raise ValueError('routes.txt no está en el paquete')

def procedencia(destino):
    """Write, once per day, which published package these readings belong to.

    Un día de capturas solo se puede comparar contra el horario bajo el que circuló. El índice del
    portal declara la fecha y el tamaño del paquete vigente; guardarlo al lado evita cotejar después
    unas posiciones con un horario que ya se había vuelto a publicar.
    """
    if destino.exists():
        return
    registro = {'written_at': datetime.now(BOGOTA).isoformat(timespec='seconds'),
                'positions_source': 'GTFS-Realtime de TRANSMILENIO S.A., datos abiertos'}
    try:
        registro['portal_manifest'] = json.loads(descargar(MANIFEST).decode('utf-8'))
    except (OSError, ValueError) as error:
        registro['portal_manifest_error'] = str(error)
    destino.write_text(json.dumps(registro, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def catalogo(cache):
    """{route_id: (agencia, nombre corto)}, cached on disk for a day."""
    if cache.exists() and time.time() - cache.stat().st_mtime < 86400:
        texto_rutas = cache.read_text(encoding='utf-8')
    else:
        texto_rutas = routes_txt()
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(texto_rutas, encoding='utf-8')
    return {fila['route_id']: (AGENCIES.get(fila['agency_id'], '?'), fila['route_short_name'])
            for fila in csv.DictReader(io.StringIO(texto_rutas))}

# --- Medida ---------------------------------------------------------------------------------------

def metros(lat1, lon1, lat2, lon2):
    """Haversine. Sobra precisión para un desplazamiento de decenas de metros en treinta segundos."""
    radio = 6371000.0
    f1, f2 = math.radians(lat1), math.radians(lat2)
    df, dl = f2 - f1, math.radians(lon2 - lon1)
    a = math.sin(df / 2) ** 2 + math.cos(f1) * math.cos(f2) * math.sin(dl / 2) ** 2
    return 2 * radio * math.asin(math.sqrt(a))

def percentiles(valores):
    if not valores:
        return None
    v = sorted(valores)
    n = len(v)
    corte = lambda q: round(v[min(n - 1, int(n * q))], 1)
    return {'n': n, 'p50': corte(.5), 'p75': corte(.75), 'p90': corte(.9), 'p99': corte(.99),
            'max': round(v[-1], 1), 'parado_pct': round(100 * sum(1 for x in v if x < 2) / n)}

def velocidades(anterior, actual, rutas):
    """Observed km/h per agency, matching each vehicle against itself in the previous build."""
    sello_previo, previos = anterior
    sello, presentes = actual
    dt = sello - sello_previo
    if dt <= 0:
        return {}
    indice = {v['bus']: v for v in previos}
    por_agencia = defaultdict(list)
    for v in presentes:
        antes = indice.get(v['bus'])
        if not antes or None in (v['lat'], v['lon'], antes['lat'], antes['lon']):
            continue
        avance = metros(antes['lat'], antes['lon'], v['lat'], v['lon'])
        if avance > MAX_JUMP_M:
            continue
        kmh = avance / dt * 3.6
        if kmh > MAX_KMH:
            continue
        por_agencia[rutas.get(v['ruta'], ('?', ''))[0]].append(kmh)
    return {agencia: percentiles(v) for agencia, v in por_agencia.items()}

def resumen(actual, anterior, rutas):
    sello, presentes = actual
    ahora = datetime.now(BOGOTA)
    agencias = Counter(rutas.get(v['ruta'], ('?', ''))[0] for v in presentes)
    troncales = [v for v in presentes if rutas.get(v['ruta'], ('?', ''))[0] in TRUNK]
    lectura = {
        'at': ahora.isoformat(timespec='seconds'),
        'build': sello,
        'build_age_s': round(ahora.timestamp() - sello),
        'weekday': ahora.strftime('%a'),
        'hour': round(ahora.hour + ahora.minute / 60, 3),
        'total': len(presentes),
        'trunk': len(troncales),
        'by_agency': dict(agencias),
        'by_line': dict(Counter(rutas.get(v['ruta'], ('?', ''))[1] for v in troncales)),
    }
    if anterior:
        lectura['kmh'] = velocidades(anterior, actual, rutas)
    return lectura

# --- Escritura ------------------------------------------------------------------------------------

COLUMNAS = ('build', 'bus', 'etiqueta', 'placa', 'viaje', 'ruta', 'lat', 'lon', 'parada', 'secuencia')

def cabecera(destino):
    """Columnas del archivo que ya existe; None si no existe o está vacío."""
    if not destino.exists() or destino.stat().st_size == 0:
        return None
    with gzip.open(destino, 'rt', encoding='utf-8', newline='') as archivo:
        primera = archivo.readline()
    return tuple(next(csv.reader([primera]))) if primera else None

def apartar(destino, columnas):
    """Mueve a un lado un día que venía escribiéndose con otras columnas.

    Mezclar dos esquemas en el mismo archivo deja filas que nadie puede leer sin adivinar cuál es
    cuál. El día que arranca con una captura vieja y sigue con una nueva —al añadirse la etiqueta
    de flota, por ejemplo— se parte en dos archivos, cada uno con su cabecera intacta. Los
    lectores recorren `rt_detalle_*.csv.gz` y siguen encontrando los dos.
    """
    base = destino.name[:-len('.csv.gz')]
    for intento in range(1, 100):
        aparte = destino.with_name(f'{base}_esquema{len(columnas)}' + ('' if intento == 1 else f'_{intento}') + '.csv.gz')
        if not aparte.exists():
            destino.rename(aparte)
            return aparte
    raise SystemExit(f'Demasiados archivos apartados junto a {destino}')

def escribir_detalle(destino, sello, presentes, rutas, alcance):
    """One gzip member per build. Appending keeps the file readable if the process is killed."""
    filas = [v for v in presentes
             if alcance == 'todo' or rutas.get(v['ruta'], ('?', ''))[0] in TRUNK]
    if not filas:
        return 0
    previa = cabecera(destino)
    if previa is not None and previa != COLUMNAS:
        aparte = apartar(destino, previa)
        print(f'Detalle con columnas {",".join(previa)} apartado en {aparte.name}; el día sigue con las nuevas.')
        previa = None
    with gzip.open(destino, 'at', encoding='utf-8', newline='') as archivo:
        escritor = csv.writer(archivo)
        if previa is None:
            escritor.writerow(COLUMNAS)
        for v in filas:
            escritor.writerow([sello, v['bus'], v['etiqueta'], v['placa'], v['viaje'], v['ruta'],
                               f"{v['lat']:.5f}" if v['lat'] is not None else '',
                               f"{v['lon']:.5f}" if v['lon'] is not None else '',
                               v['parada'], v['secuencia'] if v['secuencia'] is not None else ''])
    return len(filas)

def tomar_turno(carpeta):
    """Un solo proceso escribiendo en la carpeta. Dos mezclan sus lotes y rompen el detalle."""
    carpeta.mkdir(parents=True, exist_ok=True)
    cerrojo = carpeta / 'captura.lock'
    try:
        descriptor = os.open(cerrojo, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        anterior = cerrojo.read_text(encoding='utf-8').strip()
        raise SystemExit(
            f'Ya hay una captura escribiendo en {carpeta} (proceso {anterior}).\n'
            f'Si estás seguro de que no queda ninguna corriendo, borra {cerrojo} y vuelve a lanzarla.')
    with os.fdopen(descriptor, 'w', encoding='utf-8') as archivo:
        archivo.write(f'{os.getpid()} desde {datetime.now(BOGOTA).isoformat(timespec="seconds")}\n')
    atexit.register(lambda: cerrojo.exists() and cerrojo.unlink())


def anotar(destino, registro):
    destino.parent.mkdir(parents=True, exist_ok=True)
    with destino.open('a', encoding='utf-8') as archivo:
        archivo.write(json.dumps(registro, ensure_ascii=False) + '\n')

# --- Bucle ----------------------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # Relativo al proyecto y no al directorio desde el que se invoque: una captura de días no puede
    # depender de dónde estaba la terminal, ni acabar fuera de lo que .gitignore cubre.
    parser.add_argument('--out', default=str(ROOT / 'data/raw/rt_capture/rt.jsonl'),
                        help='Archivo de resumen al que se añade cada lectura')
    parser.add_argument('--every', type=int, default=30, help='SEGUNDOS entre lecturas (el feed se reconstruye cada 15-20 s)')
    parser.add_argument('--from-hour', type=float, default=4, help='Hora de Bogotá a la que empieza cada día')
    parser.add_argument('--to-hour', type=float, default=23.5, help='Hora de Bogotá a la que termina cada día')
    parser.add_argument('--days', type=int, default=8, help='Días que se queda corriendo')
    parser.add_argument('--scope', choices=('troncal', 'todo'), default='troncal',
                        help='Qué vehículos van al detalle: solo troncal y dual, o el sistema entero')
    parser.add_argument('--no-detail', action='store_true', help='Solo el resumen, sin el csv.gz por vehículo')
    parser.add_argument('--once', action='store_true', help='Una sola lectura y termina, para probar')
    args = parser.parse_args()

    salida = Path(args.out)
    salida.parent.mkdir(parents=True, exist_ok=True)
    tomar_turno(salida.parent)
    rutas = catalogo(salida.parent / 'routes.txt')
    print(f'{len(rutas)} rutas en el catálogo.', flush=True)

    if args.once:
        actual = vehiculos()
        lectura = resumen(actual, None, rutas)
        if not args.no_detail:
            destino = salida.parent / f'rt_detalle_{datetime.now(BOGOTA):%Y%m%d}.csv.gz'
            procedencia(destino.with_suffix('').with_suffix('.json'))
            lectura['detalle'] = escribir_detalle(destino, actual[0], actual[1], rutas, args.scope)
        anotar(salida, lectura)
        print(json.dumps({k: lectura[k] for k in ('at', 'build_age_s', 'total', 'trunk', 'by_agency')
                          if k in lectura}, ensure_ascii=False), flush=True)
        return

    limite = datetime.now(BOGOTA) + timedelta(days=args.days)
    print(f'Resumen en {salida.resolve()}', flush=True)
    if not args.no_detail:
        print(f'Detalle en {salida.parent.resolve()}/rt_detalle_AAAAMMDD.csv.gz  (alcance: {args.scope})', flush=True)
    print(f'Cada {args.every} s, de {args.from_hour:g} a {args.to_hour:g} hora de Bogotá, hasta {limite:%Y-%m-%d %H:%M}.', flush=True)
    print('Ctrl+C para parar. Volver a arrancarlo continúa los mismos archivos.', flush=True)

    anterior = None
    while datetime.now(BOGOTA) < limite:
        ahora = datetime.now(BOGOTA)
        if args.from_hour <= ahora.hour + ahora.minute / 60 < args.to_hour:
            try:
                actual = vehiculos()
                if anterior and actual[0] == anterior[0]:
                    # El mismo lote otra vez: no aporta nada y falsearía la cuenta de lecturas.
                    time.sleep(max(2, args.every / 3))
                    continue
                lectura = resumen(actual, anterior, rutas)
                escritas = 0
                if not args.no_detail:
                    destino = salida.parent / f'rt_detalle_{ahora:%Y%m%d}.csv.gz'
                    procedencia(destino.with_suffix('').with_suffix('.json'))
                    escritas = escribir_detalle(destino, actual[0], actual[1], rutas, args.scope)
                    lectura['detalle'] = escritas
                anotar(salida, lectura)
                anterior = actual
                troncal = (lectura.get('kmh') or {}).get('Troncal') or {}
                velocidad = f"  troncal p50 {troncal['p50']:>5.1f} p90 {troncal['p90']:>5.1f} km/h" if troncal else ''
                print(f"{lectura['at']}  {lectura['total']:5d} veh  troncal+dual {lectura['trunk']:4d}"
                      f"  lote {lectura['build_age_s']:3d} s{velocidad}", flush=True)
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, socket.timeout,
                    ValueError, OSError) as error:
                # Una lectura perdida no interrumpe la semana: se anota y se sigue.
                fallo = {'at': datetime.now(BOGOTA).isoformat(timespec='seconds'), 'error': str(error)}
                anotar(salida, fallo)
                print(f"{fallo['at']}  fallo: {error}", flush=True)
        # Alinear con el reloj para que las lecturas caigan en instantes regulares.
        time.sleep(max(2, args.every - (time.time() % args.every)))

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nDetenido. Los archivos conservan todo lo leído.')
        sys.exit(0)
