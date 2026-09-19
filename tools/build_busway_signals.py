#!/usr/bin/env python3
"""Curate directly corroborated OSM signals for the TransMilenio busway."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import re
from datetime import datetime, timezone

from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from geo import LOCAL_CRS

NODE_URL = "https://api.openstreetmap.org/api/0.6/node/{id}"
WAY_URL = "https://api.openstreetmap.org/api/0.6/way/{id}/full"
from busway_criteria import busway_reason, street_reason, street_segments


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", required=True, help="data/raw/busway_signals/<snapshot>")
    parser.add_argument("--services", default="app/dist/services.json")
    parser.add_argument("--output", default="data/curated/busway_signals.json")
    parser.add_argument("--dist-output", default="app/dist/busway_signals.json")
    # Default is off on purpose: docs/SEMAFOROS_20260911.md is hand-maintained and this
    # generator only emits a short stub, so a plain rebuild must never overwrite it.
    parser.add_argument("--docs", default=None, help="optional path for a generated summary stub")
    parser.add_argument("--max-distance-m", type=float, default=12.0)
    args = parser.parse_args()

    raw_dir = pathlib.Path(args.raw)
    raw = json.loads((raw_dir / "osm_map.json").read_text())
    services = json.loads(pathlib.Path(args.services).read_text())
    nodes = {int(n["id"]): n for n in raw["nodes"]}
    ways = {int(w["id"]): w for w in raw["ways"]}
    coords: dict[int, tuple[float, float]] = {}
    project = Transformer.from_crs("EPSG:4326", LOCAL_CRS, always_xy=True)
    for nid, node in nodes.items():
        coords[nid] = project.transform(node["lon"], node["lat"])

    route_lines = [LineString(route["points"]) for route in services["routes"] if len(route.get("points", [])) >= 2]
    tree = STRtree(route_lines)
    street_lines = [LineString(span) for span in street_segments(services)]
    street_tree = STRtree(street_lines) if street_lines else None
    evidence_records = json.loads((raw_dir / "evidence.json").read_text()).get("records", [])
    evidence_by_pair = {(e.get("node_id"), e.get("way_id")): e for e in evidence_records}
    signal_ids = sorted(nid for nid, node in nodes.items() if node["tags"].get("highway") == "traffic_signals")
    member_map = {int(nid): [int(wid) for wid in wids] for nid, wids in raw.get("signal_member_way_ids", {}).items()}
    signals = []
    rejected = {"outside_route_tolerance": 0, "no_direct_busway_or_explicit_service": 0, "missing_way_geometry": 0, "no_archived_membership_evidence": 0}
    kinds = {"busway": 0, "street": 0}
    for nid in signal_ids:
        if nid not in coords:
            continue
        point = Point(coords[nid])
        nearest_index = tree.nearest(point)
        nearest = route_lines[int(nearest_index)] if nearest_index is not None else None
        distance = float(point.distance(nearest)) if nearest is not None else float("inf")
        street_distance = float("inf")
        if street_tree is not None:
            street_distance = float(point.distance(street_lines[int(street_tree.nearest(point))]))
        on_route = distance <= args.max_distance_m
        on_street = street_distance <= args.max_distance_m
        if not on_route and not on_street:
            rejected["outside_route_tolerance"] += 1
            continue
        qualifying = []
        for wid in member_map.get(nid, []):
            way = ways.get(wid)
            if not way:
                rejected["missing_way_geometry"] += 1
                continue
            tags = way.get("tags", {})
            # Exclusive carriageway first; the shared-street path applies only where a
            # dual service actually leaves the busway, never on a lane beside it.
            reason = busway_reason(tags) if on_route else None
            kind = "busway" if reason else None
            if reason is None and on_street:
                reason = street_reason(tags)
                kind = "street" if reason else None
            if reason is None:
                continue
            archived = evidence_by_pair.get((nid, wid))
            if not archived or not archived.get("node_sha256") or not archived.get("way_sha256"):
                rejected["no_archived_membership_evidence"] += 1
                continue
            sequence = [coords[ref] for ref in way.get("nodes", []) if ref in coords]
            local = sequence
            if len(local) < 2:
                rejected["missing_way_geometry"] += 1
                continue
            # Use the adjacent segment around this node when possible, which
            # captures the way's local direction at the signal.
            try:
                pos = way["nodes"].index(nid)
            except ValueError:
                pos = -1
            if pos > 0 and pos + 1 < len(way["nodes"]):
                a, b = coords.get(way["nodes"][pos - 1]), coords.get(way["nodes"][pos + 1])
            elif pos == 0:
                a, b = coords.get(way["nodes"][0]), coords.get(way["nodes"][1])
            elif pos == len(way["nodes"]) - 1:
                a, b = coords.get(way["nodes"][-2]), coords.get(way["nodes"][-1])
            else:
                continue
            if not a or not b:
                rejected["missing_way_geometry"] += 1
                continue
            directed_angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 360.0
            angle = directed_angle % 180.0
            qualifying.append({
                "way_id": wid,
                "way_url": WAY_URL.format(id=wid),
                "tags": tags,
                "qualification": reason,
                "carriageway": kind,
                "axis_angle_deg": round(angle, 3),
                "directed_angle_deg": round(directed_angle, 3),
                "tangent_direction": "way node order (0°=east, 90°=north)",
                "oneway": tags.get("oneway"),
                "direction_restrictions": {k: tags[k] for k in tags if k in {"oneway", "bus:lanes", "access", "vehicle", "motor_vehicle", "access:lanes", "vehicle:lanes", "motor_vehicle:lanes", "destination", "direction"}},
            })
        if not qualifying:
            rejected["no_direct_busway_or_explicit_service"] += 1
            continue
        kinds["busway" if any(q["carriageway"] == "busway" for q in qualifying) else "street"] += 1
        node_tags = nodes[nid]["tags"]
        x, y = coords[nid]
        # Keep a node-level direction when OSM supplies one; way oneway and
        # lane/access tags remain visible as restrictions for integration.
        direction = {k: node_tags[k] for k in node_tags if k in {"traffic_signals:direction", "traffic_signals:forward", "traffic_signals:backward", "direction"}}
        source_records = []
        for q in qualifying:
            wid = q["way_id"]
            source_records.append({
                "node_url": NODE_URL.format(id=nid),
                "way_url": q["way_url"],
                "node_sha256": evidence_by_pair.get((nid, wid), {}).get("node_sha256"),
                "way_sha256": evidence_by_pair.get((nid, wid), {}).get("way_sha256"),
                "hash_basis": evidence_by_pair.get((nid, wid), {}).get("hash_basis"),
            })
        signals.append({
            "id": f"osm-node-{nid}",
            "osm_node_id": nid,
            "xy": [round(x, 3), round(y, 3)],
            "lon_lat": [nodes[nid]["lon"], nodes[nid]["lat"]],
            "source": "OpenStreetMap highway=traffic_signals node with direct qualifying way membership",
            "carriageway": "busway" if any(q["carriageway"] == "busway" for q in qualifying) else "street",
            "way_source": source_records,
            "axis": "busway/service way local tangent",
            "angle": qualifying[0]["axis_angle_deg"],
            "direction": direction,
            "route_distance_m": round(distance, 3),
            "evidence": {
                "node_tags": node_tags,
                "qualifying_ways": qualifying,
                "direct_membership": True,
            },
            "timings": None,
        })

    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_dataset": "OpenStreetMap API 0.6 XML",
        "source_snapshot": raw.get("snapshot"),
        "origin_lon_lat": services.get("origin_lon_lat"),
        "projection": services.get("projection"),
        "coordinate_frame": services.get("coordinate_frame"),
        "coverage": {"services": str(pathlib.Path(args.services)), "max_route_distance_m": args.max_distance_m, "raw_cell_count": raw.get("route_cells")},
        "criteria": {
            "signal_node": "highway=traffic_signals",
            "direct_way": "highway=busway, or highway=service with explicit TransMilenio/Transmi or bus-only access tags",
            "street_way": "ordinary road open to buses, accepted only within tolerance of a street section of a dual service",
            "proximity_only_rejected": True,
            "timings": "not supplied; no official phase/cycle data inferred",
        },
        "signals": signals,
        "audit": {"signal_nodes_seen": len(signal_ids), "accepted": len(signals), "accepted_by_carriageway": kinds, "rejected": rejected},
        "sources": [
            {"kind": "OSM node", "url_template": NODE_URL},
            {"kind": "OSM way full", "url_template": WAY_URL},
            {"kind": "OSM API map cells", "url_template": raw.get("source_url_template"), "manifest": str(raw_dir / "manifest.json")},
            {"kind": "route coverage", "path": str(pathlib.Path(args.services))},
        ],
    }
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    pathlib.Path(args.dist_output).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    if args.docs:
      doc = pathlib.Path(args.docs)
      doc.parent.mkdir(parents=True, exist_ok=True)
      lines = [
        "# Semáforos con evidencia directa en calzada TransMilenio",
        "",
        f"Consulta OSM capturada en `{raw.get('snapshot')}`; cobertura tomada de `app/dist/services.json` y filtrada a {args.max_distance_m:g} m de sus polilíneas. Se evaluaron {len(signal_ids)} nodos `highway=traffic_signals`; se aceptaron {len(signals)} con pertenencia directa a `highway=busway` o a un `highway=service` con identificación explícita de TransMilenio/acceso bus-only.",
        "",
        "No se activan cruces por proximidad: los nodos rechazados por no tener un way calificable se conservan en la auditoría JSON. OSM no aporta aquí fases, ciclos ni coordinación; `timings` queda en `null` para integración posterior con ciclos estimados visibles.",
        "",
        f"- Resultado: [`data/curated/busway_signals.json`](../data/curated/busway_signals.json), {len(signals)} señales aceptadas.",
        f"- Raw y hashes: [`{raw_dir}/manifest.json`](../{raw_dir}/manifest.json), [`{raw_dir}/osm_map.json`](../{raw_dir}/osm_map.json), [`{raw_dir}/evidence.json`](../{raw_dir}/evidence.json).",
        "- Fuente: OpenStreetMap contributors, ODbL 1.0; URLs de nodo y way y sus SHA-256 están en cada `way_source`.",
      ]
      doc.write_text("\n".join(lines) + "\n")
    print(json.dumps({"accepted": len(signals), "seen": len(signal_ids), "rejected": rejected}, ensure_ascii=False))


if __name__ == "__main__":
    main()
