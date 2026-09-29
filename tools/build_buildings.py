#!/usr/bin/env python3
"""Edificios junto a las troncales, en teselas binarias para la vista 3D.

La capa Construcción del Mapa de Referencia (IDECA / UAECD, datos de Catastro) publica cada
construcción de la ciudad con su huella y su número de pisos: en un kilómetro cuadrado de Chapinero
trae diez veces más edificios que OpenStreetMap, que además casi no tiene alturas. El simulador solo
necesita el paisaje de las troncales: la instantánea cruda trae lo que hay a 350 m de la calzada
exclusiva (la descarga una herramienta fuera del repositorio; ver docs/ACTUALIZAR_DATOS.md).
Más allá de esa franja la densidad baja por escalones, para que no se note un corte: hasta 1 km, el
70 % de las construcciones, y en el resto de la ciudad el 30 %, siempre las mismas porque la muestra
es determinista por OBJECTID. De cada instantánea se toman las que la franja no trae.

Cada huella se simplifica (0,4 m), pierde los patios interiores y guarda sus pisos; la altura es de
3 m por piso. Se agrupan por el kilómetro que contiene su centroide y cada tesela es un binario
pequeño que la vista 3D pide solo cuando la cámara está cerca:

    'TMB1' · u32 edificios · por edificio: u8 pisos, u8 vértices, vértices × (i16 x, i16 y)

con coordenadas en decímetros relativas a la esquina de la tesela, en la proyección de la red.

Entradas: `data/raw/construcciones/<instantánea>/construccion.json` y, si existe,
`data/raw/construcciones_ciudad/<instantánea>/construccion.jsonl`. Salida: `app/dist/buildings/`
con `index.json` —teselas, procedencia y licencia— y un `.bin` por tesela.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import shutil
import struct
from collections import defaultdict
from datetime import datetime, timezone

from pyproj import Transformer
from shapely.geometry import LineString, Polygon
from shapely.strtree import STRtree
from shapely.geometry.polygon import orient

ROOT = pathlib.Path(__file__).resolve().parents[1]
TILE = 1000        # m
SIMPLIFY = 0.4     # m
MIN_AREA = 12.0    # m²: casetas y voladizos sueltos no se ven desde la cámara
MIN_AREA_MID = 20.0  # m²: entre 350 m y 1 km
MIN_AREA_FAR = 30.0  # m²: en el fondo, solo lo que se alcanza a ver de lejos
MAX_VERTICES = 255
MAX_FLOORS = 70


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", help="carpeta de data/raw/construcciones; por omisión la de latest.json")
    parser.add_argument("--mid", help="carpeta de data/raw/construcciones_1km; por omisión la de latest.json si existe")
    parser.add_argument("--city", help="carpeta de data/raw/construcciones_ciudad; por omisión la de latest.json si existe")
    args = parser.parse_args()
    raw_root = ROOT / "data/raw/construcciones"
    snapshot = args.snapshot or json.loads((raw_root / "latest.json").read_text())["snapshot"]
    folder = raw_root / snapshot
    manifest = json.loads((folder / "manifest.json").read_text())
    city_root = ROOT / "data/raw/construcciones_ciudad"
    city = args.city or (json.loads((city_root / "latest.json").read_text())["snapshot"] if (city_root / "latest.json").exists() else None)
    city_manifest = json.loads((city_root / city / "manifest.json").read_text()) if city else None
    mid_root = ROOT / "data/raw/construcciones_1km"
    mid = args.mid or (json.loads((mid_root / "latest.json").read_text())["snapshot"] if (mid_root / "latest.json").exists() else None)
    mid_manifest = json.loads((mid_root / mid / "manifest.json").read_text()) if mid else None
    projection = json.loads((ROOT / "app/dist/services.json").read_text())["projection"]
    to_xy = Transformer.from_crs("EPSG:4326", projection, always_xy=True)

    # La calzada de TransMilenio: una construcción que la pisa —cubiertas, pasos, polígonos de
    # Catastro que se montan sobre la vía, como junto a Museo del Oro— no se dibuja.
    services = json.loads((ROOT / "app/dist/services.json").read_text())
    busway = [LineString(r["points"]).buffer(4.0) for r in services["routes"] if r.get("ready") and len(r["points"]) > 1]
    busway_tree = STRtree(busway)
    over_busway = 0
    tiles: dict[tuple[int, int], list[tuple[int, list[tuple[float, float]]]]] = defaultdict(list)
    kept = dropped = 0
    floors_seen = []
    near_ids = set()
    far_kept = mid_kept = 0
    min_area = (MIN_AREA, MIN_AREA_MID, MIN_AREA_FAR)

    # Tres capas: la franja de 350 m entera (0); hasta 1 km, la parte MOD(OBJECTID,10) de 3 a 6 que
    # con la muestra de la ciudad suma el 70 % (1); y la muestra del 30 % de la ciudad (2). Lo que la
    # franja ya trae no se repite.
    def features():
        for f in json.loads((folder / "construccion.json").read_text())["features"]:
            near_ids.add((f.get("attributes") or {}).get("OBJECTID"))
            yield f, 0
        if mid:
            for f in json.loads((mid_root / mid / "construccion.json").read_text())["features"]:
                if (f.get("attributes") or {}).get("OBJECTID") not in near_ids:
                    yield f, 1
        if city:
            with open(city_root / city / "construccion.jsonl") as fh:
                for line in fh:
                    f = json.loads(line)
                    if (f.get("attributes") or {}).get("OBJECTID") not in near_ids:
                        yield f, 2

    for f, far in features():
        rings = (f.get("geometry") or {}).get("rings") or []
        if not rings or len(rings[0]) < 4:
            dropped += 1
            continue
        attrs = f.get("attributes") or {}
        floors = int(attrs.get("CONNPISOS") or 0)
        floors = max(1, min(MAX_FLOORS, floors))
        # El anillo más grande es la huella; los demás, patios interiores o piezas sueltas.
        shells = [Polygon([to_xy.transform(x, y) for x, y in r]) for r in rings if len(r) >= 4]
        shells = [p if p.is_valid else p.buffer(0) for p in shells]
        shells = [g for p in shells for g in (getattr(p, "geoms", None) or [p]) if not g.is_empty]
        if not shells:
            dropped += 1
            continue
        shell = max(shells, key=lambda p: p.area)
        poly = orient(Polygon(shell.exterior).simplify(SIMPLIFY, preserve_topology=True), 1.0)
        if poly.is_empty or poly.area < min_area[far] or poly.geom_type != "Polygon":
            dropped += 1
            continue
        if any(busway[i].intersection(poly).area > 0.25 * poly.area or busway[i].contains(poly.centroid) for i in busway_tree.query(poly)):
            over_busway += 1
            continue
        coords = list(poly.exterior.coords)[:-1]
        if len(coords) < 3 or len(coords) > MAX_VERTICES:
            dropped += 1
            continue
        c = poly.centroid
        tiles[(math.floor(c.x / TILE), math.floor(c.y / TILE))].append((floors, coords))
        floors_seen.append(floors)
        kept += 1
        far_kept += far == 2
        mid_kept += far == 1

    out = ROOT / "app/dist/buildings"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    index, total = [], 0
    digest = hashlib.sha256()
    for (tx, ty), items in sorted(tiles.items()):
        ox, oy = tx * TILE, ty * TILE
        chunks = [b"TMB1", struct.pack("<I", len(items))]
        for floors, coords in items:
            chunks.append(struct.pack("<BB", floors, len(coords)))
            chunks.append(struct.pack(f"<{2 * len(coords)}h", *[max(-32768, min(32767, round((v - o) * 10))) for x, y in coords for v, o in ((x, ox), (y, oy))]))
        blob = b"".join(chunks)
        (out / f"{tx}_{ty}.bin").write_bytes(blob)
        digest.update(blob)
        index.append([tx, ty, len(items), len(blob)])
        total += len(blob)

    floors_seen.sort()
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "dataset": manifest["source"],
            "url": manifest["dataset"],
            "snapshot": snapshot,
            "features": manifest["features"],
            "sha256": manifest["sha256"],
            "license": "Datos Abiertos Bogotá, IDECA; atribución a la entidad productora",
            "mid": {"snapshot": mid, "features": mid_manifest["features"], "sha256": mid_manifest["sha256"], "method": mid_manifest["method"]} if mid else None,
            "city": {"snapshot": city, "features": city_manifest["features"], "sha256": city_manifest["sha256"], "method": city_manifest["method"]} if city else None,
        },
        "method": {
            "tile_m": TILE,
            "units": "decímetros relativos a la esquina de la tesela",
            "simplify_m": SIMPLIFY,
            "min_area_m2": MIN_AREA,
            "floor_height_m": 3.0,
            "min_area_mid_m2": MIN_AREA_MID,
            "min_area_far_m2": MIN_AREA_FAR,
            "rule": "huella exterior más grande de cada construcción, simplificada; pisos de CONNPISOS (mínimo 1). A 350 m de la troncal, todas; hasta 1 km, el 70 %; más lejos, la muestra del 30 % de la ciudad",
        },
        "projection": projection,
        "coverage": {
            "buildings": kept,
            "middle": mid_kept,
            "background": far_kept,
            "dropped": dropped,
            "over_busway": over_busway,
            "tiles": len(index),
            "bytes": total,
            "floors_median": floors_seen[len(floors_seen) // 2] if floors_seen else 0,
            "floors_p95": floors_seen[int(len(floors_seen) * 0.95)] if floors_seen else 0,
            "sha256": digest.hexdigest(),
        },
        "tiles": index,
    }
    (out / "index.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps(result["coverage"], ensure_ascii=False))


if __name__ == "__main__":
    main()
