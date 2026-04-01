import asyncpg
from app.core.config import get_settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        settings = get_settings()
        # asyncpg uses postgresql:// not postgresql+asyncpg://
        dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
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
"""


async def init_db():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(CREATE_TABLES_SQL)
