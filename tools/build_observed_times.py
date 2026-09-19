"""Cuánto tarda de verdad un bus de una parada a la siguiente, por tipo de día y franja.

El simulador corre contra el tiempo que el GTFS publica para cada tramo. Medido contra la calle, ese
tiempo cuadra en el total del viaje pero no tramo a tramo: el 5,7 % de los tramos no se alcanza ni
rodando al crucero y el 24 % pide ir más de 1,6 veces más rápido que lo observado. El horario reparte
mal su holgura. Esto mide el reparto verdadero.

De dónde sale. Las lecturas de posición dice a qué parada se dirige cada vehículo; cuando ese destino cambia,
el bus acaba de dejar la anterior. El tiempo entre dos cambios consecutivos es lo que tardó en ir de
una a la siguiente, atención incluida —igual que el tiempo publicado, que también la lleva dentro—.
La resolución es la del muestreo, unos veinte segundos, así que un tramo corto mide peor que uno
largo; por eso se exige un mínimo de observaciones y se guarda la mediana, no una media.

Qué no hace. No empareja con ningún servicio local: eso lo hace `build_schedule.py`, que ya alinea
las paradas publicadas con las del catálogo y sabe cuándo las dos secuencias son la misma. Aquí la
clave es la del paquete publicado —ruta, parada de origen, parada de destino— y nada más.

Biblioteca estándar; corre con el Python del sistema.
"""
import argparse
import csv
import gzip
import json
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
BOGOTA = timezone(timedelta(hours=-5))
CAPTURA = ROOT / 'data/raw/rt_capture'
SALIDA = ROOT / 'data/curated/observed_times.json'
PUNTA = (6, 7, 8, 16, 17, 18, 19)     # franjas de punta del proyecto
MINIMO = 8                            # observaciones por franja para dar un tiempo
MAXIMO_S = 3600                       # más de una hora entre dos paradas es un viaje partido, no un tramo


def franja(sello, festivos):
    """'punta', 'laborable', 'sabado' o 'festivo' para el instante de una transición."""
    momento = datetime.fromtimestamp(sello, BOGOTA)
    if momento.strftime('%Y-%m-%d') in festivos:
        return 'festivo'
    dia = momento.weekday()
    if dia == 6:
        return 'festivo'
    if dia == 5:
        return 'sabado'
    return 'punta' if momento.hour in PUNTA else 'laborable'


def transiciones_del_dia(archivo, troncales):
    """[(sello, ruta, parada anterior, parada nueva)] de un día, en orden por vehículo y viaje."""
    viajes = defaultdict(list)
    with gzip.open(archivo, 'rt', encoding='utf-8', newline='') as entrada:
        for fila in csv.DictReader(entrada):
            if fila['ruta'] not in troncales or not fila['parada']:
                continue
            viajes[(fila['bus'], fila['viaje'])].append(
                (int(fila['build']), fila['ruta'], fila['parada']))
    for filas in viajes.values():
        filas.sort()
        anterior = None
        for sello, ruta, parada in filas:
            if anterior is None:
                anterior = (sello, ruta, parada)
                continue
            if parada != anterior[2]:
                yield anterior[0], ruta, anterior[2], parada, sello
                anterior = (sello, ruta, parada)


def medir(carpeta, troncales, excluidos, festivos):
    tiempos = defaultdict(lambda: defaultdict(list))
    archivos = []
    for archivo in sorted(carpeta.glob('rt_detalle_*.csv.gz')):
        fecha = re.search(r'(\d{8})', archivo.name)
        if fecha and fecha.group(1) in excluidos:
            continue
        archivos.append(archivo.name)
        previo = {}
        for sello, ruta, desde, hasta, sello_nuevo in transiciones_del_dia(archivo, troncales):
            clave = (ruta, desde, hasta)
            duracion = sello_nuevo - sello
            if 0 < duracion <= MAXIMO_S:
                tiempos[clave][franja(sello, festivos)].append(duracion)
    return tiempos, archivos


def resumir(tiempos):
    salida, franjas = {}, defaultdict(int)
    for (ruta, desde, hasta), por_franja in tiempos.items():
        todas = [x for v in por_franja.values() for x in v]
        if len(todas) < MINIMO:
            continue
        registro = {'base': round(median(todas), 1), 'n': len(todas)}
        for nombre, valores in por_franja.items():
            if len(valores) >= MINIMO:
                registro[nombre] = round(median(valores), 1)
                registro[f'n_{nombre}'] = len(valores)
                franjas[nombre] += 1
        salida[f'{ruta}|{desde}|{hasta}'] = registro
    return salida, dict(franjas)


def construir(carpeta, excluidos=(), motivo='', festivos=()):
    rutas = {f['route_id'] for f in csv.DictReader((carpeta / 'routes.txt').open(encoding='utf-8-sig'))
             if f['agency_id'] in ('1', '6')}
    tiempos, archivos = medir(carpeta, rutas, set(excluidos), set(festivos))
    tramos, franjas = resumir(tiempos)
    dias = sorted({m.group(1) for m in (re.search(r'(\d{8})', n) for n in archivos) if m})
    return {
        'schema_version': 1,
        'observed_from': f'{dias[0][:4]}-{dias[0][4:6]}-{dias[0][6:]}' if dias else None,
        'excluded_reason': motivo or None,
        'method': ('Mediana del tiempo entre dos cambios de parada destino consecutivos del mismo viaje, '
                   'atención incluida, como el tiempo publicado. Clave: ruta del paquete y las dos paradas'),
        'parameters': {'peak_hours': list(PUNTA), 'min_observations': MINIMO, 'max_seconds': MAXIMO_S},
        'sources': {'feed': 'Lecturas de posición de la flota'},
        'coverage': {'stretches': len(tramos), 'by_slice': franjas},
        'stretches': tramos,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--capture', default=str(CAPTURA))
    parser.add_argument('--out', default=str(SALIDA))
    parser.add_argument('--exclude', action='append', default=[], metavar='AAAAMMDD')
    parser.add_argument('--exclude-note', default='')
    parser.add_argument('--holiday', action='append', default=[], metavar='AAAA-MM-DD',
                        help='Festivo colombiano dentro de la captura; cuenta como domingo')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    datos = construir(Path(args.capture), args.exclude, args.exclude_note, args.holiday)
    print(f"{datos['coverage']['stretches']} tramos medidos · por franja {datos['coverage']['by_slice']}")
    print('desde:', datos['observed_from'], '· excluidos:', len(excluidos) or 'ninguno')
    if not args.dry_run:
        Path(args.out).write_text(json.dumps(datos, ensure_ascii=False, separators=(',', ':')) + '\n',
                                  encoding='utf-8')
        print('escrito', args.out)


if __name__ == '__main__':
    main()
