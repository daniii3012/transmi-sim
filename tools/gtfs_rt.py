"""Read the published GTFS-Realtime vehicle feed with nothing but the standard library.

The official gtfs-realtime-bindings package needs protobuf from pip. Here the fields are read by
number, which is all this project needs and does not force an install on the machine that captures
nor on the one that serves the simulator. Both use this module, so there is one decoder and not two.

Dos cosas del alimentador publicado que se resuelven aquí, no en quien lo use:

  * `FeedHeader.timestamp` lleva días congelado en el mismo valor. El sello que sí avanza es el que
    traen los vehículos, y es el que se devuelve como reloj del lote.
  * Ese sello es idéntico para los 5.500 vehículos: es la hora en que se construyó el lote, no la
    del GPS de cada bus. Cada vehículo refresca a su ritmo y el feed repite mientras tanto su última
    posición conocida, así que dos lotes seguidos pueden mostrar un bus quieto y luego dar un salto
    que es ponerse al día y no velocidad. Quien derive velocidades de aquí se equivocará; los
    cambios de parada, no.

El `VehicleDescriptor` trae tres campos y aquí se leen los tres. El segundo, `label`, es el número
de flota que el vehículo lleva pintado —`E0067`, `K10657`— y de él sale el tipo de carrocería: ver
`tools/classify_fleet.py` y docs/TIPOS_DE_BUS_20260912.md. Se leyó tarde: las capturas anteriores a
esa fecha solo guardaron identificador y placa, y para ellas la etiqueta se reconstruye a partir del
identificador.
"""
import json
import struct
from pathlib import Path

# Las direcciones del alimentador se leen de aquí y no se versionan, como las de en_vivo.local.json.
# El repositorio nombra la fuente —el GTFS de TRANSMILENIO S.A., dato abierto— pero no la sirve.
LOCAL = Path(__file__).resolve().parent / 'gtfs.local.json'
AGENCIES = {'1': 'Troncal', '2': 'Alimentador', '3': 'Zonal urbano', '4': 'Zonal complementario',
            '5': 'Zonal especial', '6': 'Dual', '7': 'Cable'}
TRUNK = ('Troncal', 'Dual')
ATTRIBUTION = 'GTFS-Realtime de TRANSMILENIO S.A., datos abiertos'

_direcciones = {}
if LOCAL.exists():
    try:
        _direcciones = json.loads(LOCAL.read_text())
    except (OSError, ValueError):
        _direcciones = {}
if _direcciones.get('positions'):
    POSITIONS = _direcciones['positions']
if _direcciones.get('gtfs'):
    GTFS = _direcciones['gtfs']
if _direcciones.get('manifest'):
    MANIFEST = _direcciones['manifest']


def __getattr__(name):
    """Sin configuración local, nombrar una dirección dice qué falta en vez de fallar al usarla."""
    if name in ('POSITIONS', 'GTFS', 'MANIFEST'):
        raise AttributeError(
            f'Falta la clave de {name} en {LOCAL.name}, que no se versiona. Las lecturas de este '
            'módulo salen del GTFS de TRANSMILENIO S.A.; su dirección se configura en local.')
    raise AttributeError(name)


def _varint(buf, i):
    result = shift = 0
    while True:
        byte = buf[i]
        i += 1
        result |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return result, i


def campos(buf):
    """Yields (field number, value) walking a message once."""
    i = 0
    while i < len(buf):
        key, i = _varint(buf, i)
        number, kind = key >> 3, key & 7
        if kind == 0:
            value, i = _varint(buf, i)
        elif kind == 1:
            value = struct.unpack('<d', buf[i:i + 8])[0]
            i += 8
        elif kind == 2:
            length, i = _varint(buf, i)
            value = buf[i:i + length]
            i += length
        elif kind == 5:
            value = struct.unpack('<f', buf[i:i + 4])[0]
            i += 4
        else:
            raise ValueError(f'Tipo de campo {kind} no soportado')
        yield number, value


def mensaje(buf):
    """Last value of each field, which is what every field read here needs."""
    return {number: value for number, value in campos(buf)}


def texto(value):
    return value.decode('utf-8', 'replace') if isinstance(value, bytes) else ''


def posiciones(raw):
    """(build stamp, vehicles) from the bytes of positions.pb.

    The stamp is the one the vehicles carry; FeedHeader's is discarded on purpose. Lat and lon may
    be None when the feed omits the position, and the caller decides what to do about it.
    """
    stamp, out = None, []
    for number, value in campos(raw):
        if number != 2:
            continue
        entity = mensaje(value)
        if 4 not in entity:
            continue
        vehicle = mensaje(entity[4])
        trip = mensaje(vehicle[1]) if 1 in vehicle else {}
        position = mensaje(vehicle[2]) if 2 in vehicle else {}
        descriptor = mensaje(vehicle[8]) if 8 in vehicle else {}
        stamp = vehicle.get(5) or stamp
        out.append({
            'bus': texto(descriptor.get(1)), 'etiqueta': texto(descriptor.get(2)),
            'placa': texto(descriptor.get(3)),
            'viaje': texto(trip.get(1)), 'ruta': texto(trip.get(5)),
            'lat': position.get(1), 'lon': position.get(2),
            'parada': texto(vehicle.get(7)), 'secuencia': vehicle.get(3),
        })
    return stamp, out
