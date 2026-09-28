#!/usr/bin/env python3
"""Calzada de TransMilenio que ningún recorrido publicado usa, para dibujarla como contexto.

El mapa dibuja la calzada del motor, que sale de los trazados de los servicios. Lo que ningún
trazado recorre —la media glorieta de Banderas donde dan la vuelta los que terminan ahí, las vías
internas de los portales, los accesos a los patios— quedaba sin dibujar. Esta herramienta toma todas
las vías de TransMilenio de OSM, las muestrea cada 5 m y guarda los trozos a más de 6 m de cualquier
recorrido utilizable.

Entrada: `data/raw/busway_ways/<instantánea>/overpass.json` (descarga fuera del repositorio).
Salida: `data/curated/busway_context.json` y su copia en `app/dist`.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
STEP = 5.0
COVERED = 6.0
MIN_LENGTH = 15.0


def main() -> None:
    raw_root = ROOT / "data/raw/busway_ways"
    snapshot = json.loads((raw_root / "latest.json").read_text())["snapshot"]
    folder = raw_root / snapshot
    manifest = json.loads((folder / "manifest.json").read_text())
    raw = json.loads((folder / "overpass.json").read_text())
    services = json.loads((ROOT / "app/dist/services.json").read_text())
    to_xy = Transformer.from_crs("EPSG:4326", services["projection"], always_xy=True)
    lines = [LineString(r["points"]) for r in services["routes"] if r.get("ready") and len(r["points"]) > 1]
    tree = STRtree(lines)

    pieces = []
    for e in raw["elements"]:
        geometry = e.get("geometry") or []
        if e.get("type") != "way" or len(geometry) < 2:
            continue
        tags = e.get("tags", {})
        pts = [to_xy.transform(p["lon"], p["lat"]) for p in geometry]
        line = LineString(pts)
        n = max(1, math.ceil(line.length / STEP))
        run = []
        def flush():
            if len(run) > 1 and LineString(run).length >= MIN_LENGTH:
                pieces.append({"osm_way_id": e["id"], "points": [[round(x, 1), round(y, 1)] for x, y in run],
                               "bridge": bool(tags.get("bridge") and tags["bridge"] != "no"),
                               "tunnel": bool(tags.get("tunnel") and tags["tunnel"] != "no")})
        for k in range(n + 1):
            p = line.interpolate(min(line.length, k * STEP))
            near = any(lines[i].distance(p) <= COVERED for i in tree.query(p.buffer(COVERED)))
            if near:
                flush()
                run = []
            else:
                run.append((p.x, p.y))
        flush()

    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"dataset": "OpenStreetMap", "snapshot": snapshot, "sha256": manifest["sha256"],
                   "license": "ODbL 1.0, © OpenStreetMap contributors"},
        "method": f"vías de TransMilenio muestreadas cada {STEP:g} m; se guardan los trozos a más de {COVERED:g} m de todo recorrido utilizable y de al menos {MIN_LENGTH:g} m",
        "coverage": {"pieces": len(pieces), "km": round(sum(LineString(p["points"]).length for p in pieces) / 1000, 1)},
        "pieces": pieces,
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/busway_context.json", ROOT / "app/dist/busway_context.json"):
        target.write_text(text)
    print(json.dumps(result["coverage"]), f"{len(text) / 1e3:.0f} kB", hashlib.sha256(text.encode()).hexdigest()[:12])


if __name__ == "__main__":
    main()
