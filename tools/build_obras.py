#!/usr/bin/env python3
"""Obras de TransMilenio que todavía no operan: la troncal de la Avenida 68, el corredor de la Carrera
Séptima (calles 99 a 200), la extensión de la NQS a Soacha (fases II y III, hasta El Vínculo) y la
intersección de Puente Aranda de La Nueva Calle 13 (tramo 1).

La geometría es la que OpenStreetMap trae como calzada de TransMilenio en construcción
(`highway=construction`, `construction=service`, `name=TransMilenio`) y, en Soacha, también la calzada ya
construida que ningún servicio usa todavía y el contorno del Portal El Vínculo. El simulador no les
asigna rutas: se dibujan como obra, apagadas por defecto (Capas → Obras). Estado, avance y estaciones
planeadas vienen de la prensa que cita al IDU, la Alcaldía y la Gobernación; las estaciones no tienen
coordenadas publicadas y no se ubican.

En Puente Aranda OSM trae el diseño de los tres niveles: la glorieta mixta a nivel, la glorieta de
TransMilenio en puente (`layer=1`) y los dos puentes rectos de la Av. Américas encima (`layer=2`). Se
guardan con su nivel y sus carriles para que el mapa levante el diseño terminado, solo en la capa de
obras; la glorieta mixta queda fuera. Lo mismo vale para los puentes y deprimidos en obra de la 68 y
de Soacha que OSM marca con `bridge` o `tunnel` y su `layer`.

Entrada: `data/raw/obras/<instantánea>/busways.json`, `obras_sur_norte.json` y `puente_aranda.json`
(descargas de Overpass fuera del repositorio; de cada archivo, la instantánea más reciente que lo trae).
Salida: `data/curated/obras.json` y su copia en `app/dist`.
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
CALLE13 = {
    "id": "calle13", "name": "La Nueva Calle 13, intersección de Puente Aranda", "status": "en obra", "progress_pct": 46,
    "opening": "niveles 2 (glorieta de TransMilenio) y 3 (puentes de la Av. Américas) previstos para finales de 2027; "
               "glorieta mixta del nivel 1 en 2028",
    "source": "Alcaldía de Bogotá (bogota.gov.co); Infobae, 21 abr. 2026; Radio Santa Fe, 31 ago. 2026 (IDU)",
    "notes": "obras desde el 12 de octubre de 2025 en el cruce de la Calle 13, la Carrera 50, la Av. Américas y la Calle 6. "
             "Tres niveles: glorieta mixta de 200 m de diámetro a nivel, glorieta de TransMilenio de 100 m con dos carriles "
             "en el segundo (52,5 %) y dos puentes rectos de 600 m y tres carriles por la Américas en el tercero (63 %). "
             "La capa muestra el diseño terminado de los niveles 2 y 3, no lo construido. El resto de la troncal de la "
             "Calle 13 (Carrera 55 a Carrera 69F en preconstrucción; tramos 3 a 6 sin adjudicar) no tiene trazado publicado",
    "groups": [], "stations_planned": [],
    "corridor": [(2950, -250), (3250, -330), (3450, -470)], "reach": 320,
}


def latest(raw: Path, name: str) -> Path | None:
    found = sorted(p / name for p in raw.iterdir() if (p / name).exists())
    return found[-1] if found else None


def main() -> None:
    raw = ROOT / "data/raw/obras"
    elements, snaps = [], {}
    for name in ("busways.json", "obras_sur_norte.json", "puente_aranda.json"):
        f = latest(raw, name)
        if f:
            elements += json.loads(f.read_text())["elements"]
            snaps[name] = f.parent.name
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
            ways.append({"osm_way_id": e["id"], "built": t.get("highway") == "service", "points": pts, **levels(t)})
        elif t.get("highway") == "construction" and t.get("bridge") == "yes" and t.get("construction") in ("trunk", "primary") and t.get("layer") == "2":
            # Puentes viales del nivel superior (Américas en Puente Aranda): se dibujan, no suman calzada de TM.
            ways.append({"osm_way_id": e["id"], "built": False, "points": pts, "road": True, **levels(t)})
    works = []
    # La Séptima primero: empieza donde termina la 68 (Calle 100) y la poligonal de la 68 la alcanzaría.
    # Puente Aranda antes que la 68, cuya poligonal pasa a menos de un kilómetro.
    for spec in (SEPTIMA, SOACHA, CALLE13, AV68):
        line = LineString(spec["corridor"])
        mine = [w for w in ways if LineString(w["points"]).distance(line) < spec["reach"] and (not w["built"] or spec["id"] == "soacha")
                and (not w.get("road") or spec["id"] == "calle13")]
        for w in mine:
            ways.remove(w)
        km = sum(LineString(w["points"]).length for w in mine if not w.get("road")) / 1000
        work = {k: v for k, v in spec.items() if k not in ("corridor", "reach")}
        work.update(length_km=round(km, 1), ways=[{k: w[k] for k in ("osm_way_id", "built", "points", "road", "level", "lanes") if k in w} for w in mine],
                    areas=[a for a in areas if spec["id"] == "soacha" and Point(a["points"][0]).distance(line) < spec["reach"]])
        work["groups"] = [{"tramo": g, "avance_pct": p} for g, p in spec["groups"]]
        works.append(work)
        print(f"{spec['id']}: {len(mine)} vías, {km:.1f} km")
    out = {"schema_version": 1, "source": {"geometry": "OpenStreetMap, ODbL 1.0", "snapshot": max(snaps.values()), "files": snaps},
           "note": "obras que no operan: el simulador no les asigna rutas", "works": works}
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/obras.json", ROOT / "app/dist/obras.json"):
        target.write_text(text)


def levels(t: dict) -> dict:
    """Nivel y carriles de una vía en obra, cuando OSM los trae: `layer` de un puente (positivo) o de un
    deprimido (`tunnel=yes`, negativo), como los cruces de la 68 con las Américas o la Calle 13."""
    out = {}
    try:
        layer = int(t.get("layer") or 0)
    except ValueError:
        layer = 0
    if (t.get("bridge") == "yes" and layer > 0) or (t.get("tunnel") == "yes" and layer < 0):
        out["level"] = layer
    if (t.get("lanes") or "").isdigit():
        out["lanes"] = int(t["lanes"])
    return out


if __name__ == "__main__":
    main()
