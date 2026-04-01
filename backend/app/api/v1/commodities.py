from fastapi import APIRouter, Depends
import asyncpg
from app.db.database import get_pool

router = APIRouter()


@router.get("/")
async def get_commodities(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT commodity_name as name, unit FROM food_prices ORDER BY commodity_name"
        )
    return [dict(r) for r in rows]
