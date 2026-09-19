"""Aggregate an official daily validation ZIP without exporting transaction fields.

Usage: python3 tools/aggregate_validations.py /path/to/validacionTroncalYYYYMMDD.zip
Only station names/codes, hourly totals and provenance enter the repository.
"""
import argparse
import csv
import hashlib
import io
import json
import re
import zipfile
from collections import Counter
from datetime import date as civil_date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def aggregate(path):
    match = re.fullmatch(r"validacionTroncal(\d{8})\.zip", path.name)
    if not match:
        raise ValueError("Expected validacionTroncalYYYYMMDD.zip")
    stamp = match[1]
    date = f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:]}"
    totals, hours, dates = Counter(), Counter(), Counter()
    next_date = str(civil_date.fromisoformat(date) + timedelta(days=1))
    with zipfile.ZipFile(path) as archive, archive.open(stamp + ".csv") as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
        if not {"Estacion_Parada", "Fecha_Transaccion"} <= set(reader.fieldnames or []):
            raise ValueError("Missing station/date columns")
        for row in reader:
            station = re.fullmatch(r"\s*\(([^)]+)\)\s*(.*)", row["Estacion_Parada"])
            timestamp = row["Fecha_Transaccion"]
            if not station or timestamp[:10] not in (date, next_date) or not timestamp[11:13].isdigit():
                raise ValueError("Unexpected station or date format; no output written")
            dates[timestamp[:10]] += 1
            hour = int(timestamp[11:13])
            if not 0 <= hour < 24:
                raise ValueError("Hour outside civil day")
            code, name = station[1], station[2].strip()
            totals[code, name] += 1
            hours[code, name, hour] += 1
    count = sum(totals.values())
    return {
        "source_url": f"https://storage.googleapis.com/validaciones_tmsa/ValidacionTroncal/{path.name}",
        "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "period": date, "transaction_dates": dict(sorted(dates.items())), "metric": "validaciones_troncal", "rows_aggregated": count,
        "license": "CC BY 4.0, according to the linked Bogotá open-data catalog",
        "catalog_url": "https://datosabiertos.bogota.gov.co/dataset/validaciones-diarias-sitp",
        "weights": [{"station_code": code, "name": name, "total": n, "normalized_weight": n / count}
                    for (code, name), n in sorted(totals.items(), key=lambda item: (-item[1], item[0]))],
        "hourly_counts": [{"station_code": code, "name": name, "hour": f"{hour:02}:00", "total": n}
                          for (code, name, hour), n in sorted(hours.items())],
        "limitations": ["Una validación es un acceso registrado, no un viaje origen-destino completo.",
                        "Un único día observado. El componente se depura por código de estación al importar.",
                        "No se exportan tarjetas, dispositivos, vehículos ni transacciones individuales."]
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", type=Path)
    args = parser.parse_args()
    data = aggregate(args.zip)
    output = ROOT / "data/processed" / ("validations_" + data["period"].replace("-", "") + ".json")
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{data['rows_aggregated']} validations, {len(data['weights'])} station codes; {output.name}")
