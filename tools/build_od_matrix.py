#!/usr/bin/env python3
"""Matriz origen-destino troncal estimada por encadenamiento de viajes, sin exportar transacciones.

Las validaciones diarias del SITP registran solo entradas: dónde y a qué hora pasó una tarjeta por
la barrera, no dónde bajó. Pero traen el número de tarjeta —anonimizado con un hash— y eso permite el
método de encadenamiento de viajes (trip chaining) que usan los sistemas con tarifa de entrada: el
destino de un viaje es la estación donde la misma tarjeta vuelve a entrar después, y el del último
viaje del día es la estación del primero, la vuelta a casa.

Reglas, por tarjeta y día:

- Dos entradas en la misma estación con menos de 5 min de diferencia son una sola (repetir la
  lectura en la barrera).
- Un viaje enlaza con el siguiente si entre ambos pasaron al menos 10 min: menos es más un
  transbordo a pie entre estaciones que un destino.
- El último viaje del día enlaza con la estación del primero.
- Si el destino resulta la misma estación del origen, el viaje queda sin enlazar: la persona volvió
  por otro medio.
- Una tarjeta con una sola entrada en el día no se puede enlazar (llegó o volvió en zonal, a pie…).

Salida: `data/curated/od_matrix.json`, con viajes promedio por día entre cada par de estaciones, por
tipo de día y franja. **Solo agregados**: ningún número de tarjeta, hora exacta ni transacción sale
de la memoria, y un par entra solo si suma al menos MIN_TRIPS viajes en el periodo. Las ZIP oficiales
se leen desde un directorio de trabajo fuera del repositorio.

Uso: python3 tools/build_od_matrix.py /ruta/validacionTroncal2026MMDD.zip [...]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import date as civil_date, datetime, timedelta, timezone
from pathlib import Path

from aggregate_validation_period import day_type
from import_passenger_profiles import logical

ROOT = Path(__file__).resolve().parents[1]
REPEAT_S = 300
LINK_GAP_S = 600
MIN_TRIPS = 10          # viajes en el periodo para que un par se publique
PERIODS = (("madrugada", 3, 6), ("pico_am", 6, 9), ("valle", 9, 16), ("pico_pm", 16, 20), ("noche", 20, 27))


def period_of(seconds: int) -> str:
    h = seconds / 3600
    if h < 3:
        h += 24
    for name, a, b in PERIODS:
        if a <= h < b:
            return name
    return "noche"


def read_day(path: Path, curated: dict, by_id: set):
    match = re.fullmatch(r"validacionTroncal(\d{8})\.zip", path.name)
    if not match:
        raise ValueError("Se esperaba validacionTroncalAAAAMMDD.zip")
    stamp = match[1]
    day = civil_date(int(stamp[:4]), int(stamp[4:6]), int(stamp[6:]))
    cards: dict[int, list[int]] = defaultdict(list)
    stations: dict[str, int] = {}
    names: list[str] = []
    rows = unknown = 0
    with zipfile.ZipFile(path) as archive, archive.open(stamp + ".csv") as raw:
        reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
        header = next(reader)
        si, ti, ci = header.index("Estacion_Parada"), header.index("Fecha_Transaccion"), header.index("Numero_Tarjeta")
        for row in reader:
            rows += 1
            code = re.match(r"\s*\(([^)]+)\)", row[si])
            sid = logical(code[1], curated, by_id) if code else None
            if sid is None:
                unknown += 1
                continue
            t = row[ti]
            seconds = int(t[11:13]) * 3600 + int(t[14:16]) * 60 + int(t[17:19])
            if t[:10] != day.isoformat():
                seconds += 86400
            if sid not in stations:
                stations[sid] = len(names)
                names.append(sid)
            # Solo el prefijo del hash como llave en memoria; nunca se escribe.
            cards[int(row[ci][:15], 16)].append(seconds << 9 | stations[sid])
    return day, cards, names, rows, unknown, hashlib.sha256(path.read_bytes()).hexdigest()


def chain(cards, names):
    od = Counter()
    reasons = Counter()
    for taps in cards.values():
        taps.sort()
        trips = []
        for v in taps:
            t, s = v >> 9, v & 511
            if trips and trips[-1][1] == s and t - trips[-1][0] < REPEAT_S:
                continue
            trips.append((t, s))
        if len(trips) < 2:
            reasons["una_entrada"] += 1
            continue
        for i, (t, s) in enumerate(trips):
            if i + 1 < len(trips):
                nt, d = trips[i + 1]
                if nt - t < LINK_GAP_S:
                    reasons["siguiente_muy_pronto"] += 1
                    continue
            else:
                d = trips[0][1]
            if d == s:
                reasons["vuelve_a_la_misma"] += 1
                continue
            od[names[s], names[d], period_of(t)] += 1
            reasons["enlazado"] += 1
    return od, reasons


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("zips", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "data/curated/od_matrix.json")
    args = parser.parse_args()
    curated = json.loads((ROOT / "data/curated/validation_stations.json").read_text())
    services = json.loads((ROOT / "app/dist/services.json").read_text())
    by_id = {s["id"] for s in services["stations"]}

    totals = {k: Counter() for k in ("weekday", "saturday", "holiday")}
    days = defaultdict(list)
    coverage = {k: Counter() for k in totals}
    files = []
    for path in sorted(args.zips):
        day, cards, names, rows, unknown, sha = read_day(path, curated, by_id)
        kind = day_type(day)
        od, reasons = chain(cards, names)
        totals[kind].update(od)
        days[kind].append(day.isoformat())
        coverage[kind].update({"validaciones": rows, "sin_estacion": unknown, "tarjetas": len(cards), **reasons})
        files.append({"file": path.name, "sha256": sha, "day_type": kind, "rows": rows})
        linked = reasons["enlazado"]
        print(f"{day} {kind:8} {rows:>9} validaciones, {len(cards):>8} tarjetas, {linked:>8} viajes enlazados ({linked / max(1, rows - unknown):.0%})", flush=True)

    od_rows = []
    for kind, counter in totals.items():
        n = len(days[kind])
        for (o, d, period), count in counter.items():
            if count >= MIN_TRIPS:
                od_rows.append([o, d, kind, period, round(count / n, 2)])
    od_rows.sort(key=lambda r: (r[2], r[3], r[0], r[1]))
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "dataset": "Validaciones diarias SITP — troncal",
            "catalog_url": "https://datosabiertos.bogota.gov.co/dataset/validaciones-diarias-sitp",
            "license": "CC BY 4.0, según la ficha del catálogo de Datos Abiertos Bogotá",
            "files": files,
        },
        "method": {
            "name": "encadenamiento de viajes por tarjeta anonimizada",
            "repeat_s": REPEAT_S,
            "link_gap_s": LINK_GAP_S,
            "last_trip": "vuelve a la estación del primer viaje del día",
            "min_trips_published": MIN_TRIPS,
            "periods": {name: [a, b] for name, a, b in PERIODS},
            "unit": "viajes promedio por día del tipo, por franja de la hora de entrada",
            "privacy": "solo agregados por par de estaciones y franja; ninguna tarjeta, hora ni transacción",
        },
        "days": dict(days),
        "coverage": {k: dict(v) for k, v in coverage.items() if v},
        "od": od_rows,
    }
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({k: dict(v) for k, v in coverage.items() if v}, ensure_ascii=False))
    print(f"{len(od_rows)} pares publicados")


if __name__ == "__main__":
    main()
