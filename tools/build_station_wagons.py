"""Derive the published boarding point of each service at each station from the departure boards.

The board names the point as the operator publishes it: "Mandalay A - 2 ó 5" is wagon A, doors 2
or 5; "Portal Américas T5" is terminal platform 5. This turns the hash that operation.mjs uses to
guess a wagon into published data, for the pairs where a board was actually observed.

What is not observed stays estimated and says so. A service seen at two different points of the
same station, in the same direction, is recorded as ambiguous instead of being resolved by picking
one. Standard library only.
"""
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw/station_departures'
OUT = ROOT / 'data/curated/station_wagons.json'
# "A - 2 ó 5", "B - 4", "C - 2 ó 5-T": vagón y puertas. "T5", "T2 A": plataforma de portal.
# El punto va al final del nombre y el nombre de la estación que lo precede no es el mismo que el
# tablero da en `stopmain` —"Portal Sur T2" contra "Portal Sur - JFK Coop. Financiera"—, así que se
# lee la cola y no se recorta un prefijo. Formas observadas: "Prado B - 1", "Av. 1 de Mayo A - 2 ó 5",
# "Av. Jiménez C - 2 ó 5-T", "Puentelargo B 4 ó 6 II", "Banderas T5", "Banderas T6A".
TERMINAL = re.compile(r'(?:^|\s)T\s*(\d+)\s*([A-Z]?)\s*\.?$')
WAGON = re.compile(r'(?:^|\s)([A-Z])\s*-?\s*(\d+(?:\s*ó\s*\d+)*)\s*(?:-\s*[A-Z])?\s*(?:I+\s*)?\.?$')
DOORS = re.compile(r'\d+')
nfc = lambda value: unicodedata.normalize('NFC', value or '')

def key(name):
    """A station name reduced to what both sources agree on: no accents, dashes or case."""
    text = unicodedata.normalize('NFD', name or '')
    text = ''.join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r'[‐-―]', '-', text)
    return re.sub(r'\s+', ' ', text).strip(' .').lower()

PAIRED = re.compile(r'^([A-Z]{2,})(\d+)$')

def candidate_codes(line, known):
    """The catalogue codes a board line may stand for.

    The planner names a dual pair with one code that joins both letters —`FZ63` for F63 y Z63,
    `MC84`, `ML82`, `MK86`— or spells it out, `P85-M85`. Both halves are offered as candidates and
    the terminal of the trip decides which one it is, the same way as for any other departure.
    """
    if line in known:
        return [line]
    joined = PAIRED.match(line or '')
    if joined:
        letters, number = joined.groups()
        return [letter + number for letter in letters if letter + number in known]
    return [part for part in (line or '').split('-') if part in known]

def parse(stop):
    """(kind, label, index, doors) for a published boarding point, or None when unrecognised.

    Terminals are read first: "T5" would otherwise look like wagon T with door 5.
    """
    text = nfc(stop).strip()
    terminal = TERMINAL.search(text)
    if terminal:
        label = 'T' + terminal.group(1) + terminal.group(2)
        return 'terminal', label, int(terminal.group(1)), []
    wagon = WAGON.search(text)
    if wagon:
        return 'wagon', wagon.group(1), ord(wagon.group(1)) - 64, [int(d) for d in DOORS.findall(wagon.group(2))]
    return None

def main():
    snapshot = json.loads((RAW / 'latest.json').read_text())['snapshot']
    source = RAW / snapshot
    raw = json.loads((source / 'boards.json').read_text())
    manifest = json.loads((source / 'manifest.json').read_text())
    services = json.loads((ROOT / 'app/dist/services.json').read_text())
    stations = {s['id']: s for s in services['stations']}
    routes = [r for r in services['routes'] if r.get('ready')]

    observed = defaultdict(set)
    unparsed = defaultdict(set)
    for station_id, board in raw['stations'].items():
        for entry in board['departures']:
            parsed = parse(entry.get('stop'))
            if not parsed:
                unparsed[station_id].add(nfc(entry.get('stop')))
                continue
            observed[(station_id, entry.get('line'), nfc(entry.get('destinationMainMastName')))].add(parsed[:3] + (tuple(parsed[3]),))

    # El tablero nombra el destino con el nombre completo de la estación y el catálogo con el
    # nombre corto del servicio, que además varía entre registros ("P.SUBA", "P. Suba"). No se
    # concilian los nombres: los dos lados se resuelven a la misma estación y se compara el
    # terminal del recorrido, que es un identificador y no admite interpretación.
    by_name = defaultdict(set)
    for station in services['stations']:
        by_name[key(station['name'])].add(station['id'])

    known = {r['code'] for r in routes}
    assignments, ambiguous, unmatched = [], [], []
    for (station_id, code, destination), points in sorted(observed.items()):
        terminals = by_name.get(key(destination), set())
        codes = candidate_codes(code, known)
        here = [r for r in routes if r['code'] in codes and any(s['station_id'] == station_id for s in r['stops'])]
        candidates = [r for r in here if r['stops'] and r['stops'][-1]['station_id'] in terminals]
        if len(candidates) != 1:
            unmatched.append({'station_id': station_id, 'line': code, 'destination': destination,
                              'note': 'El destino del tablero no es una estación del catálogo' if not terminals
                                      else 'El catálogo no tiene aquí un servicio con ese código y terminal' if not candidates
                                      else f'{len(candidates)} servicios del catálogo terminan ahí'})
            continue
        route = candidates[0]
        record = {'station_id': station_id, 'route_id': route['id'], 'code': code, 'destination': destination,
                  'points': [{'kind': k, 'label': l, 'index': i, 'doors': list(d)} for k, l, i, d in sorted(points)]}
        wagons = stations[station_id].get('wagons')
        if len(points) > 1:
            ambiguous.append(record)
            continue
        kind, label, index, doors = sorted(points)[0]
        if wagons and index > wagons:
            # El punto publicado excede los vagones que el catálogo cuenta: se deja como pendiente
            # en vez de encajarlo a la fuerza en la numeración del simulador.
            ambiguous.append(dict(record, note=f'Índice {index} por encima de los {wagons} vagones del catálogo'))
            continue
        assignments.append({'station_id': station_id, 'route_id': route['id'], 'code': code,
                            'destination': destination, 'kind': kind, 'label': label,
                            'wagon': index, 'doors': list(doors)})

    visits = sum(1 for r in routes for s in r['stops'] if s['kind'] != 'street')
    payload = {
        'schema_version': 1,
        'snapshot': snapshot,
        'built_at': datetime.now(timezone.utc).isoformat(),
        'source': manifest.get('source', 'servicio configurado localmente'),
        'source_sha256': manifest['raw_sha256'],
        'reference_date': raw['reference_date'],
        'windows': raw['windows'],
        'coverage': {'trunk_visits_in_catalogue': visits, 'visits_with_published_point': len(assignments),
                     'ambiguous': len(ambiguous), 'unmatched_departures': len(unmatched),
                     'stations_with_board': len(raw['stations']),
                     'stations_in_catalogue': sum(1 for s in services['stations'] if s['kind'] == 'station')},
        'attribution': 'TRANSMILENIO S.A., tablero de salidas publicado por estación',
        'assignments': assignments,
        'ambiguous': ambiguous,
        'unmatched': unmatched,
        'unparsed': {k: sorted(v) for k, v in sorted(unparsed.items()) if v},
    }
    body = (json.dumps(payload, ensure_ascii=False, indent=2) + '\n').encode()
    OUT.write_bytes(body)
    (ROOT / 'app/dist/station_wagons.json').write_bytes(body)
    print(f'STATION_WAGONS {len(assignments)} asignaciones publicadas de {visits} paradas troncales · '
          f'{len(ambiguous)} ambiguas · {len(unmatched)} salidas sin equivalente · '
          f'sha256 {hashlib.sha256(body).hexdigest()[:12]}')

if __name__ == '__main__':
    main()
