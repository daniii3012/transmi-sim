"""Shared input for Blender and station generation. No Blender dependency."""
import hashlib
import json
import math
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATH = ROOT / 'data/vehicles/articulado_prototipo.json'


def validate(data):
    if data.get('schema_version') != 1:
        raise ValueError('Unsupported vehicle schema')
    if [m.get('id') for m in data.get('modules', [])] != ['front', 'rear']:
        raise ValueError('Only a two-body articulated vehicle is implemented')
    for field in ['width_m', 'hitch_offset_m']:
        if not isinstance(data[field], (int, float)) or not math.isfinite(data[field]) or data[field] <= 0:
            raise ValueError('Invalid positive dimension: '+field)
    for group in ['collision', 'wheels', 'door_motion', 'body', 'dynamics']:
        for key, value in data[group].items():
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError('Invalid positive value: '+group+'.'+key)
    front, rear = data['modules']
    if len(front['axles']) != 2 or len(rear['axles']) != 1:
        raise ValueError('Expected two front axles and one trailer axle')
    if not front['axles'][0]['steered'] or front['axles'][1]['steered'] or rear['axles'][0]['steered']:
        raise ValueError('Only the first front axle may steer')
    if front['axles'][1]['z_m'] != 0 or front['axles'][0]['z_m'] >= 0 or rear['axles'][0]['z_m'] <= 0:
        raise ValueError('Axles do not match the front-rear-axle / trailer-hitch reference frames')
    if front['z_max_m'] >= data['hitch_offset_m']+rear['z_min_m']:
        raise ValueError('Bodies overlap at the joint')
    ids = set()
    half_opening = data['door_motion']['opening_width_m']/2
    for module in data['modules']:
        start, end = module['z_min_m'], module['z_max_m']
        if not math.isfinite(start) or not math.isfinite(end) or start >= end:
            raise ValueError('Invalid module bounds')
        for axle in module['axles']:
            if not start <= axle['z_m'] <= end:
                raise ValueError('Axle outside body')
        previous_end = -math.inf
        for door in module['doors']:
            z = door['z_m']
            if door['id'] in ids or not door['id']:
                raise ValueError('Door IDs must be unique and nonempty')
            ids.add(door['id'])
            if door['side'] != 'left':
                raise ValueError('Only left boarding is implemented in this prototype')
            if not (start < z-half_opening and z+half_opening < end) or z-half_opening < previous_end:
                raise ValueError('Door opening outside body, unsorted, or overlapping')
            previous_end = z+half_opening
    if not ids:
        raise ValueError('At least one door is required')
    if data['collision']['joint_radius_m'] < data['width_m']/2:
        raise ValueError('Joint collision envelope narrower than body')
    if not 0 < data['dynamics']['max_articulation_deg'] < 90:
        raise ValueError('Articulation angle must be below 90 degrees')
    return data


def load(path=DEFAULT_PATH):
    return validate(json.loads(Path(path).read_text()))


def digest(path=DEFAULT_PATH):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def straight_doors(data):
    return [{'id': door['id'], 'module': module['id'], 'x_m': -data['width_m']/2,
             'z_m': door['z_m']+(data['hitch_offset_m'] if module['id']=='rear' else 0)}
            for module in data['modules'] for door in module['doors']]


def nominal_bounds(data):
    return data['modules'][0]['z_min_m'], data['hitch_offset_m']+data['modules'][1]['z_max_m']
