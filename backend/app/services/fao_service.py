import asyncio
import faostat
from datetime import date
import calendar
from app.db.database import get_pool
from app.core.config import get_settings

GHANA_AREA_CODE = "81"

MONTH_MAP = {
    "January": 1, "February": 2, "March": 3, "April": 4,
    "May": 5, "June": 6, "July": 7, "August": 8,
    "September": 9, "October": 10, "November": 11, "December": 12,
}


_faostat_configured = False


def _configure_faostat():
    """Configure faostat package once — calling set_requests_args multiple times
    appends the lang segment to the base URL each time (package bug)."""
    global _faostat_configured
    if _faostat_configured:
        return
    settings = get_settings()
    kwargs = {"lang": "en"}
    if settings.faostat_username and settings.faostat_password:
        kwargs["username"] = settings.faostat_username
        kwargs["password"] = settings.faostat_password
    elif settings.faostat_token:
        kwargs["token"] = settings.faostat_token
    else:
        raise ValueError("Either FAOSTAT_USERNAME+FAOSTAT_PASSWORD or FAOSTAT_TOKEN must be set in .env")
    faostat.set_requests_args(**kwargs)
    _faostat_configured = True


def _fetch_cpi_sync() -> list[tuple]:
    _configure_faostat()
    data = faostat.get_data(
        "CP",
        pars={"area": GHANA_AREA_CODE},
        show_flags=True,
        null_values=False,
    )
    rows = list(data)
    if not rows:
        return []
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]


def _fetch_producer_prices_sync() -> list[dict]:
    _configure_faostat()  # no-op after first call
    data = faostat.get_data(
        "PP",
        pars={"area": GHANA_AREA_CODE},
        show_flags=True,
        null_values=False,
    )
    rows = list(data)
    if not rows:
        return []
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]


async def sync_fao_cpi() -> dict:
    """Fetch FAO Consumer Price Indices for Ghana via faostat package."""
    try:
        rows = await asyncio.to_thread(_fetch_cpi_sync)
    except Exception as e:
        return {"records_inserted": 0, "message": f"FAOSTAT error: {e}"}

    if not rows:
        return {"records_inserted": 0, "message": "No CPI data returned"}

    pool = await get_pool()
    inserted = 0

    async with pool.acquire() as conn:
        for row in rows:
            try:
                year_str = str(row.get("Year", "")).strip()
                months_str = str(row.get("Months", "")).strip()
                item = str(row.get("Item", "")).strip()
                element = str(row.get("Element", "")).strip() or None
                value_raw = row.get("Value")
                unit = str(row.get("Unit", "")).strip() or None
                flag = str(row.get("Flag", "")).strip() or None

                if not year_str or not item or value_raw is None:
                    continue

                year = int(year_str)
                month = MONTH_MAP.get(months_str, 1)
                start_date = date(year, month, 1)
                end_date = date(year, month, calendar.monthrange(year, month)[1])
                value = float(value_raw)

                await conn.execute(
                    """
                    INSERT INTO fao_cpi
                        (start_date, end_date, item, element, months, year, value, unit, flag)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (item, start_date) DO UPDATE
                        SET end_date = EXCLUDED.end_date,
                            element  = EXCLUDED.element,
                            months   = EXCLUDED.months,
                            year     = EXCLUDED.year,
                            value    = EXCLUDED.value,
                            unit     = EXCLUDED.unit,
                            flag     = EXCLUDED.flag
                    """,
                    start_date, end_date, item, element, months_str or None,
                    year, value, unit, flag,
                )
                inserted += 1
            except Exception as e:
                print(f"FAO CPI insert error: {e} | row: {row}")
                continue

    return {"records_inserted": inserted, "message": f"Synced {inserted} FAO CPI records from FAOSTAT"}


async def sync_fao_producer_prices() -> dict:
    """Fetch FAO Producer Prices for Ghana via faostat package."""
    try:
        rows = await asyncio.to_thread(_fetch_producer_prices_sync)
    except Exception as e:
        return {"records_inserted": 0, "message": f"FAOSTAT error: {e}"}

    if not rows:
        return {"records_inserted": 0, "message": "No Producer Price data returned"}

    pool = await get_pool()
    inserted = 0

    async with pool.acquire() as conn:
        for row in rows:
            try:
                year_str = str(row.get("Year", "")).strip()
                item = str(row.get("Item", "")).strip()
                element = str(row.get("Element", "")).strip() or None
                value_raw = row.get("Value")
                unit = str(row.get("Unit", "")).strip() or None
                flag = str(row.get("Flag", "")).strip() or None

                if not year_str or not item or value_raw is None:
                    continue

                year = int(year_str)
                start_date = date(year, 1, 1)
                end_date = date(year, 12, 31)
                value = float(value_raw)

                await conn.execute(
                    """
                    INSERT INTO fao_producer_prices
                        (start_date, end_date, item, element, year, value, unit, flag)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (item, start_date) DO UPDATE
                        SET end_date = EXCLUDED.end_date,
                            element  = EXCLUDED.element,
                            year     = EXCLUDED.year,
                            value    = EXCLUDED.value,
                            unit     = EXCLUDED.unit,
                            flag     = EXCLUDED.flag
                    """,
                    start_date, end_date, item, element,
                    year, value, unit, flag,
                )
                inserted += 1
            except Exception as e:
                print(f"FAO PP insert error: {e} | row: {row}")
                continue

    return {"records_inserted": inserted, "message": f"Synced {inserted} FAO Producer Price records from FAOSTAT"}


# ── CAHD: Cost & Affordability of Healthy Diet ────────────────────────────────

def _fetch_healthy_diet_cost_sync() -> list[dict]:
    _configure_faostat()
    data = faostat.get_data(
        "CAHD",
        pars={"area": GHANA_AREA_CODE},
        null_values=False,
    )
    rows = list(data)
    if not rows:
        return []
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]


async def sync_fao_healthy_diet_cost() -> dict:
    """Fetch FAO Cost & Affordability of Healthy Diet data for Ghana."""
    try:
        rows = await asyncio.to_thread(_fetch_healthy_diet_cost_sync)
    except Exception as e:
        return {"records_inserted": 0, "message": f"FAOSTAT error: {e}"}

    if not rows:
        return {"records_inserted": 0, "message": "No Healthy Diet Cost data returned"}

    pool = await get_pool()
    inserted = 0

    async with pool.acquire() as conn:
        for row in rows:
            try:
                year_raw = row.get("Year")
                item = str(row.get("Item", "")).strip()
                item_code = str(row.get("Item Code", "")).strip() or None
                element = str(row.get("Element", "")).strip() or None
                release = str(row.get("Release", "")).strip() or None
                unit = str(row.get("Unit", "")).strip() or None
                value_raw = row.get("Value")

                if year_raw is None or not item or value_raw is None:
                    continue

                year = int(year_raw)
                value = float(value_raw)

                await conn.execute(
                    """
                    INSERT INTO fao_healthy_diet_cost
                        (year, item, item_code, element, release, unit, value)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (item_code, year) DO UPDATE
                        SET item     = EXCLUDED.item,
                            element  = EXCLUDED.element,
                            release  = EXCLUDED.release,
                            unit     = EXCLUDED.unit,
                            value    = EXCLUDED.value
                    """,
                    year, item, item_code, element, release, unit, value,
                )
                inserted += 1
            except Exception as e:
                print(f"FAO CAHD insert error: {e} | row: {row}")
                continue

    return {"records_inserted": inserted, "message": f"Synced {inserted} FAO Healthy Diet Cost records from FAOSTAT"}


# ── FS: Food Security Indicators ─────────────────────────────────────────────

def _fetch_food_security_sync() -> list[dict]:
    _configure_faostat()
    data = faostat.get_data(
        "FS",
        pars={"area": GHANA_AREA_CODE},
        null_values=False,
    )
    rows = list(data)
    if not rows:
        return []
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]


async def sync_fao_food_security() -> dict:
    """Fetch FAO Food Security Indicators for Ghana."""
    try:
        rows = await asyncio.to_thread(_fetch_food_security_sync)
    except Exception as e:
        return {"records_inserted": 0, "message": f"FAOSTAT error: {e}"}

    if not rows:
        return {"records_inserted": 0, "message": "No Food Security data returned"}

    pool = await get_pool()
    inserted = 0

    async with pool.acquire() as conn:
        for row in rows:
            try:
                year_label = str(row.get("Year", "")).strip()
                year_code_raw = row.get("Year Code", row.get("YearCode", ""))
                item = str(row.get("Item", "")).strip()
                item_code = str(row.get("Item Code", "")).strip() or None
                element = str(row.get("Element", "")).strip() or None
                unit = str(row.get("Unit", "")).strip() or None
                value_raw = row.get("Value")

                if not year_label or not item or value_raw is None:
                    continue

                year_start_str = str(year_code_raw).strip()[:4]
                year_start = int(year_start_str) if year_start_str.isdigit() else None
                value = float(value_raw)

                await conn.execute(
                    """
                    INSERT INTO fao_food_security
                        (year_label, year_start, item, item_code, element, unit, value)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (item_code, year_label) DO UPDATE
                        SET year_start = EXCLUDED.year_start,
                            item       = EXCLUDED.item,
                            element    = EXCLUDED.element,
                            unit       = EXCLUDED.unit,
                            value      = EXCLUDED.value
                    """,
                    year_label, year_start, item, item_code, element, unit, value,
                )
                inserted += 1
            except Exception as e:
                print(f"FAO FS insert error: {e} | row: {row}")
                continue

    return {"records_inserted": inserted, "message": f"Synced {inserted} FAO Food Security records from FAOSTAT"}


# ── PE: Exchange Rates ────────────────────────────────────────────────────────

def _fetch_exchange_rates_sync() -> list[dict]:
    _configure_faostat()
    data = faostat.get_data(
        "PE",
        pars={"area": GHANA_AREA_CODE},
        null_values=False,
    )
    rows = list(data)
    if not rows:
        return []
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]


async def sync_fao_exchange_rates() -> dict:
    """Fetch FAO Exchange Rates for Ghana."""
    try:
        rows = await asyncio.to_thread(_fetch_exchange_rates_sync)
    except Exception as e:
        return {"records_inserted": 0, "message": f"FAOSTAT error: {e}"}

    if not rows:
        return {"records_inserted": 0, "message": "No Exchange Rate data returned"}

    pool = await get_pool()
    inserted = 0

    async with pool.acquire() as conn:
        for row in rows:
            try:
                year_raw = row.get("Year")
                months = str(row.get("Months", "")).strip() or None
                months_code = str(row.get("Months Code", row.get("MonthsCode", ""))).strip() or None
                element = str(row.get("Element", "")).strip() or None
                element_code = str(row.get("Element Code", row.get("ElementCode", ""))).strip() or None
                currency = str(row.get("Currency", "")).strip() or None
                iso_currency_code = str(row.get("ISO Currency Code", row.get("ISOCurrencyCode", ""))).strip() or None
                unit = str(row.get("Unit", "")).strip() or None
                value_raw = row.get("Value")

                if year_raw is None or value_raw is None:
                    continue

                year = int(year_raw)
                value = float(value_raw)

                await conn.execute(
                    """
                    INSERT INTO fao_exchange_rates
                        (year, months, months_code, element, element_code, currency, iso_currency_code, unit, value)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (element_code, year, months_code) DO UPDATE
                        SET months            = EXCLUDED.months,
                            element           = EXCLUDED.element,
                            currency          = EXCLUDED.currency,
                            iso_currency_code = EXCLUDED.iso_currency_code,
                            unit              = EXCLUDED.unit,
                            value             = EXCLUDED.value
                    """,
                    year, months, months_code, element, element_code,
                    currency, iso_currency_code, unit, value,
                )
                inserted += 1
            except Exception as e:
                print(f"FAO PE insert error: {e} | row: {row}")
                continue

    return {"records_inserted": inserted, "message": f"Synced {inserted} FAO Exchange Rate records from FAOSTAT"}


# ── QCL: Crops & Livestock Production ────────────────────────────────────────

def _fetch_crop_production_sync() -> list[dict]:
    _configure_faostat()
    data = faostat.get_data(
        "QCL",
        pars={"area": GHANA_AREA_CODE},
        null_values=False,
    )
    rows = list(data)
    if not rows:
        return []
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]


async def sync_fao_crop_production() -> dict:
    """Fetch FAO Crops & Livestock Production data for Ghana."""
    try:
        rows = await asyncio.to_thread(_fetch_crop_production_sync)
    except Exception as e:
        return {"records_inserted": 0, "message": f"FAOSTAT error: {e}"}

    if not rows:
        return {"records_inserted": 0, "message": "No Crop Production data returned"}

    pool = await get_pool()
    inserted = 0

    async with pool.acquire() as conn:
        for row in rows:
            try:
                year_raw = row.get("Year")
                item = str(row.get("Item", "")).strip()
                item_code = str(row.get("Item Code", "")).strip() or None
                element = str(row.get("Element", "")).strip() or None
                element_code = str(row.get("Element Code", row.get("ElementCode", ""))).strip() or None
                unit = str(row.get("Unit", "")).strip() or None
                value_raw = row.get("Value")

                if year_raw is None or not item or value_raw is None:
                    continue

                year = int(year_raw)
                value = float(value_raw)

                await conn.execute(
                    """
                    INSERT INTO fao_crop_production
                        (year, item, item_code, element, element_code, unit, value)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (item_code, element_code, year) DO UPDATE
                        SET item    = EXCLUDED.item,
                            element = EXCLUDED.element,
                            unit    = EXCLUDED.unit,
                            value   = EXCLUDED.value
                    """,
                    year, item, item_code, element, element_code, unit, value,
                )
                inserted += 1
            except Exception as e:
                print(f"FAO QCL insert error: {e} | row: {row}")
                continue

    return {"records_inserted": inserted, "message": f"Synced {inserted} FAO Crop Production records from FAOSTAT"}


# ── QV: Value of Agricultural Production ─────────────────────────────────────

def _fetch_value_production_sync() -> list[dict]:
    _configure_faostat()
    data = faostat.get_data(
        "QV",
        pars={"area": GHANA_AREA_CODE},
        null_values=False,
    )
    rows = list(data)
    if not rows:
        return []
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]


async def sync_fao_value_production() -> dict:
    """Fetch FAO Value of Agricultural Production data for Ghana."""
    try:
        rows = await asyncio.to_thread(_fetch_value_production_sync)
    except Exception as e:
        return {"records_inserted": 0, "message": f"FAOSTAT error: {e}"}

    if not rows:
        return {"records_inserted": 0, "message": "No Value of Production data returned"}

    pool = await get_pool()
    inserted = 0

    async with pool.acquire() as conn:
        for row in rows:
            try:
                year_raw = row.get("Year")
                item = str(row.get("Item", "")).strip()
                item_code = str(row.get("Item Code", "")).strip() or None
                element = str(row.get("Element", "")).strip() or None
                element_code = str(row.get("Element Code", row.get("ElementCode", ""))).strip() or None
                unit = str(row.get("Unit", "")).strip() or None
                value_raw = row.get("Value")

                if year_raw is None or not item or value_raw is None:
                    continue

                year = int(year_raw)
                value = float(value_raw)

                await conn.execute(
                    """
                    INSERT INTO fao_value_production
                        (year, item, item_code, element, element_code, unit, value)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (item_code, element_code, year) DO UPDATE
                        SET item    = EXCLUDED.item,
                            element = EXCLUDED.element,
                            unit    = EXCLUDED.unit,
                            value   = EXCLUDED.value
                    """,
                    year, item, item_code, element, element_code, unit, value,
                )
                inserted += 1
            except Exception as e:
                print(f"FAO QV insert error: {e} | row: {row}")
                continue

    return {"records_inserted": inserted, "message": f"Synced {inserted} FAO Value of Production records from FAOSTAT"}


# ── SCL: Supply Utilization Accounts ─────────────────────────────────────────

def _fetch_supply_utilization_sync() -> list[dict]:
    _configure_faostat()
    data = faostat.get_data(
        "SCL",
        pars={"area": GHANA_AREA_CODE},
        null_values=False,
    )
    rows = list(data)
    if not rows:
        return []
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]


async def sync_fao_supply_utilization() -> dict:
    """Fetch FAO Supply Utilization Accounts data for Ghana."""
    try:
        rows = await asyncio.to_thread(_fetch_supply_utilization_sync)
    except Exception as e:
        return {"records_inserted": 0, "message": f"FAOSTAT error: {e}"}

    if not rows:
        return {"records_inserted": 0, "message": "No Supply Utilization data returned"}

    pool = await get_pool()
    inserted = 0

    async with pool.acquire() as conn:
        for row in rows:
            try:
                year_raw = row.get("Year")
                item = str(row.get("Item", "")).strip()
                item_code = str(row.get("Item Code", "")).strip() or None
                element = str(row.get("Element", "")).strip() or None
                element_code = str(row.get("Element Code", row.get("ElementCode", ""))).strip() or None
                unit = str(row.get("Unit", "")).strip() or None
                value_raw = row.get("Value")

                if year_raw is None or not item or value_raw is None:
                    continue

                year = int(year_raw)
                value = float(value_raw)

                await conn.execute(
                    """
                    INSERT INTO fao_supply_utilization
                        (year, item, item_code, element, element_code, unit, value)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (item_code, element_code, year) DO UPDATE
                        SET item    = EXCLUDED.item,
                            element = EXCLUDED.element,
                            unit    = EXCLUDED.unit,
                            value   = EXCLUDED.value
                    """,
                    year, item, item_code, element, element_code, unit, value,
                )
                inserted += 1
            except Exception as e:
                print(f"FAO SCL insert error: {e} | row: {row}")
                continue

    return {"records_inserted": inserted, "message": f"Synced {inserted} FAO Supply Utilization records from FAOSTAT"}


# ── FBS: Food Balances ────────────────────────────────────────────────────────

def _fetch_food_balances_sync() -> list[dict]:
    _configure_faostat()
    data = faostat.get_data(
        "FBS",
        pars={"area": GHANA_AREA_CODE},
        null_values=False,
    )
    rows = list(data)
    if not rows:
        return []
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]


async def sync_fao_food_balances() -> dict:
    """Fetch FAO Food Balances data for Ghana."""
    try:
        rows = await asyncio.to_thread(_fetch_food_balances_sync)
    except Exception as e:
        return {"records_inserted": 0, "message": f"FAOSTAT error: {e}"}

    if not rows:
        return {"records_inserted": 0, "message": "No Food Balances data returned"}

    pool = await get_pool()
    inserted = 0

    async with pool.acquire() as conn:
        for row in rows:
            try:
                year_raw = row.get("Year")
                item = str(row.get("Item", "")).strip()
                item_code = str(row.get("Item Code", "")).strip() or None
                element = str(row.get("Element", "")).strip() or None
                element_code = str(row.get("Element Code", row.get("ElementCode", ""))).strip() or None
                unit = str(row.get("Unit", "")).strip() or None
                value_raw = row.get("Value")

                if year_raw is None or not item or value_raw is None:
                    continue

                year = int(year_raw)
                value = float(value_raw)

                await conn.execute(
                    """
                    INSERT INTO fao_food_balances
                        (year, item, item_code, element, element_code, unit, value)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (item_code, element_code, year) DO UPDATE
                        SET item    = EXCLUDED.item,
                            element = EXCLUDED.element,
                            unit    = EXCLUDED.unit,
                            value   = EXCLUDED.value
                    """,
                    year, item, item_code, element, element_code, unit, value,
                )
                inserted += 1
            except Exception as e:
                print(f"FAO FBS insert error: {e} | row: {row}")
                continue

    return {"records_inserted": inserted, "message": f"Synced {inserted} FAO Food Balances records from FAOSTAT"}
