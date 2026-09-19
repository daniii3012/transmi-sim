"""Lo que el campo de velocidad afirma, sobre un corredor recto inventado.

Necesita el Python geográfico, porque el módulo proyecta coordenadas. No toca la red ni las
capturas: lo que se fija aquí es el enganche al eje, el reparto entre cubetas y la regla que separa
la atención de la propia parada del tiempo que detiene a cualquiera que pase.
"""
import csv
import gzip
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

from build_speed_field import (ATENCION_M, CUBETA, ENGANCHE, ESTACION_M, SEMAFORO_M, corredores,
                               enganchar, indice, lecturas, medir, rellenar, repartir)

EJE = {'corridors': [{'id': 'T1', 'kind': 'trunk', 'name': 'Recta', 'zone': 'B',
                      'components': [[[0, 0], [2000, 0]]]}]}


class Enganche(unittest.TestCase):
    def setUp(self):
        self.ejes = corredores(EJE)
        self.malla = indice(self.ejes)

    def test_un_punto_sobre_el_eje_da_su_abscisa(self):
        eje, abscisa = enganchar(self.malla, 750, 0)
        self.assertEqual(eje, 'T1:0')
        self.assertAlmostEqual(abscisa, 750, places=6)

    def test_un_punto_apartado_del_eje_no_engancha(self):
        """Un bus en la calle paralela no es un bus en la troncal."""
        self.assertIsNone(enganchar(self.malla, 750, ENGANCHE + 5))
        self.assertIsNotNone(enganchar(self.malla, 750, ENGANCHE - 5))

    def test_el_eje_conserva_su_largo(self):
        self.assertAlmostEqual(self.ejes[0]['length'], 2000, places=6)


class Reparto(unittest.TestCase):
    def test_lo_que_pasa_dentro_de_una_cubeta_se_queda_en_ella(self):
        self.assertEqual(repartir(120, 180, 60, 12), [(1, 60, 12)])

    def test_atravesar_varias_cubetas_reparte_a_prorrata(self):
        partes = repartir(50, 250, 200, 20)
        self.assertEqual([p[0] for p in partes], [0, 1, 2])
        self.assertAlmostEqual(sum(p[1] for p in partes), 200)
        self.assertAlmostEqual(sum(p[2] for p in partes), 20)
        self.assertAlmostEqual(partes[1][2], 10)   # la cubeta central es la mitad del recorrido

    def test_ir_hacia_atras_reparte_igual(self):
        self.assertEqual([p[0] for p in repartir(250, 50, 200, 20)], [0, 1, 2])


class Andenes(unittest.TestCase):
    """El campo mide lo que consigue un bus que pasa de largo, no lo que hacen los que paran."""

    def medir_uno(self, x_parada, andenes=(), luces=()):
        malla = indice(corredores(EJE))
        lecturas = {'b1': [(0, 500.0, 0.0, 'P'), (20, 500.0, 0.0, 'P')]}
        campo, usadas, _ = medir(lecturas, malla, {'P': (x_parada, 0.0)}, luces, andenes)
        self.assertEqual(usadas, 1)
        return next(iter(campo.values()))

    def test_quieto_en_su_parada_cuenta_como_atencion(self):
        celda = self.medir_uno(500 + ATENCION_M - 10)
        self.assertEqual(celda['stop_t'], 0)
        self.assertEqual(celda['dwell_t'], 20)

    def test_quieto_en_cualquier_anden_no_habla_del_corredor(self):
        """Aunque no sea su estación: el motor modela la atención y la cola por el vagón aparte."""
        celda = self.medir_uno(5000, andenes=[(500 + ESTACION_M - 10, 0.0)])
        self.assertEqual(celda['stop_t'], 0)
        self.assertEqual(celda['queue_t'], 20)

    def test_quieto_en_un_semaforo_es_del_semaforo(self):
        """El motor ya resuelve las fases: contarlas aquí las cobraría dos veces."""
        celda = self.medir_uno(5000, luces=[(500 + SEMAFORO_M - 10, 0.0)])
        self.assertEqual(celda['stop_t'], 0)
        self.assertEqual(celda['signal_t'], 20)

    def test_quieto_lejos_de_todo_si_es_del_corredor(self):
        celda = self.medir_uno(5000, andenes=[(2000.0, 0.0)], luces=[(2000.0, 0.0)])
        self.assertEqual(celda['stop_t'], 20)
        self.assertEqual(celda['dwell_t'], 0)


class Relleno(unittest.TestCase):
    def test_una_cubeta_sin_datos_se_declara_y_no_se_inventa(self):
        """Sin lecturas no hay medición: la cubeta hereda la mediana del corredor y lo dice."""
        cubetas, conteo, _, _ = rellenar({}, corredores(EJE))
        self.assertEqual(len(cubetas), 2 * (2000 // CUBETA + 1))
        self.assertEqual(conteo['observed'], 0)
        self.assertTrue(all(v['source'] == 'corridor_default' for v in cubetas.values()))
        self.assertTrue(all(v['hours'] == 0 for v in cubetas.values()))


class Excluir(unittest.TestCase):
    """Un día con el corredor bloqueado describe ese día, no ese corredor."""

    def carpeta(self, tmp, dias):
        carpeta = Path(tmp)
        (carpeta / 'routes.txt').write_text('route_id,agency_id,route_short_name\nR1,1,X1\n', encoding='utf-8')
        for dia in dias:
            with gzip.open(carpeta / f'rt_detalle_{dia}.csv.gz', 'wt', encoding='utf-8', newline='') as archivo:
                escritor = csv.writer(archivo)
                escritor.writerow(('build', 'bus', 'etiqueta', 'placa', 'viaje', 'ruta', 'lat', 'lon',
                                   'parada', 'secuencia'))
                escritor.writerow((1, '41001', 'T10001', '', '', 'R1', '4.6', '-74.1', '', ''))
        return carpeta

    def test_el_dia_excluido_no_entra_ni_en_las_lecturas_ni_en_la_lista(self):
        with tempfile.TemporaryDirectory() as tmp:
            carpeta = self.carpeta(tmp, ('20260301', '20260302'))
            rutas = {'R1': '1'}
            _, todos = lecturas(carpeta, rutas)
            _, sin_excluido = lecturas(carpeta, rutas, {'20260301'})
            self.assertEqual(len(todos), 2)
            self.assertEqual(sin_excluido, ['rt_detalle_20260302.csv.gz'])

    def test_excluir_un_dia_que_no_existe_no_quita_nada(self):
        with tempfile.TemporaryDirectory() as tmp:
            carpeta = self.carpeta(tmp, ('20260302',))
            _, archivos = lecturas(carpeta, {'R1': '1'}, {'20260101'})
            self.assertEqual(archivos, ['rt_detalle_20260302.csv.gz'])


if __name__ == '__main__':
    unittest.main()
