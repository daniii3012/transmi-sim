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
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[1]


def nice(name: str) -> str:
    """«PATIO TEMPORAL LAGUNA I» → «Temporal Laguna I»; «PATIO AMERICAS II» → «Américas II»."""
    words = name.replace("PATIO ", "", 1).split()
    fixed = {"AMERICAS": "Américas", "DE": "de", "LA": "la", "DEL": "del", "I": "I", "II": "II"}
    out = [fixed.get(w, w.capitalize()) for w in words]
    if out:
        out[0] = out[0][0].upper() + out[0][1:]
    return " ".join(out)


def main() -> None:
    raw_root = ROOT / "data/raw/depots"
    snapshot = json.loads((raw_root / "latest.json").read_text())["snapshot"]
    folder = raw_root / snapshot
    manifest = json.loads((folder / "manifest.json").read_text())
    raw = json.loads((folder / "patios.json").read_text())
    projection = json.loads((ROOT / "app/dist/services.json").read_text())["projection"]
    to_xy = Transformer.from_crs("EPSG:4326", projection, always_xy=True)

    depots = []
    for f in raw["features"]:
        a = f["attributes"]
        if a.get("COMPONENTE") != "TRONCAL":
            continue
        rings = [[[round(v, 1) for v in to_xy.transform(x, y)] for x, y in ring] for ring in (f.get("geometry") or {}).get("rings", [])]
        if not rings:
            continue
        shell = max(rings, key=lambda r: Polygon(r).area)
        depots.append({
            "id": a["ID_PATIO"], "name": nice(a["NOMBRE"]), "operator": a.get("OPERADOR"),
            "address": a.get("DIRECCION"), "status": a.get("ESTADOIMP"), "area_m2": round(Polygon(shell).area),
            "points": shell,
        })
    depots.sort(key=lambda d: d["id"])
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"dataset": manifest["source"], "url": manifest["dataset"], "snapshot": snapshot, "sha256": manifest["sha256"],
                   "license": "Datos Abiertos Bogotá, IDECA; atribución a la entidad productora"},
        "method": "patios con COMPONENTE = TRONCAL; anillo exterior más grande de cada uno",
        "coverage": {"depots": len(depots), "hectares": round(sum(d["area_m2"] for d in depots) / 1e4, 1)},
        "depots": depots,
    }
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    for target in (ROOT / "data/curated/depots.json", ROOT / "app/dist/depots.json"):
        target.write_text(text)
    print(json.dumps(result["coverage"]), [d["name"] for d in depots], hashlib.sha256(text.encode()).hexdigest()[:12])


if __name__ == "__main__":
    main()
