from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional
import json
import asyncpg
from app.db.database import get_pool
from app.services.gss_service import ingest_gss_csv_streaming, sync_gss_from_mofa_streaming

router = APIRouter()

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _sse_wrap(gen):
    """Wrap an async event generator into an SSE byte stream."""
    async def generate():
        try:
            async for event in gen:
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'stage': 'error', 'pct': 0, 'message': str(e)})}\n\n"
    return generate()


@router.post("/sync")
async def sync_from_mofa():
    """Download and ingest the MoFA SRID production estimates CSV, streaming progress as SSE."""
    return StreamingResponse(_sse_wrap(sync_gss_from_mofa_streaming()), media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/upload")
async def upload_gss_csv(file: UploadFile = File(...)):
    """Upload a GSS crop production CSV file, streaming progress as SSE."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Only .csv files are accepted")
    content = await file.read()
    return StreamingResponse(_sse_wrap(ingest_gss_csv_streaming(content)), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/crop-production")
async def get_gss_crop_production(
    region: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    crop: Optional[str] = Query(None),
    element: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    pool: asyncpg.Pool = Depends(get_pool),
):
    conditions, params, idx = [], [], 1
    if region:
        conditions.append(f"region ILIKE ${idx}"); params.append(f"%{region}%"); idx += 1
    if district:
        conditions.append(f"district ILIKE ${idx}"); params.append(f"%{district}%"); idx += 1
    if crop:
        conditions.append(f"crop ILIKE ${idx}"); params.append(f"%{crop}%"); idx += 1
    if element:
        conditions.append(f"element ILIKE ${idx}"); params.append(f"%{element}%"); idx += 1
    if year is not None:
        conditions.append(f"year = ${idx}"); params.append(year); idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, year, region, district, crop, element, unit, value, source
        FROM gss_crop_production {where}
        ORDER BY year DESC, region, district, crop, element
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM gss_crop_production {where}", *params[:-2])
    return {"data": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/regions")
async def get_gss_regions(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT region FROM gss_crop_production WHERE region IS NOT NULL ORDER BY region"
        )
    return [r["region"] for r in rows]


@router.get("/districts")
async def get_gss_districts(
    region: Optional[str] = Query(None),
    pool: asyncpg.Pool = Depends(get_pool),
):
    if region:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT DISTINCT district FROM gss_crop_production WHERE district IS NOT NULL AND region ILIKE $1 ORDER BY district",
                f"%{region}%",
            )
    else:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT DISTINCT district FROM gss_crop_production WHERE district IS NOT NULL ORDER BY district"
            )
    return [r["district"] for r in rows]


@router.get("/crops")
async def get_gss_crops(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT crop FROM gss_crop_production WHERE crop IS NOT NULL ORDER BY crop"
        )
    return [r["crop"] for r in rows]
