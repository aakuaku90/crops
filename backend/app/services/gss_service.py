import csv
import io
import asyncio
import requests
from typing import AsyncIterator
from app.db.database import get_pool
from app.services.gss_normalize import normalize_crop_name, normalize_text, get_alias_map

MOFA_PRODUCTION_ESTIMATES_URL = (
    "https://srid.mofa.gov.gh/sites/default/files/uploaded_resources/"
    "production%20estimates%202020%20to%202021_0.csv"
)

REQUIRED_COLUMNS = {"year", "region", "district", "commodity", "area_cropped_ha", "average_yield_mt_per_ha", "production_mt"}


def _download_csv(url: str) -> bytes:
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.content


def _parse_float(row: dict, key: str) -> float | None:
    raw = row.get(key, "").replace(",", "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _parse_rows(content: bytes) -> tuple[list[tuple], int, str | None]:
    """Parse CSV bytes into insert tuples (blocking — run in a thread)."""
    try:
        text = content.decode("utf-8-sig", errors="replace")
    except Exception as e:
        return [], 0, f"Decode error: {e}"

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        return [], 0, "CSV appears to be empty"

    normalised = {h.strip().lower(): h for h in reader.fieldnames}
    missing = REQUIRED_COLUMNS - set(normalised.keys())
    if missing:
        return [], 0, (
            f"Missing required columns: {', '.join(sorted(missing))}. "
            f"Expected: YEAR, REGION, DISTRICT, COMMODITY, "
            f"AREA_CROPPED_Ha, AVERAGE_YIELD_Mt_per_Ha, PRODUCTION_Mt"
        )

    rows_to_insert: list[tuple] = []
    skipped = 0

    for raw_row in reader:
        row = {k: raw_row.get(normalised[k], "").strip() for k in normalised}
        try:
            year = int(row["year"])
        except (ValueError, TypeError):
            skipped += 1
            continue
        region = normalize_text(row.get("region", ""))
        district = normalize_text(row.get("district", ""))
        commodity = normalize_crop_name(row.get("commodity", ""))
        if not region:
            skipped += 1
            continue
        source = row.get("source", "GSS").strip() or "GSS"
        area = _parse_float(row, "area_cropped_ha")
        yield_val = _parse_float(row, "average_yield_mt_per_ha")
        production = _parse_float(row, "production_mt")
        rows_to_insert.append((year, region, district, commodity, "Area", "Ha", area, source))
        rows_to_insert.append((year, region, district, commodity, "Yield", "Mt/Ha", yield_val, source))
        rows_to_insert.append((year, region, district, commodity, "Production", "Mt", production, source))

    return rows_to_insert, skipped, None


async def ingest_gss_csv_streaming(content: bytes) -> AsyncIterator[dict]:
    """Async generator: parse and ingest a GSS CSV, yielding progress dicts."""
    yield {"stage": "parsing", "pct": 10}

    rows_to_insert, skipped, error = await asyncio.to_thread(_parse_rows, content)

    if error:
        yield {"stage": "error", "pct": 0, "message": error}
        return
    if not rows_to_insert:
        yield {"stage": "error", "pct": 0, "message": "No valid rows found in CSV"}
        return

    total_rows = len(rows_to_insert)
    yield {"stage": "loading", "pct": 40, "total": total_rows}

    try:
        pool = await get_pool()

        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("TRUNCATE TABLE gss_crop_production RESTART IDENTITY")

                yield {"stage": "upserting", "pct": 60, "total": total_rows}

                await conn.copy_records_to_table(
                    "gss_crop_production",
                    records=rows_to_insert,
                    columns=["year", "region", "district", "crop", "element", "unit", "value", "source"],
                )

        yield {
            "stage": "done",
            "pct": 100,
            "records_inserted": total_rows,
            "records_skipped": skipped,
            "message": f"Loaded {total_rows} records",
        }
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Database error: {e}"}


async def backfill_normalize_existing() -> dict:
    """
    Apply current normalization rules to rows already in the table.

    Reads distinct (crop, region, district) combinations, computes the canonical
    form via the normalization helpers, and updates rows where the canonical
    differs from the stored value. Returns counts of updated rows.
    """
    pool = await get_pool()
    updated_crops = 0
    updated_regions = 0
    updated_districts = 0

    async with pool.acquire() as conn:
        # ── Crops ──
        crop_rows = await conn.fetch(
            "SELECT DISTINCT crop FROM gss_crop_production WHERE crop IS NOT NULL"
        )
        for row in crop_rows:
            raw = row["crop"]
            canonical = normalize_crop_name(raw)
            if canonical and canonical != raw:
                result = await conn.execute(
                    "UPDATE gss_crop_production SET crop = $1 WHERE crop = $2",
                    canonical, raw,
                )
                updated_crops += int(result.split()[-1])

        # ── Regions ──
        region_rows = await conn.fetch(
            "SELECT DISTINCT region FROM gss_crop_production WHERE region IS NOT NULL"
        )
        for row in region_rows:
            raw = row["region"]
            canonical = normalize_text(raw)
            if canonical and canonical != raw:
                result = await conn.execute(
                    "UPDATE gss_crop_production SET region = $1 WHERE region = $2",
                    canonical, raw,
                )
                updated_regions += int(result.split()[-1])

        # ── Districts ──
        district_rows = await conn.fetch(
            "SELECT DISTINCT district FROM gss_crop_production WHERE district IS NOT NULL"
        )
        for row in district_rows:
            raw = row["district"]
            canonical = normalize_text(raw)
            if canonical and canonical != raw:
                result = await conn.execute(
                    "UPDATE gss_crop_production SET district = $1 WHERE district = $2",
                    canonical, raw,
                )
                updated_districts += int(result.split()[-1])

    return {
        "crops_updated": updated_crops,
        "regions_updated": updated_regions,
        "districts_updated": updated_districts,
        "alias_map_size": sum(len(v) for v in get_alias_map().values()),
    }


async def sync_gss_from_mofa_streaming() -> AsyncIterator[dict]:
    """Async generator: download from MoFA and ingest, yielding progress dicts."""
    yield {"stage": "downloading", "pct": 5}
    try:
        content = await asyncio.to_thread(_download_csv, MOFA_PRODUCTION_ESTIMATES_URL)
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Download error: {e}"}
        return

    async for event in ingest_gss_csv_streaming(content):
        # Remap "parsing" from 10% to 25% since download already took 5–25%
        if event.get("stage") == "parsing":
            yield {**event, "pct": 25}
        else:
            yield event
