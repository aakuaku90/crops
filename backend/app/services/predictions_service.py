"""
Maize yield prediction ingestion (TabPFN model output).

CSV `maize_predictions_tabpfn_full.csv` contains both backtest (historical
predictions vs actuals, used for evaluation) and future_tabpfn (forward
predictions where actuals are NULL).

File lives at backend/data/ and is mounted into the container as /app/data/.
"""

from __future__ import annotations

import asyncio
import csv
from pathlib import Path
from typing import AsyncIterator

from app.db.database import get_pool

CSV_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "maize_predictions_tabpfn_full.csv"


def _parse_float(s: str) -> float | None:
    s = s.strip()
    if not s or s.lower() in ("nan", "null", "none"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_csv(path: Path) -> list[tuple]:
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {path}")
    with path.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        out: list[tuple] = []
        for row in reader:
            region = (row.get("region") or "").strip()
            if not region:
                continue
            try:
                year = int(row["year"])
            except (KeyError, ValueError):
                continue
            source = (row.get("source") or "").strip()
            if not source:
                continue
            out.append((
                region,
                year,
                source,
                _parse_float(row.get("actual_yield", "")),
                _parse_float(row.get("pred_yield", "")),
                _parse_float(row.get("actual_area", "")),
                _parse_float(row.get("pred_area", "")),
                _parse_float(row.get("actual_production", "")),
                _parse_float(row.get("pred_production", "")),
            ))
    return out


async def sync_maize_predictions_streaming() -> AsyncIterator[dict]:
    """Re-ingest CSV into maize_predictions. Yields SSE-style progress events."""
    yield {"stage": "parsing", "pct": 10}
    try:
        records = await asyncio.to_thread(_parse_csv, CSV_PATH)
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Parse failed: {e}"}
        return

    if not records:
        yield {"stage": "error", "pct": 0, "message": "No rows in maize_predictions_tabpfn_full.csv"}
        return

    yield {"stage": "upserting", "pct": 50, "total": len(records)}
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.executemany(
                    """
                    INSERT INTO maize_predictions (
                        region, year, source,
                        actual_yield, pred_yield,
                        actual_area, pred_area,
                        actual_production, pred_production
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (region, year, source) DO UPDATE SET
                        actual_yield = EXCLUDED.actual_yield,
                        pred_yield = EXCLUDED.pred_yield,
                        actual_area = EXCLUDED.actual_area,
                        pred_area = EXCLUDED.pred_area,
                        actual_production = EXCLUDED.actual_production,
                        pred_production = EXCLUDED.pred_production
                    """,
                    records,
                )
        yield {
            "stage": "done",
            "pct": 100,
            "records_inserted": len(records),
            "message": f"Loaded {len(records)} maize prediction rows",
        }
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Database error: {e}"}
