"""
LightGBM yield/area/production predictions for maize.

Pipeline:
  1. Load X (climate_features_annual, z-scored) + Y (mofa_maize_regional) and
     INNER-join on (region, year). Climate covers 2000-2025; MOFA covers
     1999-2023, so the joined training range is 2000-2023.
  2. Engineer per-region temporal lag features:
       - lag1_{target}, lag2_{target}, lag3_{target}: prior year actuals
       - rolling5_{target}: 5-year rolling mean of priors (excluding current)
     These compensate for TabPFN's i.i.d. assumption — yield in year t is
     strongly tied to year t-1 in this dataset.
  3. Backtest via leave-one-year-out CV: for each year T in [2002, 2023],
     train on all other (region, year) rows and predict T. This gives an
     honest out-of-sample RMSE matching the TabPFN backtest scheme.
  4. Future predictions (2024-2026): train on the full 2000-2023 set, then
     predict using the 2024 / 2025 climate features. For 2026 we carry
     forward the 2025 climate features (per the user's choice — honest about
     missing climate data).
  5. Store every prediction in `maize_predictions_lightgbm`.

Region is fed as a categorical column so LightGBM learns region-specific
intercepts (Northern is structurally lower-yielding than Ashanti, etc).
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

import lightgbm as lgb
import numpy as np

from app.db.database import get_pool

TARGETS = ("avg_yield_mt_ha", "total_area_ha", "total_production_mt")
PRED_COLS = {
    "avg_yield_mt_ha": "pred_yield",
    "total_area_ha": "pred_area",
    "total_production_mt": "pred_production",
}
ACTUAL_COLS = {
    "avg_yield_mt_ha": "actual_yield",
    "total_area_ha": "actual_area",
    "total_production_mt": "actual_production",
}

# Climate features in `climate_features_annual` — same list as DB_COLUMNS in
# climate_service. Hardcoded here so this module doesn't import from there.
CLIMATE_FEATURES = [
    "t2m", "t2m_max", "t2m_min", "t2m_range",
    "t2m_dew", "t2m_wet",
    "rh2m", "qv2m", "ps",
    "allsky_sw_dwn", "clrsky_sw_dwn", "allsky_par_tot",
    "ws2m", "ws2m_max", "ws2m_min", "wd2m",
    "gwetroot", "gwettop", "gwetprof",
    "prectotcorr", "total_precip_mm", "avg_precip_mm", "rainy_days",
    "ndvi", "evi", "vi_quality",
    "red_reflectance", "nir_reflectance", "blue_reflectance", "mir_reflectance",
]

LGBM_PARAMS = dict(
    objective="regression",
    metric="rmse",
    # Conservative defaults for a small (~250-row) dataset. num_leaves capped
    # low to prevent leaf-wise overfit; min_data_in_leaf >= 5 guarantees each
    # leaf sees multiple region-years.
    num_leaves=15,
    learning_rate=0.05,
    n_estimators=400,
    min_data_in_leaf=5,
    feature_fraction=0.8,
    bagging_fraction=0.8,
    bagging_freq=5,
    verbose=-1,
)

FUTURE_YEARS = (2024, 2025, 2026)


async def sync_lightgbm_streaming() -> AsyncIterator[dict]:
    """Run the full LightGBM pipeline and write predictions to the DB."""
    yield {"stage": "loading", "pct": 3}

    pool = await get_pool()
    async with pool.acquire() as conn:
        climate = await conn.fetch(
            f"""
            SELECT region, year, {', '.join(CLIMATE_FEATURES)}
            FROM climate_features_annual
            ORDER BY region, year
            """
        )
        mofa = await conn.fetch(
            """
            SELECT region, year,
                   total_area_ha, avg_yield_mt_ha, total_production_mt
            FROM mofa_maize_regional
            ORDER BY region, year
            """
        )

    if not climate or not mofa:
        yield {
            "stage": "error", "pct": 0,
            "message": "Need both climate_features_annual and mofa_maize_regional populated.",
        }
        return

    # Run the actual training in a thread so we don't block the event loop.
    yield {"stage": "training", "pct": 15, "climate_rows": len(climate), "mofa_rows": len(mofa)}
    try:
        records = await asyncio.to_thread(_train_and_predict, climate, mofa)
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Training failed: {e}"}
        return

    if not records:
        yield {"stage": "error", "pct": 0, "message": "Training produced no predictions."}
        return

    yield {"stage": "upserting", "pct": 80, "total": len(records)}

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.executemany(
                """
                INSERT INTO maize_predictions_lightgbm
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
        "message": f"LightGBM produced {len(records)} predictions",
    }


# ─── Pure compute (offloaded to a thread) ───────────────────────────────────

def _train_and_predict(climate_rows, mofa_rows) -> list[tuple]:
    """
    Returns rows for INSERT. Each tuple matches the maize_predictions_lightgbm
    column order: (region, year, source, actual_yield, pred_yield,
    actual_area, pred_area, actual_production, pred_production).
    """
    # Index climate by (region, year) for fast feature lookup.
    climate_by_rk: dict[tuple[str, int], dict] = {}
    for r in climate_rows:
        climate_by_rk[(r["region"], r["year"])] = dict(r)

    # Index MOFA by region, year-sorted, for lag-feature construction.
    mofa_by_region: dict[str, list[dict]] = {}
    for r in mofa_rows:
        mofa_by_region.setdefault(r["region"], []).append(dict(r))
    for rs in mofa_by_region.values():
        rs.sort(key=lambda r: r["year"])

    # Build the joined training table. Each row needs:
    #   - climate features (X)
    #   - actual yield/area/production (Y)
    #   - lag features computed from prior MOFA rows for the same region
    #   - region (categorical), year (numeric)
    train_records: list[dict] = []
    for region, rows in mofa_by_region.items():
        for i, row in enumerate(rows):
            year = row["year"]
            climate = climate_by_rk.get((region, year))
            if climate is None:
                continue  # No matching climate row — skip.

            lag_feats = _lag_features(rows, i)
            rec = {
                "region": region,
                "year": year,
                **{k: climate[k] for k in CLIMATE_FEATURES},
                **lag_feats,
                "y_yield": row["avg_yield_mt_ha"],
                "y_area": row["total_area_ha"],
                "y_prod": row["total_production_mt"],
            }
            train_records.append(rec)

    if not train_records:
        return []

    # Region categorical encoding: stable integer per region, used by both
    # LightGBM (as a categorical feature) and the lag-feature lookup.
    regions_sorted = sorted({r["region"] for r in train_records})
    region_to_id = {r: i for i, r in enumerate(regions_sorted)}

    feature_cols = (
        ["region_id", "year"]
        + CLIMATE_FEATURES
        + ["lag1_yield", "lag2_yield", "lag3_yield", "rolling5_yield",
           "lag1_area", "lag1_prod"]
    )

    def _to_array(records: list[dict]) -> np.ndarray:
        out = np.full((len(records), len(feature_cols)), np.nan, dtype=float)
        for i, r in enumerate(records):
            for j, c in enumerate(feature_cols):
                if c == "region_id":
                    out[i, j] = region_to_id[r["region"]]
                elif c in r:
                    v = r[c]
                    out[i, j] = np.nan if v is None else float(v)
        return out

    # ─── Backtest: leave-one-year-out ──────────────────────────────────────
    out_records: list[tuple] = []
    years_with_data = sorted({r["year"] for r in train_records})

    for held_year in years_with_data:
        train_split = [r for r in train_records if r["year"] != held_year]
        test_split = [r for r in train_records if r["year"] == held_year]
        if not test_split or len(train_split) < 30:
            continue  # Not enough training data to fit a tree.

        X_tr = _to_array(train_split)
        X_te = _to_array(test_split)

        # Train one model per target.
        preds_per_target: dict[str, np.ndarray] = {}
        for tgt_key, train_col in (("yield", "y_yield"), ("area", "y_area"), ("prod", "y_prod")):
            y_tr = np.array([r[train_col] for r in train_split], dtype=float)
            mask = ~np.isnan(y_tr)
            if mask.sum() < 30:
                preds_per_target[tgt_key] = np.full(len(test_split), np.nan)
                continue
            model = lgb.LGBMRegressor(**LGBM_PARAMS)
            model.fit(
                X_tr[mask], y_tr[mask],
                feature_name=feature_cols,
                categorical_feature=["region_id"],
            )
            preds_per_target[tgt_key] = model.predict(X_te)

        for i, r in enumerate(test_split):
            out_records.append((
                r["region"], r["year"], "backtest",
                r["y_yield"], _safe(preds_per_target["yield"][i]),
                r["y_area"], _safe(preds_per_target["area"][i]),
                r["y_prod"], _safe(preds_per_target["prod"][i]),
            ))

    # ─── Future: train on everything, predict 2024-2026 ─────────────────────
    X_all = _to_array(train_records)

    final_models: dict[str, lgb.LGBMRegressor] = {}
    for tgt_key, train_col in (("yield", "y_yield"), ("area", "y_area"), ("prod", "y_prod")):
        y_all = np.array([r[train_col] for r in train_records], dtype=float)
        mask = ~np.isnan(y_all)
        if mask.sum() < 30:
            continue
        model = lgb.LGBMRegressor(**LGBM_PARAMS)
        model.fit(
            X_all[mask], y_all[mask],
            feature_name=feature_cols,
            categorical_feature=["region_id"],
        )
        final_models[tgt_key] = model

    # Build inference rows for each (region, future_year). Climate features
    # come from climate_features_annual where available; for years missing
    # (2026), we carry forward 2025 climate per the user's choice.
    for region in regions_sorted:
        rows = mofa_by_region.get(region, [])
        for fy in FUTURE_YEARS:
            climate = (
                climate_by_rk.get((region, fy))
                or climate_by_rk.get((region, fy - 1))  # Carry forward.
                or climate_by_rk.get((region, 2025))    # Last-resort fallback.
            )
            if climate is None:
                continue

            # Lag features: use the MOFA history we have.
            future_lags = _lag_features_for_year(rows, fy)
            inf_rec = {
                "region": region,
                "year": fy,
                **{k: climate[k] for k in CLIMATE_FEATURES},
                **future_lags,
            }
            X_inf = _to_array([inf_rec])

            preds = {}
            for tgt_key, model in final_models.items():
                preds[tgt_key] = float(model.predict(X_inf)[0])

            out_records.append((
                region, fy, "future_lightgbm",
                None, preds.get("yield"),
                None, preds.get("area"),
                None, preds.get("prod"),
            ))

    return out_records


def _lag_features(rows: list[dict], i: int) -> dict:
    """Lag features for the row at index i, using only earlier rows."""
    priors = rows[:i]
    return {
        "lag1_yield": _val(priors, -1, "avg_yield_mt_ha"),
        "lag2_yield": _val(priors, -2, "avg_yield_mt_ha"),
        "lag3_yield": _val(priors, -3, "avg_yield_mt_ha"),
        "rolling5_yield": _rolling_mean(priors, 5, "avg_yield_mt_ha"),
        "lag1_area": _val(priors, -1, "total_area_ha"),
        "lag1_prod": _val(priors, -1, "total_production_mt"),
    }


def _lag_features_for_year(rows: list[dict], target_year: int) -> dict:
    """Lag features for a year with no actual yet — uses all prior actuals."""
    priors = [r for r in rows if r["year"] < target_year]
    return {
        "lag1_yield": _val(priors, -1, "avg_yield_mt_ha"),
        "lag2_yield": _val(priors, -2, "avg_yield_mt_ha"),
        "lag3_yield": _val(priors, -3, "avg_yield_mt_ha"),
        "rolling5_yield": _rolling_mean(priors, 5, "avg_yield_mt_ha"),
        "lag1_area": _val(priors, -1, "total_area_ha"),
        "lag1_prod": _val(priors, -1, "total_production_mt"),
    }


def _val(rows: list[dict], offset: int, col: str):
    if abs(offset) > len(rows):
        return None
    v = rows[offset].get(col)
    return None if v is None else float(v)


def _rolling_mean(rows: list[dict], window: int, col: str):
    window_rows = rows[-window:]
    vals = [r[col] for r in window_rows if r[col] is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


def _safe(v) -> float | None:
    """Return None for NaN; otherwise pass float through."""
    try:
        if v is None:
            return None
        f = float(v)
        return None if np.isnan(f) else f
    except (TypeError, ValueError):
        return None
