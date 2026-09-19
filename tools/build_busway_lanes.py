#!/usr/bin/env python3
"""Curate the TransMilenio carriageways into local metre coordinates.

Keeps only ways that run close to a service the simulator actually operates, so a road
named after TransMilenio somewhere else in the city does not end up drawn. Lane counts
are copied from the OSM `lanes` tag and left null when OSM does not publish one; they are
never inferred from the width of the corridor or from the number of services.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib

from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL_CRS = "+proj=aeqd +lat_0=4.63027 +lon_0=-74.136 +datum=WGS84 +units=m +no_defs"
WAY_URL = "https://www.openstreetmap.org/way/{id}"


def latest(root: pathlib.Path) -> pathlib.Path:
    candidates = sorted(root.glob("*/overpass.json"))
    if not candidates:
        raise SystemExit(f"No hay instantáneas en {root}")
    return candidates[-1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=pathlib.Path)
    parser.add_argument("--raw-root", type=pathlib.Path, default=ROOT / "data/raw/busway_lanes")
    parser.add_argument("--services", default="app/dist/services.json")
    parser.add_argument("--output", default="data/curated/busway_lanes.json")
    parser.add_argument("--dist-output", default="app/dist/busway_lanes.json")
    parser.add_argument("--max-distance-m", type=float, default=45.0,
                        help="how far a carriageway may sit from an operated service")
    args = parser.parse_args()

    raw_path = args.raw or latest(args.raw_root)
    raw = json.loads(raw_path.read_text())
    services = json.loads((ROOT / args.services).read_text())
    project = Transformer.from_crs("EPSG:4326", LOCAL_CRS, always_xy=True)

    routes = [LineString(r["points"]) for r in services["routes"] if r.get("ready") and len(r.get("points", [])) >= 2]
    tree = STRtree(routes)

    lanes_seen = {"published": 0, "unknown": 0}
    kept, dropped = [], 0
    for element in raw["elements"]:
        geometry = element.get("geometry") or []
        if len(geometry) < 2:
            continue
        points = [project.transform(p["lon"], p["lat"]) for p in geometry]
        line = LineString(points)
        # Distance from the middle and both ends: a long way that only clips the network
        # at one end is not a carriageway the simulated services use.
        samples = [Point(points[0]), Point(points[len(points) // 2]), Point(points[-1])]
        if max(float(s.distance(routes[int(tree.nearest(s))])) for s in samples) > args.max_distance_m:
            dropped += 1
            continue
        tags = element.get("tags", {})
        raw_lanes = tags.get("lanes")
        lanes = int(raw_lanes) if raw_lanes and raw_lanes.isdigit() else None
        lanes_seen["published" if lanes else "unknown"] += 1
        kept.append({
            "id": f"osm-way-{element['id']}",
            "osm_way_id": element["id"],
            "source": WAY_URL.format(id=element["id"]),
            "points": [[round(x, 2), round(y, 2)] for x, y in points],
            "name": tags.get("name"),
            "highway": tags.get("highway"),
            "lanes": lanes,
            "lanes_source": "OpenStreetMap lanes tag" if lanes else None,
            "oneway": tags.get("oneway"),
            "exclusive": tags.get("highway") == "busway" or tags.get("access") in {"no", "private"},
        })

    kept.sort(key=lambda w: w["osm_way_id"])
    payload = {
        "schema_version": 1,
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "source": {
            "dataset": "OpenStreetMap", "retrieval": raw["source_url"], "snapshot": raw["snapshot"],
            "raw_file": str(raw_path.relative_to(ROOT)),
            "raw_sha256": hashlib.sha256(raw_path.read_bytes()).hexdigest(),
            "license": "OpenStreetMap contributors, ODbL 1.0",
        },
        "projection": {"crs": LOCAL_CRS, "coordinate_frame": "x east, y north, metres; same frame as app/dist/services.json"},
        "coverage": {
            "services": args.services, "max_distance_m": args.max_distance_m,
            "ways_downloaded": len(raw["elements"]), "ways_kept": len(kept), "ways_dropped_far_from_service": dropped,
            "lane_count": lanes_seen,
        },
        "limits": [
            "Geometría de calzada de OpenStreetMap, no un levantamiento de carriles operativos.",
            "El número de carriles es la etiqueta lanes de OSM donde existe; nunca se deduce.",
            "Los buses siguen la polilínea publicada del servicio, que puede separarse unos metros de esta calzada.",
        ],
        "ways": kept,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    (ROOT / args.output).write_text(text)
    (ROOT / args.dist_output).write_text(text)
    print(json.dumps({"raw": str(raw_path.relative_to(ROOT)), "kept": len(kept), "dropped": dropped,
                      "lanes": lanes_seen}, ensure_ascii=False))


if __name__ == "__main__":
    main()
