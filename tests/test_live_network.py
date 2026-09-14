"""The open network snapshot: what it reads, what it refuses and what it admits not knowing.

Standard library only, and nothing here touches the network: the feed is built byte by byte so the
decoder is exercised against bytes it has to survive, not against a good day in Bogotá.
"""
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

import live_network
from gtfs_rt import posiciones


def field(number, kind):
    return bytes([number << 3 | kind])


def delimited(number, payload):
    return field(number, 2) + bytes([len(payload)]) + payload


def varint(number, value):
    out, v = bytearray(field(number, 0)), value
    while True:
        byte = v & 0x7F
        v >>= 7
        out.append(byte | (0x80 if v else 0))
        if not v:
            return bytes(out)


def vehicle(bus='7001', route='13307', lat=4.65, lon=-74.06, stamp=1789000000, plate='ABC123'):
    trip = delimited(1, b'TD1.1.' + route.encode()) + delimited(5, route.encode())
    position = field(1, 5) + struct.pack('<f', lat) + field(2, 5) + struct.pack('<f', lon)
    descriptor = delimited(1, bus.encode()) + delimited(3, plate.encode())
    body = delimited(1, trip) + delimited(2, position) + varint(5, stamp) + delimited(8, descriptor)
    return delimited(2, delimited(4, body))


def feed(*vehicles, header_stamp=1788000000):
    return delimited(1, delimited(1, b'2.0') + varint(3, header_stamp)) + b''.join(vehicles)


class Decoder(unittest.TestCase):
    def test_the_clock_is_the_vehicles_stamp_and_not_the_frozen_header(self):
        """La cabecera del alimentador lleva días congelada; leerla daría una hora de hace días."""
        stamp, rows = posiciones(feed(vehicle(stamp=1789000000), header_stamp=1788000000))
        self.assertEqual(stamp, 1789000000)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['bus'], '7001')
        self.assertEqual(rows[0]['placa'], 'ABC123')
        self.assertEqual(rows[0]['ruta'], '13307')

    def test_an_entity_without_a_vehicle_is_skipped_not_guessed(self):
        alert_only = delimited(2, delimited(1, b'id') + delimited(5, b'x'))
        _, rows = posiciones(feed(vehicle(), alert_only))
        self.assertEqual(len(rows), 1)

    def test_a_missing_position_reads_as_missing(self):
        body = delimited(1, delimited(5, b'13307')) + delimited(8, delimited(1, b'7002'))
        _, rows = posiciones(feed(delimited(2, delimited(4, body))))
        self.assertIsNone(rows[0]['lat'])
        self.assertIsNone(rows[0]['lon'])


class Snapshot(unittest.TestCase):
    def setUp(self):
        self.net = live_network.LiveNetwork()
        self.net.routes = {'13307': ('Troncal', 'B12', 'P. Norte', '349'),
                           '13999': ('Dual', 'M82', 'CLL134 - KR 7', None),
                           '20001': ('Alimentador', 'A12', 'Suba', None)}
        self.net.origin = (-74.136, 4.63027)

    def serve(self, raw, include_zonal=False):
        self.net.fetch = lambda: raw
        self.net.cache = None
        return self.net.snapshot(include_zonal=include_zonal)

    def test_only_trunk_and_dual_survive_and_the_rest_is_not_counted_as_an_error(self):
        state, payload = self.serve(feed(vehicle(route='13307'), vehicle(bus='9', route='40000')))
        self.assertEqual(state, 'ok')
        self.assertEqual(len(payload['vehicles']), 1)
        self.assertEqual(payload['seen'], 2)
        self.assertEqual(payload['dropped'], 0)

    def test_a_zonal_vehicle_is_hidden_by_default_and_shown_when_asked(self):
        state, payload = self.serve(feed(vehicle(route='13307'), vehicle(bus='9', route='20001')))
        self.assertEqual(len(payload['vehicles']), 1, 'oculto por defecto')
        self.assertEqual(payload['zonal_seen'], 1, 'pero contado igual, para poder avisar')
        state, payload = self.serve(feed(vehicle(route='13307'), vehicle(bus='9', route='20001')), include_zonal=True)
        self.assertEqual(len(payload['vehicles']), 2)
        zonal = next(v for v in payload['vehicles'] if v['id'] == '9')
        self.assertEqual(zonal['operator'], 'Alimentador')
        self.assertEqual(zonal['line'], 'A12')
        # Un zonal sin línea local no es un troncal que el simulador no tenga: no debe inflar `unmatched`.
        self.assertEqual(payload['unmatched'], 0)

    def test_a_route_outside_the_local_catalogue_is_drawn_and_counted_apart(self):
        """Circula de verdad: esconderlo mentiría, y contarlo callando también."""
        state, payload = self.serve(feed(vehicle(route='13999')))
        self.assertEqual(payload['unmatched'], 1)
        self.assertIsNone(payload['vehicles'][0]['line_id'])
        self.assertEqual(payload['vehicles'][0]['line'], 'M82')

    def test_a_position_outside_bogota_is_dropped_and_said(self):
        state, payload = self.serve(feed(vehicle(lat=40.4, lon=-3.7)))
        self.assertEqual(payload['vehicles'], [])
        self.assertEqual(payload['dropped'], 1)

    def test_the_build_age_is_published_so_a_stale_feed_is_visible(self):
        import time
        state, payload = self.serve(feed(vehicle(stamp=int(time.time()) - 300)))
        self.assertGreater(payload['build_age_s'], 290)

    def test_the_projection_matches_the_one_the_simulator_uses(self):
        """En el origen del marco la proyección da cero, salvo lo que el propio feed no puede decir.

        Las posiciones viajan en coma flotante de 32 bits, así que traen del orden de un metro de
        cuantización: un bus queda donde el alimentador puede decir que está, no más fino que eso.
        """
        state, payload = self.serve(feed(vehicle(lat=4.63027, lon=-74.136)))
        x, y = payload['vehicles'][0]['xy']
        self.assertLess(abs(x), 2)
        self.assertLess(abs(y), 2)
        # Y un desplazamiento conocido se proyecta a su distancia, no a una escala cualquiera.
        state, payload = self.serve(feed(vehicle(lat=4.63027, lon=-74.126)))
        self.assertAlmostEqual(payload['vehicles'][0]['xy'][0], 1108.5, delta=3)

    def test_a_second_reading_inside_the_window_does_not_ask_again(self):
        calls = []

        def once():
            calls.append(1)
            return feed(vehicle())
        self.net.fetch = once
        self.net.cache = None
        self.net.snapshot()
        self.net.snapshot()
        self.assertEqual(len(calls), 1)

    def test_without_a_local_catalogue_it_says_unavailable_instead_of_failing(self):
        net = live_network.LiveNetwork()
        net.prepare = lambda: (_ for _ in ()).throw(FileNotFoundError('sin paquete'))
        state, payload = net.snapshot()
        self.assertEqual(state, 'unavailable')
        self.assertIn('detail', payload)


if __name__ == '__main__':
    unittest.main()
