from fastapi import APIRouter, Depends, Query
from typing import Optional
import asyncpg
from app.db.database import get_pool

router = APIRouter()


@router.get("/cpi")
async def get_fao_cpi(
    item: Optional[str] = Query(None),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Return all FAO CPI records. Optionally filter by ?item=."""
    conditions = []
    params = []
    idx = 1

    if item:
        conditions.append(f"item ILIKE ${idx}")
        params.append(f"%{item}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, start_date, end_date, item, element, months, year, value, unit, flag
        FROM fao_cpi
        {where}
        ORDER BY start_date ASC, item
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    return [dict(r) for r in rows]


@router.get("/producer-prices")
async def get_fao_producer_prices(
    item: Optional[str] = Query(None),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Return FAO producer price records. Optionally filter by ?item=."""
    conditions = []
    params = []
    idx = 1

    if item:
        conditions.append(f"item ILIKE ${idx}")
        params.append(f"%{item}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, start_date, end_date, item, element, year, value, unit, flag
        FROM fao_producer_prices
        {where}
        ORDER BY start_date ASC, item
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    return [dict(r) for r in rows]


@router.get("/items")
async def get_fao_items(pool: asyncpg.Pool = Depends(get_pool)):
    """Return distinct item names from fao_producer_prices."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT item FROM fao_producer_prices WHERE item IS NOT NULL AND item != '' ORDER BY item"
        )
    return [r["item"] for r in rows]


@router.get("/healthy-diet-cost")
async def get_fao_healthy_diet_cost(
    item: Optional[str] = Query(None),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Return all FAO Healthy Diet Cost records. Optionally filter by ?item=."""
    conditions = []
    params = []
    idx = 1

    if item:
        conditions.append(f"item ILIKE ${idx}")
        params.append(f"%{item}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, item, item_code, element, release, unit, value
        FROM fao_healthy_diet_cost
        {where}
        ORDER BY year ASC, item
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    return [dict(r) for r in rows]


@router.get("/food-security/items")
async def get_fao_food_security_items(pool: asyncpg.Pool = Depends(get_pool)):
    """Return distinct item names from fao_food_security."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT item FROM fao_food_security WHERE item IS NOT NULL AND item != '' ORDER BY item"
        )
    return [r["item"] for r in rows]


@router.get("/food-security")
async def get_fao_food_security(
    item: Optional[str] = Query(None),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Return all FAO Food Security records. Optionally filter by ?item=."""
    conditions = []
    params = []
    idx = 1

    if item:
        conditions.append(f"item ILIKE ${idx}")
        params.append(f"%{item}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year_label, year_start, item, item_code, element, unit, value
        FROM fao_food_security
        {where}
        ORDER BY year_start ASC NULLS LAST, item
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    return [dict(r) for r in rows]


@router.get("/exchange-rates")
async def get_fao_exchange_rates(
    element: Optional[str] = Query(None),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Return all FAO Exchange Rate records. Optionally filter by ?element=."""
    conditions = []
    params = []
    idx = 1

    if element:
        conditions.append(f"element ILIKE ${idx}")
        params.append(f"%{element}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, months, months_code, element, element_code, currency, iso_currency_code, unit, value
        FROM fao_exchange_rates
        {where}
        ORDER BY year ASC, months_code
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    return [dict(r) for r in rows]


@router.get("/crop-production/items")
async def get_fao_crop_production_items(pool: asyncpg.Pool = Depends(get_pool)):
    """Return distinct item names from fao_crop_production."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT item FROM fao_crop_production WHERE item IS NOT NULL AND item != '' ORDER BY item"
        )
    return [r["item"] for r in rows]


@router.get("/crop-production")
async def get_fao_crop_production(
    item: Optional[str] = Query(None),
    element: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Return FAO Crop Production records with pagination."""
    conditions = []
    params = []
    idx = 1

    if item:
        conditions.append(f"item ILIKE ${idx}")
        params.append(f"%{item}%")
        idx += 1

    if element:
        conditions.append(f"element ILIKE ${idx}")
        params.append(f"%{element}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, item, item_code, element, element_code, unit, value
        FROM fao_crop_production
        {where}
        ORDER BY year ASC, item, element
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM fao_crop_production {where}", *params[:-2])

    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/value-production/items")
async def get_fao_value_production_items(pool: asyncpg.Pool = Depends(get_pool)):
    """Return distinct item names from fao_value_production."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT item FROM fao_value_production WHERE item IS NOT NULL AND item != '' ORDER BY item"
        )
    return [r["item"] for r in rows]


@router.get("/value-production")
async def get_fao_value_production(
    item: Optional[str] = Query(None),
    element: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Return FAO Value of Production records with pagination."""
    conditions = []
    params = []
    idx = 1

    if item:
        conditions.append(f"item ILIKE ${idx}")
        params.append(f"%{item}%")
        idx += 1

    if element:
        conditions.append(f"element ILIKE ${idx}")
        params.append(f"%{element}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, item, item_code, element, element_code, unit, value
        FROM fao_value_production
        {where}
        ORDER BY year ASC, item, element
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM fao_value_production {where}", *params[:-2])

    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/supply-utilization/items")
async def get_fao_supply_utilization_items(pool: asyncpg.Pool = Depends(get_pool)):
    """Return distinct item names from fao_supply_utilization."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT item FROM fao_supply_utilization WHERE item IS NOT NULL AND item != '' ORDER BY item"
        )
    return [r["item"] for r in rows]


@router.get("/supply-utilization")
async def get_fao_supply_utilization(
    item: Optional[str] = Query(None),
    element: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Return FAO Supply Utilization records with pagination."""
    conditions = []
    params = []
    idx = 1

    if item:
        conditions.append(f"item ILIKE ${idx}")
        params.append(f"%{item}%")
        idx += 1

    if element:
        conditions.append(f"element ILIKE ${idx}")
        params.append(f"%{element}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, item, item_code, element, element_code, unit, value
        FROM fao_supply_utilization
        {where}
        ORDER BY year ASC, item, element
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM fao_supply_utilization {where}", *params[:-2])

    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/population")
async def get_fao_population(
    element: Optional[str] = Query(None),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Return FAO population records. Optionally filter by ?element=."""
    conditions = []
    params = []
    idx = 1

    if element:
        conditions.append(f"element ILIKE ${idx}")
        params.append(f"%{element}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, item, item_code, element, element_code, unit, value
        FROM fao_population
        {where}
        ORDER BY year ASC, element
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    return [dict(r) for r in rows]


@router.get("/trade/items")
async def get_fao_trade_items(pool: asyncpg.Pool = Depends(get_pool)):
    """Return distinct item names from fao_trade."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT item FROM fao_trade WHERE item IS NOT NULL AND item != '' ORDER BY item"
        )
    return [r["item"] for r in rows]


@router.get("/trade")
async def get_fao_trade(
    item: Optional[str] = Query(None),
    element: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Return FAO Trade records with pagination."""
    conditions = []
    params = []
    idx = 1

    if item:
        conditions.append(f"item ILIKE ${idx}")
        params.append(f"%{item}%")
        idx += 1

    if element:
        conditions.append(f"element ILIKE ${idx}")
        params.append(f"%{element}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, item, item_code, element, element_code, unit, value
        FROM fao_trade
        {where}
        ORDER BY year ASC, item, element
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM fao_trade {where}", *params[:-2])

    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


# ── RI: Fertilizer Use ────────────────────────────────────────────────────────

@router.get("/fertilizer/items")
async def get_fao_fertilizer_items(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT item FROM fao_fertilizer WHERE item IS NOT NULL AND item != '' ORDER BY item"
        )
    return [r["item"] for r in rows]


@router.get("/fertilizer")
async def get_fao_fertilizer(
    item: Optional[str] = Query(None),
    element: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    conditions, params, idx = [], [], 1
    if item:
        conditions.append(f"item ILIKE ${idx}"); params.append(f"%{item}%"); idx += 1
    if element:
        conditions.append(f"element ILIKE ${idx}"); params.append(f"%{element}%"); idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, item, item_code, element, element_code, unit, value
        FROM fao_fertilizer {where}
        ORDER BY year ASC, item, element
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM fao_fertilizer {where}", *params[:-2])
    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


# ── RL: Land Use ──────────────────────────────────────────────────────────────

@router.get("/land-use/items")
async def get_fao_land_use_items(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT item FROM fao_land_use WHERE item IS NOT NULL AND item != '' ORDER BY item"
        )
    return [r["item"] for r in rows]


@router.get("/land-use")
async def get_fao_land_use(
    item: Optional[str] = Query(None),
    element: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    conditions, params, idx = [], [], 1
    if item:
        conditions.append(f"item ILIKE ${idx}"); params.append(f"%{item}%"); idx += 1
    if element:
        conditions.append(f"element ILIKE ${idx}"); params.append(f"%{element}%"); idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, item, item_code, element, element_code, unit, value
        FROM fao_land_use {where}
        ORDER BY year ASC, item, element
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM fao_land_use {where}", *params[:-2])
    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/food-balances/items")
async def get_fao_food_balance_items(pool: asyncpg.Pool = Depends(get_pool)):
    """Return distinct item names from fao_food_balances."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT item FROM fao_food_balances WHERE item IS NOT NULL AND item != '' ORDER BY item"
        )
    return [r["item"] for r in rows]


@router.get("/food-balances")
async def get_fao_food_balances(
    item: Optional[str] = Query(None),
    element: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Return FAO Food Balance records with pagination."""
    conditions = []
    params = []
    idx = 1

    if item:
        conditions.append(f"item ILIKE ${idx}")
        params.append(f"%{item}%")
        idx += 1

    if element:
        conditions.append(f"element ILIKE ${idx}")
        params.append(f"%{element}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, item, item_code, element, element_code, unit, value
        FROM fao_food_balances
        {where}
        ORDER BY year ASC, item, element
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM fao_food_balances {where}", *params[:-2])

    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}
