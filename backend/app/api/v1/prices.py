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
    """
    Latest price summary per commodity.

    The raw `food_prices` table mixes units (KG, 100KG sack, L, head, etc.) and
    markets within the same commodity, so naïve AVG/MIN/MAX produces nonsense
    (e.g. Cassava min=0.7, max=4718). This query:

      1. Picks the dominant unit per commodity (the most-reported one).
      2. Averages across markets per month within that unit, smoothing out
         single-market outliers.
      3. Computes latest / prev / stats from those monthly averages.

    Result: comparable, clean numbers suitable for charts and ranking.
    """
    sql = """
        WITH commodity_unit AS (
            SELECT commodity_name, unit
            FROM (
                SELECT commodity_name, unit,
                       ROW_NUMBER() OVER (
                           PARTITION BY commodity_name
                           ORDER BY COUNT(*) DESC, unit
                       ) AS rn
                FROM food_prices
                WHERE unit IS NOT NULL AND unit != ''
                GROUP BY commodity_name, unit
            ) t
            WHERE rn = 1
        ),
        monthly AS (
            -- One row per (commodity, month) within the canonical unit:
            -- the mean price across markets that month. Months with fewer
            -- than 2 reporting markets are dropped — they're noise, not signal.
            SELECT fp.commodity_name,
                   date_trunc('month', fp.date)::date AS month,
                   cu.unit,
                   MAX(fp.currency) AS currency,
                   AVG(fp.price) AS avg_price,
                   COUNT(DISTINCT fp.market_name) AS market_count
            FROM food_prices fp
            JOIN commodity_unit cu USING (commodity_name)
            WHERE fp.unit = cu.unit AND fp.price > 0
            GROUP BY fp.commodity_name, date_trunc('month', fp.date), cu.unit
            HAVING COUNT(DISTINCT fp.market_name) >= 2
        ),
        ranked AS (
            SELECT *,
                   ROW_NUMBER() OVER (
                       PARTITION BY commodity_name ORDER BY month DESC
                   ) AS month_rank
            FROM monthly
        ),
        latest AS (
            SELECT commodity_name, avg_price AS latest_price,
                   unit, currency, month AS latest_date
            FROM ranked
            WHERE month_rank = 1
        ),
        baseline AS (
            -- Trailing 3-month average ending one month before latest.
            -- Smooths out market-mix swings when comparing the "change".
            SELECT commodity_name, AVG(avg_price) AS prev_price
            FROM ranked
            WHERE month_rank BETWEEN 2 AND 4
            GROUP BY commodity_name
        ),
        stats AS (
            -- Recent context: last 36 months only, so min/max/avg reflect
            -- today's market regime, not the 2006-era base prices.
            SELECT commodity_name,
                   AVG(avg_price) AS avg_price,
                   MIN(avg_price) AS min_price,
                   MAX(avg_price) AS max_price
            FROM ranked
            WHERE month_rank <= 36
            GROUP BY commodity_name
        )
        SELECT l.commodity_name,
               l.latest_price,
               l.unit,
               l.currency,
               l.latest_date,
               s.avg_price,
               s.min_price,
               s.max_price,
               CASE WHEN b.prev_price > 0
                    THEN ROUND(((l.latest_price - b.prev_price) / b.prev_price * 100)::numeric, 2)
                    ELSE NULL
               END AS price_change_pct
        FROM latest l
        LEFT JOIN baseline b USING (commodity_name)
        LEFT JOIN stats    s USING (commodity_name)
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
