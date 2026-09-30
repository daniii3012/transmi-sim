#!/usr/bin/env python3
"""Patios troncales, desde la capa Patios SITP del Mapa de Referencia (IDECA / UAECD).

La capa publica cada patio del SITP con su polígono, su nombre, el operador y si es troncal o zonal.
El simulador toma los troncales —donde duermen y esperan los buses articulados y biarticulados— para
dibujarlos y llenarlos con los buses que no están en servicio a esa hora.

Los puestos van en lo que queda libre del patio: sus parqueaderos de OSM o, si no hay, el terreno,
menos las vías internas y los edificios de OSM, las construcciones de Catastro (las mismas que dibuja
la vista 3D) y la calzada de TransMilenio con sus accesos. Antes los parqueaderos de OSM se usaban
enteros y un bus podía quedar sobre una vía interna o bajo una construcción.

Entrada: `data/raw/depots/<instantánea>/patios.json` (descarga fuera del repositorio) y las
construcciones de `data/raw/construcciones*`. Salida: `data/curated/depots.json` y su copia en `app/dist`.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer
import math

from shapely.geometry import LineString, Polygon, box
from shapely.strtree import STRtree
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


def slots_aligned(zone, axis, out):
    """Puestos en filas paralelas al eje largo del patio (`axis`, vector unitario), barriendo toda la
    pieza: bloques de dos buses de fondo, de lado, con pasillo de 11 m. Un patio se traza así, y
    orientar cada pieza suelta por su propio rectángulo desperdiciaba las piezas irregulares."""
    u = axis; v = (-u[1], u[0])
    ang = math.atan2(v[1], v[0])
    c = zone.centroid
    xs = [(x - c.x) * u[0] + (y - c.y) * u[1] for x, y in zone.exterior.coords]
    ys = [(x - c.x) * v[0] + (y - c.y) * v[1] for x, y in zone.exterior.coords]
    def fits(x, y):
        foot = rotate(box(-9.5, -1.5, 9.5, 1.5), ang, use_radians=True)
        return zone.contains(translate(foot, x, y))
    b = min(ys)
    while b <= max(ys):
        for depth in (9.75, 29.25):
            a = min(xs) + 1.8
            while a <= max(xs) - 1.8:
                x, y = c.x + u[0] * a + v[0] * (b + depth), c.y + u[1] * a + v[1] * (b + depth)
                if fits(x, y):
                    out.append([round(x, 1), round(y, 1), round(ang, 3)])
                a += 3.6
        b += 2 * 19.5 + 11


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


CUBIERTA_M2 = 1500  # construcción de Catastro más grande que esto: cubierta de parqueo o taller


def catastro(bounds, to_xy):
    """Huellas de construcción de Catastro cuyo primer vértice cae en alguno de los recuadros
    (lon/lat) de los patios, de las tres descargas: franja de 350 m, hasta 1 km y ciudad."""
    def inside(x, y):
        return any(x0 <= x <= x1 and y0 <= y <= y1 for x0, y0, x1, y1 in bounds)
    def sources():
        for name, fname in (("construcciones", "construccion.json"), ("construcciones_1km", "construccion.json")):
            latest = ROOT / "data/raw" / name / "latest.json"
            if latest.exists():
                folder = ROOT / "data/raw" / name / json.loads(latest.read_text())["snapshot"]
                yield from json.loads((folder / fname).read_text())["features"]
        latest = ROOT / "data/raw/construcciones_ciudad/latest.json"
        if latest.exists():
            folder = ROOT / "data/raw/construcciones_ciudad" / json.loads(latest.read_text())["snapshot"]
            with open(folder / "construccion.jsonl") as fh:
                for line in fh:
                    yield json.loads(line)
    seen, out = set(), []
    for f in sources():
        oid = (f.get("attributes") or {}).get("OBJECTID")
        rings = (f.get("geometry") or {}).get("rings") or []
        if oid in seen or not rings or len(rings[0]) < 4 or not inside(*rings[0][0]):
            continue
        seen.add(oid)
        poly = Polygon([to_xy.transform(x, y) for x, y in rings[0]])
        poly = poly if poly.is_valid else poly.buffer(0)
        # Una nave de más de CUBIERTA_M2 en un patio es cubierta o taller: los buses entran bajo ella.
        if poly.area <= CUBIERTA_M2:
            out.append(poly.buffer(1.5))
    return out


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
        elif t.get("highway") and t.get("service") != "parking_aisle":
            # Los pasillos del parqueadero son parte de él: restarlos partía el lote en franjas.
            roads.append(LineString(g).buffer(4 if t.get("highway") != "footway" else 1.5))
    # Construcciones de Catastro y calzada de TransMilenio dentro o junto a cada patio.
    troncales = [f for f in raw["features"] if f["attributes"].get("COMPONENTE") == "TRONCAL"]
    bounds = []
    for f in troncales:
        for ring in (f.get("geometry") or {}).get("rings", []):
            xs, ys = [p[0] for p in ring], [p[1] for p in ring]
            bounds.append((min(xs) - .0005, min(ys) - .0005, max(xs) + .0005, max(ys) + .0005))
    blocks += catastro(bounds, to_xy)
    services = json.loads((ROOT / "app/dist/services.json").read_text())
    busway = [LineString(r["points"]).buffer(6) for r in services["routes"] if r.get("ready") and len(r["points"]) > 1]
    context = json.loads((ROOT / "app/dist/busway_context.json").read_text())
    busway += [LineString(p["points"]).buffer(4) for p in context.get("pieces", []) if len(p["points"]) > 1]
    obstacles = roads + blocks + busway
    tree = STRtree(obstacles)
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
        base = unary_union(mine) if mine and sum(z.area for z in mine) > 0.25 * area.area else area
        near = [obstacles[i] for i in tree.query(area)]
        zones = base.difference(unary_union([g for g in near if g.intersects(area)] or [Polygon()]))
        pieces = sorted([z for z in getattr(zones, "geoms", [zones]) if z.geom_type == "Polygon" and z.area > 500], key=lambda z: -z.area)
        # Se prueban las dos maneras y se queda la que acomoda más: filas al eje del patio o cada pieza
        # por su cuenta.
        rect = list(area.minimum_rotated_rectangle.exterior.coords)[:3]
        e1 = (rect[1][0] - rect[0][0], rect[1][1] - rect[0][1]); e2 = (rect[2][0] - rect[1][0], rect[2][1] - rect[1][1])
        long_ = e1 if math.hypot(*e1) >= math.hypot(*e2) else e2
        axis = (long_[0] / math.hypot(*long_), long_[1] / math.hypot(*long_))
        aligned, loose = [], []
        for z in pieces:
            slots_aligned(z, axis, aligned)
            slots_in(z, loose)
        slots = aligned if len(aligned) >= len(loose) else loose
        depots.append({
            "id": a["ID_PATIO"], "name": nice(a["NOMBRE"]), "operator": a.get("OPERADOR"),
            "address": a.get("DIRECCION"), "status": a.get("ESTADOIMP"), "area_m2": round(Polygon(shell).area),
            "points": shell,
            "slots": slots,
        })
    depots.sort(key=lambda d: d["id"])
    result = {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"dataset": manifest["source"], "url": manifest["dataset"], "snapshot": snapshot, "sha256": manifest["sha256"],
                   "license": "Datos Abiertos Bogotá, IDECA; atribución a la entidad productora"},
        "method": "patios con COMPONENTE = TRONCAL; anillo exterior más grande de cada uno. Puestos de bus en los parqueaderos de OSM dentro del patio o, si no hay, en el terreno; en los dos casos menos vías internas y edificios de OSM, construcciones de Catastro y calzada de TransMilenio con sus accesos. Posición estimada: no hay dato abierto de puestos",
        "coverage": {"depots": len(depots), "hectares": round(sum(d["area_m2"] for d in depots) / 1e4, 1), "slots": sum(len(d["slots"]) for d in depots)},
        "depots": depots,
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/depots.json", ROOT / "app/dist/depots.json"):
        target.write_text(text)
    print(json.dumps(result["coverage"]), [d["name"] for d in depots], hashlib.sha256(text.encode()).hexdigest()[:12])


if __name__ == "__main__":
    main()
