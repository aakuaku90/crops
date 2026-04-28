import asyncpg
from app.core.config import get_settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        settings = get_settings()
        # asyncpg accepts `postgres://` and `postgresql://` but not the
        # SQLAlchemy `postgresql+asyncpg://` driver form. Heroku Postgres
        # provides `postgres://...` so the second replace is a no-op there;
        # local dev sets the `+asyncpg` form which we strip.
        dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
        # Heroku-style URLs use `postgres://`; asyncpg also accepts it, but
        # normalize for consistency with the rest of the ecosystem.
        if dsn.startswith("postgres://"):
            dsn = "postgresql://" + dsn[len("postgres://"):]
        _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS commodities (
    id SERIAL PRIMARY KEY,
    wfp_id INTEGER UNIQUE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    unit VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS markets (
    id SERIAL PRIMARY KEY,
    wfp_id INTEGER UNIQUE,
    name VARCHAR(255) NOT NULL,
    region VARCHAR(100),
    latitude DECIMAL(9,6),
    longitude DECIMAL(9,6),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS food_prices (
    id SERIAL PRIMARY KEY,
    commodity_id INTEGER REFERENCES commodities(id),
    market_id INTEGER REFERENCES markets(id),
    commodity_name VARCHAR(255),
    market_name VARCHAR(255),
    region VARCHAR(100),
    date DATE NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    unit VARCHAR(50),
    currency VARCHAR(10) DEFAULT 'GHS',
    price_type VARCHAR(50),
    price_flag VARCHAR(10),
    source VARCHAR(50) DEFAULT 'wfp',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(commodity_name, market_name, date, price_type)
);

CREATE INDEX IF NOT EXISTS idx_food_prices_date ON food_prices(date DESC);
CREATE INDEX IF NOT EXISTS idx_food_prices_commodity ON food_prices(commodity_name);
CREATE INDEX IF NOT EXISTS idx_food_prices_market ON food_prices(market_name);
CREATE INDEX IF NOT EXISTS idx_food_prices_region ON food_prices(region);

CREATE TABLE IF NOT EXISTS fao_cpi (
    id SERIAL PRIMARY KEY,
    start_date DATE NOT NULL,
    end_date DATE,
    item VARCHAR(255) NOT NULL,
    element VARCHAR(255),
    months VARCHAR(50),
    year INTEGER,
    value DECIMAL(10,4),
    unit VARCHAR(50),
    flag VARCHAR(10),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(item, start_date)
);

CREATE TABLE IF NOT EXISTS fao_producer_prices (
    id SERIAL PRIMARY KEY,
    start_date DATE NOT NULL,
    end_date DATE,
    item VARCHAR(255) NOT NULL,
    element VARCHAR(255),
    year INTEGER,
    value DECIMAL(10,4),
    unit VARCHAR(50),
    flag VARCHAR(10),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(item, start_date)
);

CREATE INDEX IF NOT EXISTS idx_fao_cpi_start_date ON fao_cpi(start_date DESC);
CREATE INDEX IF NOT EXISTS idx_fao_cpi_item ON fao_cpi(item);
CREATE INDEX IF NOT EXISTS idx_fao_producer_prices_start_date ON fao_producer_prices(start_date DESC);
CREATE INDEX IF NOT EXISTS idx_fao_producer_prices_item ON fao_producer_prices(item);

CREATE TABLE IF NOT EXISTS fao_healthy_diet_cost (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    item VARCHAR(255) NOT NULL,
    item_code VARCHAR(20),
    element VARCHAR(100),
    release VARCHAR(100),
    unit VARCHAR(50),
    value FLOAT NOT NULL,
    UNIQUE(item_code, year)
);

CREATE TABLE IF NOT EXISTS fao_food_security (
    id SERIAL PRIMARY KEY,
    year_label VARCHAR(20) NOT NULL,
    year_start INTEGER,
    item VARCHAR(255) NOT NULL,
    item_code VARCHAR(20),
    element VARCHAR(100),
    unit VARCHAR(50),
    value FLOAT NOT NULL,
    UNIQUE(item_code, year_label)
);

CREATE TABLE IF NOT EXISTS fao_exchange_rates (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    months VARCHAR(50),
    months_code VARCHAR(20),
    element VARCHAR(100),
    element_code VARCHAR(20),
    currency VARCHAR(50),
    iso_currency_code VARCHAR(10),
    unit VARCHAR(50),
    value FLOAT NOT NULL,
    UNIQUE(element_code, year, months_code)
);

CREATE TABLE IF NOT EXISTS fao_crop_production (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    item VARCHAR(255) NOT NULL,
    item_code VARCHAR(20),
    element VARCHAR(100),
    element_code VARCHAR(20),
    unit VARCHAR(50),
    value FLOAT NOT NULL,
    UNIQUE(item_code, element_code, year)
);

CREATE TABLE IF NOT EXISTS fao_value_production (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    item VARCHAR(255) NOT NULL,
    item_code VARCHAR(20),
    element VARCHAR(100),
    element_code VARCHAR(20),
    unit VARCHAR(50),
    value FLOAT NOT NULL,
    UNIQUE(item_code, element_code, year)
);

CREATE TABLE IF NOT EXISTS fao_food_balances (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    item VARCHAR(255) NOT NULL,
    item_code VARCHAR(20),
    element VARCHAR(100),
    element_code VARCHAR(20),
    unit VARCHAR(50),
    value FLOAT NOT NULL,
    UNIQUE(item_code, element_code, year)
);

CREATE TABLE IF NOT EXISTS fao_supply_utilization (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    item VARCHAR(255) NOT NULL,
    item_code VARCHAR(20),
    element VARCHAR(100),
    element_code VARCHAR(20),
    unit VARCHAR(50),
    value FLOAT NOT NULL,
    UNIQUE(item_code, element_code, year)
);

CREATE TABLE IF NOT EXISTS fao_trade (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    item VARCHAR(255) NOT NULL,
    item_code VARCHAR(20),
    element VARCHAR(100),
    element_code VARCHAR(20),
    unit VARCHAR(50),
    value FLOAT NOT NULL,
    UNIQUE(item_code, element_code, year)
);

CREATE INDEX IF NOT EXISTS idx_fao_trade_year ON fao_trade(year DESC);
CREATE INDEX IF NOT EXISTS idx_fao_trade_item ON fao_trade(item);

CREATE TABLE IF NOT EXISTS fao_population (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    item VARCHAR(255) NOT NULL,
    item_code VARCHAR(20),
    element VARCHAR(100),
    element_code VARCHAR(20),
    unit VARCHAR(50),
    value FLOAT NOT NULL,
    UNIQUE(element_code, year)
);

CREATE INDEX IF NOT EXISTS idx_fao_population_year ON fao_population(year DESC);

CREATE TABLE IF NOT EXISTS fao_fertilizer (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    item VARCHAR(255) NOT NULL,
    item_code VARCHAR(20),
    element VARCHAR(100),
    element_code VARCHAR(20),
    unit VARCHAR(50),
    value FLOAT NOT NULL,
    UNIQUE(item_code, element_code, year)
);

CREATE TABLE IF NOT EXISTS fao_land_use (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    item VARCHAR(255) NOT NULL,
    item_code VARCHAR(20),
    element VARCHAR(100),
    element_code VARCHAR(20),
    unit VARCHAR(50),
    value FLOAT NOT NULL,
    UNIQUE(item_code, element_code, year)
);

CREATE TABLE IF NOT EXISTS gss_crop_production (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    region VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL DEFAULT '',
    crop VARCHAR(255) NOT NULL,
    element VARCHAR(50) NOT NULL,
    unit VARCHAR(50),
    value FLOAT,
    source VARCHAR(100) DEFAULT 'GSS'
);

CREATE INDEX IF NOT EXISTS idx_gss_crop_year ON gss_crop_production(year DESC);
CREATE INDEX IF NOT EXISTS idx_gss_crop_region ON gss_crop_production(region);
CREATE INDEX IF NOT EXISTS idx_gss_crop_crop ON gss_crop_production(crop);

CREATE TABLE IF NOT EXISTS mofa_national (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    crop VARCHAR(255) NOT NULL,
    element VARCHAR(50) NOT NULL,
    unit VARCHAR(50),
    value FLOAT,
    source VARCHAR(100) DEFAULT 'MoFA SRID',
    UNIQUE(year, crop, element)
);

CREATE INDEX IF NOT EXISTS idx_mofa_national_year ON mofa_national(year DESC);
CREATE INDEX IF NOT EXISTS idx_mofa_national_crop ON mofa_national(crop);

-- ─────────────────────────────────────────────────────────────────────────
-- Forecast-pipeline tables: climate predictors (X) and maize targets (Y).
-- Climate features come from NASA POWER + MODIS, region-aggregated.
-- Two grains: monthly (raw units, for charts) and annual (z-scored, model input).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS climate_features_monthly (
    region VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    t2m FLOAT, t2m_max FLOAT, t2m_min FLOAT, t2m_range FLOAT,
    t2m_dew FLOAT, t2m_wet FLOAT,
    rh2m FLOAT, qv2m FLOAT, ps FLOAT,
    allsky_sw_dwn FLOAT, clrsky_sw_dwn FLOAT, allsky_par_tot FLOAT,
    ws2m FLOAT, ws2m_max FLOAT, ws2m_min FLOAT, wd2m FLOAT,
    gwetroot FLOAT, gwettop FLOAT, gwetprof FLOAT,
    prectotcorr FLOAT, total_precip_mm FLOAT, avg_precip_mm FLOAT, rainy_days FLOAT,
    ndvi FLOAT, evi FLOAT, vi_quality FLOAT,
    red_reflectance FLOAT, nir_reflectance FLOAT, blue_reflectance FLOAT, mir_reflectance FLOAT,
    PRIMARY KEY (region, year, month)
);

CREATE INDEX IF NOT EXISTS idx_climate_monthly_year ON climate_features_monthly(year DESC);
CREATE INDEX IF NOT EXISTS idx_climate_monthly_region ON climate_features_monthly(region);

-- Standardized / region-adjusted z-scores. Shape mirrors monthly minus `month`.
CREATE TABLE IF NOT EXISTS climate_features_annual (
    region VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL,
    t2m FLOAT, t2m_max FLOAT, t2m_min FLOAT, t2m_range FLOAT,
    t2m_dew FLOAT, t2m_wet FLOAT,
    rh2m FLOAT, qv2m FLOAT, ps FLOAT,
    allsky_sw_dwn FLOAT, clrsky_sw_dwn FLOAT, allsky_par_tot FLOAT,
    ws2m FLOAT, ws2m_max FLOAT, ws2m_min FLOAT, wd2m FLOAT,
    gwetroot FLOAT, gwettop FLOAT, gwetprof FLOAT,
    prectotcorr FLOAT, total_precip_mm FLOAT, avg_precip_mm FLOAT, rainy_days FLOAT,
    ndvi FLOAT, evi FLOAT, vi_quality FLOAT,
    red_reflectance FLOAT, nir_reflectance FLOAT, blue_reflectance FLOAT, mir_reflectance FLOAT,
    PRIMARY KEY (region, year)
);

CREATE INDEX IF NOT EXISTS idx_climate_annual_year ON climate_features_annual(year DESC);

-- MoFA regional maize stats (the Y target). Annual, 1999-2023.
CREATE TABLE IF NOT EXISTS mofa_maize_regional (
    year INTEGER NOT NULL,
    region VARCHAR(100) NOT NULL,
    total_area_ha FLOAT,
    avg_yield_mt_ha FLOAT,
    total_production_mt FLOAT,
    source VARCHAR(100) DEFAULT 'MoFA',
    PRIMARY KEY (year, region)
);

CREATE INDEX IF NOT EXISTS idx_mofa_maize_year ON mofa_maize_regional(year DESC);
CREATE INDEX IF NOT EXISTS idx_mofa_maize_region ON mofa_maize_regional(region);

-- Maize yield/area/production predictions from TabPFN model.
-- `source` distinguishes backtest (historical, has actuals) from forward
-- predictions (future_tabpfn, actuals NULL). Same (region, year) can appear
-- under both sources, hence source is part of the PK.
CREATE TABLE IF NOT EXISTS maize_predictions (
    region VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL,
    source VARCHAR(50) NOT NULL,
    actual_yield FLOAT,
    pred_yield FLOAT,
    actual_area FLOAT,
    pred_area FLOAT,
    actual_production FLOAT,
    pred_production FLOAT,
    PRIMARY KEY (region, year, source)
);

CREATE INDEX IF NOT EXISTS idx_maize_pred_year ON maize_predictions(year DESC);
CREATE INDEX IF NOT EXISTS idx_maize_pred_region ON maize_predictions(region);
CREATE INDEX IF NOT EXISTS idx_maize_pred_source ON maize_predictions(source);

-- LightGBM yield/area/production predictions for maize. Same shape as
-- `maize_predictions` (TabPFN), so the frontend page component can be reused.
CREATE TABLE IF NOT EXISTS maize_predictions_lightgbm (
    region VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL,
    source VARCHAR(50) NOT NULL,
    actual_yield FLOAT,
    pred_yield FLOAT,
    actual_area FLOAT,
    pred_area FLOAT,
    actual_production FLOAT,
    pred_production FLOAT,
    PRIMARY KEY (region, year, source)
);

CREATE INDEX IF NOT EXISTS idx_maize_pred_lgb_year ON maize_predictions_lightgbm(year DESC);
CREATE INDEX IF NOT EXISTS idx_maize_pred_lgb_region ON maize_predictions_lightgbm(region);

-- 5-year rolling-mean baseline. Same schema for consistency. Predicts only
-- yield/area/production via region's prior 5-year mean — no climate features.
CREATE TABLE IF NOT EXISTS maize_predictions_rolling_mean (
    region VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL,
    source VARCHAR(50) NOT NULL,
    actual_yield FLOAT,
    pred_yield FLOAT,
    actual_area FLOAT,
    pred_area FLOAT,
    actual_production FLOAT,
    pred_production FLOAT,
    PRIMARY KEY (region, year, source)
);

CREATE INDEX IF NOT EXISTS idx_maize_pred_rm_year ON maize_predictions_rolling_mean(year DESC);
CREATE INDEX IF NOT EXISTS idx_maize_pred_rm_region ON maize_predictions_rolling_mean(region);

-- Per-market monthly maize price forecast (Prophet w/ CPI exogenous regressor).
-- One row per (market, month, phase). Phase values:
--   'train'    : history months used for in-sample fit. Has actuals + pred.
--   'backtest' : last 12 history months held out for honest validation.
--                Pred is out-of-sample.
--   'forecast' : 12 months past last history. Pred only; actuals NULL.
-- Both currencies stored: GHS modeled directly, USD via global FX Prophet.
CREATE TABLE IF NOT EXISTS maize_price_forecast (
    market VARCHAR(255) NOT NULL,
    region VARCHAR(100),
    month_date DATE NOT NULL,
    phase VARCHAR(20) NOT NULL,
    actual_price_ghs FLOAT,
    actual_price_usd FLOAT,
    pred_price_ghs FLOAT,
    pred_price_lower_ghs FLOAT,
    pred_price_upper_ghs FLOAT,
    pred_price_usd FLOAT,
    pred_price_lower_usd FLOAT,
    pred_price_upper_usd FLOAT,
    cpi_value FLOAT,
    unit VARCHAR(50),
    PRIMARY KEY (market, month_date, phase)
);

CREATE INDEX IF NOT EXISTS idx_maize_price_fc_market ON maize_price_forecast(market);
CREATE INDEX IF NOT EXISTS idx_maize_price_fc_phase ON maize_price_forecast(phase);
CREATE INDEX IF NOT EXISTS idx_maize_price_fc_month ON maize_price_forecast(month_date DESC);

-- Per-market metadata: training-set sizes, holdout-backtest accuracy metrics,
-- and the fitted CPI regressor coefficient (so the FE can show "1% CPI move →
-- β% price move"). Refreshed every sync.
CREATE TABLE IF NOT EXISTS maize_price_forecast_meta (
    market VARCHAR(255) PRIMARY KEY,
    region VARCHAR(100),
    unit VARCHAR(50),
    n_train INTEGER,
    n_backtest INTEGER,
    backtest_rmse_ghs FLOAT,
    backtest_mae_ghs FLOAT,
    backtest_mape_pct FLOAT,
    cpi_beta FLOAT,
    last_history_date DATE,
    forecast_horizon_date DATE,
    generated_at TIMESTAMP DEFAULT NOW()
);
"""

MIGRATE_SQL = """
ALTER TABLE gss_crop_production ADD COLUMN IF NOT EXISTS district VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE gss_crop_production ALTER COLUMN value DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gss_crop_district ON gss_crop_production(district);
-- WFP sometimes returns compound flags like 'actual,aggregate' that exceed 10 chars.
ALTER TABLE food_prices ALTER COLUMN price_flag TYPE VARCHAR(50);
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'gss_crop_production_year_region_crop_element_key'
    ) THEN
        ALTER TABLE gss_crop_production DROP CONSTRAINT gss_crop_production_year_region_crop_element_key;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'gss_crop_production_year_region_district_crop_element_key'
    ) THEN
        ALTER TABLE gss_crop_production DROP CONSTRAINT gss_crop_production_year_region_district_crop_element_key;
    END IF;
END $$;
"""


async def init_db():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(CREATE_TABLES_SQL)
        await conn.execute(MIGRATE_SQL)
