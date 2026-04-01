from fastapi import APIRouter, Depends
import asyncpg
from app.db.database import get_pool

router = APIRouter()


@router.get("/")
async def get_markets(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT market_name as name, region
            FROM food_prices
            ORDER BY market_name
            """
        )
    return [dict(r) for r in rows]
