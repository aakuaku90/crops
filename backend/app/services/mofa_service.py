"""
MoFA SRID national-level crop statistics ingestion.

Three CSVs published by Ghana's Ministry of Food and Agriculture (Statistics,
Research, and Information Directorate). Each file is wide-format with one row
per crop and one column per year (2019..2023).

These extend the time series for national totals beyond what the GSS sub-national
file currently covers (and beyond what WFP retail prices cover post-2023).

Sources:
  - https://srid.mofa.gov.gh/sites/default/files/uploaded_resources/national%20cropped%20area%202019%20to%202023.csv
  - https://srid.mofa.gov.gh/sites/default/files/uploaded_resources/national%20production%202019%20to%202023.csv
  - https://srid.mofa.gov.gh/sites/default/files/uploaded_resources/national%20yield%202029%20to%202023.csv  (note: filename typo "2029")
"""

from __future__ import annotations

import asyncio
import csv
import io
import requests
from typing import AsyncIterator
from app.db.database import get_pool
from app.services.gss_normalize import normalize_crop_name

# (url, element_label, unit) tuples — element matches the convention used in
# gss_crop_production so callers can compare like-for-like.
SOURCES: tuple[tuple[str, str, str], ...] = (
    (
        "https://srid.mofa.gov.gh/sites/default/files/uploaded_resources/"
        "national%20cropped%20area%202019%20to%202023.csv",
        "Area",
        "Ha",
    ),
    (
        "https://srid.mofa.gov.gh/sites/default/files/uploaded_resources/"
        "national%20production%202019%20to%202023.csv",
        "Production",
        "Mt",
    ),
    (
        "https://srid.mofa.gov.gh/sites/default/files/uploaded_resources/"
        "national%20yield%202029%20to%202023.csv",
        "Yield",
        "Mt/Ha",
    ),
)


def _download(url: str) -> bytes:
    resp = requests.get(url, timeout=60, allow_redirects=True)
    resp.raise_for_status()
    return resp.content


def _parse_float(raw: str) -> float | None:
    s = raw.replace(",", "").replace('"', "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_one_csv(content: bytes, element: str, unit: str) -> list[tuple]:
    """Parse a wide-format MoFA CSV into (year, crop, element, unit, value) tuples."""
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if len(rows) < 2:
        return []

    header = [h.strip() for h in rows[0]]
    if not header or header[0].upper() not in ("COMMODITY", "CROP", "ITEM"):
        return []

    # Year columns start at index 1; coerce to ints, skipping any non-numeric.
    year_cols: list[tuple[int, int]] = []  # (col_index, year)
    for i, h in enumerate(header[1:], start=1):
        try:
            year_cols.append((i, int(h)))
        except ValueError:
            continue

    out: list[tuple] = []
    for row in rows[1:]:
        if not row:
            continue
        crop = normalize_crop_name(row[0])
        if not crop:
            continue
        for col_idx, year in year_cols:
            if col_idx >= len(row):
                continue
            value = _parse_float(row[col_idx])
            if value is None:
                continue
            out.append((year, crop, element, unit, value, "MoFA SRID"))
    return out


async def sync_mofa_national_streaming() -> AsyncIterator[dict]:
    """
    Fetch all three SRID CSVs (area, production, yield), normalize crop names,
    and upsert into mofa_national. Yields SSE-style progress events.
    """
    yield {"stage": "downloading", "pct": 5}

    all_records: list[tuple] = []
    for i, (url, element, unit) in enumerate(SOURCES):
        try:
            content = await asyncio.to_thread(_download, url)
        except Exception as e:
            yield {"stage": "error", "pct": 0, "message": f"Download failed for {element}: {e}"}
            return
        try:
            parsed = _parse_one_csv(content, element, unit)
        except Exception as e:
            yield {"stage": "error", "pct": 0, "message": f"Parse failed for {element}: {e}"}
            return
        all_records.extend(parsed)
        yield {"stage": "parsing", "pct": 10 + int((i + 1) / len(SOURCES) * 40), "total": len(all_records)}

    if not all_records:
        yield {"stage": "error", "pct": 0, "message": "No records parsed from MoFA CSVs"}
        return

    yield {"stage": "upserting", "pct": 60, "total": len(all_records)}

    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                # Upsert one row at a time so the UNIQUE(year, crop, element)
                # constraint can dedupe on conflict.
                inserted = 0
                for year, crop, element, unit, value, source in all_records:
                    await conn.execute(
                        """
                        INSERT INTO mofa_national (year, crop, element, unit, value, source)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (year, crop, element)
                        DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit, source = EXCLUDED.source
                        """,
                        year, crop, element, unit, value, source,
                    )
                    inserted += 1

        yield {
            "stage": "done",
            "pct": 100,
            "records_inserted": inserted,
            "message": f"Loaded {inserted} MoFA national records (2019-2023)",
        }
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Database error: {e}"}


# ─── Regional maize ingest ──────────────────────────────────────────────────
# Separate from the SRID national ingest above: this CSV is regional, maize-only,
# 1999-2023, and serves as the Y target for the climate-driven yield model.

from pathlib import Path  # noqa: E402

MAIZE_CSV = Path(__file__).resolve().parent.parent.parent / "data" / "MOFA_maize_regional.csv"


def _parse_mofa_maize_csv(path: Path) -> list[tuple]:
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {path}")
    with path.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        out: list[tuple] = []
        for row in reader:
            try:
                year = int(row["year"])
            except (KeyError, ValueError):
                continue
            region = (row.get("region") or "").strip()
            if not region:
                continue
            out.append((
                year,
                region,
                _parse_float(row.get("total_area_ha", "")),
                _parse_float(row.get("avg_yield_mt_ha", "")),
                _parse_float(row.get("total_production_mt", "")),
                "MoFA",
            ))
    return out


async def sync_mofa_maize_regional_streaming() -> AsyncIterator[dict]:
    """Ingest MOFA_maize_regional.csv into mofa_maize_regional. SSE progress events."""
    yield {"stage": "parsing", "pct": 10}
    try:
        records = await asyncio.to_thread(_parse_mofa_maize_csv, MAIZE_CSV)
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Parse failed: {e}"}
        return

    if not records:
        yield {"stage": "error", "pct": 0, "message": "No rows in MOFA_maize_regional.csv"}
        return

    yield {"stage": "upserting", "pct": 50, "total": len(records)}
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.executemany(
                    """
                    INSERT INTO mofa_maize_regional
                        (year, region, total_area_ha, avg_yield_mt_ha, total_production_mt, source)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (year, region) DO UPDATE SET
                        total_area_ha = EXCLUDED.total_area_ha,
                        avg_yield_mt_ha = EXCLUDED.avg_yield_mt_ha,
                        total_production_mt = EXCLUDED.total_production_mt,
                        source = EXCLUDED.source
                    """,
                    records,
                )
        yield {
            "stage": "done",
            "pct": 100,
            "records_inserted": len(records),
            "message": f"Loaded {len(records)} MoFA regional maize rows (1999-2023)",
        }
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Database error: {e}"}
