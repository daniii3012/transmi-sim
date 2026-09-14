"""Every vehicle in the system right now, from the published realtime feed.

This is open data: `positions.pb` needs no credential, carries the whole network in one request of
some 700 kB, and cannot truncate. Trunk and dual are what the simulator models and what this module
shows by default; the rest of the system also rides on the same feed and can be asked for apart.

Lo que se publica por encima de las posiciones son las señales para no confiar de más:

  * `build_age_s`, la antigüedad del lote. El alimentador se reconstruye cada quince segundos, así
    que un número grande significa que el feed se quedó atrás, no que los buses se detuvieran.
  * `unmatched`, los vehículos troncales o duales cuya ruta no está en el catálogo local. Aparecen
    igual en el mapa, pero sin color de corredor y contados aparte: es un servicio que el simulador
    todavía no conoce, no un error de lectura.
  * `zonal_seen`, cuántos vehículos zonales/alimentadores trae el lote, se pidan o no: así la
    interfaz puede avisar que hay algo oculto sin tener que activarlo primero.

Troncal y dual se muestran siempre. Zonal urbano, zonal complementario, zonal especial, alimentador
y cable, aparte: el simulador no los modela, pero el mismo alimentador los trae.
`snapshot(include_zonal=True)` los añade, rotulados con su propia agencia (campo `operator`), sin
fingir que son troncales.

La proyección se reimplementa aquí por la misma razón que en live_buses: el simulador lo sirve el
Python del sistema y no hay pyproj, pero la definición tiene que coincidir metro a metro.
"""
import csv
import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gtfs_rt import AGENCIES, POSITIONS, TRUNK, posiciones
from live_buses import aeqd

ROOT = Path(__file__).resolve().parents[1]
SERVICES = ROOT / 'app/dist/services.json'
SCHEDULE = ROOT / 'app/dist/schedule.json'
GTFS_LATEST = ROOT / 'data/raw/gtfs/latest.json'
BOGOTA = timezone(timedelta(hours=-5))
ATTRIBUTION = 'GTFS-Realtime de TRANSMILENIO S.A., datos abiertos'
CACHE_TTL = 15.0
TIMEOUT = 25.0
# Bogotá con margen. Una posición fuera de esto es un error del dato, no un bus.
BOX = (-75.5, -73.0, 3.5, 5.5)


def catalogue():
    """{gtfs route_id: (component, code, destination, local id or None)}, para toda agencia.

    Sale del paquete que ya redujo tools/fetch_gtfs.py, no de la red: el adaptador no debe depender
    de que el portal responda para saber qué es cada ruta. Antes se descartaba aquí lo que no fuera
    troncal o dual; ahora se conserva todo y quien filtra es `snapshot`, para que un vehículo zonal
    o alimentador se pueda pedir aparte en vez de no existir nunca para este módulo.
    """
    if not GTFS_LATEST.exists():
        raise FileNotFoundError('Falta data/raw/gtfs/latest.json: ejecutar antes tools/fetch_gtfs.py')
    folder = ROOT / 'data/raw/gtfs' / json.loads(GTFS_LATEST.read_text(encoding='utf-8'))['folder']
    local = {}
    if SCHEDULE.exists():
        for local_id, entry in json.loads(SCHEDULE.read_text(encoding='utf-8'))['routes'].items():
            for route_id in entry['gtfs']:
                local[route_id] = local_id
    out = {}
    with (folder / 'routes.txt').open(encoding='utf-8-sig') as handle:
        for row in csv.DictReader(handle):
            component = AGENCIES.get(row['agency_id'], '?')
            out[row['route_id']] = (component, row['route_short_name'].strip(),
                                    row['route_long_name'].strip(), local.get(row['route_id']))
    return out


class LiveNetwork:
    """One shared snapshot for every viewer. Reading it twice in fifteen seconds asks once.

    El lote se clasifica entero una sola vez por lectura (`snapshot`), guardando de cada vehículo su
    categoría —troncal/dual o zonal/alimentador—; qué categorías entran en la respuesta lo decide
    `payload` en cada pedido, para que dos vistas con casillas distintas compartan el mismo caché de
    quince segundos sin pisarse.
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.cache = None
        self.routes = None
        self.origin = None

    def ready(self):
        try:
            self.prepare()
            return True
        except (FileNotFoundError, OSError, ValueError, KeyError):
            return False

    def prepare(self):
        if self.routes is None:
            self.routes = catalogue()
        if self.origin is None:
            self.origin = tuple(json.loads(SERVICES.read_text(encoding='utf-8'))['origin_lon_lat'])
        return self.routes, self.origin

    def fetch(self):
        request = urllib.request.Request(POSITIONS, headers={'User-Agent': 'BogotaTransmi-local/0.2'})
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.read(50_000_000)

    def snapshot(self, include_zonal=False):
        """(status, payload). Troncal y dual siempre; el resto, solo si se pide."""
        try:
            routes, origin = self.prepare()
        except (FileNotFoundError, OSError, ValueError, KeyError) as error:
            return 'unavailable', {'detail': f'No hay catálogo local del paquete publicado: {error}'}
        cached = self.cache
        if not (cached and time.time() - cached['fetched'] < CACHE_TTL):
            with self.lock:
                cached = self.cache
                if not (cached and time.time() - cached['fetched'] < CACHE_TTL):
                    try:
                        stamp, raw = posiciones(self.fetch())
                    except urllib.error.HTTPError as error:
                        return 'upstream', {'detail': f'El alimentador respondió {error.code}.', 'code': error.code}
                    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
                        return 'upstream', {'detail': f'No se pudo leer el alimentador: {error}', 'code': None}
                    cached = self._classify(stamp, raw, routes, origin)
                    self.cache = cached
        return 'ok', self.payload(cached, include_zonal)

    def _classify(self, stamp, raw, routes, origin):
        """Clasifica cada vehículo del lote una sola vez: troncal/dual o zonal/alimentador."""
        classified, unmatched, dropped = [], 0, 0
        for entry in raw:
            known = routes.get(entry['ruta'])
            if not known:
                continue
            component, code, destination, local_id = known
            category = 'trunk' if component in TRUNK else 'zonal'
            lon, lat = entry['lon'], entry['lat']
            if lon is None or lat is None or not (BOX[0] < lon < BOX[1] and BOX[2] < lat < BOX[3]):
                dropped += 1
                continue
            if category == 'trunk' and local_id is None:
                unmatched += 1
            x, y = aeqd(lon, lat, origin)
            # La etiqueta es el número de flota rotulado en el bus, el mismo que publica la lectura
            # por servicio; el id del alimentador es interno y no coincide con nada.
            classified.append((category, {
                'id': entry['bus'], 'label': entry['etiqueta'], 'line': code, 'line_id': local_id,
                'operator': component, 'destination': destination,
                'trip': entry['viaje'], 'route_id': entry['ruta'],
                'xy': [round(x, 2), round(y, 2)], 'lonlat': [lon, lat]}))
        now = datetime.now(BOGOTA)
        return {'fetched': time.time(), 'queried_at': now.isoformat(timespec='seconds'),
                'build': stamp, 'classified': classified, 'seen': len(raw),
                'unmatched': unmatched, 'dropped': dropped}

    def payload(self, cached, include_zonal=False):
        wanted = {'trunk'}
        if include_zonal:
            wanted.add('zonal')
        vehicles = [vehicle for category, vehicle in cached['classified'] if category in wanted]
        zonal_seen = sum(1 for category, _ in cached['classified'] if category == 'zonal')
        build_age = round(time.time() - cached['build'], 1) if cached['build'] else None
        return {'queried_at': cached['queried_at'], 'age_s': round(time.time() - cached['fetched'], 1),
                'build_age_s': build_age, 'vehicles': vehicles, 'seen': cached['seen'],
                'unmatched': cached['unmatched'], 'dropped': cached['dropped'],
                'zonal_seen': zonal_seen, 'attribution': ATTRIBUTION}
