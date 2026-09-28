#!/usr/bin/env python3
"""Vagón y puertas de cada parada troncal, con su posición, desde el GTFS publicado.

El paquete GTFS de TRANSMILENIO publica cada estación troncal como estación (`location_type=1`) con
una parada hija por vagón y juego de puertas —«Mandalay A - 4 ó 6»—, cada una con sus coordenadas, y
en `stop_times` cada viaje dice en cuál de ellas para. Eso resuelve dos cosas que antes se estimaban:
en qué punto físico de la estación se detiene cada servicio, y en qué orden están los vagones (en
Mandalay el A está al oriente, no al occidente).

Para cada servicio del simulador se toma la secuencia de paradas hijas más frecuente entre los viajes
de sus rutas GTFS (las que ya empareja `schedule.json`) y se guarda, estación por estación, la parada
hija, su letra, sus puertas y su posición en la proyección de la red.

Entrada: el ZIP del GTFS en `data/raw/gtfs/`. Salida: `data/curated/wagon_stops.json` y su copia en
`app/dist`.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
# «Mandalay A - 4 ó 6», «Ricaurte E -4 ó 6», «Banderas T6A» (plataforma 6A de un portal o intercambiador).
NAME = re.compile(r"^(?P<station>.*?)\s+(?P<letter>[A-Z]{1,2}|T\d+[A-Z]?)(?:(?:\s*-\s*|\s+)(?P<doors>\d.*))?$", re.I)


def main() -> None:
    package = sorted((ROOT / "data/raw/gtfs").glob("GTFS_*.zip"))[-1]
    services = json.loads((ROOT / "app/dist/services.json").read_text())
    schedule = json.loads((ROOT / "app/dist/schedule.json").read_text())
    to_xy = Transformer.from_crs("EPSG:4326", services["projection"], always_xy=True)
    stations = {s["id"] for s in services["stations"]}

    with zipfile.ZipFile(package) as z:
        def rows(name):
            return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig", newline=""))

        children = {}
        for s in rows("stops.txt"):
            parent = s["parent_station"]
            if s["location_type"] != "0" or parent not in stations:
                continue
            m = NAME.match(s["stop_name"].strip())
            x, y = to_xy.transform(float(s["stop_lon"]), float(s["stop_lat"]))
            children[s["stop_id"]] = {
                "stop_id": s["stop_id"], "station_id": parent, "name": s["stop_name"].strip(),
                "letter": m["letter"].upper() if m else None, "doors": (m["doors"] or "").strip().rstrip(".").strip() if m else "",
                "xy": [round(x, 2), round(y, 2)],
            }

        wanted = {g: local for local, r in schedule["routes"].items() for g in r.get("gtfs") or []}
        trip_route = {t["trip_id"]: t["route_id"] for t in rows("trips.txt") if t["route_id"] in wanted}

        # Secuencia de paradas hijas de cada viaje (solo las troncales).
        sequences: dict[str, list] = defaultdict(list)
        for st in rows("stop_times.txt"):
            if st["trip_id"] in trip_route and st["stop_id"] in children:
                sequences[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"]))

    by_local: dict[str, Counter] = defaultdict(Counter)
    for trip, seq in sequences.items():
        seq.sort()
        by_local[wanted[trip_route[trip]]][tuple(stop for _, stop in seq)] += 1

    routes = {}
    for local, counter in sorted(by_local.items()):
        # Cada ruta GTFS emparejada aporta su secuencia más frecuente; un servicio que junta dos
        # mitades las recibe a las dos, y el motor toma, para cada estación, la parada de su orden.
        stops = []
        for seq, _ in counter.most_common():
            for stop in seq:
                c = children[stop]
                entry = {"station_id": c["station_id"], "stop_id": stop, "letter": c["letter"], "doors": c["doors"], "xy": c["xy"]}
                if entry not in stops:
                    stops.append(entry)
            break
        routes[local] = {"trips": sum(counter.values()), "stops": stops}

    by_station = defaultdict(list)
    for c in children.values():
        by_station[c["station_id"]].append({k: c[k] for k in ("stop_id", "name", "letter", "doors", "xy")})

    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "dataset": "GTFS abierto de TRANSMILENIO S.A.",
            "file": package.name,
            "sha256": hashlib.sha256(package.read_bytes()).hexdigest(),
        },
        "method": "paradas hijas de cada estación troncal (location_type=0 con parent_station) y, por servicio, la secuencia más frecuente de sus viajes en stop_times",
        "coverage": {"stations": len(by_station), "wagon_stops": len(children), "routes": len(routes)},
        "stations": dict(sorted(by_station.items())),
        "routes": routes,
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/wagon_stops.json", ROOT / "app/dist/wagon_stops.json"):
        target.write_text(text)
    print(json.dumps(result["coverage"], ensure_ascii=False), f"{len(text) / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
