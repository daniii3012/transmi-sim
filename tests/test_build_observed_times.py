"""Lo que la medición de tiempos entre paradas afirma, sobre transiciones escritas a mano.

Biblioteca estándar. No toca las capturas: lo que se fija es a qué franja va cada observación, el
mínimo por debajo del cual no se da un tiempo, y que una franja floja herede sin inventarse nada.
"""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

from build_observed_times import MINIMO, PUNTA, franja, resumir

BOGOTA = timezone(timedelta(hours=-5))


def sello(fecha, hora):
    return int(datetime(*fecha, hora, 0, tzinfo=BOGOTA).timestamp())


class Franjas(unittest.TestCase):
    def test_un_martes_a_las_siete_es_punta(self):
        self.assertEqual(franja(sello((2026, 9, 15), 7), ()), 'punta')

    def test_un_martes_a_mediodia_es_valle(self):
        self.assertEqual(franja(sello((2026, 9, 15), 12), ()), 'laborable')

    def test_el_sabado_y_el_domingo_tienen_su_propia_franja(self):
        self.assertEqual(franja(sello((2026, 9, 19), 7), ()), 'sabado')
        self.assertEqual(franja(sello((2026, 9, 20), 7), ()), 'festivo')

    def test_un_festivo_cuenta_como_domingo_aunque_caiga_en_lunes(self):
        """El 12 de octubre de 2026 es lunes festivo: un laborable ahí falsearía la punta."""
        self.assertEqual(franja(sello((2026, 10, 12), 7), {'2026-10-12'}), 'festivo')
        self.assertEqual(franja(sello((2026, 10, 12), 7), ()), 'punta')

    def test_las_horas_punta_son_las_del_proyecto(self):
        self.assertEqual(PUNTA, (6, 7, 8, 16, 17, 18, 19))


class Resumen(unittest.TestCase):
    def test_un_tramo_con_pocas_observaciones_no_da_tiempo(self):
        pocas = {('R1', 'A', 'B'): {'laborable': [100] * (MINIMO - 1)}}
        self.assertEqual(resumir(pocas)[0], {})

    def test_la_franja_floja_no_aparece_pero_el_tramo_si(self):
        """Mejor un tramo con base y sin punta que una punta inventada con tres observaciones."""
        datos = {('R1', 'A', 'B'): {'laborable': [100] * MINIMO, 'punta': [500, 500]}}
        salida, _ = resumir(datos)
        registro = salida['R1|A|B']
        self.assertEqual(registro['laborable'], 100)
        self.assertNotIn('punta', registro)
        self.assertEqual(registro['n'], MINIMO + 2)

    def test_la_base_es_la_mediana_de_todo_lo_observado(self):
        datos = {('R1', 'A', 'B'): {'laborable': [10] * MINIMO, 'punta': [30] * MINIMO}}
        salida, franjas = resumir(datos)
        registro = salida['R1|A|B']
        self.assertEqual(registro['base'], 20)
        self.assertEqual(registro['laborable'], 10)
        self.assertEqual(registro['punta'], 30)
        self.assertEqual(franjas, {'laborable': 1, 'punta': 1})


if __name__ == '__main__':
    unittest.main()
