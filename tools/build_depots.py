#!/usr/bin/env python3
"""Patios troncales, desde la capa Patios SITP del Mapa de Referencia (IDECA / UAECD).

La capa publica cada patio del SITP con su polígono, su nombre, el operador y si es troncal o zonal.
El simulador toma los troncales —donde duermen y esperan los buses articulados y biarticulados— para
dibujarlos y llenarlos con los buses que no están en servicio a esa hora.

Entrada: `data/raw/depots/<instantánea>/patios.json` (descarga fuera del repositorio). Salida:
`data/curated/depots.json` y su copia en `app/dist`.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer
import math

from shapely.geometry import LineString, Polygon, box
from shapely.affinity import rotate, translate
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]


def nice(name: str) -> str:
    """«PATIO TEMPORAL LAGUNA I» → «Temporal Laguna I»; «PATIO AMERICAS II» → «Américas II»."""
    words = name.replace("PATIO ", "", 1).split()
    fixed = {"AMERICAS": "Américas", "DE": "de", "LA": "la", "DEL": "del", "I": "I", "II": "II"}
    out = [fixed.get(w, w.capitalize()) for w in words]
    if out:
        out[0] = out[0][0].upper() + out[0][1:]
    return " ".join(out)


def slots_in(zone, out):
    """Puestos de bus dentro de una zona: de lado en bloques de dos de fondo con pasillo si la zona es
    ancha; en fila si es angosta. Cada puesto es [x, y, ángulo del bus]."""
    rect = zone.minimum_rotated_rectangle
    pts = list(rect.exterior.coords)[:4]
    e1 = (pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]); e2 = (pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
    long_, short = (e1, e2) if math.hypot(*e1) >= math.hypot(*e2) else (e2, e1)
    L, W = math.hypot(*long_), math.hypot(*short)
    u = (long_[0] / L, long_[1] / L); v = (-u[1], u[0])
    c = zone.centroid
    def fits(x, y, ang, lng, wid):
        foot = rotate(box(-lng / 2, -wid / 2, lng / 2, wid / 2), ang, use_radians=True)
        return zone.contains(translate(foot, x, y))
    if W >= 21:
        ang = math.atan2(v[1], v[0])
        b = -W / 2
        while b + 19.5 <= W / 2 + 1:
            for depth in (9.75, 29.25):
                bb = b + depth
                if bb > W / 2:
                    continue
                a = -L / 2 + 2
                while a <= L / 2 - 2:
                    x, y = c.x + u[0] * a + v[0] * bb, c.y + u[1] * a + v[1] * bb
                    if fits(x, y, ang, 19, 3):
                        out.append([round(x, 1), round(y, 1), round(ang, 3)])
                    a += 3.6
            b += 2 * 19.5 + 11
    elif W >= 3.5:
        ang = math.atan2(u[1], u[0])
        b = -W / 2 + 1.8
        while b <= W / 2 - 1.8:
            a = -L / 2 + 10
            while a <= L / 2 - 10:
                x, y = c.x + u[0] * a + v[0] * b, c.y + u[1] * a + v[1] * b
                if fits(x, y, ang, 19, 3):
                    out.append([round(x, 1), round(y, 1), round(ang, 3)])
                a += 20
            b += 3.6


def main() -> None:
    raw_root = ROOT / "data/raw/depots"
    snapshot = json.loads((raw_root / "latest.json").read_text())["snapshot"]
    folder = raw_root / snapshot
    manifest = json.loads((folder / "manifest.json").read_text())
    raw = json.loads((folder / "patios.json").read_text())
    projection = json.loads((ROOT / "app/dist/services.json").read_text())["projection"]
    to_xy = Transformer.from_crs("EPSG:4326", projection, always_xy=True)

    osm_path = folder / "osm.json"
    osm = json.loads(osm_path.read_text())["elements"] if osm_path.exists() else []
    def geom(e):
        return [to_xy.transform(p["lon"], p["lat"]) for p in e.get("geometry") or []]
    parkings, roads, blocks = [], [], []
    for e in osm:
        t, g = e.get("tags", {}), geom(e)
        if len(g) < 2:
            continue
        if t.get("amenity") == "parking" and len(g) >= 4 and g[0] == g[-1]:
            parkings.append(Polygon(g).buffer(0))
        elif t.get("building") and len(g) >= 4:
            blocks.append(Polygon(g).buffer(2))
        elif t.get("highway"):
            roads.append(LineString(g).buffer(5 if t.get("highway") != "footway" else 1.5))
    depots = []
    for f in raw["features"]:
        a = f["attributes"]
        if a.get("COMPONENTE") != "TRONCAL":
            continue
        rings = [[[round(v, 1) for v in to_xy.transform(x, y)] for x, y in ring] for ring in (f.get("geometry") or {}).get("rings", [])]
        if not rings:
            continue
        shell = max(rings, key=lambda r: Polygon(r).area)
        # Zonas de parqueo: los parqueaderos de OSM dentro del patio; si no hay, el terreno menos las
        # vías internas y los edificios. Los puestos van solo ahí, como en las fotos del patio.
        area = Polygon(shell).buffer(-2)
        mine = [p.intersection(area) for p in parkings if p.intersects(area)]
        zones = unary_union(mine) if mine and sum(z.area for z in mine) > 0.25 * area.area else area.difference(unary_union([g for g in roads + blocks if g.intersects(area)] or [Polygon()]))
        pieces = sorted([z for z in getattr(zones, "geoms", [zones]) if z.geom_type == "Polygon" and z.area > 500], key=lambda z: -z.area)
        slots = []
        for z in pieces:
            slots_in(z, slots)
        depots.append({
            "id": a["ID_PATIO"], "name": nice(a["NOMBRE"]), "operator": a.get("OPERADOR"),
            "address": a.get("DIRECCION"), "status": a.get("ESTADOIMP"), "area_m2": round(Polygon(shell).area),
            "points": shell,
            "slots": slots,
        })
    depots.sort(key=lambda d: d["id"])
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"dataset": manifest["source"], "url": manifest["dataset"], "snapshot": snapshot, "sha256": manifest["sha256"],
                   "license": "Datos Abiertos Bogotá, IDECA; atribución a la entidad productora"},
        "method": "patios con COMPONENTE = TRONCAL; anillo exterior más grande de cada uno. Puestos de bus en los parqueaderos de OSM dentro del patio o, si no hay, en el terreno menos vías internas y edificios de OSM",
        "coverage": {"depots": len(depots), "hectares": round(sum(d["area_m2"] for d in depots) / 1e4, 1), "slots": sum(len(d["slots"]) for d in depots)},
        "depots": depots,
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/depots.json", ROOT / "app/dist/depots.json"):
        target.write_text(text)
    print(json.dumps(result["coverage"]), [d["name"] for d in depots], hashlib.sha256(text.encode()).hexdigest()[:12])


if __name__ == "__main__":
    main()
