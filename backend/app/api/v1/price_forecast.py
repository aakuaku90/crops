"""Per-market maize price forecast endpoints. Backed by Prophet models with a
CPI exogenous regressor; see app/services/price_forecast_service.py."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from typing import Optional
import json
import asyncpg

from app.db.database import get_pool
from app.services.price_forecast_service import sync_maize_price_forecast_streaming

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


@router.post("/maize/sync")
async def sync_maize_price_forecast():
    """Re-fit per-market Prophet price forecasts. Streams progress as SSE."""
    return StreamingResponse(
        _sse_wrap(sync_maize_price_forecast_streaming()),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.get("/maize/markets")
async def get_maize_price_forecast_markets(pool: asyncpg.Pool = Depends(get_pool)):
    """List of markets with a fitted forecast, ordered alphabetically."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT market FROM maize_price_forecast ORDER BY market"
        )
    return [r["market"] for r in rows]


@router.get("/maize")
async def get_maize_price_forecast(
    market: Optional[str] = Query(None),
    phase: Optional[str] = Query(None, description="train | backtest | forecast"),
    limit: int = Query(5000, le=20000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """List forecast rows. Filterable by market and phase."""
    conditions, params, idx = [], [], 1
    if market:
        conditions.append(f"market = ${idx}"); params.append(market); idx += 1
    if phase:
        conditions.append(f"phase = ${idx}"); params.append(phase); idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT market, region, month_date, phase,
               actual_price_ghs, actual_price_usd,
               pred_price_ghs, pred_price_lower_ghs, pred_price_upper_ghs,
               pred_price_usd, pred_price_lower_usd, pred_price_upper_usd,
               cpi_value, unit
        FROM maize_price_forecast {where}
        ORDER BY market, month_date, phase
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM maize_price_forecast {where}", *params[:-2]
        )
    return {
        "data": [
            {
                "market": r["market"],
                "region": r["region"],
                "month_date": r["month_date"].isoformat() if r["month_date"] else None,
                "phase": r["phase"],
                "actual_price_ghs": r["actual_price_ghs"],
                "actual_price_usd": r["actual_price_usd"],
                "pred_price_ghs": r["pred_price_ghs"],
                "pred_price_lower_ghs": r["pred_price_lower_ghs"],
                "pred_price_upper_ghs": r["pred_price_upper_ghs"],
                "pred_price_usd": r["pred_price_usd"],
                "pred_price_lower_usd": r["pred_price_lower_usd"],
                "pred_price_upper_usd": r["pred_price_upper_usd"],
                "cpi_value": r["cpi_value"],
                "unit": r["unit"],
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/maize/meta")
async def get_maize_price_forecast_meta(pool: asyncpg.Pool = Depends(get_pool)):
    """Per-market metadata: training-set sizes, holdout backtest metrics, CPI beta."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT market, region, unit, n_train, n_backtest,
                   backtest_rmse_ghs, backtest_mae_ghs, backtest_mape_pct,
                   cpi_beta, last_history_date, forecast_horizon_date,
                   generated_at
            FROM maize_price_forecast_meta
            ORDER BY market
            """
        )
    return [
        {
            "market": r["market"],
            "region": r["region"],
            "unit": r["unit"],
            "n_train": r["n_train"],
            "n_backtest": r["n_backtest"],
            "backtest_rmse_ghs": r["backtest_rmse_ghs"],
            "backtest_mae_ghs": r["backtest_mae_ghs"],
            "backtest_mape_pct": r["backtest_mape_pct"],
            "cpi_beta": r["cpi_beta"],
            "last_history_date": r["last_history_date"].isoformat() if r["last_history_date"] else None,
            "forecast_horizon_date": r["forecast_horizon_date"].isoformat() if r["forecast_horizon_date"] else None,
            "generated_at": r["generated_at"].isoformat() if r["generated_at"] else None,
        }
        for r in rows
    ]


@router.get("/maize/summary")
async def get_maize_price_forecast_summary(pool: asyncpg.Pool = Depends(get_pool)):
    """Top-line: # markets, horizon, latest history month, mean backtest RMSE,
    average projected price at horizon (GHS) for the KPI tiles."""
    async with pool.acquire() as conn:
        n_markets = await conn.fetchval(
            "SELECT COUNT(*) FROM maize_price_forecast_meta"
        )
        horizon = await conn.fetchval(
            "SELECT MAX(forecast_horizon_date) FROM maize_price_forecast_meta"
        )
        last_history = await conn.fetchval(
            "SELECT MAX(last_history_date) FROM maize_price_forecast_meta"
        )
        avg_rmse = await conn.fetchval(
            "SELECT AVG(backtest_rmse_ghs) FROM maize_price_forecast_meta"
        )
        avg_mape = await conn.fetchval(
            "SELECT AVG(backtest_mape_pct) FROM maize_price_forecast_meta"
        )
        # Mean projected price at the horizon month, across markets.
        avg_pred_horizon = await conn.fetchval(
            """
            SELECT AVG(pred_price_ghs)
            FROM maize_price_forecast f
            JOIN maize_price_forecast_meta m USING (market)
            WHERE f.month_date = m.forecast_horizon_date
              AND f.phase = 'forecast'
            """
        )
    return {
        "n_markets": n_markets or 0,
        "horizon_date": horizon.isoformat() if horizon else None,
        "last_history_date": last_history.isoformat() if last_history else None,
        "avg_backtest_rmse_ghs": float(avg_rmse) if avg_rmse is not None else None,
        "avg_backtest_mape_pct": float(avg_mape) if avg_mape is not None else None,
        "avg_pred_horizon_ghs": float(avg_pred_horizon) if avg_pred_horizon is not None else None,
    }
