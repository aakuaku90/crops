from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from typing import Optional
import json
import asyncpg

from app.db.database import get_pool
from app.services.climate_service import sync_climate_streaming, DB_COLUMNS

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
async def sync_climate():
    """Re-ingest both X_monthly_regionadj.csv and X_annual_regionadj.csv from backend/data/."""
    return StreamingResponse(_sse_wrap(sync_climate_streaming()), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/regions")
async def get_climate_regions(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT region FROM climate_features_monthly ORDER BY region"
        )
    return [r["region"] for r in rows]


@router.get("/monthly")
async def get_climate_monthly(
    region: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    year_from: Optional[int] = Query(None),
    year_to: Optional[int] = Query(None),
    limit: int = Query(2000, le=10000),
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
    cols = ", ".join(["region", "year", "month", *DB_COLUMNS])
    sql = f"""
        SELECT {cols}
        FROM climate_features_monthly {where}
        ORDER BY region, year, month
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM climate_features_monthly {where}", *params[:-2]
        )
    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/annual")
async def get_climate_annual(
    region: Optional[str] = Query(None),
    year_from: Optional[int] = Query(None),
    year_to: Optional[int] = Query(None),
    limit: int = Query(2000, le=10000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    conditions, params, idx = [], [], 1
    if region:
        conditions.append(f"region = ${idx}"); params.append(region); idx += 1
    if year_from is not None:
        conditions.append(f"year >= ${idx}"); params.append(year_from); idx += 1
    if year_to is not None:
        conditions.append(f"year <= ${idx}"); params.append(year_to); idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    cols = ", ".join(["region", "year", *DB_COLUMNS])
    sql = f"""
        SELECT {cols}
        FROM climate_features_annual {where}
        ORDER BY region, year
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM climate_features_annual {where}", *params[:-2]
        )
    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/summary")
async def get_climate_summary(pool: asyncpg.Pool = Depends(get_pool)):
    """High-level counts so the dashboard can show 'Sync me' vs. 'X rows loaded'."""
    async with pool.acquire() as conn:
        m_count = await conn.fetchval("SELECT COUNT(*) FROM climate_features_monthly")
        a_count = await conn.fetchval("SELECT COUNT(*) FROM climate_features_annual")
        m_range = await conn.fetchrow(
            "SELECT MIN(year) AS y_min, MAX(year) AS y_max FROM climate_features_monthly"
        )
        a_range = await conn.fetchrow(
            "SELECT MIN(year) AS y_min, MAX(year) AS y_max FROM climate_features_annual"
        )
    return {
        "monthly": {"rows": m_count, "year_min": m_range["y_min"], "year_max": m_range["y_max"]},
        "annual": {"rows": a_count, "year_min": a_range["y_min"], "year_max": a_range["y_max"]},
    }
