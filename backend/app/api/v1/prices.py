from fastapi import APIRouter, Depends, Query
from typing import Optional
import asyncpg
from app.db.database import get_pool

router = APIRouter()


@router.get("/")
async def get_prices(
    commodity: Optional[str] = Query(None),
    market: Optional[str] = Query(None),
    region: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    price_type: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    conditions = []
    params = []
    idx = 1

    if commodity:
        conditions.append(f"commodity_name ILIKE ${idx}")
        params.append(f"%{commodity}%")
        idx += 1
    if market:
        conditions.append(f"market_name ILIKE ${idx}")
        params.append(f"%{market}%")
        idx += 1
    if region:
        conditions.append(f"region ILIKE ${idx}")
        params.append(f"%{region}%")
        idx += 1
    if start_date:
        conditions.append(f"date >= ${idx}")
        params.append(start_date)
        idx += 1
    if end_date:
        conditions.append(f"date <= ${idx}")
        params.append(end_date)
        idx += 1
    if price_type:
        conditions.append(f"price_type ILIKE ${idx}")
        params.append(f"%{price_type}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, commodity_name, market_name, region, admin2, category,
               date, price, usd_price, unit, currency, price_type, price_flag,
               latitude, longitude, source
        FROM food_prices
        {where}
        ORDER BY date DESC, commodity_name
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        count_sql = f"SELECT COUNT(*) FROM food_prices {where}"
        total = await conn.fetchval(count_sql, *params[:-2])

    return {
        "data": [dict(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/summary")
async def get_price_summary(pool: asyncpg.Pool = Depends(get_pool)):
    """Latest price summary per commodity."""
    sql = """
        WITH latest AS (
            SELECT DISTINCT ON (commodity_name)
                commodity_name, price, unit, currency, date, region
            FROM food_prices
            ORDER BY commodity_name, date DESC
        ),
        prev AS (
            SELECT DISTINCT ON (commodity_name)
                commodity_name, price AS prev_price
            FROM food_prices
            WHERE date < (SELECT MAX(date) - INTERVAL '30 days' FROM food_prices)
            ORDER BY commodity_name, date DESC
        ),
        stats AS (
            SELECT commodity_name,
                AVG(price) as avg_price,
                MIN(price) as min_price,
                MAX(price) as max_price
            FROM food_prices
            GROUP BY commodity_name
        )
        SELECT l.commodity_name, l.price as latest_price, l.unit, l.currency, l.date as latest_date,
               s.avg_price, s.min_price, s.max_price,
               CASE WHEN p.prev_price > 0
                    THEN ROUND(((l.price - p.prev_price) / p.prev_price * 100)::numeric, 2)
                    ELSE NULL
               END as price_change_pct
        FROM latest l
        LEFT JOIN prev p ON l.commodity_name = p.commodity_name
        LEFT JOIN stats s ON l.commodity_name = s.commodity_name
        ORDER BY l.commodity_name
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)
    return [dict(r) for r in rows]


@router.get("/timeseries")
async def get_price_timeseries(
    commodity: str = Query(...),
    market: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Price timeseries for a specific commodity."""
    params = [f"%{commodity}%"]
    conditions = ["commodity_name ILIKE $1"]
    idx = 2

    if market:
        conditions.append(f"market_name ILIKE ${idx}")
        params.append(f"%{market}%")
        idx += 1
    if start_date:
        conditions.append(f"date >= ${idx}")
        params.append(start_date)
        idx += 1
    if end_date:
        conditions.append(f"date <= ${idx}")
        params.append(end_date)
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}"
    sql = f"""
        SELECT date, market_name, region,
               AVG(price) as avg_price, MIN(price) as min_price, MAX(price) as max_price,
               unit, currency
        FROM food_prices
        {where}
        GROUP BY date, market_name, region, unit, currency
        ORDER BY date ASC
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
    return [dict(r) for r in rows]


@router.get("/regions")
async def get_regions(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT region FROM food_prices WHERE region IS NOT NULL AND region != '' ORDER BY region"
        )
    return [r["region"] for r in rows]
