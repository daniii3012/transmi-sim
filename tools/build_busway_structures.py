#!/usr/bin/env python3
"""Puentes y deprimidos de la calzada de TransMilenio, desde OpenStreetMap.

OSM corta las vías de la calzada exclusiva donde empieza y termina un puente o un deprimido y las
etiqueta con `bridge`, `tunnel` y `layer`. Eso sirve para dos cosas: el motor sabe dónde la calzada
se angosta a un carril —los puentes de la troncal tienen uno por sentido salvo que OSM diga otra
cosa—, y la vista 3D levanta o hunde la calzada y los buses.

Entrada: `data/raw/busway_structures/<instantánea>/overpass.json` (la descarga va fuera del
repositorio, como las demás). Salida: `data/curated/busway_structures.json` y su copia en `app/dist`.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]


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
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"dataset": "OpenStreetMap", "snapshot": snapshot, "sha256": manifest["sha256"], "osm_base": manifest.get("osm_base"),
                   "license": "ODbL 1.0, © OpenStreetMap contributors"},
        "method": "vías de la calzada de TransMilenio con bridge o tunnel (el layer solo no cuenta); un puente sin layer cuenta como 1 y un deprimido como -1",
        "coverage": {"bridges": sum(s["kind"] == "bridge" for s in structures), "tunnels": sum(s["kind"] == "tunnel" for s in structures)},
        "structures": structures,
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/busway_structures.json", ROOT / "app/dist/busway_structures.json"):
        target.write_text(text)
    print(json.dumps(result["coverage"]), hashlib.sha256(text.encode()).hexdigest()[:12])


if __name__ == "__main__":
    main()
