"""
Per-market maize price forecast (Prophet, CPI exogenous regressor).

Pipeline per market (ones with >= MIN_HISTORY_MONTHS of monthly data):
  1. Backtest pass — hold out the last HOLDOUT_MONTHS (12). Fit Prophet on the
     rest with CPI as a regressor. Predict the 12-month holdout to compute an
     honest, out-of-sample RMSE / MAE / MAPE.
  2. Production pass — re-fit on the full history. Predict the next
     FORECAST_MONTHS (12). Also captures in-sample fit over the training span.
  3. Persist all rows tagged by `phase`:
       train    — in-sample fit + actuals
       backtest — out-of-sample 12-mo + actuals
       forecast — future 12-mo (actuals NULL)

Two global pre-passes (run once, cached, used by every market):

  * CPI Prophet — fit on log(monthly Ghana food/general CPI), project
    CPI_HORIZON_MONTHS (24) ahead. Used as an exogenous regressor in each
    market's price model. The CPI's 95% interval is converted to per-step
    sigma and propagated into each market's prediction CIs:
        sigma_with_cpi = sqrt(sigma_price^2 + (beta_cpi * sigma_cpi)^2)

  * FX Prophet — fit on log(monthly mean GHS-per-USD ratio implied by maize
    food_prices rows), project FORECAST_MONTHS (12) ahead. USD predictions
    are derived by dividing the GHS forecast by the FX forecast, with a
    worst-case CI combination:
        pred_usd_lower = pred_ghs_lower / fx_upper
        pred_usd_upper = pred_ghs_upper / fx_lower
    History months use the observed FX from food_prices, not the projected.
"""

from __future__ import annotations

import asyncio
import logging
import math
from datetime import date
from typing import AsyncIterator

import numpy as np
import pandas as pd

from app.db.database import get_pool

log = logging.getLogger(__name__)

MIN_HISTORY_MONTHS = 36
HOLDOUT_MONTHS = 12
FORECAST_MONTHS = 12
CPI_HORIZON_MONTHS = HOLDOUT_MONTHS + FORECAST_MONTHS  # 24
COMMODITY_LIKE = "Maize%"  # WFP names: "Maize", "Maize (white)", etc.
PREFERRED_CPI_ITEMS = (
    "Consumer Prices, Food Indices (2015 = 100)",
    "Consumer Prices, General Indices (2015 = 100)",
)


def _silence_prophet():
    """Prophet/cmdstanpy is INFO-chatty; quiet it for sync streams."""
    for name in ("cmdstanpy", "prophet", "prophet.plot"):
        logging.getLogger(name).setLevel(logging.WARNING)


# ─── Prophet helpers ──────────────────────────────────────────────────────────


def _fit_prophet_log(monthly: pd.DataFrame, horizon_months: int) -> pd.DataFrame:
    """Fit Prophet on log(value); return ds/yhat/yhat_lower/yhat_upper/sigma in
    natural units, covering training + horizon_months."""
    from prophet import Prophet

    df = monthly.rename(columns={"date": "ds", "value": "y"}).copy()
    df["y"] = np.log(df["y"].clip(lower=1e-9))

    m = Prophet(
        seasonality_mode="multiplicative",
        weekly_seasonality=False,
        daily_seasonality=False,
        yearly_seasonality=True,
        interval_width=0.95,
    )
    m.fit(df)

    future = m.make_future_dataframe(periods=horizon_months, freq="MS")
    fc = m.predict(future)[["ds", "yhat", "yhat_lower", "yhat_upper"]].copy()
    for col in ("yhat", "yhat_lower", "yhat_upper"):
        fc[col] = np.exp(fc[col])
    # Approximate per-step std from the 95% CI width (~ ±1.96 sigma).
    fc["sigma"] = (fc["yhat_upper"] - fc["yhat_lower"]) / 3.92
    return fc


def _fit_prophet_with_cpi(
    monthly: pd.DataFrame,
    cpi_history: pd.DataFrame,
    cpi_future: pd.DataFrame,
    horizon_months: int,
) -> tuple[pd.DataFrame, float]:
    """Fit Prophet with CPI as an unstandardized exogenous regressor.

    cpi_history: ds → cpi for past months (training).
    cpi_future:  ds → cpi for projection months (must cover horizon).

    Returns (forecast_df, beta_cpi). forecast_df has ds, yhat, yhat_lower,
    yhat_upper, sigma. beta_cpi is the natural-units price-per-CPI coefficient.
    """
    from prophet import Prophet

    train_df = monthly.rename(columns={"date": "ds", "value": "y"}).merge(
        cpi_history, on="ds", how="left"
    )
    train_df = train_df.dropna(subset=["y", "cpi"])
    if len(train_df) < MIN_HISTORY_MONTHS // 2:
        raise ValueError(
            f"Not enough overlapping price+CPI months ({len(train_df)})"
        )

    m = Prophet(
        seasonality_mode="multiplicative",
        weekly_seasonality=False,
        daily_seasonality=False,
        yearly_seasonality=True,
        interval_width=0.95,
    )
    # standardize=False so beta is in natural price-per-CPI units, which lets
    # us combine it with sigma_cpi (also natural) when propagating uncertainty.
    m.add_regressor("cpi", standardize=False)
    m.fit(train_df)

    future = m.make_future_dataframe(periods=horizon_months, freq="MS")
    # Coalesce CPI: history months come from cpi_history; future months from
    # cpi_future. ffill/bfill anything still missing (rare gaps).
    future = future.merge(cpi_history, on="ds", how="left").merge(
        cpi_future.rename(columns={"cpi": "cpi_proj"}), on="ds", how="left"
    )
    future["cpi"] = future["cpi"].fillna(future["cpi_proj"])
    future = future.drop(columns=["cpi_proj"])
    future["cpi"] = future["cpi"].ffill().bfill()

    fc = m.predict(future)[["ds", "yhat", "yhat_lower", "yhat_upper"]].copy()
    fc["sigma"] = (fc["yhat_upper"] - fc["yhat_lower"]) / 3.92

    # Prophet stores betas in m.params['beta'] with shape (n_samples, n_betas).
    # MAP fit (no MCMC) → n_samples = 1; CPI is the only regressor → index 0.
    beta_cpi = float(m.params["beta"][0, 0])
    return fc, beta_cpi


# ─── Data loaders ─────────────────────────────────────────────────────────────


async def _load_maize_prices() -> pd.DataFrame:
    """One-shot DB pull. Returns long-form rows: date, market, region, price (GHS),
    usd_price, unit. Filtered to GHS-quoted maize records only."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT date, market_name, region, price, usd_price, unit
            FROM food_prices
            WHERE commodity_name ILIKE $1
              AND currency = 'GHS'
              AND price IS NOT NULL
            ORDER BY market_name, date
            """,
            COMMODITY_LIKE,
        )
    if not rows:
        return pd.DataFrame(
            columns=["date", "market", "region", "price", "usd_price", "unit"]
        )
    df = pd.DataFrame(
        [
            {
                "date": r["date"],
                "market": r["market_name"],
                "region": r["region"],
                "price": float(r["price"]) if r["price"] is not None else None,
                "usd_price": float(r["usd_price"]) if r["usd_price"] is not None else None,
                "unit": r["unit"],
            }
            for r in rows
        ]
    )
    df["date"] = pd.to_datetime(df["date"]).dt.to_period("M").dt.to_timestamp()
    return df


async def _load_cpi() -> pd.DataFrame:
    """Monthly Ghana CPI as ds (period-month) → cpi. Prefer Food CPI; fall back
    to General CPI; return empty if neither has monthly resolution."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT start_date, item, value, months
            FROM fao_cpi
            WHERE item = ANY($1::text[])
              AND value IS NOT NULL
              AND months IS NOT NULL
              AND months NOT IN ('Annual value', 'Year')
            ORDER BY item, start_date
            """,
            list(PREFERRED_CPI_ITEMS),
        )
    if not rows:
        return pd.DataFrame(columns=["ds", "cpi"])

    df = pd.DataFrame(
        [
            {"ds": r["start_date"], "item": r["item"], "value": float(r["value"])}
            for r in rows
        ]
    )
    df["ds"] = pd.to_datetime(df["ds"]).dt.to_period("M").dt.to_timestamp()

    # Prefer Food CPI; only fall back if Food CPI returned nothing.
    food = df[df["item"] == PREFERRED_CPI_ITEMS[0]]
    chosen = food if len(food) else df[df["item"] == PREFERRED_CPI_ITEMS[1]]
    out = (
        chosen.groupby("ds", as_index=False)["value"]
        .mean()
        .rename(columns={"value": "cpi"})
        .sort_values("ds")
        .reset_index(drop=True)
    )
    return out


# ─── Per-market modeling ──────────────────────────────────────────────────────


def _market_monthly(prices: pd.DataFrame, market: str) -> pd.DataFrame:
    """Aggregate a market's prices to monthly mean GHS, restricted to the
    market's modal unit (so we don't average prices across kg vs sack)."""
    sub = prices[prices["market"] == market].copy()
    if len(sub) == 0:
        return pd.DataFrame(columns=["date", "value", "usd_price", "region", "unit"])
    modal_unit = sub["unit"].mode().iat[0] if not sub["unit"].mode().empty else None
    if modal_unit is not None:
        sub = sub[sub["unit"] == modal_unit]
    region = sub["region"].mode().iat[0] if not sub["region"].mode().empty else None
    monthly = (
        sub.groupby("date", as_index=False)
        .agg(value=("price", "mean"), usd_price=("usd_price", "mean"))
        .sort_values("date")
        .reset_index(drop=True)
    )
    monthly["region"] = region
    monthly["unit"] = modal_unit
    return monthly


def _build_fx_history(prices: pd.DataFrame) -> pd.DataFrame:
    """Monthly mean implied GHS/USD rate across ALL maize records."""
    sub = prices.dropna(subset=["price", "usd_price"]).copy()
    sub = sub[sub["usd_price"] > 0]
    sub["fx"] = sub["price"] / sub["usd_price"]
    return (
        sub.groupby("date", as_index=False)["fx"]
        .mean()
        .rename(columns={"date": "ds"})
        .sort_values("ds")
        .reset_index(drop=True)
    )


def _backtest_metrics(actual: np.ndarray, pred: np.ndarray) -> dict[str, float | None]:
    """RMSE, MAE, MAPE on aligned arrays. Skips rows where either is NaN."""
    mask = (~np.isnan(actual)) & (~np.isnan(pred))
    if mask.sum() == 0:
        return {"rmse": None, "mae": None, "mape": None}
    a, p = actual[mask], pred[mask]
    rmse = float(np.sqrt(np.mean((a - p) ** 2)))
    mae = float(np.mean(np.abs(a - p)))
    nonzero = a != 0
    mape = float(np.mean(np.abs((a[nonzero] - p[nonzero]) / a[nonzero])) * 100) if nonzero.any() else None
    return {"rmse": rmse, "mae": mae, "mape": mape}


def _inflate_with_cpi(
    pred: pd.DataFrame,
    cpi_sigma: pd.DataFrame,
    beta_cpi: float,
) -> pd.DataFrame:
    """First-order propagation: sigma_total = sqrt(sigma_price^2 + (beta * sigma_cpi)^2).
    Rebuild lower/upper from the inflated sigma at 95%."""
    out = pred.merge(cpi_sigma.rename(columns={"sigma": "sigma_cpi"}), on="ds", how="left")
    out["sigma_cpi"] = out["sigma_cpi"].fillna(0.0)
    out["sigma_total"] = np.sqrt(out["sigma"] ** 2 + (beta_cpi * out["sigma_cpi"]) ** 2)
    out["yhat_lower"] = out["yhat"] - 1.96 * out["sigma_total"]
    out["yhat_upper"] = out["yhat"] + 1.96 * out["sigma_total"]
    out["yhat_lower"] = out["yhat_lower"].clip(lower=0.0)
    out = out.drop(columns=["sigma_cpi", "sigma_total"])
    return out


def _run_market(
    market: str,
    monthly: pd.DataFrame,
    cpi_history: pd.DataFrame,
    cpi_future: pd.DataFrame,
    cpi_sigma_future: pd.DataFrame,
    fx_history: pd.DataFrame,  # ds → fx (observed)
    fx_future: pd.DataFrame,   # ds → fx, fx_lower, fx_upper (projected)
) -> tuple[list[tuple], dict] | None:
    """Run backtest + production passes for one market. Returns (rows, meta_dict)
    or None if the market is too short."""
    if len(monthly) < MIN_HISTORY_MONTHS:
        return None

    region = monthly["region"].iat[0] if "region" in monthly.columns else None
    unit = monthly["unit"].iat[0] if "unit" in monthly.columns else None
    train_input = monthly[["date", "value"]].copy()

    # ── Holdout selection by CALENDAR DATE, not row index ─────────────────────
    # Markets with gaps in the recent past would otherwise get the last 12
    # *records* (which may span 13-14 calendar months), and Prophet would
    # only forecast 12 *calendar* months past training, producing a shape
    # mismatch in metrics. Date-based selection is robust to gaps.
    last_actual_date = train_input["date"].max()
    backtest_start = last_actual_date - pd.offsets.MonthBegin(HOLDOUT_MONTHS - 1)
    holdout_mask = train_input["date"] >= backtest_start
    train_bt = train_input[~holdout_mask]
    actual_holdout = train_input[holdout_mask].sort_values("date")

    # ── Backtest pass: train on pre-holdout months, predict forward ──
    # Predict at least HOLDOUT_MONTHS ahead so even with training-side gaps
    # we cover the holdout window fully.
    bt_horizon = HOLDOUT_MONTHS + 2  # small buffer for gap markets
    fc_bt, beta_bt = _fit_prophet_with_cpi(
        train_bt, cpi_history, cpi_future, bt_horizon
    )
    fc_bt = _inflate_with_cpi(fc_bt, cpi_sigma_future, beta_bt)

    # Match preds to actuals on the date intersection.
    fc_bt_indexed = fc_bt.set_index("ds")
    matched = actual_holdout.merge(
        fc_bt[["ds", "yhat", "yhat_lower", "yhat_upper"]],
        left_on="date", right_on="ds", how="inner",
    )
    metrics = _backtest_metrics(
        matched["value"].to_numpy(),
        matched["yhat"].to_numpy(),
    )
    fc_bt_holdout = fc_bt_indexed

    # ── Production pass: fit on full history, project FORECAST_MONTHS ahead ──
    fc_prod, beta_prod = _fit_prophet_with_cpi(
        train_input, cpi_history, cpi_future, FORECAST_MONTHS
    )
    fc_prod = _inflate_with_cpi(fc_prod, cpi_sigma_future, beta_prod)

    # ── Build output rows ──
    last_history = train_input["date"].max()
    forecast_horizon = fc_prod["ds"].max()

    # Lookup observed FX & USD per market-month (history). For future months,
    # use projected FX. NB: monthly already carries observed mean usd_price.
    history_actuals = monthly[["date", "value", "usd_price"]].set_index("date")
    fx_obs = fx_history.set_index("ds")  # ds → fx
    fx_proj = fx_future.set_index("ds")  # ds → fx, fx_lower, fx_upper

    # CPI for each row (best effort; coalesced from history then future).
    cpi_combined = pd.concat([cpi_history, cpi_future], ignore_index=True)
    cpi_combined = cpi_combined.drop_duplicates(subset=["ds"], keep="first").set_index("ds")

    rows: list[tuple] = []

    def usd_from_ghs(ghs_pred: float, ghs_lo: float, ghs_hi: float, ds) -> tuple[float | None, float | None, float | None]:
        """Convert pred_ghs ± to USD using projected FX on future months,
        observed FX on history months. Worst-case CI combination."""
        if ds in fx_proj.index:
            fx_pt = float(fx_proj.loc[ds, "fx"])
            fx_lo = float(fx_proj.loc[ds, "fx_lower"])
            fx_hi = float(fx_proj.loc[ds, "fx_upper"])
        elif ds in fx_obs.index:
            fx_pt = float(fx_obs.loc[ds, "fx"])
            fx_lo = fx_pt
            fx_hi = fx_pt
        else:
            return (None, None, None)
        if fx_pt <= 0 or fx_lo <= 0 or fx_hi <= 0:
            return (None, None, None)
        pred_usd = ghs_pred / fx_pt
        pred_usd_lo = ghs_lo / fx_hi  # worst case: lower price ÷ higher FX
        pred_usd_hi = ghs_hi / fx_lo
        return (pred_usd, pred_usd_lo, pred_usd_hi)

    # Production-pass output spans (training + forecast). Phase labelling is
    # by calendar date (not row index) so it stays consistent with the
    # date-based holdout selection above:
    #   - rows < backtest_start          → 'train'
    #   - rows in [backtest_start, last_history] → 'backtest' (overwrite pred
    #     with the truly out-of-sample backtest prediction when available)
    #   - rows > last_history            → 'forecast'
    for _, r in fc_prod.iterrows():
        ds = r["ds"]
        ghs_pred = float(r["yhat"])
        ghs_lo = float(r["yhat_lower"])
        ghs_hi = float(r["yhat_upper"])

        if ds <= last_history:
            phase = "backtest" if ds >= backtest_start else "train"
            actual_row = history_actuals.loc[ds] if ds in history_actuals.index else None
            actual_ghs = float(actual_row["value"]) if actual_row is not None else None
            actual_usd = (
                float(actual_row["usd_price"])
                if actual_row is not None and pd.notna(actual_row["usd_price"])
                else None
            )
            if phase == "backtest" and ds in fc_bt_holdout.index:
                # Overwrite in-sample pred with the truly out-of-sample one.
                bt_row = fc_bt_holdout.loc[ds]
                ghs_pred = float(bt_row["yhat"])
                ghs_lo = float(bt_row["yhat_lower"])
                ghs_hi = float(bt_row["yhat_upper"])
        else:
            phase = "forecast"
            actual_ghs = None
            actual_usd = None

        usd_pred, usd_lo, usd_hi = usd_from_ghs(ghs_pred, ghs_lo, ghs_hi, ds)
        cpi_value = (
            float(cpi_combined.loc[ds, "cpi"])
            if ds in cpi_combined.index
            else None
        )

        rows.append(
            (
                market,
                region,
                ds.date() if hasattr(ds, "date") else ds,
                phase,
                actual_ghs,
                actual_usd,
                ghs_pred,
                ghs_lo,
                ghs_hi,
                usd_pred,
                usd_lo,
                usd_hi,
                cpi_value,
                unit,
            )
        )

    meta = {
        "market": market,
        "region": region,
        "unit": unit,
        "n_train": int((~holdout_mask).sum()),
        # n_backtest counts actuals successfully matched to an out-of-sample
        # prediction. May be < HOLDOUT_MONTHS for markets with recent gaps.
        "n_backtest": int(len(matched)),
        "backtest_rmse_ghs": metrics["rmse"],
        "backtest_mae_ghs": metrics["mae"],
        "backtest_mape_pct": metrics["mape"],
        "cpi_beta": beta_prod,
        "last_history_date": last_history.date() if hasattr(last_history, "date") else last_history,
        "forecast_horizon_date": forecast_horizon.date() if hasattr(forecast_horizon, "date") else forecast_horizon,
    }
    return rows, meta


# ─── Top-level streaming sync ─────────────────────────────────────────────────


def _run_pipeline_sync(prices: pd.DataFrame, cpi: pd.DataFrame) -> tuple[list[tuple], list[dict], list[str]]:
    """All Prophet fitting happens here, off the event loop. Returns
    (price_rows, meta_rows, skipped_markets)."""
    _silence_prophet()

    # ── Global CPI projection ────────────────────────────────────────────────
    if len(cpi) < MIN_HISTORY_MONTHS:
        raise ValueError(
            f"Need >= {MIN_HISTORY_MONTHS} months of CPI; have {len(cpi)}. "
            "Sync FAO CPI first."
        )
    cpi_input = cpi.rename(columns={"ds": "date", "cpi": "value"})
    cpi_pred = _fit_prophet_log(cpi_input, CPI_HORIZON_MONTHS)
    # cpi_history covers training months (use observed values), cpi_future is
    # the projected horizon (covers backtest training extension + future).
    cpi_history = cpi.copy()
    cpi_future_only = cpi_pred[cpi_pred["ds"] > cpi["ds"].max()][
        ["ds", "yhat", "sigma"]
    ].rename(columns={"yhat": "cpi"})
    cpi_future = cpi_future_only[["ds", "cpi"]]
    cpi_sigma_future = cpi_future_only[["ds", "sigma"]]
    # For history months, sigma_cpi is essentially 0 (we know CPI exactly).
    cpi_sigma_history = pd.DataFrame({"ds": cpi["ds"], "sigma": 0.0})
    cpi_sigma_full = pd.concat([cpi_sigma_history, cpi_sigma_future], ignore_index=True)

    # ── Global FX projection ─────────────────────────────────────────────────
    fx_history = _build_fx_history(prices)
    if len(fx_history) >= MIN_HISTORY_MONTHS:
        fx_input = fx_history.rename(columns={"ds": "date", "fx": "value"})
        fx_pred = _fit_prophet_log(fx_input, FORECAST_MONTHS)
        fx_future = fx_pred[fx_pred["ds"] > fx_history["ds"].max()][
            ["ds", "yhat", "yhat_lower", "yhat_upper"]
        ].rename(
            columns={"yhat": "fx", "yhat_lower": "fx_lower", "yhat_upper": "fx_upper"}
        )
    else:
        # Not enough FX history → carry forward the last observed rate as a
        # flat projection. CIs collapse to the point.
        last_fx = float(fx_history["fx"].iat[-1]) if len(fx_history) else None
        fx_future = pd.DataFrame(columns=["ds", "fx", "fx_lower", "fx_upper"])
        if last_fx is not None:
            future_dates = pd.date_range(
                start=fx_history["ds"].max() + pd.offsets.MonthBegin(1),
                periods=FORECAST_MONTHS,
                freq="MS",
            )
            fx_future = pd.DataFrame(
                {
                    "ds": future_dates,
                    "fx": last_fx,
                    "fx_lower": last_fx,
                    "fx_upper": last_fx,
                }
            )

    # ── Per-market loop ──────────────────────────────────────────────────────
    markets = sorted(prices["market"].dropna().unique().tolist())
    price_rows: list[tuple] = []
    meta_rows: list[dict] = []
    skipped: list[str] = []

    for market in markets:
        monthly = _market_monthly(prices, market)
        if len(monthly) < MIN_HISTORY_MONTHS:
            skipped.append(market)
            continue
        try:
            result = _run_market(
                market,
                monthly,
                cpi_history,
                cpi_future,
                cpi_sigma_full,
                fx_history,
                fx_future,
            )
        except Exception as e:
            log.warning("Skipping %s: %s", market, e)
            skipped.append(market)
            continue
        if result is None:
            skipped.append(market)
            continue
        rows, meta = result
        price_rows.extend(rows)
        meta_rows.append(meta)

    return price_rows, meta_rows, skipped


async def sync_maize_price_forecast_streaming() -> AsyncIterator[dict]:
    """Re-fit per-market Prophet forecasts and persist. Yields SSE events."""
    yield {"stage": "loading", "pct": 5, "message": "Loading prices and CPI"}

    try:
        prices, cpi = await asyncio.gather(_load_maize_prices(), _load_cpi())
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Load failed: {e}"}
        return

    if len(prices) == 0:
        yield {"stage": "error", "pct": 0, "message": "No maize prices in DB"}
        return
    if len(cpi) < MIN_HISTORY_MONTHS:
        yield {
            "stage": "error",
            "pct": 0,
            "message": f"Need >= {MIN_HISTORY_MONTHS} months of CPI history; "
                       f"have {len(cpi)}. Sync FAO CPI first.",
        }
        return

    n_markets_total = prices["market"].nunique()
    yield {
        "stage": "fitting",
        "pct": 15,
        "message": f"Fitting Prophet for {n_markets_total} markets (~3-5 min)",
    }

    try:
        price_rows, meta_rows, skipped = await asyncio.to_thread(
            _run_pipeline_sync, prices, cpi
        )
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Modeling failed: {e}"}
        return

    if not price_rows:
        yield {
            "stage": "error",
            "pct": 0,
            "message": (
                "No markets passed the 36-month minimum-history threshold "
                f"(skipped: {len(skipped)})"
            ),
        }
        return

    yield {
        "stage": "writing",
        "pct": 80,
        "message": f"Writing {len(price_rows)} forecast rows for {len(meta_rows)} markets",
    }

    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("TRUNCATE maize_price_forecast")
                await conn.execute("TRUNCATE maize_price_forecast_meta")
                await conn.executemany(
                    """
                    INSERT INTO maize_price_forecast (
                        market, region, month_date, phase,
                        actual_price_ghs, actual_price_usd,
                        pred_price_ghs, pred_price_lower_ghs, pred_price_upper_ghs,
                        pred_price_usd, pred_price_lower_usd, pred_price_upper_usd,
                        cpi_value, unit
                    )
                    VALUES (
                        $1, $2, $3, $4,
                        $5, $6,
                        $7, $8, $9,
                        $10, $11, $12,
                        $13, $14
                    )
                    """,
                    price_rows,
                )
                await conn.executemany(
                    """
                    INSERT INTO maize_price_forecast_meta (
                        market, region, unit, n_train, n_backtest,
                        backtest_rmse_ghs, backtest_mae_ghs, backtest_mape_pct,
                        cpi_beta, last_history_date, forecast_horizon_date
                    )
                    VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7, $8,
                        $9, $10, $11
                    )
                    """,
                    [
                        (
                            m["market"], m["region"], m["unit"],
                            m["n_train"], m["n_backtest"],
                            m["backtest_rmse_ghs"], m["backtest_mae_ghs"], m["backtest_mape_pct"],
                            m["cpi_beta"], m["last_history_date"], m["forecast_horizon_date"],
                        )
                        for m in meta_rows
                    ],
                )
    except Exception as e:
        yield {"stage": "error", "pct": 0, "message": f"Database error: {e}"}
        return

    yield {
        "stage": "done",
        "pct": 100,
        "records_inserted": len(price_rows),
        "message": (
            f"Forecast ready: {len(meta_rows)} markets, "
            f"{len(price_rows)} rows. Skipped {len(skipped)} short-history markets."
        ),
    }
