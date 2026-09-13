"""Deduce el tipo de carrocería de cada servicio troncal a partir de la flota que lo atiende.

El alimentador GTFS-Realtime publica, por vehículo, la etiqueta de flota que el bus lleva pintada
—`E0067`, `K10657`, `D0204`—. Ni el GTFS publicado ni la API de rutas dicen si un servicio se
atiende con articulados o con biarticulados, pero la etiqueta sí distingue las familias de la flota,
y la operación observada las separa sola: hay servicios donde nunca entra un vehículo de la familia
alta y servicios donde nunca entra uno de la baja.

Cómo se leyó la etiqueta. El feed escribe un cero de relleno que el bus no lleva: `K10657` en el
alimentador es `K1657` en la calle, y `E0067` es `E67`. Las series de cuatro cifras (A, M, S, K, U,
T) numeran desde 1000; las de tres (E, D, N) desde 1. Las capturas anteriores al 12 de septiembre de
2026 no guardaron la etiqueta, así que para ellas se reconstruye desde el identificador del
vehículo, que es la misma cifra con otro desplazamiento. Cuando el archivo trae las dos, se comparan
y la discrepancia queda contada en la salida.

Por qué los rangos de RANGOS son los que son, y qué los sostiene:

  * Los servicios 1, 3, 4, 5, 6, 7 y 8 no reciben ni un vehículo de la familia alta en todo un día
    de lecturas, y el 2 no recibe ni uno de la baja. Esa partición coincide con el tipo de bus que
    esos servicios llevan en la calle.
  * De los 59 vehículos de la familia 700–999 de E y 500–699 de D y N, ninguno atendió jamás un
    servicio troncal: solo aparecen en servicios duales, que el GTFS marca con su propia agencia.
    Al revés, ningún vehículo de la familia baja apareció nunca en un servicio dual. La frontera
    numérica coincide con una clasificación oficial que no depende de este análisis.
  * Nueve series de operadores distintos, cada una con su propio corte, reparten sus vehículos entre
    los servicios de forma que las 76 líneas observadas quedan de un solo tipo. Una línea recibe
    vehículos de siete series a la vez, así que el corte no puede ser el patio ni el operador.

Lo que esto no es: un padrón de flota. Nadie publica qué carrocería tiene cada bus. Lo que se
demuestra aquí es que la numeración separa familias de vehículos y que cada servicio usa una sola;
el nombre de cada familia —articulado, biarticulado, dual— viene del contraste con la operación
visible y se puede desmentir con un padrón oficial el día que exista.

Salida: data/curated/fleet_types.json, que build_services.py adjunta a cada ruta.
Biblioteca estándar; corre con el Python del sistema.
"""
import argparse
import csv
import gzip
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOGOTA = timezone(timedelta(hours=-5))
CAPTURA = ROOT / 'data/raw/rt_capture'
SALIDA = ROOT / 'data/curated/fleet_types.json'
TRONCAL, DUAL = '1', '6'

# Bloque de identificador -> (prefijo, desplazamiento). etiqueta = identificador - desplazamiento.
# Sale de comparar identificador y etiqueta en el alimentador en vivo, vehículo por vehículo.
BLOQUES = {7000: ('E', 7000), 10000: ('D', 10000), 11000: ('D', 10000), 14000: ('N', 14000),
           22000: ('BO', 22000), 23000: ('BO', 23000), 28000: ('KE', 28000), 29000: ('KE', 29000),
           40000: ('U', 39000), 41000: ('T', 40000), 42000: ('M', 41000),
           43000: ('A', 42000), 44000: ('S', 43000), 45000: ('K', 44000)}

# Prefijo -> tipo -> rangos de etiqueta, inclusive. Lo observado el 12/09/2026 cabe holgado dentro
# de cada rango; un vehículo fuera de todos ellos no se clasifica y sale listado en la salida.
RANGOS = {
    'E':  {'articulated': [(1, 49), (300, 399)], 'biarticulated': [(50, 199)], 'dual': [(700, 799)]},
    'D':  {'articulated': [(1, 99)], 'biarticulated': [(100, 299)], 'dual': [(500, 599)]},
    'N':  {'articulated': [(1, 99)], 'biarticulated': [(100, 199)], 'dual': [(500, 699)]},
    'U':  {'articulated': [(1000, 1299)], 'biarticulated': [(1400, 1699)]},
    'T':  {'articulated': [(1000, 1299)], 'biarticulated': [(1400, 1699)]},
    'M':  {'articulated': [(1000, 1299)], 'biarticulated': [(1400, 1699)]},
    'A':  {'articulated': [(1000, 1299)], 'biarticulated': [(1400, 1699)]},
    'S':  {'articulated': [(1000, 1299)], 'biarticulated': [(1400, 1699)]},
    'K':  {'articulated': [(1000, 1299)], 'biarticulated': [(1400, 1699)]},
    'BO': {'dual': [(900, 999)]},
    'KE': {'dual': [(900, 999)]},
}
CAPACIDAD = {'articulated': 160, 'biarticulated': 240, 'dual': 80}
MINIMO_BUSES = 3        # por debajo de esto una línea no decide nada
PUREZA_MINIMA = 0.9     # un servicio que no llega aquí queda sin resolver, no se redondea


def etiqueta_desde_id(bus):
    """('K', 1657) desde el identificador 45657, o (None, None) si el bloque no se conoce."""
    if not bus.isdigit():
        return None, None
    numero = int(bus)
    prefijo_base = BLOQUES.get(numero // 1000 * 1000)
    if not prefijo_base:
        return None, None
    prefijo, desplazamiento = prefijo_base
    return prefijo, numero - desplazamiento


def partir_etiqueta(etiqueta):
    """('K', 1657) desde la etiqueta publicada 'K10657'. El feed rellena con un cero de más."""
    letras = ''.join(c for c in etiqueta if c.isalpha())
    cifras = ''.join(c for c in etiqueta if c.isdigit())
    if not letras or not cifras:
        return None, None
    numero = int(cifras)
    if len(cifras) == 5 and cifras[0] == '1':   # K10657 -> K1657
        numero = 1000 + numero % 1000
    return letras, numero


def tipo_de(prefijo, numero):
    for tipo, rangos in RANGOS.get(prefijo, {}).items():
        if any(bajo <= numero <= alto for bajo, alto in rangos):
            return tipo
    return None


def catalogo(carpeta):
    ruta = carpeta / 'routes.txt'
    filas = list(csv.DictReader(ruta.open(encoding='utf-8-sig')))
    return ({f['route_id']: (f['agency_id'], f['route_short_name']) for f in filas},
            hashlib.sha256(ruta.read_bytes()).hexdigest())


def leer(carpeta, rutas):
    """Recorre el detalle capturado y devuelve, por servicio, los vehículos que lo atendieron."""
    por_linea = defaultdict(lambda: defaultdict(set))
    vistos, sin_clasificar, discrepancias, archivos = {}, Counter(), 0, []
    for archivo in sorted(carpeta.glob('rt_detalle_*.csv.gz')):
        archivos.append(archivo.name)
        with gzip.open(archivo, 'rt', encoding='utf-8', newline='') as entrada:
            for fila in csv.DictReader(entrada):
                agencia, codigo = rutas.get(fila['ruta'], ('', ''))
                if agencia not in (TRONCAL, DUAL):
                    continue
                bus = fila['bus']
                prefijo, numero = etiqueta_desde_id(bus)
                publicada = partir_etiqueta(fila['etiqueta']) if fila.get('etiqueta') else (None, None)
                if publicada[0]:
                    # Solo es discrepancia cuando las dos lecturas existen y no coinciden. Un bloque
                    # que esta tabla no conoce no dice nada de la etiqueta publicada, que manda.
                    if prefijo is not None and (prefijo, numero) != publicada:
                        discrepancias += 1
                    prefijo, numero = publicada
                if prefijo is None:
                    sin_clasificar[bus] += 1
                    continue
                etiqueta = f'{prefijo}{numero}'
                tipo = tipo_de(prefijo, numero)
                vistos[bus] = (etiqueta, tipo)
                if tipo is None:
                    sin_clasificar[etiqueta] += 1
                    continue
                por_linea[codigo][tipo].add(bus)
    return por_linea, vistos, sin_clasificar, discrepancias, archivos


def resolver(por_linea):
    """Un tipo por servicio, con la mezcla observada al lado. No se redondea una línea dudosa."""
    servicios, sin_resolver = {}, []
    for codigo, tipos in sorted(por_linea.items()):
        conteo = {tipo: len(buses) for tipo, buses in tipos.items()}
        total = sum(conteo.values())
        tipo, buses = max(conteo.items(), key=lambda kv: kv[1])
        pureza = buses / total
        estado = ('observed' if pureza == 1 and buses >= MINIMO_BUSES else
                  'observed_majority' if pureza >= PUREZA_MINIMA and total >= MINIMO_BUSES else 'unresolved')
        registro = {'type': tipo, 'capacity': CAPACIDAD[tipo], 'status': estado,
                    'buses': buses, 'buses_total': total, 'purity': round(pureza, 3), 'mix': conteo}
        if estado == 'unresolved':
            sin_resolver.append(codigo)
            registro.pop('capacity')
        servicios[codigo] = registro
    return servicios, sin_resolver


def construir(carpeta):
    rutas, huella = catalogo(carpeta)
    por_linea, vistos, sin_clasificar, discrepancias, archivos = leer(carpeta, rutas)
    servicios, sin_resolver = resolver(por_linea)
    flota = Counter(tipo for _, tipo in vistos.values() if tipo)
    series = defaultdict(lambda: defaultdict(list))
    for etiqueta, tipo in vistos.values():
        if tipo:
            prefijo = ''.join(c for c in etiqueta if c.isalpha())
            series[prefijo][tipo].append(int(''.join(c for c in etiqueta if c.isdigit())))
    # Jornadas leídas, tomadas del nombre del archivo: la fecha del dato no es la del día en que se
    # corre la herramienta, y un perfil fechado hoy sobre lecturas de ayer diría algo que no es.
    fechas = (re.search(r'(\d{8})', nombre) for nombre in archivos)
    dias = sorted({m.group(1) for m in fechas if m})
    observadas = [f'{d[:4]}-{d[4:6]}-{d[6:]}' for d in dias]
    return {
        'schema_version': 1,
        'derived_at': datetime.now(BOGOTA).isoformat(timespec='seconds'),
        'observed_days': observadas,
        'method': ('Tipo por servicio a partir de la etiqueta de flota del alimentador GTFS-Realtime; '
                   'ver docs/TIPOS_DE_BUS_20260912.md'),
        'sources': {'detail': archivos, 'routes_sha256': huella,
                    'feed': 'GTFS-Realtime de TRANSMILENIO S.A., datos abiertos'},
        'label_ranges': {prefijo: {tipo: [[bajo, alto] for bajo, alto in rangos]
                                   for tipo, rangos in tipos.items()} for prefijo, tipos in RANGOS.items()},
        'observed_ranges': {prefijo: {tipo: [min(v), max(v), len(v)] for tipo, v in sorted(tipos.items())}
                            for prefijo, tipos in sorted(series.items())},
        'fleet_seen': dict(sorted(flota.items())),
        'label_mismatches': discrepancias,
        'unclassified': dict(sin_clasificar.most_common()),
        'unresolved_services': sin_resolver,
        'routes': servicios,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--capture', default=str(CAPTURA), help='Carpeta con los rt_detalle_*.csv.gz')
    parser.add_argument('--out', default=str(SALIDA))
    parser.add_argument('--dry-run', action='store_true', help='Resume sin escribir')
    argumentos = parser.parse_args()
    datos = construir(Path(argumentos.capture))
    troncales = sum(1 for r in datos['routes'].values() if r['status'] != 'unresolved')
    print(f"{len(datos['routes'])} servicios con lecturas, {troncales} resueltos, "
          f"{len(datos['unresolved_services'])} sin resolver")
    print('flota vista:', datos['fleet_seen'])
    if datos['unclassified']:
        print('etiquetas fuera de los rangos conocidos:', list(datos['unclassified'])[:20])
    if datos['label_mismatches']:
        print(f"{datos['label_mismatches']} lecturas donde la etiqueta publicada no coincide con la reconstruida")
    if not argumentos.dry_run:
        Path(argumentos.out).write_text(json.dumps(datos, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        print('escrito', argumentos.out)


if __name__ == '__main__':
    main()
