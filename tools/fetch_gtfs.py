"""Snapshot the published GTFS package and reduce it to the trunk and dual trips.

TRANSMILENIO S.A. publishes an open GTFS, rebuilt daily; its address is configured locally, in
tools/gtfs.local.json, which is not versioned —see gtfs_rt.py.
The package is 121 MB and `stop_times.txt` alone is 580 MB uncompressed, so it is not versioned:
what stays in the repository is the manifest with the SHA-256 of the exact bytes read, the small
tables, one row per trunk or dual trip, and one row per stretch between two consecutive stops.

`stop_times.txt` is read in a single pass and is not sorted by stop_sequence, so every trip's stops
are ordered explicitly before anything is measured on them.

`--archive` reruns the reduction over a package already on disk, without downloading it again; the
SHA-256 is recomputed from those same bytes, never copied from a previous manifest.

Este archivo no da por supuesto nada sobre lo que declara el paquete: la fecha de publicación, la
del dato y la de descarga se guardan por separado, como en el resto de las fuentes del proyecto.
"""
import argparse
import csv
import hashlib
import io
import json
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
# Lo que se guarda como procedencia es el nombre de la fuente, no su dirección: el dato derivado
# viaja a los dos repositorios y tiene que ser idéntico en ambos.
FUENTE = 'GTFS de TRANSMILENIO S.A., datos abiertos'


def direccion(nombre):
    """La dirección sale de tools/gtfs.local.json, que no se versiona. Perezosa a propósito: así
    `--archive`, que no descarga nada, sigue corriendo sin configuración local."""
    import gtfs_rt
    return getattr(gtfs_rt, nombre)
# 1 troncal, 6 dual. El simulador es BRT: alimentadores, zonales y cable quedan fuera del recorte,
# aunque el paquete los traiga.
SCOPE = ('1', '6')
VERBATIM = ('routes.txt', 'calendar.txt', 'calendar_dates.txt', 'feed_info.txt', 'agency.txt', 'stops.txt')
COLUMNS = ('trip_id', 'route_id', 'service_id', 'shape_id', 'departure_s', 'arrival_s',
           'stops', 'first_stop', 'last_stop', 'metres')
# Un tramo no dura lo mismo un martes a las siete que un domingo. Los cubos son los tipos de día
# que ya distingue el simulador, más la punta dentro del laborable.
BUCKETS = ('peak', 'weekday', 'saturday', 'holiday')
SEGMENT_COLUMNS = ('route_id', 'index', 'from_stop', 'to_stop', 'metres', 'seconds', 'trips',
                   *(f'seconds_{b}' for b in BUCKETS), *(f'trips_{b}' for b in BUCKETS))


def now():
    return datetime.now(timezone.utc).isoformat()


def seconds(value):
    """GTFS clock to seconds after midnight. Past midnight the feed keeps counting: 24:30:00."""
    hours, minutes, rest = value.split(':')
    return int(hours) * 3600 + int(minutes) * 60 + int(rest)


def download(url, destination):
    """Streams to disk, hashing as it goes, so the 121 MB never sit in memory twice."""
    digest, read = hashlib.sha256(), 0
    request = urllib.request.Request(url, headers={'User-Agent': 'BogotaTransmi-local-research/0.2'})
    with urllib.request.urlopen(request, timeout=120) as response, destination.open('wb') as handle:
        published = response.headers.get('Last-Modified')
        while chunk := response.read(1 << 20):
            digest.update(chunk)
            handle.write(chunk)
            read += len(chunk)
            print(f'\r  {read / 1e6:,.0f} MB', end='', flush=True)
    print()
    return {'url': FUENTE, 'retrieved_at_utc': now(), 'published_header': published,
            'sha256': digest.hexdigest(), 'bytes': read}


def table(package, name):
    return list(csv.DictReader(io.TextIOWrapper(package.open(name), 'utf-8-sig')))


def trunk_trips(package):
    """(trip rows, segment rows) from a single pass over stop_times.txt.

    Segments are what the calibration needs: between two consecutive stops the feed gives a running
    time, and because arrival equals departure everywhere that time carries the real dwell inside it.
    Only trips with the route's most common stop count contribute, so segment i means the same
    stretch on every trip compared.
    """
    scope = {r['route_id'] for r in table(package, 'routes.txt') if r['agency_id'] in SCOPE}
    trips = {t['trip_id']: t for t in table(package, 'trips.txt') if t['route_id'] in scope}
    # Qué tipos de día puede cubrir cada service_id. Uno que corra toda la semana alimenta los tres:
    # es el mismo viaje publicado para todos ellos, así que su tiempo vale para todos.
    covers = {}
    for row in table(package, 'calendar.txt'):
        kinds = set()
        if any(int(row[d]) for d in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday')):
            kinds.add('weekday')
        if int(row['saturday']):
            kinds.add('saturday')
        if int(row['sunday']):
            kinds.add('holiday')
        covers[row['service_id']] = kinds
    print(f'  {len(scope)} rutas en el recorte, {len(trips):,} viajes')
    stops, skipped = defaultdict(list), 0
    with package.open('stop_times.txt') as raw:
        for row in csv.DictReader(io.TextIOWrapper(raw, 'utf-8-sig')):
            trip = row['trip_id']
            if trip not in trips:
                continue
            try:
                stops[trip].append((int(row['stop_sequence']), seconds(row['arrival_time']),
                                    seconds(row['departure_time']), row['stop_id'],
                                    float(row['shape_dist_traveled'] or 0)))
            except ValueError:
                skipped += 1
    if skipped:
        print(f'  {skipped} filas de paradas ilegibles, descartadas')

    rows = []
    for trip, meta in trips.items():
        visits = stops.get(trip)
        if not visits:
            continue
        # El archivo no viene ordenado por secuencia: se ordena, no se confía en el orden de lectura.
        visits.sort()
        rows.append({'trip_id': trip, 'route_id': meta['route_id'], 'service_id': meta['service_id'],
                     'shape_id': meta.get('shape_id', ''), 'departure_s': visits[0][2],
                     'arrival_s': visits[-1][1], 'stops': len(visits), 'first_stop': visits[0][3],
                     'last_stop': visits[-1][3], 'metres': round(visits[-1][4] - visits[0][4], 1)})
    rows.sort(key=lambda r: (r['route_id'], r['service_id'], r['departure_s']))

    shape = Counter()
    for row in rows:
        shape[(row['route_id'], row['stops'])] += 1
    usual = {}
    for (route, count), seen in shape.items():
        if seen > shape.get((route, usual.get(route, -1)), -1):
            usual[route] = count
    gathered = defaultdict(lambda: defaultdict(list))
    for row in rows:
        if row['stops'] != usual[row['route_id']]:
            continue
        visits = stops[row['trip_id']]
        kinds = covers.get(row['service_id'], set())
        for i in range(len(visits) - 1):
            hour = visits[i][2] // 3600 % 24
            sample = (visits[i + 1][1] - visits[i][2], visits[i + 1][4] - visits[i][4],
                      visits[i][3], visits[i + 1][3])
            for kind in kinds:
                gathered[(row['route_id'], i)][kind].append(sample)
            if 'weekday' in kinds and (6 <= hour < 9 or 16 <= hour < 20):
                gathered[(row['route_id'], i)]['peak'].append(sample)
    segments = []
    for (route, index), buckets in sorted(gathered.items()):
        # La punta es un subconjunto del laborable: sumarla otra vez la contaría dos veces.
        every = [x for kind in ('weekday', 'saturday', 'holiday') for x in buckets.get(kind, [])]
        if not every:
            continue
        entry = {'route_id': route, 'index': index, 'from_stop': every[0][2], 'to_stop': every[0][3],
                 'metres': round(median(x[1] for x in every), 1),
                 'seconds': round(median(x[0] for x in every), 1), 'trips': len(every)}
        for kind in BUCKETS:
            got = buckets.get(kind, [])
            entry[f'seconds_{kind}'] = round(median(x[0] for x in got), 1) if got else ''
            entry[f'trips_{kind}'] = len(got)
        segments.append(entry)
    return rows, segments


def digest_of(path):
    digest, read = hashlib.sha256(), 0
    with path.open('rb') as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
            read += len(chunk)
    return {'url': FUENTE, 'retrieved_at_utc': now(), 'published_header': None,
            'sha256': digest.hexdigest(), 'bytes': read, 'reused_archive': str(path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--archive', help='Reducir un paquete ya descargado en vez de bajarlo otra vez')
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    folder = ROOT / 'data/raw/gtfs' / stamp
    folder.mkdir(parents=True, exist_ok=False)
    # El paquete se queda fuera del control de versiones: pesa 121 MB y se vuelve a publicar cada
    # día. Lo que acredita de qué bytes salió todo lo demás es su SHA-256 en el manifiesto.
    archive = Path(args.archive).resolve() if args.archive else ROOT / 'data/raw/gtfs' / f'GTFS_{stamp}.zip'

    if args.archive:
        print(f'Reutilizando {archive}')
        evidence = digest_of(archive)
    else:
        paquete = direccion('GTFS')
        print(f'Descargando {paquete}')
        evidence = download(paquete, archive)
    print(f"  SHA-256 {evidence['sha256']}")

    sources = [evidence]
    try:
        request = urllib.request.Request(direccion('MANIFEST'),
                                         headers={'User-Agent': 'BogotaTransmi-local-research/0.2'})
        with urllib.request.urlopen(request, timeout=40) as response:
            raw = response.read()
        sources.append({'url': FUENTE, 'retrieved_at_utc': now(),
                        'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
        (folder / 'manifest_publicado.json').write_bytes(raw)
    except OSError as error:
        # El índice del portal es informativo; su ausencia no invalida el paquete ya descargado.
        print(f'  aviso: no se pudo leer el índice publicado ({error})')

    with zipfile.ZipFile(archive) as package:
        contents = {i.filename: i.file_size for i in package.infolist()}
        for name in VERBATIM:
            if name in contents:
                (folder / name).write_bytes(package.read(name))
        feed = table(package, 'feed_info.txt')
        print('Leyendo stop_times.txt')
        rows, segments = trunk_trips(package)

    for name, columns, payload in (('trunk_trips.csv', COLUMNS, rows),
                                   ('trunk_segments.csv', SEGMENT_COLUMNS, segments)):
        with (folder / name).open('w', encoding='utf-8', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=columns)
            writer.writeheader()
            writer.writerows(payload)

    payload = {
        'generated_at_utc': now(),
        'scope': {'agency_ids': list(SCOPE), 'meaning': 'Troncal y Dual; el paquete trae siete agencias'},
        'sources': sources,
        'package_contents_bytes': contents,
        'feed_info': feed[0] if feed else None,
        'trips': len(rows), 'segments': len(segments),
        'archive_kept_at': str(archive.relative_to(ROOT)) if archive.is_relative_to(ROOT) else str(archive),
        'archive_versioned': False,
        'note': ('departure_s y arrival_s son segundos tras la medianoche del día de servicio y '
                 'pueden pasar de 86400. metres sale de shape_dist_traveled, comprobado en metros '
                 'para este paquete; no suponerlo para otros. El tiempo de cada tramo lleva dentro '
                 'la atención en estación: el feed da llegada y salida iguales en todas las paradas.'),
    }
    (folder / 'manifest.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    latest = ROOT / 'data/raw/gtfs/latest.json'
    latest.write_text(json.dumps({'folder': stamp, 'generated_at_utc': payload['generated_at_utc'],
                                  'sha256': evidence['sha256'], 'trips': len(rows)},
                                 ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(rows):,} viajes y {len(segments):,} tramos en {folder.relative_to(ROOT)}')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nInterrumpido.')
        sys.exit(1)
