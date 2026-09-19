#!/usr/bin/env python3
"""Normalize the small OSM station-layout snapshot into local metre coordinates."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import re
import shutil
from datetime import datetime, timezone

from shapely.geometry import LineString, Point, Polygon

from geo import PROJECT


NAME_NORMALIZE = re.compile(r"[^a-z0-9]+", re.I)
TRANSIT_RE = re.compile(r"transmilenio|transmielnio", re.I)
PLATFORM_RE = re.compile(r"plataf(?:orma|oma)|platform", re.I)
FEEDER_RE = re.compile(r"alimentador|alimentadores", re.I)


def norm(value: str | None) -> str:
    return NAME_NORMALIZE.sub(" ", (value or "").lower()).strip()


def is_transmilenio(tags: dict) -> bool:
    return bool(TRANSIT_RE.search(" ".join(str(tags.get(k, "")) for k in ("network", "operator", "name"))))


def project_point(lon: float, lat: float) -> list[float]:
    x, y = PROJECT.transform(lon, lat)
    return [round(float(x), 3), round(float(y), 3)]


def project_geometry(element: dict) -> list[list[float]]:
    if element["type"] == "node":
        return [project_point(float(element["lon"]), float(element["lat"]))]
    return [project_point(float(p["lon"]), float(p["lat"])) for p in element.get("geometry", [])]


def distance(a: list[float], b: list[float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def centroid(points: list[list[float]], closed: bool) -> list[float]:
    if closed and len(points) >= 4:
        shape = Polygon(points)
        c = shape.centroid
        if not shape.is_empty:
            return [round(c.x, 3), round(c.y, 3)]
    return [round(sum(p[0] for p in points) / len(points), 3), round(sum(p[1] for p in points) / len(points), 3)]


def derived_axis(points: list[list[float]], closed: bool) -> tuple[list[float] | None, float, float]:
    if len(points) < 2:
        return None, 0.0, 0.0
    shape = Polygon(points) if closed and len(points) >= 4 else LineString(points)
    if shape.is_empty:
        return None, 0.0, 0.0
    coords = list(shape.exterior.coords)[:-1] if closed and hasattr(shape, "exterior") else points
    mx = sum(p[0] for p in coords) / len(coords)
    my = sum(p[1] for p in coords) / len(coords)
    xx = sum((p[0] - mx) ** 2 for p in coords)
    yy = sum((p[1] - my) ** 2 for p in coords)
    xy = sum((p[0] - mx) * (p[1] - my) for p in coords)
    angle = 0.5 * math.atan2(2 * xy, xx - yy) if (xx or yy) else 0.0
    ux, uy = math.cos(angle), math.sin(angle)
    projections = [(p[0] - mx) * ux + (p[1] - my) * uy for p in coords]
    lo, hi = min(projections), max(projections)
    start = [round(mx + lo * ux, 3), round(my + lo * uy, 3)]
    end = [round(mx + hi * ux, 3), round(my + hi * uy, 3)]
    length = round(max(0.0, hi - lo), 2)
    width = 0.0
    if closed and shape.area > 0 and length > 0:
        width = round(float(shape.area) / length, 2)
    return [start, end], length, width


def source_url(element_type: str, element_id: int) -> str:
    return f"https://www.openstreetmap.org/{element_type}/{element_id}"


def feature(
    element: dict,
    points: list[list[float]],
    *,
    name: str,
    role: str,
    source_relation: int | None = None,
    confidence: str = "high",
) -> dict:
    tags = element.get("tags", {})
    closed = len(points) >= 4 and distance(points[0], points[-1]) <= 0.2
    if closed and points[-1] != points[0]:
        points = points + [points[0]]
    axis, length, width = derived_axis(points, closed)
    result = {
        "id": f"osm-{element['type']}-{element['id']}",
        "points": points,
        "closed": closed,
        "name": name or None,
        "source": source_url(element["type"], element["id"]),
        "role": role,
        "confidence": confidence,
        "osm_type": element["type"],
        "osm_id": element["id"],
        "osm_tags": tags,
        "centroid": centroid(points, closed),
        "axis": axis,
        "length_m": length,
        "width_m": width,
    }
    if source_relation is not None:
        result["source_relation"] = source_url("relation", source_relation)
    return result


def latest_raw(root: pathlib.Path) -> pathlib.Path:
    candidates = sorted(root.glob("*/overpass.json"))
    if not candidates:
        raise FileNotFoundError(f"No OSM snapshot under {root}")
    return candidates[-1]


def station_match(element: dict, center: list[float], station_name: str, max_m: float) -> bool:
    points = project_geometry(element)
    return bool(points) and distance(centroid(points, False), center) <= max_m


def relation_match(relation: dict, elements: dict, center: list[float], max_m: float) -> bool:
    """Relations have no direct geometry in Overpass JSON; use member vectors."""
    for member in relation.get("members", []):
        element = elements.get((member.get("type"), member.get("ref")))
        if not element:
            continue
        points = project_geometry(element)
        if points and distance(centroid(points, False), center) <= max_m:
            return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=pathlib.Path)
    parser.add_argument("--raw-root", type=pathlib.Path, default=pathlib.Path("data/raw/station_layouts"))
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path("data/curated/station_layouts.json"))
    parser.add_argument("--app-output", type=pathlib.Path, default=pathlib.Path("app/dist/station_layouts.json"))
    args = parser.parse_args()
    raw_path = args.raw or latest_raw(args.raw_root)
    raw = json.loads(raw_path.read_text())
    elements = {(e["type"], e["id"]): e for e in raw.get("elements", [])}
    raw_sha256 = hashlib.sha256(raw_path.read_bytes()).hexdigest()
    raw_stations = {s["station_id"]: s for s in raw["stations"]}
    relation_values = [e for e in elements.values() if e["type"] == "relation"]

    output_stations: list[dict] = []
    for station_id, station in raw_stations.items():
        center = project_point(*station["lon_lat"])
        station_name = station["name"]
        station_norm = norm(station_name)
        station_relations = []
        for relation in relation_values:
            tags = relation.get("tags", {})
            if tags.get("public_transport") != "station" or not is_transmilenio(tags):
                continue
            relation_name = norm(tags.get("name"))
            if not relation_name or not (relation_name in station_norm or station_norm in relation_name or ("portal" in station_norm and "portal" in relation_name)):
                continue
            if relation_match(relation, elements, center, 450):
                station_relations.append(relation)

        platforms: dict[str, dict] = {}
        areas: dict[str, dict] = {}
        # Named platform polygons and station outlines are relation members.  A
        # station outline remains an area; it is never silently converted into a
        # platform polygon.
        for relation in station_relations:
            relation_tags = relation.get("tags", {})
            for member in relation.get("members", []):
                element = elements.get((member.get("type"), member.get("ref")))
                if not element or element["type"] != "way":
                    continue
                points = project_geometry(element)
                if len(points) < 2 or not station_match(element, center, station_name, 450):
                    continue
                tags = element.get("tags", {})
                name = tags.get("name", "")
                is_named_platform = bool(PLATFORM_RE.search(name)) or tags.get("public_transport") == "platform"
                # A platform can be mapped as an inner member of a
                # multipolygon station (Portal Tunal's Plataforma 2 is one
                # such case).  The member role describes ring topology, not
                # the physical use of the way, so retain named platform ways
                # regardless of outer/inner role.
                if is_named_platform:
                    role = "platform_feeder" if FEEDER_RE.search(name) else "platform_trunk"
                    platforms[f"way-{element['id']}"] = feature(
                        element, points, name=name, role=role, source_relation=relation["id"]
                    )
                elif member.get("role") == "outer":
                    role = "station_entry" if re.search(r"ingreso|entrada|salida", name, re.I) else "station_area"
                    areas[f"way-{element['id']}"] = feature(
                        element, points, name=name or relation_tags.get("name", ""), role=role, source_relation=relation["id"]
                    )

        for element in elements.values():
            tags = element.get("tags", {})
            if element["type"] not in ("node", "way") or not station_match(element, center, station_name, 450):
                continue
            pt = tags.get("public_transport")
            if pt not in ("platform", "stop_position"):
                continue
            # Some OSM TransMilenio platform ways (notably Banderas) carry
            # only bus=yes/public_transport=platform and no network tag.  Keep
            # those as medium-confidence vectors, while excluding explicitly
            # tagged SITP and Metro features.
            tagged_transmi = is_transmilenio(tags)
            if not tagged_transmi:
                if pt != "platform" or element["type"] != "way" or tags.get("bus") != "yes":
                    continue
                if re.search(r"sitp|metro", " ".join(str(tags.get(k, "")) for k in ("network", "operator", "railway", "subway")), re.I):
                    continue
            points = project_geometry(element)
            if not points:
                continue
            name = tags.get("name", "") or station_name
            role = "feeder_stop_position" if FEEDER_RE.search(name) else (
                "trunk_stop_position" if pt == "stop_position" else "platform_trunk"
            )
            platforms[f"{element['type']}-{element['id']}"] = feature(
                element, points, name=name, role=role, confidence="high" if tagged_transmi else "medium"
            )

        internal_lines: dict[str, dict] = {}
        for element in elements.values():
            if element["type"] != "way" or not station_match(element, center, station_name, 200):
                continue
            tags = element.get("tags", {})
            highway = tags.get("highway")
            railway = tags.get("railway")
            if railway and (tags.get("operator", "").lower().find("metro") >= 0 or tags.get("subway") == "yes"):
                continue
            if highway not in ("busway", "service"):
                continue
            if tags.get("service") == "parking_aisle":
                continue
            explicit_transmi = is_transmilenio(tags) or tags.get("bus") == "yes" or highway == "busway"
            if not explicit_transmi and highway == "service":
                confidence = "medium"
            else:
                confidence = "high"
            role = "internal_busway" if highway == "busway" else "internal_access"
            points = project_geometry(element)
            if len(points) >= 2:
                internal_lines[f"way-{element['id']}"] = feature(
                    element, points, name=tags.get("name", ""), role=role, confidence=confidence
                )

        # Stable, spatial order makes diffs and downstream rendering reproducible.
        platforms_list = sorted(platforms.values(), key=lambda x: (x["centroid"][0], x["centroid"][1], x["osm_id"]))
        areas_list = sorted(areas.values(), key=lambda x: (x["centroid"][0], x["centroid"][1], x["osm_id"]))
        lines_list = sorted(internal_lines.values(), key=lambda x: x["osm_id"])
        relation_ids = [r["id"] for r in station_relations]
        output_stations.append(
            {
                "station_id": station_id,
                "name": station_name,
                "lon_lat": station["lon_lat"],
                "xy": center,
                "match": {
                    "method": "nearest OSM feature within 450 m plus normalized OSM station relation/name",
                    "confidence": "high" if station_relations or platforms_list else "medium",
                    "relation_ids": relation_ids,
                    "note": "Ricaurte and Avenida Jiménez are logical services whose OSM features can occupy separate nearby physical axes; no service-to-platform assignment is inferred.",
                },
                "platforms": platforms_list,
                "areas": areas_list,
                "internal_lines": lines_list,
                "counts": {"platforms": len(platforms_list), "areas": len(areas_list), "internal_lines": len(lines_list)},
            }
        )

    document = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "dataset": "OpenStreetMap",
            "retrieval": raw.get("source_url"),
            "retrieved_at": raw.get("queried_at"),
            "osm_timestamp": raw.get("osm3s", {}).get("timestamp_osm_base"),
            "raw_snapshot": raw.get("snapshot"),
            "raw_file": str(raw_path),
            "raw_sha256": raw_sha256,
            "license": "OpenStreetMap contributors, ODbL 1.0",
            "attribution": "© OpenStreetMap contributors",
        },
        "projection": {
            "origin_lon_lat": [-74.136, 4.63027],
            "crs": "+proj=aeqd +lat_0=4.63027 +lon_0=-74.136 +datum=WGS84 +units=m +no_defs",
            "coordinate_frame": "x east, y north, metres; same frame as app/dist/services.json",
        },
        "scope": {
            "stations": list(raw_stations),
            "radius_m": raw.get("radius_m", 450),
            "selection": "Portal Norte, Portal 80, Portal Sur, Portal Suba, Portal Américas, Portal El Dorado, Portal Tunal, Portal Usme, Portal 20 de Julio, Banderas, Ricaurte, Avenida Jiménez",
            "limitations": [
                "OSM may encode a platform as a node or open line; those features retain closed=false and are not inflated into invented polygons.",
                "Station/building outlines are in areas and are never emitted as platforms unless OSM names/tags the member as a platform.",
                "No assignment of a service, route, wagon, direction, or platform is inferred from proximity alone.",
                "Metro de Bogotá construction features and unrelated SITP stops are excluded by tags/operator/network.",
            ],
        },
        "stations": output_stations,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")
    args.app_output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.output, args.app_output)
    print(json.dumps({"raw": str(raw_path), "output": str(args.output), "stations": len(output_stations), "platforms": sum(s["counts"]["platforms"] for s in output_stations)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
