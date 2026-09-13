"""Every trunk and dual vehicle in the system right now, from the published realtime feed.

This is open data: `positions.pb` needs no credential, carries the whole network in one request of
some 700 kB, and cannot truncate. Which routes count as trunk or dual is decided from the same
`routes.txt` the simulator's timetable was built on, so both agree on the scope by construction, and
the reading works offline from any service other than the feed itself.

Lo que se publica por encima de las posiciones son las señales para no confiar de más:

  * `build_age_s`, la antigüedad del lote. El alimentador se reconstruye cada quince segundos, así
    que un número grande significa que el feed se quedó atrás, no que los buses se detuvieran.
  * `unmatched`, los vehículos troncales o duales cuya ruta no está en el catálogo local. Aparecen
    igual en el mapa, pero sin color de corredor y contados aparte: es un servicio que el simulador
    todavía no conoce, no un error de lectura.

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
    """{gtfs route_id: (component, code, destination, local id or None)}.

    Sale del paquete que ya redujo tools/fetch_gtfs.py, no de la red: el adaptador no debe depender
    de que el portal responda para saber qué es troncal.
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
            if component not in TRUNK:
                continue
            out[row['route_id']] = (component, row['route_short_name'].strip(),
                                    row['route_long_name'].strip(), local.get(row['route_id']))
    return out


class LiveNetwork:
    """One shared snapshot for every viewer. Reading it twice in fifteen seconds asks once."""

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

    def snapshot(self):
        """(status, payload). Trunk and dual only: the simulator does not model the rest."""
        try:
            routes, origin = self.prepare()
        except (FileNotFoundError, OSError, ValueError, KeyError) as error:
            return 'unavailable', {'detail': f'No hay catálogo local del paquete publicado: {error}'}
        cached = self.cache
        if cached and time.time() - cached['fetched'] < CACHE_TTL:
            return 'ok', self.payload(cached)
        with self.lock:
            cached = self.cache
            if cached and time.time() - cached['fetched'] < CACHE_TTL:
                return 'ok', self.payload(cached)
            try:
                stamp, raw = posiciones(self.fetch())
            except urllib.error.HTTPError as error:
                return 'upstream', {'detail': f'El alimentador respondió {error.code}.', 'code': error.code}
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
                return 'upstream', {'detail': f'No se pudo leer el alimentador: {error}', 'code': None}
            vehicles, unmatched, dropped = [], 0, 0
            for entry in raw:
                known = routes.get(entry['ruta'])
                if not known:
                    continue
                lon, lat = entry['lon'], entry['lat']
                if lon is None or lat is None or not (BOX[0] < lon < BOX[1] and BOX[2] < lat < BOX[3]):
                    dropped += 1
                    continue
                component, code, destination, local_id = known
                if local_id is None:
                    unmatched += 1
                x, y = aeqd(lon, lat, origin)
                # La etiqueta es el número de flota rotulado en el bus, el mismo que publica la
                # lectura por servicio; el id del alimentador es interno y no coincide con nada.
                vehicles.append({'id': entry['bus'], 'label': entry['etiqueta'], 'line': code, 'line_id': local_id,
                                 'operator': component, 'destination': destination,
                                 'trip': entry['viaje'], 'route_id': entry['ruta'],
                                 'xy': [round(x, 2), round(y, 2)], 'lonlat': [lon, lat]})
            now = datetime.now(BOGOTA)
            cached = {'fetched': time.time(), 'queried_at': now.isoformat(timespec='seconds'),
                      'build': stamp, 'vehicles': vehicles, 'seen': len(raw),
                      'unmatched': unmatched, 'dropped': dropped}
            self.cache = cached
            return 'ok', self.payload(cached)

    def payload(self, cached):
        build_age = round(time.time() - cached['build'], 1) if cached['build'] else None
        return {'queried_at': cached['queried_at'], 'age_s': round(time.time() - cached['fetched'], 1),
                'build_age_s': build_age, 'vehicles': cached['vehicles'], 'seen': cached['seen'],
                'unmatched': cached['unmatched'], 'dropped': cached['dropped'],
                'attribution': ATTRIBUTION}
