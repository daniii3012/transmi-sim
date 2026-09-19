"""Tie the local service catalogue to the published GTFS and emit the departures the engine runs.

The simulator dispatched on a binary rule —four minutes in peak, eight the rest— identical for the
137 services. The feed publishes the real departure of every trip, so the rule can go. What this
builds is the correspondence between both catalogues and, for every service that matches, the list
of departures per GTFS service_id.

Three decisions, all of them visible in the audit file:

  * Correspondence is exact on code and destination, normalised NFC because the two catalogues come
    from the same family of data and write accents decomposed. Spaces and hyphens are dropped from
    the key as well: the two catalogues write the same destination as «AV CL80 - KR114» and
    «AV CL80 KR114», or «P ElDorado» and «PElDorado». Still not fuzzy matching —it is equality on a
    key that normalises one more separator—, and a service that does not match stays pending and
    keeps the synthetic rule, flagged, instead of being guessed.
  * A local service can map to several GTFS route records. They are calendar or pattern splits of
    the same service —one record for weekdays, another for Saturday— and their departures add up.
  * A GTFS record whose name carries `||`, or whose code joins two codes, is a full round trip
    covering two local services. It is cut in two instead of being discarded. Hanging its departure
    list on both codes would invent a second bus —both halves would leave at once—, so the second
    half departs at the trip's own departure plus the share of the trip that the first half and the
    turn take. One bus does the outward leg and then becomes the return one, which is what the
    record describes. The cut is only made when the arithmetic is exact: published stretches must be
    the first service's, plus one for the turn, plus the second service's. A loop that returns to the
    platform it left from carries one more stretch, the one that closes it; it belongs to neither
    service and is set apart before counting. Anything else stays aside, with the reason written
    down.

Calendars are not collapsed into the project's three day types. What travels to the browser is the
GTFS calendar as published —weekday flags plus added and removed dates— so that which services run
on a date is decided once, by GTFS rules, over the real date.
"""
import csv
import json
import re
import statistics
from statistics import median
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / 'app/dist/services.json'
OUT_APP = ROOT / 'app/dist/schedule.json'
OUT_AUDIT = ROOT / 'data/processed/schedule_audit.json'
SCOPE = ('1', '6')
DAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')


def norm(text):
    """NFC, upper, single spaces. Los dos catálogos escriben los acentos descompuestos."""
    return ' '.join(unicodedata.normalize('NFC', (text or '')).upper().split())


def clave(text):
    """La clave de emparejamiento: como norm, y además sin espacios ni guiones.

    Los dos catálogos separan igual pero escriben distinto: «AV CL80 - KR114» contra «AV CL80
    KR114», «P ElDorado» contra «PElDorado». Quitar el separador no empareja nada que no fuera ya
    el mismo destino —se comprobó sobre el catálogo entero: ningún emparejamiento se pierde ni
    cambia de registro, y ni el paquete ni el catálogo local producen dos destinos distintos bajo
    la misma clave—, así que sigue siendo igualdad exacta y no un parecido.
    """
    return re.sub(r'[\s-]', '', unicodedata.normalize('NFC', (text or '')).upper())


def combined(route):
    """True when the record is a round trip covering two services, not one direction of one."""
    return '||' in route['route_long_name'] or '-' in route['route_short_name'].strip()


def newest(folder):
    latest = folder / 'latest.json'
    if not latest.exists():
        raise SystemExit('Falta data/raw/gtfs/latest.json: ejecutar antes tools/fetch_gtfs.py')
    return folder / json.loads(latest.read_text(encoding='utf-8'))['folder']


def read(path):
    with path.open(encoding='utf-8-sig') as handle:
        return list(csv.DictReader(handle))


def correspondence(routes, catalogue):
    """(matches, pending, combined records). Exact on code and destination, nothing else."""
    index = defaultdict(list)
    aside = []
    for route in routes:
        if route['agency_id'] not in SCOPE:
            continue
        if combined(route):
            aside.append(route)
            continue
        index[(clave(route['route_short_name']), clave(route['route_long_name']))].append(route)
    matches, pending = {}, []
    for service in catalogue:
        if not service.get('ready'):
            continue
        key = (clave(service['code']), clave(service['name']))
        found = index.get(key)
        if not found:
            candidates = sorted({r['route_long_name'] for r in routes
                                 if clave(r['route_short_name']) == key[0] and r['agency_id'] in SCOPE})
            pending.append({'id': service['id'], 'code': service['code'], 'name': service['name'],
                            'dual': bool(service.get('dual')), 'variant': service.get('variant'),
                            'reason': 'sin destino equivalente en el paquete' if candidates else 'el código no está en el paquete',
                            'gtfs_same_code': candidates})
            continue
        matches[service['id']] = found
    return matches, pending, aside


def mitades(route, codigos):
    """(código, destino) de cada lado de un registro de vuelta completa, o None si no se deja leer.

    El destino publicado de una vuelta completa es «M84 KR 7 CLL 73 || C84 Av. Suba K114 D»: cada
    lado empieza por el código del servicio que cubre. Cuando no lo lleva —«CLL134 KR 7 || L82
    Portal 20 de Julio»— el código del lado que falta es el del propio registro, y si el registro
    une dos códigos con guion —«P85-M85»— cada mitad se queda con el suyo, en orden.
    """
    partes = [p.strip() for p in route['route_long_name'].split('||')]
    if len(partes) != 2 or not all(partes):
        return None
    cortos = [p.strip() for p in route['route_short_name'].split('-')]
    salida = []
    for lado, parte in enumerate(partes):
        primero, _, resto = parte.partition(' ')
        if clave(primero) in codigos and resto.strip():
            salida.append((primero, resto.strip()))
        elif len(cortos) == 2:
            salida.append((cortos[lado], parte))
        else:
            salida.append((route['route_short_name'], parte))
    return salida


def partir(aside, catalogue, segments, by_route):
    """Cut every round-trip record into its two halves. (extra matches, cuts made, refusals).

    Un registro de vuelta completa es un viaje: un bus que hace la ida, da la vuelta y hace el
    regreso. El catálogo local lo ve como dos servicios. Cortarlo es repartir sus tramos entre los
    dos —descartando el que une el final de uno con el principio del otro, que el motor ya modela
    como regulación en extremo— y desfasar las salidas de la segunda mitad, que no sale a la hora
    del viaje sino cuando el bus llega al otro extremo. Sin ese desfase las dos mitades saldrían a
    la vez y donde hay un bus aparecerían dos.

    Solo se corta cuando la aritmética es exacta: tramos publicados = los del primer servicio + 1
    + los del segundo. Si no cuadra, el registro se queda apartado con el motivo escrito, porque un
    corte en el sitio equivocado emparejaría trechos de vía que no son los mismos.
    """
    por_clave = {}
    for service in catalogue:
        if service.get('ready'):
            por_clave.setdefault((clave(service['code']), clave(service['name'])), service)
    codigos = {clave(s['code']) for s in catalogue}
    extra, cortes, rechazos, fuera = defaultdict(list), [], [], defaultdict(int)
    for route in sorted(aside, key=lambda r: r['route_id']):
        filas = sorted(segments.get(route['route_id']) or [], key=lambda x: int(x['index']))
        lados = mitades(route, codigos)

        def rechazar(motivo):
            # Los viajes de un registro que no se pudo cortar no desaparecen: son servicio publicado
            # que queda fuera de alcance. Se anotan contra cada mitad que sí se pudo identificar,
            # para que después se vea si lo que sí se emparejó es el servicio o una esquina de él.
            for lado in (lados or []):
                servicio = por_clave.get((clave(lado[0]), clave(lado[1])))
                if servicio:
                    fuera[servicio['id']] += len(by_route.get(route['route_id']) or [])
            rechazos.append({'route_id': route['route_id'], 'short': route['route_short_name'],
                             'long': route['route_long_name'], 'reason': motivo,
                             'trips': len(by_route.get(route['route_id']) or [])})
        if not filas:
            rechazar('el registro no trae tramos publicados')
            continue
        if not lados:
            rechazar('el destino publicado no separa dos servicios')
            continue

        locales = [por_clave.get((clave(c), clave(d))) for c, d in lados]
        if not all(locales):
            falta = ', '.join(f'{c} {d}' for (c, d), s in zip(lados, locales) if not s)
            rechazar(f'sin servicio local utilizable para: {falta}')
            continue
        if locales[0]['id'] == locales[1]['id']:
            rechazar('las dos mitades apuntan al mismo servicio local')
            continue
        cuenta = [len(s.get('stops') or []) - 1 for s in locales]
        # Algunas vueltas regresan al andén desde el que salieron y traen un tramo de más: el que
        # cierra el bucle, que no pertenece a ninguno de los dos servicios porque el local termina en
        # su última parada y no en el andén contrario de la misma estación. Solo se aparta si la
        # cuenta no cuadra sin hacerlo, para no tocar los registros que ya encajaban: en unos el
        # último tramo es parte del recorrido y en otros es el cierre, y la cuenta local es la que
        # distingue uno de otro. Sin esto se descartaba FZ63 entero —los 347 viajes de día laborable
        # de F63 y Z63— y el servicio se quedaba sin un bus entre las cinco de la mañana y las nueve
        # de la noche.
        cierre, utiles = [], filas
        if (cuenta[0] + 1 + cuenta[1] != len(filas) and len(filas) > 1
                and filas[-1]['to_stop'] == filas[0]['from_stop']):
            cierre, utiles = filas[-1:], filas[:-1]
        if min(cuenta) < 1 or cuenta[0] + 1 + cuenta[1] != len(utiles):
            rechazar(f'el catálogo local cuenta {cuenta[0]} + giro + {cuenta[1]} tramos '
                     f'y el paquete {len(utiles)}' + (' más el cierre del bucle' if cierre else ''))
            continue
        # El reparto del viaje se hace sobre su propia duración publicada, no sobre la mediana de
        # los tramos: un viaje de la punta tarda más que uno de la noche y el punto donde da la
        # vuelta se corre con él.
        totales = [float(x['seconds']) for x in filas]
        total = sum(totales)
        if total <= 0:
            rechazar('algún tramo publicado dura cero segundos')
            continue
        # Las proporciones se miden sobre la vuelta entera, cierre incluido, porque la duración
        # publicada del viaje también lo incluye; pero la segunda mitad termina en su última parada
        # y no en el andén de salida, así que su llegada se corta antes del cierre.
        parte_ida = sum(totales[:cuenta[0]]) / total
        parte_giro = sum(totales[:cuenta[0] + 1]) / total
        parte_vuelta = sum(totales[:len(utiles)]) / total
        tramos = [utiles[:cuenta[0]], utiles[cuenta[0] + 1:]]
        metros = [sum(float(x['metres']) for x in bloque) for bloque in tramos]
        registros = []
        for lado in (0, 1):
            rid = f"{route['route_id']}#{'ab'[lado]}"
            segments[rid] = [{**fila, 'index': str(i)} for i, fila in enumerate(tramos[lado])]
            viajes = []
            for trip in by_route.get(route['route_id'], []):
                salida, llegada = int(trip['departure_s']), int(trip['arrival_s'])
                duracion = llegada - salida if llegada > salida else total
                if lado == 0:
                    desde, hasta = salida, salida + round(duracion * parte_ida)
                else:
                    desde = salida + round(duracion * parte_giro)
                    hasta = llegada if not cierre else salida + round(duracion * parte_vuelta)
                viajes.append({**trip, 'route_id': rid, 'departure_s': str(desde),
                               'arrival_s': str(hasta), 'metres': str(metros[lado])})
            by_route[rid] = viajes
            registro = {**route, 'route_id': rid, 'route_short_name': lados[lado][0],
                        'route_long_name': lados[lado][1], 'split_from': route['route_id']}
            registros.append(registro)
            extra[locales[lado]['id']].append(registro)
        cortes.append({
            'route_id': route['route_id'], 'short': route['route_short_name'],
            'long': route['route_long_name'], 'segments': len(utiles),
            'loop_closing_seconds': round(sum(float(x['seconds']) for x in cierre)) if cierre else None,
            'turn_segment': int(utiles[cuenta[0]]['index']),
            'turn_seconds': round(float(utiles[cuenta[0]]['seconds'])),
            'trips': len(by_route.get(route['route_id']) or []),
            'halves': [{'route_id': r['route_id'], 'local_id': locales[i]['id'],
                        'code': locales[i]['code'], 'name': locales[i]['name'],
                        'segments': cuenta[i], 'metres': round(metros[i]),
                        'share_of_trip': round([parte_ida, 1 - parte_giro][i], 4)}
                       for i, r in enumerate(registros)],
        })
    return extra, cortes, rechazos, fuera


BUCKETS = ('peak', 'weekday', 'saturday', 'holiday')


OBSERVADOS = ROOT / 'data/curated/observed_times.json'
# Las cuatro columnas del horario, en el orden en que las escribe running_times, contra el nombre que
# usa la medición. La base va aparte: es la mediana de todas las observaciones del tramo.
FRANJAS = {'peak': 'punta', 'weekday': 'laborable', 'saturday': 'sabado', 'holiday': 'festivo'}


def observado(medidos, fila):
    """[base, punta, laborable, sábado, festivo] medidos para ese tramo, o None si no hay bastante.

    Se exige la base —la mediana de todas las observaciones— y se rellena cada columna con la suya
    cuando la tiene; si a una franja le faltaron observaciones, hereda la base en vez de inventarse.
    Que un tramo no aparezca aquí no es un fallo: significa que el motor sigue con el tiempo publicado
    para ese tramo, que es lo que hacía antes.
    """
    registro = medidos.get(f"{fila['route_id']}|{fila['from_stop']}|{fila['to_stop']}")
    if not registro:
        return None
    base = registro['base']
    return [base] + [registro.get(FRANJAS[b], base) for b in BUCKETS]


def running_times(service, found, by_route, segments, medidos=None):
    """(list of [base, peak, weekday, saturday, holiday] seconds per stretch, or None and a reason).

    The published stretch time carries the dwell inside it, because the feed gives arrival equal to
    departure at every stop. It is handed over raw: what to subtract for dwell and for signals is
    the engine's business, which is where those two are actually modelled.

    Se exige que los dos catálogos cuenten las mismas paradas. Alinear por índice dos secuencias de
    distinto largo emparejaría tramos que no son el mismo trecho de vía, y el error no se vería.
    """
    wanted = len(service.get('stops') or []) - 1
    if wanted < 1:
        return None, 'el servicio local no tiene tramos', None
    # Los registros publicados de un mismo servicio suelen repartirse el calendario: uno lleva los
    # días laborables y otro el sábado. Para cada tipo de día manda el que más viajes aportó a ese
    # tipo; quedarse solo con el registro mayor daría al sábado los tiempos de un martes.
    usable = [r for r in found if len(segments.get(r['route_id']) or []) == wanted]
    if not usable:
        counts = sorted({len(segments.get(r['route_id']) or []) for r in found})
        return None, f'el catálogo local cuenta {wanted} tramos y el paquete {counts}', None
    rows = {r['route_id']: sorted(segments[r['route_id']], key=lambda x: int(x['index'])) for r in usable}
    out, medido = [], []
    for index in range(wanted):
        here = [rows[r['route_id']][index] for r in usable]
        base = median([float(x['seconds']) for x in here])
        if base <= 0:
            return None, 'algún tramo publicado dura cero segundos', None
        entry = [round(base, 1)]
        for bucket in BUCKETS:
            best = max(here, key=lambda x: int(x.get(f'trips_{bucket}') or 0))
            value = best.get(f'seconds_{bucket}')
            # Un tipo de día sin viajes en ningún registro cae al agregado: mejor eso que inventarlo.
            entry.append(round(float(value), 1) if value and int(best[f'trips_{bucket}']) else round(base, 1))
        out.append(entry)
        # La medición se busca en cualquiera de los registros publicados que aporten este tramo: son
        # el mismo trecho de vía y la captura no distingue de cuál de ellos venía el bus.
        medido.append(next((m for m in (observado(medidos or {}, fila) for fila in here) if m), None))
    return out, None, (medido if any(medido) else None)


def percentiles(values):
    if not values:
        return None
    ordered = sorted(values)
    take = lambda q: round(ordered[min(len(ordered) - 1, int(len(ordered) * q))] / 60, 1)
    return {'p10': take(.1), 'p50': take(.5), 'p90': take(.9), 'n': len(ordered)}


def main():
    source = newest(ROOT / 'data/raw/gtfs')
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    routes = read(source / 'routes.txt')
    calendar = read(source / 'calendar.txt')
    exceptions = read(source / 'calendar_dates.txt') if (source / 'calendar_dates.txt').exists() else []
    trips = read(source / 'trunk_trips.csv')
    tramos_crudos = read(source / 'trunk_segments.csv') if (source / 'trunk_segments.csv').exists() else []
    catalogue = json.loads(CATALOGUE.read_text(encoding='utf-8'))['routes']
    # Tiempos medidos en la calle, si los hay. Sin este archivo el horario sale como siempre: el
    # motor usa lo publicado y nada cambia.
    medicion = json.loads(OBSERVADOS.read_text(encoding='utf-8')) if OBSERVADOS.exists() else {}
    medidos = medicion.get('stretches') or {}

    matches, pending, aside = correspondence(routes, catalogue)

    by_route = defaultdict(list)
    for trip in trips:
        by_route[trip['route_id']].append(trip)

    segments = defaultdict(list)
    for row in tramos_crudos:
        segments[row['route_id']].append(row)

    # Las vueltas completas se cortan en sus dos mitades antes de repartir salidas: un servicio
    # puede recibir a la vez sus registros propios y la mitad que le toca de una vuelta completa, y
    # entonces sus salidas son la suma de las dos, que es el servicio entero.
    extra, cortes, rechazos, fuera = partir(aside, catalogue, segments, by_route)
    for local_id, registros in sorted(extra.items()):
        matches[local_id] = list(matches.get(local_id) or []) + registros
    pending = [p for p in pending if p['id'] not in extra]
    # Un emparejamiento que solo alcanza una esquina del servicio es peor que no tenerlo: el motor
    # usa la lista de salidas como si fuera completa, así que despacharía M86 únicamente entre las
    # 22:10 y las 23:00, que es el último viaje del día, y apagaría el resto. Cuando la mayoría de
    # los viajes publicados del servicio está dentro de una vuelta completa que no se pudo cortar,
    # se prefiere la regla sintética, dicho en la lista de pendientes.
    for local_id in sorted(set(matches) & set(fuera)):
        propios = sum(len(by_route.get(r['route_id']) or []) for r in matches[local_id])
        if fuera[local_id] > propios:
            service = next(s for s in catalogue if s['id'] == local_id)
            pending.append({'id': local_id, 'code': service['code'], 'name': service['name'],
                            'dual': bool(service.get('dual')), 'variant': service.get('variant'),
                            'reason': f'{fuera[local_id]} de sus viajes publicados están en vueltas '
                                      f'completas que no se pudieron cortar y solo {propios} quedan '
                                      f'a la vista: se usa la regla sintética antes que un horario a medias',
                            'gtfs_same_code': [r['route_id'] for r in matches[local_id]]})
            del matches[local_id]
    print(f'{len(matches)} servicios emparejados, {len(pending)} pendientes, '
          f'{len(aside)} registros de vuelta completa: {len(cortes)} cortados, {len(rechazos)} apartados')

    salidas, auditoria, sin_tramos = {}, [], []
    for local_id, found in sorted(matches.items()):
        service = next(s for s in catalogue if s['id'] == local_id)
        departures, durations, metres = defaultdict(list), defaultdict(list), []
        for route in found:
            for trip in by_route.get(route['route_id'], []):
                departure, arrival = int(trip['departure_s']), int(trip['arrival_s'])
                departures[trip['service_id']].append(departure)
                durations[trip['service_id']].append(arrival - departure)
                if float(trip['metres']) > 0:
                    metres.append(float(trip['metres']))
        if not any(departures.values()):
            pending.append({'id': local_id, 'code': service['code'], 'name': service['name'],
                            'dual': bool(service.get('dual')), 'variant': service.get('variant'),
                            'reason': 'emparejado pero sin viajes en el paquete',
                            'gtfs_same_code': [r['route_id'] for r in found]})
            continue
        salidas[local_id] = {
            'gtfs': [r['route_id'] for r in found],
            'departures': {k: sorted(v) for k, v in sorted(departures.items())},
        }
        tramos, motivo, medidos_tramo = running_times(service, found, by_route, segments, medidos)
        if tramos:
            salidas[local_id]['segments'] = tramos
        if medidos_tramo:
            salidas[local_id]['observed'] = medidos_tramo
        else:
            sin_tramos.append({'id': local_id, 'code': service['code'], 'name': service['name'],
                               'reason': motivo})
        auditoria.append({
            'id': local_id, 'code': service['code'], 'name': service['name'],
            'dual': bool(service.get('dual')),
            'gtfs': [{'route_id': r['route_id'], 'agency_id': r['agency_id'],
                      'short': r['route_short_name'], 'long': r['route_long_name']} for r in found],
            'trips': sum(len(v) for v in departures.values()),
            'by_service': {k: len(v) for k, v in sorted(departures.items())},
            'duration_min': {k: percentiles(v) for k, v in sorted(durations.items())},
            'metres_median': round(statistics.median(metres)) if metres else None,
            'local_length_m': service.get('length_m'),
            'segments': len(salidas[local_id].get('segments') or []),
            'segments_total_s': round(sum(s[0] for s in salidas[local_id].get('segments') or [])),
        })

    calendario = {row['service_id']: {'days': [int(row[d]) for d in DAYS],
                                      'start': row['start_date'], 'end': row['end_date']}
                  for row in calendar}
    excepciones = defaultdict(lambda: {'added': [], 'removed': []})
    for row in exceptions:
        excepciones[row['service_id']]['added' if row['exception_type'] == '1' else 'removed'].append(row['date'])

    app = {
        'source': {'folder': source.name, 'sha256': manifest['sources'][0]['sha256'],
                   'retrieved_at_utc': manifest['sources'][0]['retrieved_at_utc'],
                   'feed_info': manifest.get('feed_info'), 'url': manifest['sources'][0]['url']},
        'scope': 'Troncal y Dual. Alimentador, zonal y cable quedan fuera.',
        'observed': {k: medicion[k] for k in ('observed_from', 'excluded_reason', 'method',
                                              'parameters', 'coverage')
                     if k in medicion} or None,
        'calendar': calendario,
        'exceptions': {k: v for k, v in sorted(excepciones.items())},
        'routes': salidas,
        'pending': sorted(pending, key=lambda p: (p['code'], p['name'])),
        'without_segments': sorted(sin_tramos, key=lambda p: (p['code'], p['name'])),
    }
    OUT_APP.write_text(json.dumps(app, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

    OUT_AUDIT.parent.mkdir(parents=True, exist_ok=True)
    OUT_AUDIT.write_text(json.dumps({
        'source': app['source'],
        'matched': len(salidas), 'pending': len(app['pending']),
        'combined_records': [{'route_id': r['route_id'], 'short': r['route_short_name'],
                              'long': r['route_long_name']} for r in aside],
        'split_records': cortes,
        'split_refused': sorted(rechazos, key=lambda r: r['route_id']),
        'routes': sorted(auditoria, key=lambda a: (a['code'], a['name'])),
        'still_pending': app['pending'],
        'without_segments': app['without_segments'],
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    for corte in cortes:
        mitades_txt = ' + '.join(f"{h['code']} {h['name']} ({h['segments']} tramos)" for h in corte['halves'])
        print(f"  corte {corte['route_id']} «{corte['long'][:46]}»: {mitades_txt}, "
              f"{corte['trips']} viajes a cada mitad")
    for r in rechazos:
        print(f"  apartado {r['route_id']} «{r['long'][:46]}»: {r['reason']}")
    con = sum(1 for r in salidas.values() if r.get('segments'))
    print(f'{con} servicios con tiempos por tramo, {len(sin_tramos)} sin ellos')
    total = sum(len(v) for r in salidas.values() for v in r['departures'].values())
    print(f'{total:,} salidas en {len(salidas)} servicios -> {OUT_APP.relative_to(ROOT)} '
          f'({OUT_APP.stat().st_size / 1e6:.2f} MB)')
    print(f'auditoría -> {OUT_AUDIT.relative_to(ROOT)}')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
