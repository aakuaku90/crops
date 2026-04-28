from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from typing import Optional
import json
import asyncpg
from app.db.database import get_pool
from app.services.mofa_service import sync_mofa_national_streaming, sync_mofa_maize_regional_streaming

router = APIRouter()

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _sse_wrap(gen):
    async def generate():
        try:
            async for event in gen:
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'stage': 'error', 'pct': 0, 'message': str(e)})}\n\n"
    return generate()


@router.post("/sync")
async def sync_mofa_national():
    """Download all three MoFA SRID national CSVs (area, production, yield) for 2019-2023."""
    return StreamingResponse(_sse_wrap(sync_mofa_national_streaming()), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/national")
async def get_mofa_national(
    crop: Optional[str] = Query(None),
    element: Optional[str] = Query(None, description="Area, Production, or Yield"),
    year: Optional[int] = Query(None),
    limit: int = Query(500, le=5000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    conditions, params, idx = [], [], 1
    if crop:
        conditions.append(f"crop ILIKE ${idx}"); params.append(f"%{crop}%"); idx += 1
    if element:
        conditions.append(f"element = ${idx}"); params.append(element); idx += 1
    if year is not None:
        conditions.append(f"year = ${idx}"); params.append(year); idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, crop, element, unit, value, source
        FROM mofa_national {where}
        ORDER BY year DESC, crop, element
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM mofa_national {where}", *params[:-2])
    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/crops")
async def get_mofa_crops(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT DISTINCT crop FROM mofa_national WHERE crop IS NOT NULL ORDER BY crop")
    return [r["crop"] for r in rows]


# ─── Regional maize (Y target for forecast model) ───────────────────────────

@router.post("/regional/sync")
async def sync_mofa_regional_maize():
    """Re-ingest MOFA_maize_regional.csv from backend/data/."""
    return StreamingResponse(_sse_wrap(sync_mofa_maize_regional_streaming()), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/regional/maize")
async def get_mofa_regional_maize(
    region: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    year_from: Optional[int] = Query(None),
    year_to: Optional[int] = Query(None),
    limit: int = Query(1000, le=5000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    conditions, params, idx = [], [], 1
    if region:
        conditions.append(f"region = ${idx}"); params.append(region); idx += 1
    if year is not None:
        conditions.append(f"year = ${idx}"); params.append(year); idx += 1
    if year_from is not None:
        conditions.append(f"year >= ${idx}"); params.append(year_from); idx += 1
    if year_to is not None:
        conditions.append(f"year <= ${idx}"); params.append(year_to); idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT year, region, total_area_ha, avg_yield_mt_ha, total_production_mt, source
        FROM mofa_maize_regional {where}
        ORDER BY year DESC, region
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM mofa_maize_regional {where}", *params[:-2]
        )
    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/regional/regions")
async def get_mofa_regional_regions(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT region FROM mofa_maize_regional ORDER BY region"
        )
    return [r["region"] for r in rows]
