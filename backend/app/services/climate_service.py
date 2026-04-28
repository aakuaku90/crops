"""
Climate predictor ingestion.

Two CSVs from the mapping pipeline (NASA POWER + MODIS aggregated to Ghana
regions):

  - X_monthly_regionadj.csv  → climate_features_monthly (raw units, for charts)
  - X_annual_regionadj.csv   → climate_features_annual  (z-scored, model input)

Both share the same column shape minus `month`. The "regionadj" suffix on the
annual file means region-mean subtracted before scaling, which is why those
values are standardized rather than in physical units.

Files live at backend/data/ in the repo and at /app/data/ inside the container
(mounted via docker-compose).
"""

from __future__ import annotations

import asyncio
import csv
import io
from pathlib import Path
from typing import AsyncIterator

from app.db.database import get_pool

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
MONTHLY_CSV = DATA_DIR / "X_monthly_regionadj.csv"
ANNUAL_CSV = DATA_DIR / "X_annual_regionadj.csv"

# CSV header → DB column. Source headers include literal spaces ("1 km monthly NDVI")
# from the MODIS dataset, so this map is the single source of truth for renames.
COLUMN_MAP: dict[str, str] = {
    "T2M": "t2m",
    "T2M_MAX": "t2m_max",
    "T2M_MIN": "t2m_min",
    "T2M_RANGE": "t2m_range",
    "T2MDEW": "t2m_dew",
    "T2MWET": "t2m_wet",
    "RH2M": "rh2m",
    "QV2M": "qv2m",
    "PS": "ps",
    "ALLSKY_SFC_SW_DWN": "allsky_sw_dwn",
    "CLRSKY_SFC_SW_DWN": "clrsky_sw_dwn",
    "ALLSKY_SFC_PAR_TOT": "allsky_par_tot",
    "WS2M": "ws2m",
    "WS2M_MAX": "ws2m_max",
    "WS2M_MIN": "ws2m_min",
    "WD2M": "wd2m",
    "GWETROOT": "gwetroot",
    "GWETTOP": "gwettop",
    "GWETPROF": "gwetprof",
    "PRECTOTCORR": "prectotcorr",
    "total_precip_mm": "total_precip_mm",
    "avg_precip_mm": "avg_precip_mm",
    "rainy_days": "rainy_days",
    "1 km monthly NDVI": "ndvi",
    "1 km monthly EVI": "evi",
    "1 km monthly VI Quality": "vi_quality",
    "1 km monthly red reflectance": "red_reflectance",
    "1 km monthly NIR reflectance": "nir_reflectance",
    "1 km monthly blue reflectance": "blue_reflectance",
    "1 km monthly MIR reflectance": "mir_reflectance",
}

DB_COLUMNS = list(COLUMN_MAP.values())


def _parse_float(s: str) -> float | None:
    s = s.strip()
    if not s or s.lower() in ("nan", "null", "none"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_csv(path: Path, has_month: bool) -> list[tuple]:
    """Return (region, year, [month,] *features) tuples."""
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {path}")
    with path.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        out: list[tuple] = []
        for row in reader:
            region = (row.get("region") or "").strip()
            if not region:
                continue
            try:
                year = int(row["year"])
            except (KeyError, ValueError):
                continue
            features = tuple(_parse_float(row.get(src, "")) for src in COLUMN_MAP)
            if has_month:
                try:
                    month = int(row["month"])
                except (KeyError, ValueError):
                    continue
                out.append((region, year, month, *features))
            else:
                out.append((region, year, *features))
    return out


async def _upsert_monthly(records: list[tuple]) -> int:
    cols = ["region", "year", "month", *DB_COLUMNS]
    placeholders = ", ".join(f"${i+1}" for i in range(len(cols)))
    update_set = ", ".join(f"{c} = EXCLUDED.{c}" for c in DB_COLUMNS)
    sql = f"""
        INSERT INTO climate_features_monthly ({", ".join(cols)})
        VALUES ({placeholders})
        ON CONFLICT (region, year, month) DO UPDATE SET {update_set}
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.executemany(sql, records)
    return len(records)


async def _upsert_annual(records: list[tuple]) -> int:
    cols = ["region", "year", *DB_COLUMNS]
    placeholders = ", ".join(f"${i+1}" for i in range(len(cols)))
    update_set = ", ".join(f"{c} = EXCLUDED.{c}" for c in DB_COLUMNS)
    sql = f"""
        INSERT INTO climate_features_annual ({", ".join(cols)})
        VALUES ({placeholders})
        ON CONFLICT (region, year) DO UPDATE SET {update_set}
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.executemany(sql, records)
    return len(records)


async def sync_climate_streaming() -> AsyncIterator[dict]:
    """Ingest both monthly and annual CSVs. Yields SSE-style progress events."""
    yield {"stage": "parsing_monthly", "pct": 5}
    try:
        monthly = await asyncio.to_thread(_parse_csv, MONTHLY_CSV, True)
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Monthly parse failed: {e}"}
        return
    yield {"stage": "parsing_annual", "pct": 25, "monthly_rows": len(monthly)}
    try:
        annual = await asyncio.to_thread(_parse_csv, ANNUAL_CSV, False)
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Annual parse failed: {e}"}
        return

    yield {"stage": "upserting_monthly", "pct": 40, "monthly_rows": len(monthly), "annual_rows": len(annual)}
    try:
        m_count = await _upsert_monthly(monthly)
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Monthly upsert failed: {e}"}
        return

    yield {"stage": "upserting_annual", "pct": 75, "monthly_inserted": m_count}
    try:
        a_count = await _upsert_annual(annual)
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Annual upsert failed: {e}"}
        return

    yield {
        "stage": "done",
        "pct": 100,
        "monthly_inserted": m_count,
        "annual_inserted": a_count,
        "message": f"Loaded {m_count} monthly + {a_count} annual climate rows",
    }
