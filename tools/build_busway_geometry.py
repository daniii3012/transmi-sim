#!/usr/bin/env python3
"""Carriles de la calzada de TransMilenio a partir de la capa Calzada del Mapa de Referencia.

OpenStreetMap publica la etiqueta `lanes` en una parte de la calzada exclusiva —113 de 299 km— y en
el resto el simulador tenía que suponer un carril: en la troncal Américas, que tiene dos carriles en
casi todo el tramo entre De La Sabana y Banderas, los buses hacían fila de a uno en cada semáforo.

La capa Calzada del Mapa de Referencia (IDECA / UAECD, datos del IDU) publica cada calzada de la
ciudad como polígono con su ancho medido. La calzada exclusiva de TransMilenio es una más, sin
atributo que la distinga, pero los recorridos del simulador van por ella: el polígono que contiene
cada punto del recorrido es el de la calzada del bus. Su ancho da los carriles: una calzada de 3,5 m
es un carril, una de 7 m son dos. El atributo de carriles de la malla vial no sirve aquí: un mismo
código de vía cubre varios segmentos con valores distintos.

Entrada: `data/raw/idu_calzada/<instantánea>/calzada.json` y `puente.json`, que descarga una
herramienta fuera del repositorio (ver docs/ACTUALIZAR_DATOS.md). Salida:
`data/curated/busway_geometry.json` y su copia en `app/dist`, con los carriles cada 5 m de cada
arista dirigida de los recorridos utilizables, en la misma clave de vértices que usa el motor.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
from collections import Counter
from datetime import datetime, timezone

from pyproj import Transformer
from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree

ROOT = pathlib.Path(__file__).resolve().parents[1]
STEP = 5.0            # m entre muestras, la celda del motor
TOUCH = 1.5           # m de tolerancia: el trazado publicado puede caer al borde de la calzada
ONE_LANE_BELOW = 5.3  # m: por debajo, un carril; por encima, dos
WIDE = 10.5           # m: patios de portal y plazoletas; se tratan como dos carriles y se marcan


def key(p):
    return f"{p[0]},{p[1]}"


def lanes_for(width: float) -> int:
    return 1 if width < ONE_LANE_BELOW else 2


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", help="carpeta de data/raw/idu_calzada; por omisión la de latest.json")
    args = parser.parse_args()
    raw_root = ROOT / "data/raw/idu_calzada"
    snapshot = args.snapshot or json.loads((raw_root / "latest.json").read_text())["snapshot"]
    folder = raw_root / snapshot
    manifest = json.loads((folder / "manifest.json").read_text())
    services = json.loads((ROOT / "app/dist/services.json").read_text())
    to_xy = Transformer.from_crs("EPSG:4326", services["projection"], always_xy=True)

    def polygons(name):
        out = []
        for f in json.loads((folder / name).read_text())["features"]:
            rings = (f.get("geometry") or {}).get("rings") or []
            if not rings or len(rings[0]) < 4:
                continue
            shell = [to_xy.transform(x, y) for x, y in rings[0]]
            holes = [[to_xy.transform(x, y) for x, y in r] for r in rings[1:] if len(r) >= 4]
            p = Polygon(shell, holes)
            if not p.is_valid:
                p = p.buffer(0)
            if p.is_empty:
                continue
            out.append((p, f["attributes"]))
        return out

    calzadas = polygons("calzada.json")
    bridges = polygons("puente.json")
    ctree = STRtree([p for p, _ in calzadas])
    btree = STRtree([p for p, _ in bridges])

    # Aristas dirigidas de los recorridos utilizables, con la misma clave que usa el motor.
    edges = {}
    for r in services["routes"]:
        if not r.get("ready"):
            continue
        pts = [p for i, p in enumerate(r["points"]) if i == 0 or p != r["points"][i - 1]]
        for a, b in zip(pts, pts[1:]):
            edges.setdefault(f"{key(a)}>{key(b)}", (a, b))

    # Primera pasada: qué polígono contiene cada muestra y en qué sentido va el recorrido ahí. Un
    # polígono que contiene muestras de los dos sentidos es una calzada compartida —sin separador
    # entre las dos direcciones— y cada sentido se queda con la mitad de su ancho.
    samples = {}
    headings = {}
    for k, (a, b) in sorted(edges.items()):
        length = math.dist(a, b)
        n = max(1, math.ceil(length / STEP))
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        row = []
        for s in range(n):
            t = min(1.0, (s + 0.5) * STEP / length) if length else 0.0
            p = Point(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            hits = [i for i in ctree.query(p.buffer(TOUCH)) if calzadas[i][0].distance(p) <= TOUCH]
            best = min(hits, key=lambda i: calzadas[i][0].area) if hits else -1
            row.append((p, best))
            if best >= 0:
                headings.setdefault(best, []).append((math.cos(ang), math.sin(ang)))
        samples[k] = row
    shared = set()
    for i, hs in headings.items():
        if any(u[0] * v[0] + u[1] * v[1] < -0.8 for u in hs[:40] for v in hs[:40]):
            shared.add(i)

    out, counts, widths = {}, Counter(), Counter()
    for k, (a, b) in sorted(edges.items()):
        length = math.dist(a, b)
        n = max(1, math.ceil(length / STEP))
        lanes, bridge, width = [], [], []
        for s, (p, best) in enumerate(samples[k]):
            if best >= 0:
                att = calzadas[best][1]
                w = float(att.get("CALANCHO") or 0) / (2 if best in shared else 1)
                lanes.append(lanes_for(w) if w > 0 else 0)
                width.append(round(w, 1))
            else:
                lanes.append(0)
                width.append(0)
            bridge.append(1 if any(bridges[i][0].distance(p) <= 0.5 for i in btree.query(p.buffer(0.5))) else 0)
        # Donde no hay polígono —casi siempre el área de un cruce— se toma el menor de los vecinos
        # conocidos: los cruces son justamente donde la calzada se angosta.
        for s in range(n):
            if lanes[s]:
                continue
            left = next((lanes[j] for j in range(s - 1, -1, -1) if lanes[j]), 0)
            right = next((lanes[j] for j in range(s + 1, n) if lanes[j]), 0)
            lanes[s] = min(x for x in (left, right) if x) if (left or right) else 0
        for s in range(n):
            counts[lanes[s]] += 1
            if width[s]:
                widths["wide" if width[s] >= WIDE else lanes_for(width[s])] += 1
        out[k] = {"lanes": "".join(str(v) for v in lanes), "bridge": "".join(str(v) for v in bridge)}

    total = sum(counts.values())
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "dataset": manifest["source"],
            "url": manifest["dataset"],
            "snapshot": snapshot,
            "files": manifest["files"],
            "license": "Datos Abiertos Bogotá, IDECA; atribución a la entidad productora",
        },
        "method": {
            "step_m": STEP,
            "touch_m": TOUCH,
            "one_lane_below_m": ONE_LANE_BELOW,
            "wide_m": WIDE,
            "rule": "polígono de calzada más pequeño que contiene el punto del recorrido; su ancho da los carriles. Si el polígono contiene los dos sentidos, cada uno se queda con la mitad del ancho. Sin polígono —cruces— el menor de los vecinos.",
            "bridge": "punto dentro de un polígono de la capa Puente; puede ser el puente de la troncal o uno que pasa por encima de ella",
        },
        "coverage": {
            "edges": len(out),
            "samples": total,
            "km_one_lane": round(counts[1] * STEP / 1000, 1),
            "km_two_lanes": round(counts[2] * STEP / 1000, 1),
            "km_unknown": round(counts[0] * STEP / 1000, 1),
            "km_measured_wide": round(widths["wide"] * STEP / 1000, 1),
            "shared_polygons": len(shared),
        },
        "edges": out,
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    for target in (ROOT / "data/curated/busway_geometry.json", ROOT / "app/dist/busway_geometry.json"):
        target.write_text(text + "\n")
    print(json.dumps(result["coverage"], ensure_ascii=False), hashlib.sha256(text.encode()).hexdigest()[:12])


if __name__ == "__main__":
    main()
