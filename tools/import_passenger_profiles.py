"""Map aggregate validation snapshots to logical stations. No transactions.

Prefers the multi-day period aggregate, which carries a separate hourly profile per day
type, and falls back to the original single-day file when no period aggregate exists.
The scenario used to estimate Saturday and Sunday as flat reductions of one Wednesday;
with several days observed those two profiles are measured instead of assumed.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PERIOD = ROOT / 'data/processed/validations_20260824_20260909.json'
SINGLE = ROOT / 'data/processed/validations_20260909.json'
DAY_TYPES = ('weekday', 'saturday', 'holiday')


def logical(code, curated, by_id):
    """Logical station id for a recaudo code, or None when it is excluded/unknown."""
    if code in curated['excluded']:
        return None
    sid = curated['aliases'].get(code, str(int(code)) if code.isdigit() else '')
    return sid if sid in by_id else None


def from_period(source, curated, by_id):
    raw = json.loads(source.read_text())
    profiles, unmatched = {}, []
    for row in raw['profiles']:
        sid = logical(row['station_code'], curated, by_id)
        if sid is None:
            if row['station_code'] not in curated['excluded'] and row['station_code'] not in unmatched:
                unmatched.append(row['station_code'])
            continue
        entry = profiles.setdefault(sid, {
            'station_id': sid, 'name': by_id[sid]['name'],
            'hourly_by_day_type': {k: [0.0] * 24 for k in DAY_TYPES},
            'days_observed': {}, 'source_codes': [],
        })
        for kind in DAY_TYPES:
            measured = row['day_types'].get(kind)
            if not measured:
                continue
            entry['days_observed'][kind] = measured['days_observed']
            for hour, value in enumerate(measured['hourly_mean']):
                entry['hourly_by_day_type'][kind][hour] += value
        if row['station_code'] not in entry['source_codes']:
            entry['source_codes'].append(row['station_code'])
    for entry in profiles.values():
        for kind in DAY_TYPES:
            entry['hourly_by_day_type'][kind] = [round(v, 3) for v in entry['hourly_by_day_type'][kind]]
        # `hourly` stays as the weekday profile so anything reading the old field keeps working.
        entry['hourly'] = entry['hourly_by_day_type']['weekday']
        entry['total'] = round(sum(entry['hourly']), 1)
    return raw, profiles, unmatched


def from_single(source, curated, by_id):
    raw = json.loads(source.read_text())
    profiles, unmatched = {}, []
    for row in raw['hourly_counts']:
        sid = logical(row['station_code'], curated, by_id)
        if sid is None:
            if row['station_code'] not in curated['excluded'] and row['station_code'] not in unmatched:
                unmatched.append(row['station_code'])
            continue
        entry = profiles.setdefault(sid, {'station_id': sid, 'name': by_id[sid]['name'], 'hourly': [0] * 24, 'source_codes': []})
        entry['hourly'][int(row['hour'].split(':')[0])] += row['total']
        if row['station_code'] not in entry['source_codes']:
            entry['source_codes'].append(row['station_code'])
    for entry in profiles.values():
        entry['total'] = sum(entry['hourly'])
    return raw, profiles, unmatched


def build(source: Path):
    curated = json.loads((ROOT / 'data/curated/validation_stations.json').read_text())
    services = json.loads((ROOT / 'app/dist/services.json').read_text())
    by_id = {str(int(s['id'])): s for s in services['stations'] if s['id'].isdigit()}
    period = 'profiles' in json.loads(source.read_text()) and 'day_types' in json.loads(source.read_text())['profiles'][0]
    raw, profiles, unmatched = (from_period if period else from_single)(source, curated, by_id)

    document = {
        'source_aggregate': str(source.relative_to(ROOT)),
        'aggregate_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'observed_validations': raw['rows_aggregated'],
        'matched_validations': round(sum(p['total'] for p in profiles.values()), 1),
        'unmatched_codes': unmatched,
        'profiles': sorted(profiles.values(), key=lambda p: p['station_id']),
    }
    if period:
        document.update({
            'period': raw['period'], 'days_by_type': raw['days_by_type'],
            'sources': [{k: s[k] for k in ('file', 'date', 'day_type', 'rows', 'sha256')} for s in raw['sources']],
            'limitations': [
                f"Medias de {raw['period']['days']} días observados: {len(raw['days_by_type'].get('weekday', []))} de semana, "
                f"{len(raw['days_by_type'].get('saturday', []))} sábados y {len(raw['days_by_type'].get('holiday', []))} domingos. "
                "No es una predicción de otros meses ni una matriz origen-destino.",
                'Sábado y domingo/festivo ya no son una reducción estimada del día de semana: se miden.',
                'La dirección y el destino siguen estimados. Una validación es un acceso registrado, no un viaje completo.',
                'Correspondencias de accesos/temporales curadas en validation_stations.json.',
            ],
        })
    else:
        document.update({
            'source_url': raw['source_url'], 'source_date': raw['period'], 'source_sha256': raw['source_sha256'],
            'limitations': [
                'Un único miércoles observado: comparación histórica, no predicción de septiembre entero.',
                'La dirección y el destino se estiman. Validaciones no equivalen a OD completo.',
                'Otros días de semana reutilizan el perfil; fines de semana son una reducción estimada.',
                'Correspondencias de accesos/temporales curadas en validation_stations.json.',
            ],
        })
    return document


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=None, help='aggregate to import; defaults to the period file when present')
    args = parser.parse_args()
    source = args.source or (PERIOD if PERIOD.exists() else SINGLE)
    data = build(source)
    (ROOT / 'app/dist/demand.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    kinds = data.get('days_by_type') and {k: len(v) for k, v in data['days_by_type'].items()}
    print(f"perfiles {len(data['profiles'])} · desde {source.name} · días {kinds or 1} · "
          f"emparejadas {data['matched_validations']} · sin emparejar {data['unmatched_codes']}")
