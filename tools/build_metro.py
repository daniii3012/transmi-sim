#!/usr/bin/env python3
"""Primera Línea del Metro de Bogotá (proyecto), desde los datos abiertos de la Empresa Metro.

Trazado, viaducto y las 16 estaciones de la capa movilidad/metrobogota que publica Catastro Bogotá
con licencia CC BY 4.0 (Datos Abiertos Bogotá, «Estaciones de la Línea 1 del Metro de Bogotá»). Se
proyectan al marco métrico del simulador y cada estación recibe su abscisa sobre el trazado, que es
lo que necesita una operación simulada. Los nombres de las estaciones son los elegidos en la votación
de 2026 (la 7, en la Av. 68, sigue sin nombre). Lo que no publica nadie —horario, intervalos fuera
del inicial, tiempos de parada— va en `operation` rotulado como estimado.

El patio taller de El Corzo (Bosa) no está en esa capa: sale de OpenStreetMap (ODbL), con su
contorno, sus vías de patio y sus edificios. Sus alturas no están publicadas y van estimadas: 14 m
una nave con cubierta (`building=roof`), 8 m un edificio.

Edificios de acceso y puentes peatonales: de los planos de ubicación que la Empresa Metro publica
por estación (metrodebogota.gov.co/linea-1/estaciones, «Estacion-N-nuevo-mapa.pdf», página 1). Son
mapas con el norte arriba: el rectángulo azul de la estación se hace coincidir con su contorno
publicado (escala a lo largo, giro y centro) y con esa transformación los polígonos naranja pasan a
metros. Un polígono de menos de 9 m de ancho es un puente peatonal hacia el piso de ingreso; los
demás, edificios. Las alturas no están publicadas: 14 m un edificio de acceso, puente a 7,5 m.
Las estaciones 1, 2, 6 y 8 no tienen edificios aparte (el acceso va bajo la estación).

Entrada: `data/raw/metro/<instantánea>/*.geojson`, `patio_taller_osm.json` y `planos/*.pdf` (descargas
fuera del repositorio). Salida: `data/curated/metro_l1.json`.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point, shape
from shapely.ops import linemerge, transform

ROOT = Path(__file__).resolve().parents[1]
NOMBRES = {1: "Gibraltar", 2: "Portal Américas", 3: "Ciudad Kennedy", 4: "Timiza", 5: "Hospital de Kennedy",
           6: "Avenida Boyacá", 7: None, 8: "Puente Aranda", 9: "SENA", 10: "Santa Isabel", 11: "Hospital",
           12: "Avenida Jiménez", 13: "Central", 14: "Calle 45", 15: "Calle 63", 16: "Calle 72"}


def station_access(planos: Path, stations) -> dict:
    """Edificios de acceso y puentes de cada estación, desde la página 1 de su plano (ver arriba)."""
    if not planos.exists():
        return {}
    import math
    import fitz
    from shapely.geometry import Polygon

    def poly(d):
        pts = []
        for it in d["items"]:
            if it[0] == "l": pts += [it[1], it[2]]
            elif it[0] == "c": pts += [it[1], it[4]]
            elif it[0] == "re": r = it[1]; pts += [r.tl, r.tr, r.br, r.bl]
            elif it[0] == "qu": q = it[1]; pts += [q.ul, q.ur, q.lr, q.ll]
        return [(p.x, -p.y) for p in pts]

    def rect(pts):
        g = Polygon(pts).minimum_rotated_rectangle
        c = list(g.exterior.coords)[:4]
        e1, e2 = (c[1][0] - c[0][0], c[1][1] - c[0][1]), (c[2][0] - c[1][0], c[2][1] - c[1][1])
        if math.hypot(*e1) < math.hypot(*e2): e1, e2 = e2, e1
        return g.centroid.coords[0], math.atan2(e1[1], e1[0]), math.hypot(*e1), math.hypot(*e2)

    out = {}
    for st in stations:
        f = planos / f"Estacion-{st['number']}-nuevo-mapa.pdf"
        if not f.exists():
            continue
        page = fitz.open(f)[0]
        blue, orange = [], []
        for d in page.get_drawings():
            c = d.get("fill")
            if not c: continue
            P = poly(d)
            if not P or max(y for _, y in P) > -150: continue  # la leyenda va arriba
            if c[0] > .9 and .55 < c[1] < .7 and c[2] < .4: orange.append(P)
            elif c[0] < .15 and .55 < c[1] < .72 and c[2] > .75: blue.append(P)
        if not blue:
            continue
        pc, pa, pl, _ = rect(blue[0])
        wc, wa, wl, _ = rect([tuple(q) for q in st["outline"]])
        rot = (wa - pa + math.pi / 2) % math.pi - math.pi / 2
        k = wl / pl
        cs, sn = math.cos(rot), math.sin(rot)
        to_world = lambda p: [round(wc[0] + k * (cs * (p[0] - pc[0]) - sn * (p[1] - pc[1])), 1),
                              round(wc[1] + k * (sn * (p[0] - pc[0]) + cs * (p[1] - pc[1])), 1)]
        items = []
        for P in orange:
            W = [to_world(p) for p in P]
            g = Polygon(W)
            if not g.is_valid or g.area < 20: continue
            _, _, L, Wd = rect(W)
            bridge = Wd < 9
            items.append({"kind": "puente" if bridge else "edificio", "outline": W + [W[0]] if W[0] != W[-1] else W,
                          "z0": 6.5 if bridge else 0, "z1": 8.5 if bridge else 14, "height": "estimada"})
        out[st["number"]] = items
    return out


def main() -> None:
    raw = ROOT / "data/raw/metro"
    snapshot = json.loads((raw / "latest.json").read_text())["snapshot"]
    folder = raw / snapshot
    manifest = json.loads((folder / "manifest.json").read_text())
    projection = json.loads((ROOT / "app/dist/services.json").read_text())["projection"]
    to_xy = Transformer.from_crs("EPSG:4326", projection, always_xy=True).transform
    read = lambda n: json.loads((folder / f"{n}.geojson").read_text())["features"]
    line = transform(to_xy, linemerge([shape(f["geometry"]) for f in read("trazado_l1")]))
    if line.geom_type != "LineString":
        line = max(line.geoms, key=lambda g: g.length)
    stations = []
    for f in read("estaciones_l1"):
        p = f["properties"]
        n = int(p["NUMERO"])
        poly = transform(to_xy, shape(f["geometry"]))
        c = poly.centroid
        stations.append({"number": n, "name": NOMBRES.get(n) or f"Estación {n} (Av. 68, sin nombre)",
                         "reference": p.get("REFNAME"), "xy": [round(c.x, 1), round(c.y, 1)],
                         "at_m": round(line.project(Point(c.x, c.y)), 1),
                         "outline": [[round(x, 1), round(y, 1)] for x, y in poly.exterior.coords]})
    stations.sort(key=lambda s: s["number"])
    # El trazado se orienta de la estación 1 a la 16.
    if stations[0]["at_m"] > stations[-1]["at_m"]:
        line = LineString(list(line.coords)[::-1])
        for s in stations:
            s["at_m"] = round(line.project(Point(*s["xy"])), 1)
    viaduct = [transform(to_xy, shape(f["geometry"])) for f in read("viaducto_l1")]
    access = station_access(folder / "planos", stations)
    for st in stations:
        st["access"] = access.get(st["number"], [])
    depot = None
    if (folder / "patio_taller_osm.json").exists():
        osm = json.loads((folder / "patio_taller_osm.json").read_text())
        pts = lambda e: [[round(v, 1) for v in to_xy(g["lon"], g["lat"])] for g in e["geometry"]]
        area = next(e for e in osm["elements"] if e["tags"].get("name") == "Patio Taller El Corzo")
        depot = {"name": "Patio Taller El Corzo", "osm_way_id": area["id"],
                 "source": "OpenStreetMap, ODbL 1.0", "retrieved_at": osm.get("osm3s", {}).get("timestamp_osm_base"),
                 "outline": pts(area),
                 "tracks": [{"osm_way_id": e["id"], "points": pts(e)} for e in osm["elements"]
                            if e["tags"].get("railway") == "subway" and e["tags"].get("service") in ("yard", "crossover")],
                 "buildings": [{"osm_way_id": e["id"], "name": e["tags"].get("name"), "roof": e["tags"]["building"] == "roof",
                                "height_m": 14 if e["tags"]["building"] == "roof" else 8, "height": "estimada",
                                "outline": pts(e)} for e in osm["elements"] if e["tags"].get("building")]}
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"dataset": manifest["source"], "license": manifest["license"], "retrieved_at": manifest["retrieved_at"],
                   "files_sha256": manifest["files"]},
        "status": "proyecto en construcción; operación comercial prevista para marzo de 2028",
        "length_m": round(line.length, 1),
        "alignment": [[round(x, 1), round(y, 1)] for x, y in line.coords],
        "viaduct_area_m2": round(sum(v.area for v in viaduct)),
        "stations": stations,
        "depot": depot,
        "operation": {
            "published": {"trains": 30, "cars_per_train": 6, "train_length_m": 135, "capacity_per_train": 1800,
                          "commercial_speed_kmh": 42.5, "max_speed_kmh": 80, "initial_headway_s": 140,
                          "automation": "GoA4, sin conductor (CBTC)", "viaduct_height_m": 13},
            "estimated": {"service_hours": ["04:30", "23:00"], "offpeak_headway_s": 240, "dwell_s": 30,
                          "note": "horario, intervalo fuera de la punta y parada estimados: no están publicados"},
        },
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    (ROOT / "data/curated/metro_l1.json").write_text(text)
    print(f"trazado {line.length/1000:.2f} km · {len(stations)} estaciones · viaducto {result['viaduct_area_m2']} m²",
          hashlib.sha256(text.encode()).hexdigest()[:12])
    print("  accesos:", sum(len(s["access"]) for s in stations), "polígonos en", sum(1 for s in stations if s["access"]), "estaciones")
    if depot:
        print(f"  patio: {len(depot['tracks'])} vías, {len(depot['buildings'])} edificios")
    for s in stations:
        print(f"  {s['number']:2} {s['name']:28} {s['at_m']/1000:6.2f} km")


if __name__ == "__main__":
    main()
