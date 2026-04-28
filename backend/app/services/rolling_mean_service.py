"""
5-year rolling-mean baseline for maize yield / area / production.

For each (region, year), prediction = mean of that region's prior 5 years
of *actual* values from `mofa_maize_regional`. Skips rows with fewer than 2
prior years available (otherwise the "mean" is meaningless).

Backtest covers years where actuals exist (so we can compute residuals).
Future predictions (2024-2026): carry-forward — predict using the most
recent 5 actual years available, since by definition no future actuals exist
yet.

This baseline tells you whether *any* model is doing meaningful work above
"yield reverts to recent regional mean."
"""

from __future__ import annotations

from typing import AsyncIterator

from app.db.database import get_pool

# Future years to predict beyond the latest MOFA actual (2023). The user OK'd
# 2024-2026 as the horizon (matching the TabPFN ingest extent).
FUTURE_YEARS = (2024, 2025, 2026)


async def sync_rolling_mean_streaming() -> AsyncIterator[dict]:
    """Compute and upsert 5-yr rolling-mean predictions for all regions."""
    yield {"stage": "loading_actuals", "pct": 5}

    pool = await get_pool()
    async with pool.acquire() as conn:
        # Pull every (region, year) MOFA row into memory. ~280 rows — trivial.
        actuals = await conn.fetch(
            """
            SELECT region, year, total_area_ha, avg_yield_mt_ha, total_production_mt
            FROM mofa_maize_regional
            ORDER BY region, year
            """
        )

    if not actuals:
        yield {"stage": "error", "pct": 0, "message": "No MOFA maize data — sync the dataset first."}
        return

    # Group by region.
    by_region: dict[str, list[dict]] = {}
    for r in actuals:
        by_region.setdefault(r["region"], []).append(dict(r))

    yield {"stage": "computing", "pct": 30, "regions": len(by_region)}

    # Build prediction records.
    # `source` distinguishes 'backtest' (actual exists, we predict it for
    # evaluation) from 'rolling_mean' (forward extrapolation).
    records: list[tuple] = []
    for region, rows in by_region.items():
        rows.sort(key=lambda r: r["year"])

        # Backtest: for each year that has at least 2 prior years, predict
        # using the 5-year (or shorter) rolling mean of those priors.
        for i, row in enumerate(rows):
            priors = rows[max(0, i - 5) : i]
            if len(priors) < 2:
                continue
            pred_yield = _mean(priors, "avg_yield_mt_ha")
            pred_area = _mean(priors, "total_area_ha")
            pred_production = _mean(priors, "total_production_mt")
            records.append((
                region, row["year"], "backtest",
                row["avg_yield_mt_ha"], pred_yield,
                row["total_area_ha"], pred_area,
                row["total_production_mt"], pred_production,
            ))

        # Future: predict each FUTURE_YEAR using the most recent 5 actuals.
        # As we move forward through years, each prediction's window stays
        # anchored on actual MOFA data (we don't recursively use prior
        # predictions — that would inflate confidence and is a different
        # method).
        last_5 = rows[-5:]
        if len(last_5) < 2:
            continue
        pred_yield_f = _mean(last_5, "avg_yield_mt_ha")
        pred_area_f = _mean(last_5, "total_area_ha")
        pred_production_f = _mean(last_5, "total_production_mt")
        for fy in FUTURE_YEARS:
            records.append((
                region, fy, "rolling_mean",
                None, pred_yield_f,
                None, pred_area_f,
                None, pred_production_f,
            ))

    if not records:
        yield {"stage": "error", "pct": 0, "message": "No predictions could be computed (insufficient history)."}
        return

    yield {"stage": "upserting", "pct": 70, "total": len(records)}

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.executemany(
                """
                INSERT INTO maize_predictions_rolling_mean
                    (region, year, source,
                     actual_yield, pred_yield,
                     actual_area, pred_area,
                     actual_production, pred_production)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
        "message": f"Computed {len(records)} rolling-mean predictions",
    }


def _mean(rows: list[dict], col: str) -> float | None:
    """Mean of `col` over rows, ignoring NULLs. Returns None if all NULL."""
    vals = [r[col] for r in rows if r[col] is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)
