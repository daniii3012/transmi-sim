"""Lo que la deducción de tipo de bus afirma, sobre etiquetas escritas a mano.

Biblioteca estándar, como el módulo que prueba. Nada de aquí toca la red ni las capturas: lo que se
fija es la lectura de la etiqueta y la regla que decide cuándo un servicio queda sin resolver, no el
recuento de una jornada concreta.
"""
import csv
import gzip
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

from classify_fleet import etiqueta_desde_id, leer, partir_etiqueta, resolver, tipo_de


class Etiquetas(unittest.TestCase):
    def test_el_cero_de_relleno_del_feed_no_es_parte_del_numero(self):
        """Las lecturas de posición escribe K10657 y el bus lleva pintado K1657."""
        self.assertEqual(partir_etiqueta('K10657'), ('K', 1657))
        self.assertEqual(partir_etiqueta('T10044'), ('T', 1044))
        self.assertEqual(partir_etiqueta('E0067'), ('E', 67))
        self.assertEqual(partir_etiqueta('BO0903'), ('BO', 903))

    def test_la_etiqueta_se_reconstruye_desde_el_identificador(self):
        """Las capturas anteriores al 12/09/2026 no guardaron la etiqueta; el identificador la da."""
        self.assertEqual(etiqueta_desde_id('45657'), ('K', 1657))
        self.assertEqual(etiqueta_desde_id('41044'), ('T', 1044))
        self.assertEqual(etiqueta_desde_id('7067'), ('E', 67))
        self.assertEqual(etiqueta_desde_id('23903'), ('BO', 903))
        self.assertEqual(etiqueta_desde_id('11006'), ('D', 1006))

    def test_las_dos_lecturas_coinciden_en_el_mismo_vehiculo(self):
        for bus, etiqueta in (('45657', 'K10657'), ('41044', 'T10044'), ('7067', 'E0067'),
                              ('10204', 'D0204'), ('14025', 'N0025'), ('29919', 'KE0919')):
            self.assertEqual(etiqueta_desde_id(bus), partir_etiqueta(etiqueta), bus)

    def test_un_bloque_desconocido_no_se_adivina(self):
        self.assertEqual(etiqueta_desde_id('102130'), (None, None))
        self.assertEqual(etiqueta_desde_id(''), (None, None))


class Tipos(unittest.TestCase):
    def test_cada_familia_cae_en_su_rango(self):
        self.assertEqual(tipo_de('K', 1657), 'biarticulated')
        self.assertEqual(tipo_de('T', 1044), 'articulated')
        self.assertEqual(tipo_de('E', 67), 'biarticulated')
        self.assertEqual(tipo_de('E', 30), 'articulated')
        self.assertEqual(tipo_de('E', 720), 'dual')
        self.assertEqual(tipo_de('D', 520), 'dual')

    def test_un_numero_fuera_de_los_rangos_queda_sin_clasificar(self):
        """Una serie nueva se tiene que ver en la salida, no repartirse al rango más cercano."""
        self.assertIsNone(tipo_de('T', 1350))
        self.assertIsNone(tipo_de('E', 250))
        self.assertIsNone(tipo_de('ZZ', 100))


class Servicios(unittest.TestCase):
    def test_un_servicio_de_un_solo_tipo_queda_observado(self):
        servicios, sin_resolver = resolver({'J23': {'biarticulated': {'a', 'b', 'c', 'd'}}})
        self.assertEqual(servicios['J23']['type'], 'biarticulated')
        self.assertEqual(servicios['J23']['status'], 'observed')
        self.assertEqual(servicios['J23']['capacity'], 240)
        self.assertEqual(sin_resolver, [])

    def test_una_mezcla_pareja_no_se_redondea_a_un_tipo(self):
        servicios, sin_resolver = resolver({'X1': {'articulated': {'a', 'b', 'c'},
                                                  'biarticulated': {'d', 'e', 'f'}}})
        self.assertEqual(servicios['X1']['status'], 'unresolved')
        self.assertNotIn('capacity', servicios['X1'])
        self.assertEqual(sin_resolver, ['X1'])

    def test_dos_buses_sueltos_no_deciden_un_servicio(self):
        servicios, _ = resolver({'X2': {'articulated': {'a', 'b'}}})
        self.assertEqual(servicios['X2']['status'], 'unresolved')

    def test_una_minoria_pequena_se_conserva_en_la_mezcla(self):
        servicios, _ = resolver({'X3': {'biarticulated': set('abcdefghijklmnopqrs'), 'articulated': {'z'}}})
        self.assertEqual(servicios['X3']['status'], 'observed_majority')
        self.assertEqual(servicios['X3']['mix'], {'biarticulated': 19, 'articulated': 1})


class Lectura(unittest.TestCase):
    """Lo que hace `leer` con un detalle escrito a mano, sin tocar las capturas reales."""

    def detalle(self, carpeta, filas):
        columnas = ('build', 'bus', 'etiqueta', 'placa', 'viaje', 'ruta', 'lat', 'lon', 'parada', 'secuencia')
        with gzip.open(carpeta / 'rt_detalle_20260101.csv.gz', 'wt', encoding='utf-8', newline='') as archivo:
            escritor = csv.writer(archivo)
            escritor.writerow(columnas)
            for fila in filas:
                escritor.writerow(fila)

    def test_un_bloque_desconocido_no_cuenta_como_discrepancia(self):
        """La etiqueta publicada manda; que esta tabla no conozca el bloque no la contradice."""
        rutas = {'100': ('1', 'X1')}
        with tempfile.TemporaryDirectory() as tmp:
            carpeta = Path(tmp)
            self.detalle(carpeta, [(1, '999999', 'QQ0001', '', '', '100', '', '', '', ''),
                                   (1, '45657', 'K10657', '', '', '100', '', '', '', '')])
            _, _, sin_clasificar, discrepancias, _ = leer(carpeta, rutas)
            self.assertEqual(discrepancias, 0)
            self.assertIn('QQ1', sin_clasificar)

    def test_una_etiqueta_que_contradice_al_identificador_se_cuenta(self):
        rutas = {'100': ('1', 'X1')}
        with tempfile.TemporaryDirectory() as tmp:
            carpeta = Path(tmp)
            self.detalle(carpeta, [(1, '45657', 'K10999', '', '', '100', '', '', '', '')])
            _, _, _, discrepancias, _ = leer(carpeta, rutas)
            self.assertEqual(discrepancias, 1)

    def test_solo_entran_los_servicios_troncales_y_duales(self):
        """Un zonal comparte código con un troncal; el filtro es la agencia, no el nombre corto."""
        rutas = {'100': ('1', 'X1'), '200': ('3', 'X1')}
        with tempfile.TemporaryDirectory() as tmp:
            carpeta = Path(tmp)
            self.detalle(carpeta, [(1, '45657', 'K10657', '', '', '100', '', '', '', ''),
                                   (1, '107259', 'Z10-7259', '', '', '200', '', '', '', '')])
            por_linea, vistos, sin_clasificar, _, _ = leer(carpeta, rutas)
            self.assertEqual(por_linea['X1'], {'biarticulated': {'45657'}})
            self.assertEqual(list(vistos), ['45657'])
            self.assertEqual(sin_clasificar, {})


if __name__ == '__main__':
    unittest.main()
