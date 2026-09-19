"""Shared rules for deciding which OSM ways a TransMilenio signal may govern.

The downloader and the curator have to agree exactly: the downloader archives the
node/way evidence for the pairs it selects, and the curator refuses any pair without
archived evidence. Keeping the rules in one module stops the two from drifting apart.

Two separate paths, never conflated in the output:

* busway — the signal node belongs to a `highway=busway`, or to a `highway=service`
  that names TransMilenio or is explicitly bus-only. This is the exclusive carriageway.
* street — the signal node belongs to an ordinary road that a dual service actually
  runs along in one of its street sections (Carrera Séptima, Avenida 68 and similar).
  There the bus shares general traffic, so the traffic light governs it too.

The street path is deliberately restricted to street sections. On a trunk corridor the
mixed-traffic lanes run parallel within a few metres, and accepting them there would
attach signals that do not control the busway at all.
"""
from __future__ import annotations

import math
import re

TRANSMI_RE = re.compile(r"transmilenio|transmi", re.IGNORECASE)
TEXT_KEYS = ("name", "description", "operator", "ref", "route_ref", "destination", "access:description", "note")
LANE_KEYS = ("access:lanes", "vehicle:lanes", "motor_vehicle:lanes")

# Roads a bus can physically run along. Footways, cycleways and steps are excluded, and
# so is highway=construction: an unfinished road is not a corroborated bus route.
STREET_HIGHWAYS = {
    "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "busway",
}
ACCESS_DENIED = {"no", "private", "customers", "delivery"}


def explicit_service(tags: dict) -> tuple[bool, str | None]:
    """A highway=service way that is explicitly TransMilenio or bus-only."""
    text = " ".join(tags.get(k, "") for k in TEXT_KEYS)
    if TRANSMI_RE.search(text):
        return True, "service way names TransMilenio"
    if tags.get("vehicle") == "bus" or tags.get("motor_vehicle") == "bus":
        return True, "vehicle=bus or motor_vehicle=bus"
    if tags.get("bus") == "yes" and tags.get("access") in {"no", "private"}:
        return True, "bus=yes with restricted access"
    if any("bus" in tags.get(k, "").lower() for k in LANE_KEYS):
        return True, "lane access explicitly names bus"
    return False, None


def busway_reason(tags: dict) -> str | None:
    """Qualification string for the exclusive-carriageway path, or None."""
    if tags.get("highway") == "busway":
        return "highway=busway"
    if tags.get("highway") != "service":
        return None
    ok, reason = explicit_service(tags)
    return reason if ok else None


def street_reason(tags: dict) -> str | None:
    """Qualification string for the shared-street path, or None.

    Requires an ordinary road that does not forbid buses. `bus=yes` overrides a general
    `access=no`, which is how a bus-only section of a normal street is tagged.
    """
    highway = tags.get("highway")
    if highway not in STREET_HIGHWAYS:
        return None
    if tags.get("bus") in ACCESS_DENIED or tags.get("psv") in ACCESS_DENIED:
        return None
    if tags.get("access") in ACCESS_DENIED and tags.get("bus") not in {"yes", "designated", "permit"}:
        return None
    return f"highway={highway} shared with general traffic on a street section"


def street_segments(services: dict) -> list[list[list[float]]]:
    """Polylines of the street-running sections of every usable service.

    A section counts as street when either of the stops bounding it is a street stop,
    which is how the catalogue marks the parts of a dual service that leave the busway.
    """
    segments = []
    for route in services.get("routes", []):
        points = route.get("points") or []
        stops = route.get("stops") or []
        if len(points) < 2 or len(stops) < 2:
            continue
        cumulative, total = [0.0], 0.0
        for i in range(1, len(points)):
            total += math.dist(points[i - 1], points[i])
            cumulative.append(total)
        for i in range(len(stops) - 1):
            if stops[i].get("kind") != "street" and stops[i + 1].get("kind") != "street":
                continue
            low, high = stops[i]["at_m"], stops[i + 1]["at_m"]
            span = [p for p, c in zip(points, cumulative) if low <= c <= high]
            if len(span) >= 2:
                segments.append(span)
    return segments
