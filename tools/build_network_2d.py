"""Uncompressed official XY geography and explicitly synthetic isolated test patterns.

Never joins crossing lines or assigns a stop to a different source corridor.
No real commercial service or current works are inferred from these vectors.
"""
import hashlib
import json
from pathlib import Path
from shapely.geometry import LineString, Point, shape
from shapely.ops import transform, substring
from geo import PROJECT, ORIGIN, LOCAL_CRS
from vehicle_definition import load, digest, nominal_bounds

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = '20260909T035301Z'
# Explicit scenario selection. Z is reference only until source vigency is checked.
LOAD_CORRIDORS = {'TZ%03d' % n for n in [1, 2, 3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19]}
COLORS = {'A':'#855446','B':'#43806c','C':'#9b8338','D':'#785c94','E':'#ac6652',
          'F':'#bf493e','G':'#65916a','H':'#62799d','J':'#ba8b34','K':'#4a8891',
          'L':'#936875','M':'#687164','Z':'#90958a'}


def read(path):
    return json.loads(path.read_text())


def points(line):
    return [[round(x, 3), round(y, 3)] for x, y in line.coords]


def component_lines(geometry):
    return list(geometry.geoms) if geometry.geom_type == 'MultiLineString' else [geometry]


def pattern_pair(key, label, corridor, line, stops, scenario):
    output = []
    for direction in [1, -1]:
        directed = line if direction == 1 else LineString(list(line.coords)[::-1])
        ordered = sorted([dict(s, at_m=round(directed.project(Point(s['xy'])), 3)) for s in stops], key=lambda s:s['at_m'])
        output.append({'id': key+('~f' if direction == 1 else '~r'),
            'reverse_id': key+('~r' if direction == 1 else '~f'),
            'label': label+(' · ida' if direction == 1 else ' · regreso'),
            'corridor_id': corridor['id'], 'color': corridor['color'], 'scenario':scenario,
            'status': 'synthetic_not_commercial_service', 'points': points(directed),
            'length_m': directed.length, 'stops': [{'station_id':s['id'], 'name':s['name'], 'at_m':s['at_m']} for s in ordered],
            'max_speed_mps': 13.89, 'dwell_s': 18, 'terminal_s': 35})
    return output


def build():
    folder = ROOT / 'data/raw' / SNAPSHOT
    raw_stations = read(folder/'stations.geojson')['features']
    stations = [{'id':f['properties']['num_est'], 'name':f['properties']['nom_est'],
                 'corridor_id':f['properties']['id_trazado'],
                 'xy':list(PROJECT.transform(*f['geometry']['coordinates'])),
                 'lon_lat':f['geometry']['coordinates']} for f in raw_stations]
    corridors, patterns, audit = [], [], []
    for f in read(folder/'corridors.geojson')['features']:
        p = f['properties']
        lines = component_lines(transform(PROJECT.transform, shape(f['geometry'])))
        c = {'id':p['id_trazado'], 'name':p['nom_traz'], 'zone':p['le_troncal'],
             'color':COLORS.get(p['le_troncal'], '#78857e'), 'source_properties':p,
             'components':[points(line) for line in lines]}
        corridors.append(c)
        for i, line in enumerate(lines):
            same = [s for s in stations if s['corridor_id']==c['id'] and line.distance(Point(s['xy'])) <= 35]
            eligible = c['id'] in LOAD_CORRIDORS and line.length >= 400 and len(same)>=2
            # Exclude almost-coincident stops from trials; source markers stay intact.
            ordered = sorted(same, key=lambda s:line.project(Point(s['xy'])))
            if any(line.project(Point(b['xy']))-line.project(Point(a['xy']))<40 for a,b in zip(ordered,ordered[1:])):
                eligible = False
            audit.append({'component':f'{c["id"]}:{i}', 'length_m':line.length,
                          'matched_station_ids':[s['id'] for s in same], 'load_trial':eligible})
            if eligible:
                patterns.extend(pattern_pair(f'load:{c["id"]}:{i}', f'Ensayo {c["name"]} / {i+1}', c, line, same, 'load'))
            if c['id']=='TZ009' and all(any(s['id']==sid for s in same) for sid in ['05101','05102','05103']):
                selected = [next(s for s in same if s['id']==sid) for sid in ['05101','05102','05103']]
                if line.project(Point(selected[0]['xy']))>line.project(Point(selected[-1]['xy'])):
                    line = LineString(list(line.coords)[::-1])
                pilot = substring(line, line.project(Point(selected[0]['xy']))-180, line.project(Point(selected[-1]['xy']))+180)
                patterns.extend(pattern_pair('pilot:americas', 'Mandalay–Marsella', c, pilot, selected, 'pilot'))
    if len([p for p in patterns if p['scenario']=='pilot']) != 2:
        raise ValueError('Expected exactly one independent component through pilot stations')
    xy = [xy for c in corridors for line in c['components'] for xy in line]
    vehicle = load(); bounds = nominal_bounds(vehicle)
    return {'schema_version':1, 'revision':'network2d-v1', 'source_snapshot':SNAPSHOT,
        'origin_lon_lat':ORIGIN, 'projection':LOCAL_CRS.to_string(), 'coordinate_frame':'XY east/north, metres; no compression',
        'source_sha256':{name:hashlib.sha256((folder/name).read_bytes()).hexdigest() for name in ['corridors.geojson','stations.geojson']},
        'attribution':'TRANSMILENIO S.A. / IDECA · CC BY 4.0 · reproyección y selección de ensayo',
        'bounds':[min(p[0] for p in xy), min(p[1] for p in xy), max(p[0] for p in xy), max(p[1] for p in xy)],
        'vehicle':{'id':vehicle['id'], 'label':'Articulado de ensayo', 'length_m':bounds[1]-bounds[0], 'width_m':vehicle['width_m'], 'sha256':digest()},
        'assumptions':{'station_snap_max_m':35, 'min_station_spacing_m':40, 'min_gap_m':5,
                       'directional_display_offset_m':3, 'terminal_turn':'abstract same-coordinate reversal, no actual turn geometry',
                       'load_scenario':'isolated source components; no junctions, overtaking, schedules, verified routes or demand',
                       'source_validity':'download date is not proof of operational status on that date'},
        'corridors':corridors, 'stations':stations, 'patterns':patterns, 'component_audit':audit}


def main():
    data = build()
    out = ROOT/'app/dist/network.json'; out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps({'corridors':len(data['corridors']), 'stations':len(data['stations']),
                      'components':len(data['component_audit']), 'directed_trial_patterns':len(data['patterns']),
                      'pilot_length_m':next(p['length_m'] for p in data['patterns'] if p['scenario']=='pilot')},indent=2))

if __name__ == '__main__':
    main()
