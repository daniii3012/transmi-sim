#!/usr/bin/env python3
"""Troncal de la Avenida 68 en obra: el corredor que OpenStreetMap trae como calzada de TransMilenio en
construcción (`highway=construction`, `construction=service`, `name=TransMilenio`) a lo largo de la 68,
de la Autopista Sur (Venecia) a la Carrera 7. No opera: el simulador no le asigna rutas; las que hoy
van por la 68 (68, P85, M85) siguen en carril mixto. Estado y estaciones planeadas, de la prensa que
cita al IDU y a la Alcaldía; las estaciones no tienen coordenadas publicadas y no se ubican.

Entrada: `data/raw/av68/<instantánea>/busways.json` (descarga de Overpass fuera del repositorio).
Salida: `data/curated/av68_obra.json` y su copia en `app/dist`.
"""
from __future__ import annotations

import json
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point

ROOT = Path(__file__).resolve().parents[1]
STATIONS = ["Calle 42 Sur", "Calle 40 Sur", "Avenida Primero de Mayo", "Calle 18 Sur", "Calle 8 Sur", "Américas",
            "Calle 11 (Colegio Nicolás Esguerra)", "Calle 13", "Calle 19", "Avenida La Esperanza", "Calle 53",
            "Parque Simón Bolívar", "Calle 66", "Calle 72", "Calle 80", "Calle 98 (Floresta)", "Avenida Suba",
            "Carrera 53", "Avenida 19", "Carrera 11", "Carrera Séptima (Chapinero)"]
GROUPS = [["Autopista Sur – Calle 18 Sur", 75.16], ["Calle 18 Sur – Av. Américas", 91.12], ["Av. Américas – Calle 13", 94.25],
          ["Calle 13 – Calle 24", 99.58], ["Calle 24 – Calle 46", 96.66], ["Calle 46 – Calle 66", 77.68],
          ["Calle 66 – Carrera 65", 90.6], ["Carrera 65 – Carrera 48", 76.48], ["Carrera 48 – Carrera 9", 84.88]]


def main() -> None:
    raw = ROOT / "data/raw/av68"
    snap = sorted(p for p in raw.iterdir() if p.is_dir())[-1]
    data = json.loads((snap / "busways.json").read_text())
    proj = json.loads((ROOT / "app/dist/services.json").read_text())["projection"]
    to_xy = Transformer.from_crs("EPSG:4326", proj, always_xy=True).transform
    ways = []
    for e in data["elements"]:
        t = e.get("tags", {})
        if e["type"] != "way" or t.get("highway") != "construction" or t.get("name") != "TransMilenio":
            continue
        pts = [to_xy(g["lon"], g["lat"]) for g in e["geometry"]]
        ways.append({"osm_way_id": e["id"], "points": [[round(x, 1), round(y, 1)] for x, y in pts]})
    # Solo el corredor de la 68 (una poligonal aproximada de la Autopista Sur a la Carrera 7, a 900 m):
    # deja fuera otras obras de calzada de TransMilenio en la ciudad.
    corridor = LineString([(1950, -4000), (1000, -1500), (2400, 1200), (5300, 4600), (6200, 6300), (8700, 6000)])
    keep = [w for w in ways if LineString(w["points"]).distance(corridor) < 900 or Point(w["points"][0]).distance(corridor) < 900]
    km = sum(LineString(w["points"]).length for w in keep) / 1000
    out = {"schema_version": 1, "name": "Troncal Avenida 68", "status": "en obra",
           "source": {"geometry": "OpenStreetMap, ODbL 1.0", "osm_base": data.get("osm3s", {}).get("timestamp_osm_base"),
                      "status": "Infobae (7 sep. 2026), con datos del IDU: avance por grupo; primeros buses previstos para dic. 2026, entrega total en 2027",
                      "stations": "Infobae (24 mar. 2026): 21 estaciones planeadas, sin coordenadas publicadas"},
           "opening": "primeros buses previstos para diciembre de 2026; corredor completo en 2027",
           "progress_pct": 87, "groups": [{"tramo": g, "avance_pct": p} for g, p in GROUPS],
           "stations_planned": STATIONS, "length_km": round(km, 1), "ways": keep}
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/av68_obra.json", ROOT / "app/dist/av68_obra.json"):
        target.write_text(text)
    print(f"{len(keep)} vías, {km:.1f} km")


if __name__ == "__main__":
    main()
