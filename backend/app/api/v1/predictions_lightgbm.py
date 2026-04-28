from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from typing import Optional
import json
import asyncpg

from app.db.database import get_pool
from app.services.lightgbm_predictions_service import sync_lightgbm_streaming

router = APIRouter()
TABLE = "maize_predictions_lightgbm"

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _sse_wrap(gen):
    async def generate():
        try:
            async for event in gen:
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'stage': 'error', 'pct': 0, 'message': str(e)})}\n\n"
    return generate()


@router.post("/maize/sync")
async def sync_lightgbm():
    """Train LightGBM (LOYO backtest + final model) and write predictions to DB."""
    return StreamingResponse(_sse_wrap(sync_lightgbm_streaming()), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/maize/regions")
async def regions(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(f"SELECT DISTINCT region FROM {TABLE} ORDER BY region")
    return [r["region"] for r in rows]


@router.get("/maize")
async def list_predictions(
    region: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
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
    if source:
        conditions.append(f"source = ${idx}"); params.append(source); idx += 1
    if year is not None:
        conditions.append(f"year = ${idx}"); params.append(year); idx += 1
    if year_from is not None:
        conditions.append(f"year >= ${idx}"); params.append(year_from); idx += 1
    if year_to is not None:
        conditions.append(f"year <= ${idx}"); params.append(year_to); idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT region, year, source,
               actual_yield, pred_yield,
               actual_area, pred_area,
               actual_production, pred_production
        FROM {TABLE} {where}
        ORDER BY year, region, source
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM {TABLE} {where}", *params[:-2]
        )
    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/maize/summary")
async def summary(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM {TABLE}")
        backtest = await conn.fetchval(f"SELECT COUNT(*) FROM {TABLE} WHERE source = 'backtest'")
        future = await conn.fetchval(f"SELECT COUNT(*) FROM {TABLE} WHERE source != 'backtest'")
        future_max_year = await conn.fetchval(
            f"SELECT MAX(year) FROM {TABLE} WHERE source != 'backtest'"
        )
        backtest_year_range = await conn.fetchrow(
            f"SELECT MIN(year) AS y_min, MAX(year) AS y_max FROM {TABLE} WHERE source = 'backtest'"
        )
        rmse = await conn.fetchval(
            f"""
            SELECT SQRT(AVG((actual_yield - pred_yield) * (actual_yield - pred_yield)))
            FROM {TABLE}
            WHERE source = 'backtest' AND actual_yield IS NOT NULL AND pred_yield IS NOT NULL
            """
        )
    return {
        "total": total,
        "backtest_rows": backtest,
        "future_rows": future,
        "future_horizon_year": future_max_year,
        "backtest_year_min": backtest_year_range["y_min"],
        "backtest_year_max": backtest_year_range["y_max"],
        "yield_rmse_mt_ha": float(rmse) if rmse is not None else None,
    }
