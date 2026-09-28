#!/usr/bin/env python3
"""Lo que el simulador usa de la matriz origen-destino: hacia dónde sale la gente de cada estación y
qué parte de los que llegan en bus se baja en ella.

El modelo de pasajeros tenía dos supuestos declarados: un factor direccional que en la mañana
cargaba la demanda hacia un centro de empleo aproximado, y una fracción de descenso que dependía de
la hora y de lo céntrica que fuera la estación. La matriz estimada por encadenamiento de viajes
(`build_od_matrix.py`) permite medir los dos:

- **Sentido de salida.** Cada viaje de la matriz se asigna al camino más corto sobre la red de
  paradas de los servicios utilizables. La dirección del primer tramo —de la estación de origen a la
  siguiente parada del camino— es el sentido en que esa persona toma el bus. Por estación, tipo de
  día y franja se guarda el histograma de esas direcciones en 16 sectores; el simulador lee de ahí
  qué parte de la demanda de la estación va en cada sentido.
- **Descenso.** Con los mismos caminos se cuentan, por estación, los viajes que terminan en ella y
  los que pasan de largo en un bus que para ahí. La fracción de descenso es la de los primeros sobre
  el total que llega.

Salida: `app/dist/od_profiles.json` y su copia en `data/curated`.
"""
from __future__ import annotations

import hashlib
import heapq
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECTORS = 16
STOP_PENALTY_M = 150      # cada parada intermedia cuesta como 150 m: entre dos caminos parecidos, el de menos paradas
TRANSFER_PENALTY_M = 1500  # cambiar de servicio cuesta como 1,5 km


def main() -> None:
    matrix_path = ROOT / "data/curated/od_matrix.json"
    matrix = json.loads(matrix_path.read_text())
    services = json.loads((ROOT / "app/dist/services.json").read_text())
    xy = {s["id"]: s["xy"] for s in services["stations"]}
    periods = list(matrix["method"]["periods"])

    # Grafo de paradas: un nodo por (servicio, parada) y otro por estación, para cobrar el
    # transbordo al subir. Las aristas de un servicio unen sus paradas consecutivas.
    graph: dict[tuple, list] = defaultdict(list)
    for r in services["routes"]:
        if not r.get("ready"):
            continue
        stops = [s for s in r["stops"] if s["station_id"] in xy]
        for a, b in zip(stops, stops[1:]):
            if a["station_id"] == b["station_id"]:
                continue
            graph[("r", r["id"], a["station_id"])].append((("r", r["id"], b["station_id"]), max(1.0, b["at_m"] - a["at_m"]) + STOP_PENALTY_M))
        for s in stops:
            graph[("s", s["station_id"])].append((("r", r["id"], s["station_id"]), TRANSFER_PENALTY_M))
            graph[("r", r["id"], s["station_id"])].append((("s", s["station_id"]), 0.0))

    def paths_from(origin: str):
        """Camino más corto a cada estación: lista de (estación, paró el bus ahí)."""
        start = ("s", origin)
        dist, prev = {start: 0.0}, {}
        heap = [(0.0, start)]
        while heap:
            d, node = heapq.heappop(heap)
            if d > dist[node]:
                continue
            for nxt, w in graph.get(node, ()):
                nd = d + w
                if nd < dist.get(nxt, math.inf):
                    dist[nxt], prev[nxt] = nd, node
                    heapq.heappush(heap, (nd, nxt))
        out = {}
        for node in dist:
            if node[0] != "s" or node == start:
                continue
            chain, cur = [], node
            while cur != start:
                if cur[0] == "r":
                    chain.append(cur[2])
                cur = prev[cur]
            chain.reverse()
            # Paradas del camino en orden, sin repetir la del transbordo.
            stations = [origin] + [s for i, s in enumerate(chain) if s != origin and (i == 0 or s != chain[i - 1])]
            out[node[1]] = stations
        return out

    by_origin = defaultdict(list)
    for o, d, kind, period, trips in matrix["od"]:
        if o in xy and d in xy:
            by_origin[o].append((d, kind, period, trips))

    sectors = defaultdict(lambda: [0.0] * SECTORS)   # (estación, tipo, franja) → sentido del primer tramo
    ending = defaultdict(float)                      # (estación, tipo, franja) → viajes que terminan ahí
    passing = defaultdict(float)                     # (estación, tipo, franja) → viajes que pasan en un bus que para ahí
    assigned = unassigned = 0.0
    for o, rows in sorted(by_origin.items()):
        paths = paths_from(o)
        for d, kind, period, trips in rows:
            path = paths.get(d)
            if not path or len(path) < 2:
                unassigned += trips
                continue
            assigned += trips
            (x0, y0), (x1, y1) = xy[path[0]], xy[path[1]]
            angle = math.atan2(y1 - y0, x1 - x0) % (2 * math.pi)
            sectors[o, kind, period][int(angle / (2 * math.pi) * SECTORS) % SECTORS] += trips
            ending[d, kind, period] += trips
            for s in path[1:-1]:
                passing[s, kind, period] += trips

    stations = {}
    for (s, kind, period), hist in sorted(sectors.items()):
        entry = stations.setdefault(s, {}).setdefault(kind, {"sectors": {}, "alight": {}})
        entry["sectors"][period] = [round(v, 1) for v in hist]
    for key in set(ending) | set(passing):
        s, kind, period = key
        total = ending[key] + passing[key]
        if total < 20:
            continue
        entry = stations.setdefault(s, {}).setdefault(kind, {"sectors": {}, "alight": {}})
        entry["alight"][period] = round(ending[key] / total, 3)

    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "od_matrix": "data/curated/od_matrix.json",
            "od_matrix_sha256": hashlib.sha256(matrix_path.read_bytes()).hexdigest(),
            "days": matrix["days"],
        },
        "method": {
            "sectors": SECTORS,
            "sector_zero": "este, en sentido antihorario; sector k cubre [k, k+1)·360°/16",
            "periods": matrix["method"]["periods"],
            "paths": f"camino más corto sobre las paradas de los servicios utilizables; cada parada intermedia suma {STOP_PENALTY_M} m y cada transbordo {TRANSFER_PENALTY_M} m",
            "alight": "viajes que terminan en la estación sobre los que llegan a ella en un bus que para ahí",
        },
        "coverage": {"trips_assigned": round(assigned), "trips_unassigned": round(unassigned), "stations": len(stations)},
        "stations": stations,
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/od_profiles.json", ROOT / "app/dist/od_profiles.json"):
        target.write_text(text)
    print(json.dumps(result["coverage"], ensure_ascii=False), f"{len(text) / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
