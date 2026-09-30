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
- **Descenso.** Con los mismos caminos se cuentan, por estación, los viajes que terminan en ella,
  los que se bajan a cambiar de servicio y los que pasan de largo en un bus que para ahí. La fracción
  de descenso es la de los dos primeros sobre el total que llega.
- **Transbordo.** Quien cambia de servicio en una estación espera allí el siguiente bus, aunque no
  valide: el archivo solo registra la entrada. Por estación, tipo de día y franja se guarda cuántos
  viajes al día transbordan ahí y hacia dónde sale su segundo tramo, en los mismos 16 sectores. El
  conteo se lleva a todas las entradas, no solo a las enlazadas, con la proporción de cada tipo de día.

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
        """Camino más corto a cada estación: (paradas en orden, [(estación de transbordo, siguiente)])."""
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
            nodes, cur = [], prev[node]
            while cur != start:
                nodes.append(cur)
                cur = prev[cur]
            nodes.reverse()
            chain = [n[2] for n in nodes if n[0] == "r"]
            # Paradas del camino en orden, sin repetir la del transbordo.
            stations = [origin] + [s for i, s in enumerate(chain) if s != origin and (i == 0 or s != chain[i - 1])]
            # Un nodo de estación en mitad del camino es un transbordo: se baja de un servicio y sube
            # a otro. Su segundo tramo sale hacia la parada siguiente del nuevo servicio.
            transfers = []
            for i, n in enumerate(nodes):
                if n[0] == "s":
                    after = next((m[2] for m in nodes[i + 1:] if m[0] == "r" and m[2] != n[1]), None)
                    if after:
                        transfers.append((n[1], after))
            out[node[1]] = (stations, transfers)
        return out

    by_origin = defaultdict(list)
    for o, d, kind, period, trips in matrix["od"]:
        if o in xy and d in xy:
            by_origin[o].append((d, kind, period, trips))

    sectors = defaultdict(lambda: [0.0] * SECTORS)   # (estación, tipo, franja) → sentido del primer tramo
    ending = defaultdict(float)                      # (estación, tipo, franja) → viajes que terminan ahí
    passing = defaultdict(float)                     # (estación, tipo, franja) → viajes que pasan en un bus que para ahí
    changing = defaultdict(float)                    # (estación, tipo, franja) → viajes que transbordan ahí
    onward = defaultdict(lambda: [0.0] * SECTORS)    # (estación, tipo, franja) → sentido del tramo tras el transbordo
    assigned = unassigned = 0.0
    for o, rows in sorted(by_origin.items()):
        paths = paths_from(o)
        for d, kind, period, trips in rows:
            path, transfers = paths.get(d) or (None, ())
            if not path or len(path) < 2:
                unassigned += trips
                continue
            assigned += trips
            (x0, y0), (x1, y1) = xy[path[0]], xy[path[1]]
            angle = math.atan2(y1 - y0, x1 - x0) % (2 * math.pi)
            sectors[o, kind, period][int(angle / (2 * math.pi) * SECTORS) % SECTORS] += trips
            ending[d, kind, period] += trips
            here = {t for t, _ in transfers}
            for s in path[1:-1]:
                if s not in here:
                    passing[s, kind, period] += trips
            for t, after in transfers:
                changing[t, kind, period] += trips
                (xa, ya), (xb, yb) = xy[t], xy[after]
                turn = math.atan2(yb - ya, xb - xa) % (2 * math.pi)
                onward[t, kind, period][int(turn / (2 * math.pi) * SECTORS) % SECTORS] += trips

    stations = {}
    for (s, kind, period), hist in sorted(sectors.items()):
        entry = stations.setdefault(s, {}).setdefault(kind, {"sectors": {}, "alight": {}})
        entry["sectors"][period] = [round(v, 1) for v in hist]
    for key in set(ending) | set(passing) | set(changing):
        s, kind, period = key
        total = ending[key] + changing[key] + passing[key]
        if total < 20:
            continue
        entry = stations.setdefault(s, {}).setdefault(kind, {"sectors": {}, "alight": {}})
        entry["alight"][period] = round((ending[key] + changing[key]) / total, 3)
    # La matriz solo lleva los viajes enlazados; el simulador genera todas las entradas. El transbordo
    # se lleva a esa misma escala: entradas registradas por día sobre viajes enlazados por día.
    scale = {}
    for kind, days in matrix["days"].items():
        linked = sum(t for _, _, k, _, t in matrix["od"] if k == kind)
        entries = matrix["coverage"].get(kind, {}).get("validaciones", 0) / max(1, len(days))
        scale[kind] = entries / linked if linked else 1.0
    for (s, kind, period), trips in sorted(changing.items()):
        trips *= scale.get(kind, 1.0)
        if trips < 20:
            continue
        entry = stations.setdefault(s, {}).setdefault(kind, {"sectors": {}, "alight": {}})
        entry.setdefault("transfer", {})[period] = round(trips, 1)
        entry.setdefault("transfer_sectors", {})[period] = [round(v, 1) for v in onward[s, kind, period]]

    result = {
        "schema_version": 2,
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
            "alight": "viajes que terminan en la estación o transbordan en ella, sobre los que llegan a ella en un bus que para ahí",
            "transfer": "viajes por día que cambian de servicio en la estación en cada franja, llevados a todas las entradas; transfer_sectors, hacia dónde sale su segundo tramo",
            "transfer_scale": {k: round(v, 3) for k, v in scale.items()},
        },
        "coverage": {"trips_assigned": round(assigned), "trips_unassigned": round(unassigned), "stations": len(stations),
                     "transfers_weekday": round(sum(v for (s, k, p), v in changing.items() if k == "weekday") * scale.get("weekday", 1.0))},
        "stations": stations,
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/od_profiles.json", ROOT / "app/dist/od_profiles.json"):
        target.write_text(text)
    print(json.dumps(result["coverage"], ensure_ascii=False), f"{len(text) / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
