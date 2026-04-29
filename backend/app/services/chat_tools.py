"""
Tool handlers for the Claude-powered chat panel. Each function maps to one
of the tool schemas declared in `app/api/v1/chat.py` — when Claude emits a
`tool_use` block, the chat router dispatches to the matching handler here,
serializes the result, and feeds it back into the conversation.

The contract: every handler is `async def fn(**kwargs) -> dict`, returns a
JSON-serializable mapping. Date and Decimal values get coerced to ISO
strings / floats by `_to_jsonable` before they leave this module so the
chat router can `json.dumps` the result without custom encoders.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from app.db.database import get_pool


def _to_jsonable(value: Any) -> Any:
    """Coerce asyncpg result types into JSON-serializable Python primitives."""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _row(record) -> dict:
    return {k: _to_jsonable(v) for k, v in record.items()}


# ── Tool: query_food_prices ─────────────────────────────────────────────────
async def query_food_prices(
    commodity: str,
    market: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
) -> dict:
    """WFP retail/wholesale prices for Ghana commodities.

    Coverage: 2006-01 through 2023-07. Returns most recent rows first.
    """
    pool = await get_pool()
    where = ["commodity_name ILIKE $1"]
    params: list = [f"%{commodity}%"]
    idx = 2
    if market:
        where.append(f"market_name ILIKE ${idx}")
        params.append(f"%{market}%")
        idx += 1
    if date_from:
        where.append(f"date >= ${idx}::date")
        params.append(date_from)
        idx += 1
    if date_to:
        where.append(f"date <= ${idx}::date")
        params.append(date_to)
        idx += 1
    sql = f"""
        SELECT date, commodity_name, market_name, region, price, currency,
               unit, price_type
        FROM food_prices
        WHERE {' AND '.join(where)}
        ORDER BY date DESC
        LIMIT ${idx}
    """
    params.append(min(max(limit, 1), 200))
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
    return {
        "rows": [_row(r) for r in rows],
        "count": len(rows),
        "note": "WFP HDEX data; upstream feed stops at 2023-07. For prices "
                "after that, use web_search.",
    }


# ── Tool: query_food_balance ────────────────────────────────────────────────
async def query_food_balance(
    crop: str,
    year_min: int | None = None,
    year_max: int | None = None,
    elements: list[str] | None = None,
) -> dict:
    """FAO Food Balance Sheet rows for a crop.

    Elements include Production, Food, Feed, Losses, Imports, Exports,
    Domestic supply, Stock Variation, and per-capita supply variants. Values
    are in **1000 tonnes** (kilotonnes) — multiply by 1000 for tonnes.
    """
    pool = await get_pool()
    # Restrict to the canonical "<crop> and products" item to avoid mixing
    # in derivatives like "Maize Germ Oil" — the same filter the frontend
    # CropBalanceChart applies.
    where = ["item ILIKE $1"]
    params: list = [f"{crop} and products"]
    idx = 2
    if year_min is not None:
        where.append(f"year >= ${idx}")
        params.append(year_min)
        idx += 1
    if year_max is not None:
        where.append(f"year <= ${idx}")
        params.append(year_max)
        idx += 1
    if elements:
        where.append(f"element = ANY(${idx})")
        params.append(elements)
        idx += 1
    sql = f"""
        SELECT year, item, element, value, unit
        FROM fao_food_balances
        WHERE {' AND '.join(where)}
        ORDER BY year DESC, element
        LIMIT 500
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
    # Fallback: if the canonical item produced nothing, retry with a loose
    # ILIKE so e.g. "Wheat" works even when there's no exact "Wheat and products".
    if not rows:
        params[0] = f"%{crop}%"
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, *params)
    return {
        "rows": [_row(r) for r in rows],
        "count": len(rows),
        "note": "FAO Food Balance Sheets. Quantity values are in 1000 tonnes.",
    }


# ── Tool: query_predictions ─────────────────────────────────────────────────
_MODEL_TABLES = {
    "tabpfn": "maize_predictions",
    "lightgbm": "maize_predictions_lightgbm",
    "rolling": "maize_predictions_rolling_mean",
}


async def query_predictions(
    model: str,
    region: str | None = None,
    year_min: int | None = None,
    year_max: int | None = None,
    source: str | None = None,
) -> dict:
    """Maize yield/area/production predictions from one of three models.

    `source` is 'backtest' (with actuals) or one of the future-* labels
    ('future_tabpfn', 'future', 'future_rolling'). Leave unset to return both.
    """
    table = _MODEL_TABLES.get(model.lower())
    if not table:
        return {"error": f"unknown model '{model}'. Options: tabpfn, lightgbm, rolling."}

    pool = await get_pool()
    where: list[str] = []
    params: list = []
    idx = 1
    if region:
        where.append(f"region ILIKE ${idx}")
        params.append(f"%{region}%")
        idx += 1
    if year_min is not None:
        where.append(f"year >= ${idx}")
        params.append(year_min)
        idx += 1
    if year_max is not None:
        where.append(f"year <= ${idx}")
        params.append(year_max)
        idx += 1
    if source:
        where.append(f"source = ${idx}")
        params.append(source)
        idx += 1
    where_clause = "WHERE " + " AND ".join(where) if where else ""
    sql = f"""
        SELECT region, year, source, actual_yield, pred_yield,
               actual_area, pred_area, actual_production, pred_production
        FROM {table}
        {where_clause}
        ORDER BY year DESC, region
        LIMIT 500
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
    return {
        "rows": [_row(r) for r in rows],
        "count": len(rows),
        "model": model,
        "note": "Yield in mt/ha, area in hectares, production in tonnes. "
                "'backtest' rows have both actuals and predictions; 'future*' "
                "rows are predictions only.",
    }


# ── Tool: query_producer_prices ─────────────────────────────────────────────
async def query_producer_prices(
    item: str,
    year_min: int | None = None,
    year_max: int | None = None,
    element: str | None = None,
) -> dict:
    """FAO producer prices for a Ghana crop.

    Elements: 'Producer Price (LCU/tonne)' (Ghana cedi), 'Producer Price
    (USD/tonne)', 'Producer Price (SLC/tonne)' (Standard Local Currency, the
    pre-2007 cedi), 'Producer Price Index (2014-2016 = 100)'.
    """
    pool = await get_pool()
    where = ["item ILIKE $1"]
    params: list = [f"%{item}%"]
    idx = 2
    if year_min is not None:
        where.append(f"year >= ${idx}")
        params.append(year_min)
        idx += 1
    if year_max is not None:
        where.append(f"year <= ${idx}")
        params.append(year_max)
        idx += 1
    if element:
        where.append(f"element ILIKE ${idx}")
        params.append(f"%{element}%")
        idx += 1
    sql = f"""
        SELECT year, item, element, value, unit, flag
        FROM fao_producer_prices
        WHERE {' AND '.join(where)}
        ORDER BY year DESC, element
        LIMIT 300
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
    return {
        "rows": [_row(r) for r in rows],
        "count": len(rows),
        "note": "FAO Producer Prices. LCU = Ghana cedi (post-2007). "
                "Pre-2007 LCU values are in old cedis (1 GHS = 10,000 old cedis).",
    }


# ── Tool: query_population ──────────────────────────────────────────────────
async def query_population(
    year_min: int | None = None,
    year_max: int | None = None,
    element: str = "Total Population - Both sexes",
) -> dict:
    """Ghana population by year. Includes FAO/UN projections through 2100."""
    pool = await get_pool()
    where = ["element ILIKE $1"]
    params: list = [f"%{element}%"]
    idx = 2
    if year_min is not None:
        where.append(f"year >= ${idx}")
        params.append(year_min)
        idx += 1
    if year_max is not None:
        where.append(f"year <= ${idx}")
        params.append(year_max)
        idx += 1
    sql = f"""
        SELECT year, element, value, unit
        FROM fao_population
        WHERE {' AND '.join(where)}
        ORDER BY year ASC
        LIMIT 500
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
    return {
        "rows": [_row(r) for r in rows],
        "count": len(rows),
        "note": "Population values are in 1000 No (multiply by 1000 for actual headcount).",
    }


# Registry — used by chat.py to dispatch tool calls.
TOOL_HANDLERS = {
    "query_food_prices": query_food_prices,
    "query_food_balance": query_food_balance,
    "query_predictions": query_predictions,
    "query_producer_prices": query_producer_prices,
    "query_population": query_population,
}
