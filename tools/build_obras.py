#!/usr/bin/env python3
"""Obras de TransMilenio que todavía no operan: la troncal de la Avenida 68, el corredor de la Carrera
Séptima (calles 99 a 200) y la extensión de la NQS a Soacha (fases II y III, hasta El Vínculo).

La geometría es la que OpenStreetMap trae como calzada de TransMilenio en construcción
(`highway=construction`, `construction=service`, `name=TransMilenio`) y, en Soacha, también la calzada ya
construida que ningún servicio usa todavía y el contorno del Portal El Vínculo. El simulador no les
asigna rutas: se dibujan como obra, apagadas por defecto (Capas → Obras). Estado, avance y estaciones
planeadas vienen de la prensa que cita al IDU, la Alcaldía y la Gobernación; las estaciones no tienen
coordenadas publicadas y no se ubican.

Entrada: `data/raw/obras/<instantánea>/busways.json` y `obras_sur_norte.json` (descargas de Overpass
fuera del repositorio). Salida: `data/curated/obras.json` y su copia en `app/dist`.
"""
from __future__ import annotations

import json
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point

ROOT = Path(__file__).resolve().parents[1]

AV68 = {
    "id": "av68", "name": "Troncal Avenida 68", "status": "en obra", "progress_pct": 87,
    "opening": "primeros buses previstos para diciembre de 2026; corredor completo en 2027",
    "source": "Infobae, 7 sep. 2026 (IDU) y 24 mar. 2026 (estaciones)",
    "groups": [["Autopista Sur – Calle 18 Sur", 75.16], ["Calle 18 Sur – Av. Américas", 91.12], ["Av. Américas – Calle 13", 94.25],
               ["Calle 13 – Calle 24", 99.58], ["Calle 24 – Calle 46", 96.66], ["Calle 46 – Calle 66", 77.68],
               ["Calle 66 – Carrera 65", 90.6], ["Carrera 65 – Carrera 48", 76.48], ["Carrera 48 – Carrera 9", 84.88]],
    "stations_planned": ["Calle 42 Sur", "Calle 40 Sur", "Avenida Primero de Mayo", "Calle 18 Sur", "Calle 8 Sur", "Américas",
                         "Calle 11 (Colegio Nicolás Esguerra)", "Calle 13", "Calle 19", "Avenida La Esperanza", "Calle 53",
                         "Parque Simón Bolívar", "Calle 66", "Calle 72", "Calle 80", "Calle 98 (Floresta)", "Avenida Suba",
                         "Carrera 53", "Avenida 19", "Carrera 11", "Carrera Séptima (Chapinero)"],
    # Poligonal aproximada de la Autopista Sur a la Carrera 7 por la 68: lo que cae a menos de 900 m.
    "corridor": [(1950, -4000), (1000, -1500), (2400, 1200), (5300, 4600), (6200, 6300), (8700, 6000), (11150, 5900)], "reach": 900,
}
SEPTIMA = {
    "id": "septima", "name": "Corredor Carrera Séptima (calles 99 a 200)", "status": "en obra", "progress_pct": None,
    "opening": "obras desde el 30 de marzo de 2026, por tres tramos (calles 99–127, 127–183 y 183–200); sin fecha de operación publicada",
    "source": "Alcaldía de Bogotá (bogota.gov.co) e Infobae, ene.–mar. 2026",
    "notes": "11,56 km con dos carriles de TransMilenio 100 % eléctrico, 14 estaciones y ciclorruta",
    "groups": [], "stations_planned": [],
    "corridor": [(11206, 5942), (11649, 8818), (12092, 13241), (12425, 15453)], "reach": 450,
}
SOACHA = {
    "id": "soacha", "name": "TransMilenio a Soacha, fases II y III (San Mateo – El Vínculo)", "status": "en obra", "progress_pct": 80,
    "opening": "Portal El Vínculo terminado y en pruebas de operación; fases II y III al 80 % (14 ago. 2026)",
    "source": "Semana, 1 sep. 2026; Alcaldía de Bogotá; Gobernación de Cundinamarca",
    "notes": "4,4 km. Patio portal El Vínculo (Colsubsidio–Maiporé) para 296 buses",
    "groups": [], "stations_planned": ["Estadio Luis Carlos Galán", "Universidades", "Soacha Centro", "El Altico", "Compartir", "Portal El Vínculo"],
    "corridor": [(-7637, -4871), (-8212, -5559), (-9876, -6111), (-10209, -7217), (-10653, -8323)], "reach": 500,
}


def main() -> None:
    raw = ROOT / "data/raw/obras"
    snap = sorted(p for p in raw.iterdir() if p.is_dir())[-1]
    elements = []
    for name in ("busways.json", "obras_sur_norte.json"):
        f = snap / name
        if f.exists():
            elements += json.loads(f.read_text())["elements"]
    proj = json.loads((ROOT / "app/dist/services.json").read_text())["projection"]
    to_xy = Transformer.from_crs("EPSG:4326", proj, always_xy=True).transform
    used = {w["osm_way_id"] for w in json.loads((ROOT / "app/dist/busway_lanes.json").read_text())["ways"]}
    seen, ways, areas = set(), [], []
    for e in elements:
        if e["type"] != "way" or e["id"] in seen or not e.get("geometry"):
            continue
        seen.add(e["id"])
        t = e.get("tags", {})
        pts = [[round(x, 1), round(y, 1)] for x, y in (to_xy(g["lon"], g["lat"]) for g in e["geometry"])]
        if t.get("public_transport") == "station" and "Vínculo" in (t.get("name") or ""):
            areas.append({"osm_way_id": e["id"], "name": t.get("name"), "points": pts})
        elif t.get("name") == "TransMilenio" and (t.get("highway") == "construction" or (t.get("highway") == "service" and e["id"] not in used)):
            ways.append({"osm_way_id": e["id"], "built": t.get("highway") == "service", "points": pts})
    works = []
    # La Séptima primero: empieza donde termina la 68 (Calle 100) y la poligonal de la 68 la alcanzaría.
    for spec in (SEPTIMA, SOACHA, AV68):
        line = LineString(spec["corridor"])
        mine = [w for w in ways if LineString(w["points"]).distance(line) < spec["reach"] and (not w["built"] or spec["id"] == "soacha")]
        for w in mine:
            ways.remove(w)
        km = sum(LineString(w["points"]).length for w in mine) / 1000
        work = {k: v for k, v in spec.items() if k not in ("corridor", "reach")}
        work.update(length_km=round(km, 1), ways=[{"osm_way_id": w["osm_way_id"], "built": w["built"], "points": w["points"]} for w in mine],
                    areas=[a for a in areas if spec["id"] == "soacha" and Point(a["points"][0]).distance(line) < spec["reach"]])
        work["groups"] = [{"tramo": g, "avance_pct": p} for g, p in spec["groups"]]
        works.append(work)
        print(f"{spec['id']}: {len(mine)} vías, {km:.1f} km")
    out = {"schema_version": 1, "source": {"geometry": "OpenStreetMap, ODbL 1.0", "snapshot": snap.name},
           "note": "obras que no operan: el simulador no les asigna rutas", "works": works}
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/obras.json", ROOT / "app/dist/obras.json"):
        target.write_text(text)


if __name__ == "__main__":
    main()
