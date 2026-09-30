#!/usr/bin/env python3
"""Puentes y deprimidos de la calzada de TransMilenio, desde OpenStreetMap.

OSM corta las vías de la calzada exclusiva donde empieza y termina un puente o un deprimido y las
etiqueta con `bridge`, `tunnel` y `layer`. Eso sirve para dos cosas: el motor sabe dónde la calzada
se angosta a un carril —los puentes de la troncal tienen uno por sentido salvo que OSM diga otra
cosa—, y la vista 3D levanta o hunde la calzada y los buses.

Un `bridge` de OSM no siempre es un paso elevado. Sobre un caño o un río, la calzada sigue a nivel:
OSM marca la estructura, pero la vía no sube. Dibujarlo con el nivel 1 del motor —5,5 m con rampas
del 7 %— convertía un paso de 8 m sobre un caño en una joroba de 160 m. Cada puente se clasifica por
lo que cruza, con las calles y el agua del contexto urbano (`app/dist/context.json`):

- cruza una calle a nivel: paso elevado, conserva su `layer`;
- de nivel 1 y cruza solo agua, hasta 60 m: `at_grade`, sin altura;
- de nivel 1, hasta 30 m y sin nada debajo: `at_grade` (un tramo de cruce o de canal sin dibujar);
- tocando por un extremo un paso elevado: parte de él, conserva su `layer`.

Con los deprimidos pasa lo contrario. OSM marca `tunnel` en todo el tramo hundido, pero solo la parte
que pasa bajo una calle necesita el gálibo completo; el resto es trinchera a cielo abierto, más baja
que la calle sin ser un túnel (el conector de la Caracas a la Calle 26 por el lote de la Carrera 14).
Un deprimido que cruza bajo una calle es `underpass`, a 5,5 m por nivel; uno que no, `cutting`, a
TRINCHERA_M. El motor lee la altura de `level`.

Entrada: `data/raw/busway_structures/<instantánea>/overpass.json` (la descarga va fuera del
repositorio, como las demás). Salida: `data/curated/busway_structures.json` y su copia en `app/dist`.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]


AGUA_MAX_M = 60      # un puente de nivel 1 que solo cruza agua y no pasa de esto va a nivel
CORTO_MAX_M = 30     # uno sin nada debajo y no más largo que esto, también
NIVEL_M = 5.5        # altura de un nivel de OSM en el motor
TRINCHERA_M = 3.0    # profundidad de un deprimido a cielo abierto


def _segs(pts, closed=False):
    out = list(zip(pts, pts[1:]))
    if closed and len(pts) > 2:
        out.append((pts[-1], pts[0]))
    return out


def _cross(p1, p2, q1, q2) -> bool:
    def o(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    return o(p1, p2, q1) * o(p1, p2, q2) < 0 and o(q1, q2, p1) * o(q1, q2, p2) < 0


def _inside(p, poly) -> bool:
    x, y = p
    c = False
    for (x1, y1), (x2, y2) in _segs(poly, True):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def _bbox(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _near(a, b, m=5.0) -> bool:
    return not (a[2] + m < b[0] or b[2] + m < a[0] or a[3] + m < b[1] or b[3] + m < a[1])


def classify(structures, context, streets=(), crossings=()):
    """Marca `grade` y `grade_reason` en cada puente, según lo que cruza. Devuelve el recuento."""
    water = [(f, _bbox(f["points"])) for f in context if f["kind"] == "water"]
    roads = [(f, _bbox(f["points"])) for f in context if f["kind"] == "road" and not f.get("bridge") and not f.get("tunnel")]
    bridges = [s for s in structures if s["kind"] == "bridge"]
    for s in bridges:
        pts, bb = s["points"], _bbox(s["points"])
        s["_length"] = sum(math.dist(a, b) for a, b in _segs(pts))
        s["_water"] = any(_near(bb, wb) and (any(_cross(a, b, c, d) for a, b in _segs(pts) for c, d in _segs(f["points"], f["closed"]))
                                            or (f["closed"] and any(_inside(p, f["points"]) for p in pts))) for f, wb in water)
        s["_road"] = any(_near(bb, rb) and any(_cross(a, b, c, d) for a, b in _segs(pts) for c, d in _segs(f["points"])) for f, rb in roads)
    overpass = [s for s in bridges if s["_road"]]
    counts = {"overpass": 0, "at_grade": 0, "kept": 0}
    for s in bridges:
        touches = any(o is not s and min(math.dist(p, q) for p in (s["points"][0], s["points"][-1]) for q in (o["points"][0], o["points"][-1])) < 2
                      for o in overpass)
        if s["_road"]:
            s["grade"], s["grade_reason"] = "overpass", "cruza una calle"
        elif s["layer"] == 1 and not touches and s["_water"] and s["_length"] <= AGUA_MAX_M:
            s["grade"], s["grade_reason"] = "at_grade", "cruza solo agua: la calzada sigue a nivel"
        elif s["layer"] == 1 and not touches and not s["_water"] and s["_length"] <= CORTO_MAX_M:
            s["grade"], s["grade_reason"] = "at_grade", "tramo corto sin calle ni agua debajo"
        else:
            s["grade"], s["grade_reason"] = "overpass", "parte de un paso elevado" if touches else "sin evidencia en contra: se conserva el nivel de OSM"
        counts["at_grade" if s["grade"] == "at_grade" else ("overpass" if s["_road"] else "kept")] += 1
        if s["grade"] == "at_grade":
            s["kind"], s["layer"] = "at_grade", 0
        for k in ("_length", "_water", "_road"):
            del s[k]
    # Encima de un deprimido puede ir una calle del contexto, una de las calles vecinas o una cebra;
    # la propia calzada de TransMilenio en un empalme no cuenta.
    def over(f):
        return f.get("kind", "road") == "road" and not f.get("tunnel") and f.get("name") != "TransMilenio" and f.get("highway") != "busway"
    above = [(f, _bbox(f["points"])) for f in list(context) + list(streets) + list(crossings) if over(f)]
    for s in structures:
        if s["kind"] == "tunnel":
            bb = _bbox(s["points"])
            under = any(_near(bb, rb) and any(_cross(a, b, c, d) for a, b in _segs(s["points"]) for c, d in _segs(f["points"])) for f, rb in above)
            s["grade"], s["grade_reason"] = ("underpass", "pasa bajo una calle") if under else ("cutting", "trinchera a cielo abierto: ninguna calle encima")
            s["level"] = s["layer"] if under else round(s["layer"] * TRINCHERA_M / NIVEL_M, 2)
            counts["underpass" if under else "cutting"] = counts.get("underpass" if under else "cutting", 0) + 1
        else:
            s["level"] = s["layer"]
    return counts


def main() -> None:
    raw_root = ROOT / "data/raw/busway_structures"
    snapshot = json.loads((raw_root / "latest.json").read_text())["snapshot"]
    folder = raw_root / snapshot
    manifest = json.loads((folder / "manifest.json").read_text())
    raw = json.loads((folder / "overpass.json").read_text())
    projection = json.loads((ROOT / "app/dist/services.json").read_text())["projection"]
    to_xy = Transformer.from_crs("EPSG:4326", projection, always_xy=True)

    structures = []
    for e in raw["elements"]:
        tags = e.get("tags", {})
        geometry = e.get("geometry") or []
        if e.get("type") != "way" or len(geometry) < 2:
            continue
        try:
            layer = int(tags.get("layer", "0"))
        except ValueError:
            layer = 0
        if tags.get("bridge") and tags["bridge"] != "no":
            kind, layer = "bridge", max(1, layer)
        elif tags.get("tunnel") and tags["tunnel"] != "no":
            kind, layer = "tunnel", min(-1, layer)
        else:
            # Un `layer` sin `bridge` ni `tunnel` suele estar solo para que dos vías no se crucen en
            # el mapa (la calzada de la Américas en Mandalay lleva -1 por 900 m); no es una estructura.
            continue
        lanes = tags.get("lanes")
        structures.append({
            "osm_way_id": e["id"],
            "kind": kind,
            "layer": layer,
            "lanes": int(lanes) if lanes and lanes.isdigit() else None,
            "oneway": tags.get("oneway") in ("yes", "1", "true"),
            "name": tags.get("name"),
            "points": [[round(x, 2), round(y, 2)] for x, y in (to_xy.transform(p["lon"], p["lat"]) for p in geometry)],
        })
    structures.sort(key=lambda s: s["osm_way_id"])
    context = json.loads((ROOT / "app/dist/context.json").read_text())["features"]
    vecinas = json.loads((ROOT / "app/dist/cross_streets.json").read_text())
    grades = classify(structures, context, vecinas["streets"], vecinas["crossings"])
    result = {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"dataset": "OpenStreetMap", "snapshot": snapshot, "sha256": manifest["sha256"], "osm_base": manifest.get("osm_base"),
                   "license": "ODbL 1.0, © OpenStreetMap contributors"},
        "method": ("vías de la calzada de TransMilenio con bridge o tunnel (el layer solo no cuenta); un puente sin layer cuenta como 1 y un deprimido como -1. level es la altura en niveles de 5,5 m; un deprimido sin calle encima es trinchera de 3 m. "
                   f"Un puente de nivel 1 que solo cruza agua (hasta {AGUA_MAX_M} m) o que no cruza nada (hasta {CORTO_MAX_M} m) va a nivel: kind at_grade, layer 0"),
        "coverage": {"bridges": sum(s["kind"] == "bridge" for s in structures), "tunnels": sum(s["kind"] == "tunnel" for s in structures),
                     "at_grade": grades["at_grade"], "overpass_over_street": grades["overpass"], "overpass_kept": grades["kept"],
                     "underpass": grades.get("underpass", 0), "cutting": grades.get("cutting", 0)},
        "structures": structures,
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/busway_structures.json", ROOT / "app/dist/busway_structures.json"):
        target.write_text(text)
    print(json.dumps(result["coverage"]), hashlib.sha256(text.encode()).hexdigest()[:12])


if __name__ == "__main__":
    main()
