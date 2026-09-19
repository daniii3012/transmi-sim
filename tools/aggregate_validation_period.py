"""Aggregate several official daily validation ZIPs into a per-day-type profile.

A single day cannot tell a Tuesday from a Friday, nor measure a Saturday at all: the
scenario had to estimate weekend demand as a flat reduction. This reads a set of daily
files and reports, per station and hour, the mean of the days of each type actually
observed, plus how many days that mean rests on and how much they varied.

Only station codes/names, hourly totals and provenance enter the repository. No card,
device, vehicle or transaction field is read out of the archive.

Usage: python3 tools/aggregate_validation_period.py /path/validacionTroncal*.zip
"""
import argparse
import csv
import hashlib
import io
import json
import re
import statistics
import zipfile
from collections import defaultdict
from datetime import date as civil_date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def easter(year: int) -> civil_date:
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f, g = (b + 8) // 25, (b - (b + 8) // 25 + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return civil_date(year, month, day)


def holidays(year: int) -> set:
    """Colombian civil holidays, including the Monday-moved ones (Ley 51 de 1983)."""
    def monday(value: civil_date) -> civil_date:
        return value + timedelta(days=(7 - value.weekday()) % 7)
    out = {civil_date(year, m, d) for m, d in [(1, 1), (5, 1), (7, 20), (8, 7), (12, 8), (12, 25)]}
    out |= {monday(civil_date(year, m, d)) for m, d in [(1, 6), (3, 19), (6, 29), (8, 15), (10, 12), (11, 1), (11, 11)]}
    e = easter(year)
    out |= {e - timedelta(days=3), e - timedelta(days=2)}
    out |= {monday(e + timedelta(days=n)) for n in (39, 60, 68)}
    return out


def day_type(value: civil_date) -> str:
    """Same three classes the simulator uses: Sundays and holidays share one profile."""
    if value.weekday() == 6 or value in holidays(value.year):
        return "holiday"
    return "saturday" if value.weekday() == 5 else "weekday"


def read_day(path: Path) -> tuple[civil_date, dict, int, str, dict]:
    match = re.fullmatch(r"validacionTroncal(\d{8})\.zip", path.name)
    if not match:
        raise ValueError(f"Se esperaba validacionTroncalAAAAMMDD.zip, no {path.name}")
    stamp = match[1]
    date = civil_date.fromisoformat(f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:]}")
    # A daily file carries a few transactions stamped on the neighbouring civil dates,
    # from service that runs across midnight. They are counted under the file's service
    # day, as the single-day aggregate already did, and the split is reported.
    allowed = {str(date + timedelta(days=n)) for n in (-1, 0, 1)}
    counts: dict = defaultdict(int)
    seen_dates: dict = defaultdict(int)
    rows = 0
    with zipfile.ZipFile(path) as archive, archive.open(stamp + ".csv") as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
        if not {"Estacion_Parada", "Fecha_Transaccion"} <= set(reader.fieldnames or []):
            raise ValueError(f"{path.name}: faltan columnas de estación o fecha")
        for row in reader:
            station = re.fullmatch(r"\s*\(([^)]+)\)\s*(.*)", row["Estacion_Parada"])
            timestamp = row["Fecha_Transaccion"]
            if not station or timestamp[:10] not in allowed or not timestamp[11:13].isdigit():
                raise ValueError(f"{path.name}: estación o fecha inesperada ({row['Estacion_Parada']!r}, {timestamp!r}); no se escribe nada")
            seen_dates[timestamp[:10]] += 1
            hour = int(timestamp[11:13])
            if not 0 <= hour < 24:
                raise ValueError(f"{path.name}: hora fuera del día civil")
            counts[(station[1], station[2].strip(), hour)] += 1
            rows += 1
    return date, counts, rows, hashlib.sha256(path.read_bytes()).hexdigest(), dict(sorted(seen_dates.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zips", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    per_day, sources, names = {}, [], {}
    for path in sorted(args.zips):
        date, counts, rows, digest, seen = read_day(path)
        if date in per_day:
            raise ValueError(f"{date} aparece dos veces")
        per_day[date] = counts
        for (code, name, _), _ in counts.items():
            names[code] = name
        sources.append({"file": path.name, "date": str(date), "day_type": day_type(date),
                        "rows": rows, "sha256": digest, "transaction_dates": seen,
                        "url": f"https://storage.googleapis.com/validaciones_tmsa/ValidacionTroncal/{path.name}"})
        print(f"  {date} {day_type(date):<8} {rows:>9} filas")

    by_type = defaultdict(list)
    for date in per_day:
        by_type[day_type(date)].append(date)

    profiles = []
    for code, name in sorted(names.items()):
        entry = {"station_code": code, "name": name, "day_types": {}}
        for kind, dates in sorted(by_type.items()):
            hourly_mean, hourly_days = [], []
            for hour in range(24):
                values = [per_day[d].get((code, name, hour), 0) for d in dates]
                hourly_mean.append(round(statistics.fmean(values), 3))
                hourly_days.append(values)
            totals = [sum(per_day[d].get((code, name, h), 0) for h in range(24)) for d in dates]
            entry["day_types"][kind] = {
                "days_observed": len(dates),
                "hourly_mean": hourly_mean,
                "daily_total_mean": round(statistics.fmean(totals), 1),
                # Spread across the observed days of this type: it says how much a single
                # day would have misrepresented this station, and it is not a forecast.
                "daily_total_stdev": round(statistics.stdev(totals), 1) if len(totals) > 1 else None,
                "daily_total_min": min(totals),
                "daily_total_max": max(totals),
            }
        profiles.append(entry)

    document = {
        "schema_version": 1,
        "metric": "validaciones_troncal",
        "period": {"from": str(min(per_day)), "to": str(max(per_day)), "days": len(per_day)},
        "days_by_type": {k: [str(d) for d in sorted(v)] for k, v in sorted(by_type.items())},
        "rows_aggregated": sum(s["rows"] for s in sources),
        "license": "CC BY 4.0, according to the linked Bogotá open-data catalog",
        "catalog_url": "https://datosabiertos.bogota.gov.co/dataset/validaciones-diarias-sitp",
        "sources": sources,
        "profiles": profiles,
        "limitations": [
            "Una validación es un acceso registrado, no un viaje origen-destino completo.",
            "La media es de los días observados de cada tipo; no es una predicción de otros meses.",
            "No se exportan tarjetas, dispositivos, vehículos ni transacciones individuales.",
            "Domingos y festivos comparten tipo de día, como en el calendario del simulador.",
        ],
    }
    output = args.output or ROOT / "data/processed" / f"validations_{min(per_day):%Y%m%d}_{max(per_day):%Y%m%d}.json"
    output.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"\n{document['rows_aggregated']:,} validaciones · {len(profiles)} códigos · "
          f"{ {k: len(v) for k, v in document['days_by_type'].items()} } · {output.name}")


if __name__ == "__main__":
    main()
