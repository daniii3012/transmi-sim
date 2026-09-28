#!/usr/bin/env python3
"""Calles, cruces peatonales y puentes peatonales junto a la calzada de TransMilenio, desde OSM.

El contexto general (`context.json`) solo trae las avenidas y las simplifica cada 10 m: de cerca
faltaban calles que cruzan la troncal —en la Calle 13 había semáforos sin calle— y no había cruces
ni puentes peatonales. Esta herramienta toma todas las vías de OSM a 70 m de la calzada y guarda:

- `streets`: las calles de carros que `context.json` no trae, recortadas a 120 m de la troncal, con
  un ancho de calzada estimado por carriles o por categoría;
- `crossings`: los cruces peatonales —vías `footway=crossing` y nodos `highway=crossing`—, como un
  segmento con su ancho, para dibujar la cebra;
- `footbridges`: los puentes peatonales (`bridge` en andenes, senderos y escaleras) con la altura
  de cada vértice; sus rampas son las vías peatonales con `incline` o `ramp` que salen de sus
  extremos; baja de cada extremo libre al suelo, por sus rampas o dentro de su propio trazado.

Entrada: `data/raw/cross_streets/<instantánea>/overpass.json` (descarga fuera del repositorio).
Salida: `data/curated/cross_streets.json` y su copia en `app/dist`.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
REACH = 120.0       # m de la troncal que se guardan de cada calle
SIMPLIFY = 1.0      # m
MIN_PIECE = 8.0     # m
DECK = 5.5          # m por nivel de un puente peatonal
VEHICULAR = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
             "living_street", "road", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
PEDESTRIAN = {"footway", "path", "steps", "pedestrian", "cycleway"}
# Ancho de calzada por categoría, en metros, cuando OSM no dice cuántos carriles hay.
WIDTH = {"motorway": 10.5, "trunk": 10.5, "primary": 10.0, "secondary": 8.0, "tertiary": 7.0, "unclassified": 6.0,
         "residential": 6.0, "living_street": 5.0, "road": 6.0, "service": 4.5}


def yes(tags, key):
    return tags.get(key) not in (None, "no")


def width_of(tags):
    kind = tags["highway"].removesuffix("_link")
    lanes = tags.get("lanes", "")
    if lanes.isdigit() and 0 < int(lanes) < 9:
        return round(int(lanes) * 3.2 + 0.6, 1)
    w = WIDTH.get(kind, 6.0)
    return round(w * (0.6 if tags.get("oneway") == "yes" and kind in ("motorway", "trunk", "primary") else 1) if not tags["highway"].endswith("_link") else 4.5, 1)


def main() -> None:
    raw_root = ROOT / "data/raw/cross_streets"
    snapshot = json.loads((raw_root / "latest.json").read_text())["snapshot"]
    folder = raw_root / snapshot
    manifest = json.loads((folder / "manifest.json").read_text())
    raw = json.loads((folder / "overpass.json").read_text())
    services = json.loads((ROOT / "app/dist/services.json").read_text())
    to_xy = Transformer.from_crs("EPSG:4326", services["projection"], always_xy=True)
    lines = [LineString(r["points"]) for r in services["routes"] if r.get("ready") and len(r["points"]) > 1]
    tree = STRtree(lines)
    corridor = unary_union([l.buffer(REACH) for l in lines])
    context_ids = {f["id"] for f in json.loads((ROOT / "app/dist/context.json").read_text())["features"] if f["kind"] == "road"}

    def busway_near(geom, d):
        return [lines[i] for i in tree.query(geom.buffer(d)) if lines[i].distance(geom) <= d]

    def xy(e):
        return [to_xy.transform(p["lon"], p["lat"]) for p in e.get("geometry") or []]

    def rounded(points, z=None):
        return [[round(x, 1), round(y, 1)] + ([round(z[k], 1)] if z else []) for k, (x, y) in enumerate(points)]

    ways = [e for e in raw["elements"] if e["type"] == "way" and len(e.get("geometry") or []) >= 2]
    nodes = [e for e in raw["elements"] if e["type"] == "node"]

    # Calles de carros que el contexto no trae, recortadas al corredor.
    streets = []
    road_vertices = {}
    for e in ways:
        t = e.get("tags", {})
        hw = t.get("highway")
        pts = xy(e)
        line = LineString(pts)
        crosses = bool(busway_near(line, 12))
        if hw in VEHICULAR or (hw == "service" and crosses and t.get("service") not in ("parking_aisle", "driveway")):
            w = width_of(t)
            for p in pts:
                road_vertices[(round(p[0], 2), round(p[1], 2))] = (e, w)
            if e["id"] in context_ids or yes(t, "tunnel"):
                continue
            clipped = line.intersection(corridor)
            for piece in getattr(clipped, "geoms", [clipped]):
                if piece.geom_type != "LineString" or piece.length < MIN_PIECE:
                    continue
                streets.append({"id": e["id"], "kind": "road", "name": t.get("name", ""), "highway": hw, "width": w,
                                "points": rounded(piece.simplify(SIMPLIFY).coords), "closed": False, "holes": [],
                                "bridge": yes(t, "bridge"), "tunnel": False, "layer": t.get("layer"), "junction": t.get("junction")})

    # Cruces peatonales: las vías de cruce con su trazado; los nodos sueltos, atravesados a la vía en
    # la que están (o a la troncal, si están sobre ella).
    crossings = []
    on_crossing_way = set()
    for e in ways:
        t = e.get("tags", {})
        if t.get("footway") == "crossing" or (t.get("highway") in PEDESTRIAN and t.get("crossing")):
            pts = xy(e)
            for p in pts:
                on_crossing_way.add((round(p[0], 2), round(p[1], 2)))
            line = LineString(pts)
            if line.length < 3 or line.length > 60:
                continue
            crossings.append({"points": rounded(line.simplify(SIMPLIFY).coords), "width": 3.0,
                              "signals": t.get("crossing") in ("traffic_signals",) or t.get("crossing:signals") == "yes"})
    for e in nodes:
        t = e.get("tags", {})
        x, y = to_xy.transform(e["lon"], e["lat"])
        key = (round(x, 2), round(y, 2))
        if key in on_crossing_way:
            continue
        p = Point(x, y)
        near = busway_near(p, 8)
        if near:
            base, half = near[0], 6.0
        elif key in road_vertices:
            way, w = road_vertices[key]
            base, half = LineString(xy(way)), w / 2 + 0.5
        else:
            continue
        s = base.project(p)
        a, b = base.interpolate(max(0, s - 2)), base.interpolate(min(base.length, s + 2))
        dx, dy = b.x - a.x, b.y - a.y
        n = math.hypot(dx, dy) or 1
        nx, ny = -dy / n * half, dx / n * half
        crossings.append({"points": rounded([(x - nx, y - ny), (x + nx, y + ny)]), "width": 3.0,
                          "signals": t.get("crossing") == "traffic_signals"})

    # Puentes peatonales. Cada puente, con las rampas y escaleras que lo tocan, es un grafo de puntos
    # cada 4 m; la altura de un punto es el camino más barato hasta un extremo libre (a nivel del
    # suelo), a 10 % en rampa o tablero y 60 % en escalera, con tope en la altura del tablero. Así
    # baja por sus rampas etiquetadas y, si OSM no las trae, dentro de su propio trazado.
    vehicular = [LineString(xy(e)) for e in ways if e.get("tags", {}).get("highway") in VEHICULAR]
    vtree = STRtree(vehicular)
    def ped(t):
        return t.get("highway") in PEDESTRIAN and not yes(t, "tunnel") and t.get("footway") != "sidewalk"
    bridge_ways = [e for e in ways if ped(e.get("tags", {})) and yes(e["tags"], "bridge")]
    link_ways = [e for e in ways if ped(e.get("tags", {})) and not yes(e["tags"], "bridge")
                 and (yes(e["tags"], "incline") or yes(e["tags"], "ramp") or e["tags"].get("highway") == "steps")]
    key = lambda p: (round(p[0], 2), round(p[1], 2))
    bridge_ends = {key(p) for e in bridge_ways for p in (xy(e)[0], xy(e)[-1])}
    # Rampas y escaleras encadenadas a un puente (hasta seis tramos).
    members, frontier = {e["id"]: e for e in bridge_ways}, set(bridge_ends)
    for _ in range(6):
        grown = [e for e in link_ways if e["id"] not in members and (key(xy(e)[0]) in frontier or key(xy(e)[-1]) in frontier)]
        if not grown:
            break
        for e in grown:
            members[e["id"]] = e
            frontier |= {key(xy(e)[0]), key(xy(e)[-1])}
    # Grafo de puntos cada 4 m.
    parent = {}
    def find(k):
        while parent.setdefault(k, k) != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k
    pieces, adj, degree = [], defaultdict(list), defaultdict(int)
    for e in members.values():
        line = LineString(xy(e))
        n = max(1, math.ceil(line.length / 4))
        pts = [line.interpolate(line.length * k / n) for k in range(n + 1)]
        ids = [key(xy(e)[0])] + [(e["id"], k) for k in range(1, n)] + [key(xy(e)[-1])]
        rate = 0.6 if e["tags"].get("highway") == "steps" else 0.1
        for k in range(n):
            c = line.length / n * rate
            adj[ids[k]].append((ids[k + 1], c)); adj[ids[k + 1]].append((ids[k], c))
            find(ids[k]); parent[find(ids[k])] = find(ids[k + 1])
        degree[ids[0]] += 1; degree[ids[-1]] += 1
        pieces.append((e, ids, [(q.x, q.y) for q in pts]))
    # Extremos libres: puntas que no siguen en otro tramo del puente.
    import heapq
    height = {}
    heap = [(0.0, k) for k, d in degree.items() if d == 1]
    while heap:
        d, k = heapq.heappop(heap)
        if k in height:
            continue
        height[k] = d
        for m, c in adj[k]:
            if m not in height:
                heapq.heappush(heap, (d + c, m))
    # Un puente cuenta si cruza una calle o la troncal; los de canales y parques no se levantan.
    crosses_road = defaultdict(bool)
    for e, ids, pts in pieces:
        if yes(e["tags"], "bridge"):
            line = LineString(pts)
            if busway_near(line, 3) or any(vehicular[i].intersects(line) for i in vtree.query(line)):
                crosses_road[find(ids[0])] = True
    footbridges = []
    for e, ids, pts in pieces:
        if not crosses_road[find(ids[0])]:
            continue
        try:
            level = max(1, int(e["tags"].get("layer", "1")))
        except ValueError:
            level = 1
        H = DECK if level <= 1 else DECK + 2.5  # un puente sobre otro puente va más arriba
        z = [min(H, height.get(k, H)) for k in ids]
        kind = "deck" if yes(e["tags"], "bridge") else "steps" if e["tags"].get("highway") == "steps" else "ramp"
        footbridges.append({"id": e["id"], "kind": kind, "name": e["tags"].get("name", ""), "points": rounded(pts, z)})

    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"dataset": "OpenStreetMap", "snapshot": snapshot, "sha256": manifest["sha256"],
                   "license": "ODbL 1.0, © OpenStreetMap contributors"},
        "method": (f"vías de OSM a 70 m de la calzada de TransMilenio. Calles de carros que context.json no trae, "
                   f"recortadas a {REACH:g} m de la troncal; ancho por carriles (3,2 m cada uno) o por categoría. Cruces: "
                   f"vías footway=crossing y nodos highway=crossing atravesados a su vía. Puentes peatonales a {DECK:g} m "
                   f"por nivel si cruzan una calle o la troncal; con sus rampas y escaleras bajan desde cada extremo "
                   f"libre al 10 % (60 % en escalera)"),
        "coverage": {"streets": len(streets), "street_km": round(sum(LineString(s["points"]).length for s in streets) / 1000, 1),
                     "crossings": len(crossings), "footbridge_pieces": sum(f["kind"] == "deck" for f in footbridges),
                     "ramps": sum(f["kind"] != "deck" for f in footbridges)},
        "streets": streets,
        "crossings": crossings,
        "footbridges": footbridges,
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/cross_streets.json", ROOT / "app/dist/cross_streets.json"):
        target.write_text(text)
    print(json.dumps(result["coverage"]), f"{len(text) / 1e3:.0f} kB", hashlib.sha256(text.encode()).hexdigest()[:12])


if __name__ == "__main__":
    main()
