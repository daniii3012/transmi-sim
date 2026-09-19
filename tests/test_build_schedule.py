"""Cómo se ata el catálogo local al paquete publicado, sobre registros hechos a mano.

Solo biblioteca estándar, como el módulo que prueba. Ninguna prueba toca la red ni el paquete
descargado: lo que se fija aquí es el significado de un emparejamiento y de un corte, no volver a
medir Bogotá.
"""
import sys
import unittest
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

from build_schedule import clave, correspondence, mitades, partir


def registro(route_id, short, long, agency='6'):
    return {'route_id': route_id, 'route_short_name': short, 'route_long_name': long,
            'agency_id': agency}


def servicio(sid, code, name, paradas, ready=True):
    return {'id': sid, 'code': code, 'name': name, 'ready': ready,
            'stops': [{'station_id': str(i)} for i in range(paradas)]}


def tramo(route_id, index, seconds, metres=500.0):
    return {'route_id': route_id, 'index': str(index), 'from_stop': f'a{index}',
            'to_stop': f'a{index + 1}', 'metres': str(metres), 'seconds': str(seconds),
            'trips': '10', 'seconds_peak': str(seconds), 'seconds_weekday': str(seconds),
            'seconds_saturday': str(seconds), 'seconds_holiday': str(seconds),
            'trips_peak': '2', 'trips_weekday': '4', 'trips_saturday': '3', 'trips_holiday': '1'}


def viaje(route_id, departure, arrival, service='1'):
    return {'trip_id': f'{route_id}.{departure}', 'route_id': route_id, 'service_id': service,
            'departure_s': str(departure), 'arrival_s': str(arrival), 'metres': '10000',
            'stops': '10', 'first_stop': 'a0', 'last_stop': 'a1', 'shape_id': 's'}


class Clave(unittest.TestCase):
    def test_separators_do_not_decide_a_match(self):
        """Los dos catálogos escriben el mismo destino con y sin guion, y con y sin espacio."""
        self.assertEqual(clave('AV CL80 - KR114'), clave('AV CL80 KR114'))
        self.assertEqual(clave('P ElDorado'), clave('PElDorado'))
        self.assertEqual(clave('KR 7 - CLL 107A'), clave('KR 7 CLL 107A'))

    def test_it_is_still_equality_and_not_resemblance(self):
        """Relajar el separador no debe juntar dos destinos que son distintos."""
        self.assertNotEqual(clave('Portal Suba'), clave('Portal Usme'))
        self.assertNotEqual(clave('K7 - CL100'), clave('K7 - CL101'))

    def test_a_hyphenated_destination_matches_the_package(self):
        routes = [registro('1', 'D81', 'AV CL80 KR114')]
        catalogo = [servicio('619', 'D81', 'AV CL80 - KR114', 25)]
        matches, pending, aside = correspondence(routes, catalogo)
        self.assertEqual(list(matches), ['619'])
        self.assertEqual(pending, [])


class Mitades(unittest.TestCase):
    def test_each_side_carries_its_own_code(self):
        got = mitades(registro('1', 'MC84', 'M84 KR 7 CLL 73 || C84 Av. Suba K114 D'),
                      {clave('M84'), clave('C84')})
        self.assertEqual(got, [('M84', 'KR 7 CLL 73'), ('C84', 'Av. Suba K114 D')])

    def test_a_side_without_code_takes_the_record_s_own(self):
        """«CLL134 KR 7 || L82 Portal 20 de Julio» con código M82: el lado mudo es el del registro."""
        got = mitades(registro('1', 'M82', 'CLL134 KR 7 || L82 Portal 20 de Julio'),
                      {clave('M82'), clave('L82')})
        self.assertEqual(got, [('M82', 'CLL134 KR 7'), ('L82', 'Portal 20 de Julio')])

    def test_a_joined_short_name_gives_one_code_to_each_side(self):
        got = mitades(registro('1', 'P85-M85', 'AV 68 Calle 9 || Museo Nacional'), set())
        self.assertEqual(got, [('P85', 'AV 68 Calle 9'), ('M85', 'Museo Nacional')])

    def test_a_record_that_does_not_separate_two_services_is_not_read(self):
        self.assertIsNone(mitades(registro('1', 'K86', 'Aeropuerto'), set()))


class Partir(unittest.TestCase):
    def escenario(self, tramos_publicados, paradas_a, paradas_b, duracion=1000):
        route = registro('9', 'MC84', 'M84 ida || C84 vuelta')
        catalogo = [servicio('a', 'M84', 'ida', paradas_a), servicio('b', 'C84', 'vuelta', paradas_b)]
        segments = defaultdict(list)
        segments['9'] = [tramo('9', i, 100) for i in range(tramos_publicados)]
        by_route = defaultdict(list)
        by_route['9'] = [viaje('9', 20000, 20000 + duracion), viaje('9', 30000, 30000 + duracion)]
        return route, catalogo, segments, by_route

    def test_an_exact_round_trip_is_cut_in_two(self):
        """Tramos publicados = los de la ida + el giro + los de la vuelta."""
        route, catalogo, segments, by_route = self.escenario(9, 5, 5)
        extra, cortes, rechazos, fuera = partir([route], catalogo, segments, by_route)
        self.assertEqual(rechazos, [])
        self.assertEqual(len(cortes), 1)
        self.assertEqual(sorted(extra), ['a', 'b'])
        self.assertEqual(len(segments['9#a']), 4)
        self.assertEqual(len(segments['9#b']), 4)
        self.assertEqual([s['index'] for s in segments['9#b']], ['0', '1', '2', '3'])

    def test_the_return_leaves_when_the_outward_has_arrived(self):
        """Sin el desfase las dos mitades saldrían a la vez y un bus se vería como dos."""
        route, catalogo, segments, by_route = self.escenario(9, 5, 5, duracion=900)
        partir([route], catalogo, segments, by_route)
        for ida, vuelta in zip(by_route['9#a'], by_route['9#b']):
            self.assertLess(int(ida['departure_s']), int(vuelta['departure_s']))
            self.assertLessEqual(int(ida['arrival_s']), int(vuelta['departure_s']))
            self.assertEqual(int(vuelta['arrival_s']) - int(ida['departure_s']), 900)
        # Cuatro tramos de ida y el giro sobre nueve: la vuelta sale al 5/9 del viaje.
        self.assertEqual(int(by_route['9#b'][0]['departure_s']) - 20000, 500)

    def test_a_cut_that_does_not_add_up_is_refused_with_its_reason(self):
        """Cortar por donde no es emparejaría trechos de vía que no son el mismo."""
        route, catalogo, segments, by_route = self.escenario(9, 5, 6)
        extra, cortes, rechazos, fuera = partir([route], catalogo, segments, by_route)
        self.assertEqual(cortes, [])
        self.assertEqual(extra, {})
        self.assertIn('4 + giro + 5', rechazos[0]['reason'])
        self.assertEqual(rechazos[0]['trips'], 2)

    def test_what_cannot_be_cut_is_counted_against_each_half(self):
        """Esos viajes existen: son servicio publicado que queda fuera de alcance, y se dice."""
        route, catalogo, segments, by_route = self.escenario(9, 5, 6)
        extra, cortes, rechazos, fuera = partir([route], catalogo, segments, by_route)
        self.assertEqual(dict(fuera), {'a': 2, 'b': 2})

    def test_a_half_without_a_usable_local_service_is_not_guessed(self):
        route, catalogo, segments, by_route = self.escenario(9, 5, 5)
        catalogo[1]['ready'] = False
        extra, cortes, rechazos, fuera = partir([route], catalogo, segments, by_route)
        self.assertEqual(cortes, [])
        self.assertIn('sin servicio local utilizable', rechazos[0]['reason'])

    def test_both_halves_pointing_at_one_service_is_refused(self):
        """Un bus no sale dos veces de la misma cabecera por el mismo viaje."""
        route = registro('9', 'K86', 'ida || ida')
        catalogo = [servicio('a', 'K86', 'ida', 5)]
        segments = defaultdict(list, {'9': [tramo('9', i, 100) for i in range(9)]})
        by_route = defaultdict(list, {'9': [viaje('9', 20000, 21000)]})
        extra, cortes, rechazos, fuera = partir([route], catalogo, segments, by_route)
        self.assertEqual(cortes, [])
        self.assertIn('mismo servicio local', rechazos[0]['reason'])


if __name__ == '__main__':
    unittest.main()
