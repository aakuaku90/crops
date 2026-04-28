"""
Cross-model evaluation for maize yield/area/production predictions.

Pulls backtest rows from the three prediction tables (TabPFN, LightGBM, 5-yr
rolling mean), joins on (region, year), and computes side-by-side metrics on
the common set so the comparison is apples-to-apples — even when one model
backtest covers different years than another, only the intersection is scored.

Metrics:
  - RMSE     : sqrt(mean((y - yhat)^2)). Penalizes large errors.
  - MAE      : mean(|y - yhat|). Robust central error.
  - sMAPE %  : mean(|y - yhat| / ((|y| + |yhat|) / 2)) * 100. Bounded 0-200%.
               Doesn't explode near zero like vanilla MAPE — important for
               area/production where some regions have very small actuals.
  - R^2      : 1 - SS_res / SS_tot.
  - Bias     : mean(yhat - y). Negative = under-forecasts on average.
  - MASE     : MAE / MAE_naive, where MAE_naive is the in-sample one-step-ahead
               (year-over-year) error of the actual series. <1 beats naive.

Paired comparison: for any two models on the common set, we compute the mean
of squared-error differences `d_t = e1_t^2 - e2_t^2` and the t-statistic
`mean(d) / (std(d) / sqrt(n))`. This is the Diebold-Mariano statistic with no
HAC adjustment (with n_models comparisons on ~250 paired errors, the simpler
form is fine — for academic rigor the full DM with autocorrelation correction
would be needed).
"""

from __future__ import annotations

import math
from typing import Iterable

from app.db.database import get_pool

MODELS = (
    ("tabpfn", "maize_predictions"),
    ("lightgbm", "maize_predictions_lightgbm"),
    ("rolling_mean", "maize_predictions_rolling_mean"),
)

TARGETS = ("yield", "area", "production")
ACTUAL_COL = {
    "yield": "actual_yield",
    "area": "actual_area",
    "production": "actual_production",
}
PRED_COL = {
    "yield": "pred_yield",
    "area": "pred_area",
    "production": "pred_production",
}


async def compare_maize_models() -> dict:
    """Return per-model metrics + pairwise DM-style test results."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Pull (region, year, actual_*, pred_*) for each model's backtest.
        per_model: dict[str, dict[tuple[str, int], dict]] = {}
        for label, table in MODELS:
            rows = await conn.fetch(
                f"""
                SELECT region, year,
                       actual_yield, pred_yield,
                       actual_area, pred_area,
                       actual_production, pred_production
                FROM {table}
                WHERE source = 'backtest'
                """
            )
            per_model[label] = {(r["region"], r["year"]): dict(r) for r in rows}

    if any(not d for d in per_model.values()):
        missing = [k for k, v in per_model.items() if not v]
        return {"error": f"No backtest data for: {', '.join(missing)}. Sync those models first."}

    # Common evaluation set: (region, year) keys present in all three tables.
    common_keys = set.intersection(*(set(d.keys()) for d in per_model.values()))

    # Plus per-model count on its own backtest (for context, not used for metrics).
    own_counts = {label: len(d) for label, d in per_model.items()}

    if not common_keys:
        return {"error": "No (region, year) pairs are present across all three model backtests."}

    # Sort keys deterministically — needed for the in-sample naive MAE used by MASE.
    keys = sorted(common_keys)

    # Per-target metrics for each model.
    per_target: dict[str, dict] = {}
    for tgt in TARGETS:
        per_target[tgt] = _evaluate_target(per_model, keys, tgt)

    return {
        "common_count": len(keys),
        "own_counts": own_counts,
        "models": [label for label, _ in MODELS],
        "metrics": per_target,
    }


def _evaluate_target(
    per_model: dict[str, dict[tuple[str, int], dict]],
    keys: list[tuple[str, int]],
    target: str,
) -> dict:
    """Compute metrics for one target across all models."""
    actual_col = ACTUAL_COL[target]
    pred_col = PRED_COL[target]

    # Filter keys to those where every model has a non-null prediction AND
    # the actual exists. Naive MAE for MASE comes from the actuals.
    actuals: dict[tuple[str, int], float] = {}
    preds: dict[str, dict[tuple[str, int], float]] = {label: {} for label in per_model}

    for k in keys:
        actual_vals = [per_model[label][k].get(actual_col) for label in per_model]
        pred_vals = [per_model[label][k].get(pred_col) for label in per_model]
        if any(v is None for v in actual_vals) or any(v is None for v in pred_vals):
            continue
        # Actuals should match across models (they pull from the same MOFA
        # source) — but we use the first one defensively.
        actuals[k] = float(actual_vals[0])
        for label, p in zip(per_model.keys(), pred_vals, strict=True):
            preds[label][k] = float(p)

    if len(actuals) < 5:
        return {"error": f"Too few common rows ({len(actuals)}) to evaluate {target}."}

    eval_keys = sorted(actuals.keys())

    # Naive baseline for MASE: per-region year-over-year absolute change.
    # If a region has only one observation in the eval set we drop it from
    # the naive denominator.
    naive_diffs: list[float] = []
    by_region: dict[str, list[tuple[int, float]]] = {}
    for region, year in eval_keys:
        by_region.setdefault(region, []).append((year, actuals[(region, year)]))
    for region, rows in by_region.items():
        rows.sort(key=lambda r: r[0])
        for i in range(1, len(rows)):
            naive_diffs.append(abs(rows[i][1] - rows[i - 1][1]))
    naive_mae = sum(naive_diffs) / len(naive_diffs) if naive_diffs else None

    # Per-model metrics.
    per_model_metrics: dict[str, dict] = {}
    sq_errors: dict[str, list[float]] = {}  # for paired comparison

    for label, p_dict in preds.items():
        errs = [p_dict[k] - actuals[k] for k in eval_keys]
        abs_errs = [abs(e) for e in errs]
        sq = [e * e for e in errs]
        sq_errors[label] = sq

        n = len(errs)
        rmse = math.sqrt(sum(sq) / n)
        mae = sum(abs_errs) / n
        bias = sum(errs) / n

        # sMAPE — symmetric variant. Denominator is the average magnitude of
        # actual + predicted, so it can't explode when actuals are small. Skip
        # rows where both are zero (denominator = 0).
        smape_terms: list[float] = []
        for k in eval_keys:
            denom = (abs(actuals[k]) + abs(p_dict[k])) / 2.0
            if denom > 0:
                smape_terms.append(abs(p_dict[k] - actuals[k]) / denom)
        smape = (sum(smape_terms) / len(smape_terms)) * 100 if smape_terms else None

        # R^2 — 1 - SS_res / SS_tot.
        mean_actual = sum(actuals[k] for k in eval_keys) / n
        ss_tot = sum((actuals[k] - mean_actual) ** 2 for k in eval_keys)
        ss_res = sum(sq)
        r2 = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else None

        mase = (mae / naive_mae) if naive_mae and naive_mae > 0 else None

        per_model_metrics[label] = {
            "n": n,
            "rmse": rmse,
            "mae": mae,
            "smape_pct": smape,
            "r2": r2,
            "bias": bias,
            "mase": mase,
        }

    # Pairwise paired-error tests. For each (a, b) pair we report:
    #   diff = mean(sq_a - sq_b)  — positive = a's MSE is larger (b is better)
    #   t = diff / (std_diff / sqrt(n)) — DM-style statistic
    #   p ≈ 2 * (1 - Phi(|t|))   — approximate two-sided p-value via normal CDF
    pair_tests: list[dict] = []
    labels = list(preds.keys())
    for i in range(len(labels)):
        for j in range(i + 1, len(labels)):
            a, b = labels[i], labels[j]
            d = [sq_errors[a][k] - sq_errors[b][k] for k in range(len(eval_keys))]
            n = len(d)
            mean_d = sum(d) / n
            var_d = sum((x - mean_d) ** 2 for x in d) / max(1, n - 1)
            std_d = math.sqrt(var_d) if var_d > 0 else 0.0
            t_stat = mean_d / (std_d / math.sqrt(n)) if std_d > 0 else 0.0
            # Approximate p-value via standard normal (n is large enough).
            p_value = 2 * (1 - _standard_normal_cdf(abs(t_stat)))
            # mean_d = mean(sq_a - sq_b). Positive = a has larger errors → b wins.
            winner = b if mean_d > 0 else a if mean_d < 0 else "tie"
            pair_tests.append({
                "model_a": a,
                "model_b": b,
                "mean_sq_diff": mean_d,
                "t_statistic": t_stat,
                "p_value": p_value,
                "winner": winner,  # the model with the smaller mean squared error
            })

    return {
        "common_n": len(eval_keys),
        "naive_mae": naive_mae,
        "per_model": per_model_metrics,
        "pair_tests": pair_tests,
    }


def _standard_normal_cdf(z: float) -> float:
    """Phi(z) via erf — sufficient precision for p-values to ~5 decimals."""
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))
