from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional
import json
import asyncpg
from app.db.database import get_pool
from app.services.gss_service import ingest_gss_csv_streaming, sync_gss_from_mofa_streaming, backfill_normalize_existing

router = APIRouter()

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _sse_wrap(gen):
    """Wrap an async event generator into an SSE byte stream."""
    async def generate():
        try:
            async for event in gen:
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'stage': 'error', 'pct': 0, 'message': str(e)})}\n\n"
    return generate()


@router.post("/sync")
async def sync_from_mofa():
    """Download and ingest the MoFA SRID production estimates CSV, streaming progress as SSE."""
    return StreamingResponse(_sse_wrap(sync_gss_from_mofa_streaming()), media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/upload")
async def upload_gss_csv(file: UploadFile = File(...)):
    """Upload a GSS crop production CSV file, streaming progress as SSE."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Only .csv files are accepted")
    content = await file.read()
    return StreamingResponse(_sse_wrap(ingest_gss_csv_streaming(content)), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/crop-production")
async def get_gss_crop_production(
    region: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    crop: Optional[str] = Query(None),
    element: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    limit: int = Query(100, le=10000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    conditions, params, idx = [], [], 1
    if region:
        conditions.append(f"region ILIKE ${idx}"); params.append(f"%{region}%"); idx += 1
    if district:
        conditions.append(f"district ILIKE ${idx}"); params.append(f"%{district}%"); idx += 1
    if crop:
        conditions.append(f"crop ILIKE ${idx}"); params.append(f"%{crop}%"); idx += 1
    if element:
        conditions.append(f"element ILIKE ${idx}"); params.append(f"%{element}%"); idx += 1
    if year is not None:
        conditions.append(f"year = ${idx}"); params.append(year); idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, region, district, crop, element, unit, value, source
        FROM gss_crop_production {where}
        ORDER BY year DESC, region, district, crop, element
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM gss_crop_production {where}", *params[:-2])
    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/regions")
async def get_gss_regions(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT region FROM gss_crop_production WHERE region IS NOT NULL ORDER BY region"
        )
    return [r["region"] for r in rows]


@router.get("/districts")
async def get_gss_districts(
    region: Optional[str] = Query(None),
    pool: asyncpg.Pool = Depends(get_pool),
):
    if region:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT DISTINCT district FROM gss_crop_production WHERE district IS NOT NULL AND region ILIKE $1 ORDER BY district",
                f"%{region}%",
            )
    else:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT DISTINCT district FROM gss_crop_production WHERE district IS NOT NULL ORDER BY district"
            )
    return [r["district"] for r in rows]


@router.get("/crops")
async def get_gss_crops(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT crop FROM gss_crop_production WHERE crop IS NOT NULL ORDER BY crop"
        )
    return [r["crop"] for r in rows]


@router.get("/tracker-crops")
async def get_tracker_crops(pool: asyncpg.Pool = Depends(get_pool)):
    """
    Return the subset of GSS crops that have data in EVERY dataset the
    Demand & Supply Tracker page renders charts from. Computed live so the
    list reflects whatever has been synced.

    Required datasets:
      - fao_crop_production    (Production / Area trend)
      - fao_food_balances      (Food balance card)
      - fao_trade              (Imports vs exports card)
      - gss_crop_production    (Regional production / yield cards)
      - fao_producer_prices    (Farmgate price + YoY inflation)
      - food_prices            (WFP retail price card)

    Matching: the crop must appear at the start of a word in the candidate
    item name (e.g. "Tomato" matches "Tomatoes" but not "..." while "Yam"
    matches "Yam (puna)" but not "Cocoyam").
    """
    # Pull distinct names from each dataset once
    queries = {
        "fao_crop_production":  "SELECT DISTINCT item AS name FROM fao_crop_production WHERE item IS NOT NULL AND item != ''",
        "fao_food_balances":    "SELECT DISTINCT item AS name FROM fao_food_balances WHERE item IS NOT NULL AND item != ''",
        "fao_trade":            "SELECT DISTINCT item AS name FROM fao_trade WHERE item IS NOT NULL AND item != ''",
        "fao_producer_prices":  "SELECT DISTINCT item AS name FROM fao_producer_prices WHERE item IS NOT NULL AND item != ''",
        "food_prices":          "SELECT DISTINCT commodity_name AS name FROM food_prices WHERE commodity_name IS NOT NULL AND commodity_name != ''",
    }

    async with pool.acquire() as conn:
        gss_crops = [
            r["crop"]
            for r in await conn.fetch(
                "SELECT DISTINCT crop FROM gss_crop_production "
                "WHERE crop IS NOT NULL AND crop != '' AND value IS NOT NULL "
                "ORDER BY crop"
            )
        ]
        dataset_names: dict[str, list[str]] = {}
        for label, sql in queries.items():
            rows = await conn.fetch(sql)
            dataset_names[label] = [r["name"].lower() for r in rows]

    import re
    def matches(crop: str, candidate: str) -> bool:
        # Word-start anchor (rejects "Yam" inside "Cocoyam") with permissive
        # right side (matches "Tomato" against "Tomatoes").
        return bool(re.search(rf"(?<![a-z]){re.escape(crop.lower())}", candidate))

    available = []
    for crop in gss_crops:
        if all(any(matches(crop, n) for n in names) for names in dataset_names.values()):
            available.append(crop)
    return available


@router.post("/normalize-backfill")
async def normalize_backfill():
    """
    Apply current crop / region / district normalization rules to existing rows.
    Idempotent — running it multiple times is a no-op once converged.
    """
    return await backfill_normalize_existing()


@router.get("/yields")
async def get_gss_yields(
    region: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    crop: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    limit: int = Query(500, le=5000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """
    Derived yield = Production / Area, computed only where both are present
    and Area > 0. Pivots the long-format `gss_crop_production` table (one row
    per element) into wide rows with area, production, and computed yield.

    The stored "Yield" element is unreliable in the source data (often null or
    inconsistent with production / area), so we compute it on read instead.
    """
    conditions, params, idx = [], [], 1
    if region:
        conditions.append(f"region ILIKE ${idx}"); params.append(f"%{region}%"); idx += 1
    if district:
        conditions.append(f"district ILIKE ${idx}"); params.append(f"%{district}%"); idx += 1
    if crop:
        conditions.append(f"crop ILIKE ${idx}"); params.append(f"%{crop}%"); idx += 1
    if year is not None:
        conditions.append(f"year = ${idx}"); params.append(year); idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    sql = f"""
        WITH pivoted AS (
            SELECT
                year,
                region,
                district,
                crop,
                MAX(value) FILTER (WHERE element = 'Area')       AS area_ha,
                MAX(value) FILTER (WHERE element = 'Production') AS production_mt
            FROM gss_crop_production
            {where}
            GROUP BY year, region, district, crop
        )
        SELECT
            year,
            region,
            district,
            crop,
            area_ha,
            production_mt,
            (production_mt / NULLIF(area_ha, 0))::float AS yield_mt_per_ha
        FROM pivoted
        WHERE area_ha IS NOT NULL
          AND production_mt IS NOT NULL
          AND area_ha > 0
        ORDER BY year DESC, region, district, crop
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])

    count_sql = f"""
        WITH pivoted AS (
            SELECT
                MAX(value) FILTER (WHERE element = 'Area')       AS area_ha,
                MAX(value) FILTER (WHERE element = 'Production') AS production_mt
            FROM gss_crop_production
            {where}
            GROUP BY year, region, district, crop
        )
        SELECT COUNT(*) FROM pivoted
        WHERE area_ha IS NOT NULL AND production_mt IS NOT NULL AND area_ha > 0
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(count_sql, *params[:-2])

    return {
        "data": [dict(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
