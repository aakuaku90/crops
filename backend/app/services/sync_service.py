from datetime import datetime
from app.db.database import get_pool
from app.services.wfp_service import fetch_hdex_csv_data


async def sync_from_hdex() -> dict:
    """Sync price data from HDEX CSV (public data, no credentials needed)."""
    rows = await fetch_hdex_csv_data()
    if not rows:
        return {"records_inserted": 0, "message": "No data from HDEX"}

    pool = await get_pool()
    inserted = 0

    async with pool.acquire() as conn:
        for row in rows:
            try:
                # HDEX/WFP CSV columns: date, admin1, admin2, market, latitude, longitude,
                # category, commodity, unit, pricetype, currency, price, usdprice
                commodity_name = row.get("commodity", "").strip()
                market_name = row.get("market", "").strip()
                region = row.get("admin1", "").strip()
                admin2 = row.get("admin2", "").strip()
                category = row.get("category", "").strip()
                price_date = row.get("date", "").strip()
                price_str = row.get("price", "0").strip()
                usd_price_str = row.get("usdprice", "").strip()
                unit = row.get("unit", "").strip()
                currency = row.get("currency", "GHS").strip()
                price_type = row.get("pricetype", "Retail").strip()
                price_flag = row.get("priceflag", "").strip()
                lat_str = row.get("latitude", "").strip()
                lon_str = row.get("longitude", "").strip()

                if not commodity_name or not price_date or not price_str:
                    continue

                price = float(price_str) if price_str else 0.0
                if price <= 0:
                    continue

                price_date = datetime.strptime(price_date, "%Y-%m-%d").date()
                usd_price = float(usd_price_str) if usd_price_str else None
                latitude = float(lat_str) if lat_str else None
                longitude = float(lon_str) if lon_str else None

                await conn.execute(
                    """
                    INSERT INTO food_prices
                        (commodity_name, market_name, region, admin2, category, date, price, usd_price,
                         unit, currency, price_type, price_flag, latitude, longitude, source)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'hdex')
                    ON CONFLICT (commodity_name, market_name, date, price_type) DO UPDATE
                        SET price = EXCLUDED.price,
                            usd_price = EXCLUDED.usd_price,
                            admin2 = EXCLUDED.admin2,
                            category = EXCLUDED.category,
                            price_flag = EXCLUDED.price_flag,
                            latitude = EXCLUDED.latitude,
                            longitude = EXCLUDED.longitude
                    """,
                    commodity_name, market_name, region, admin2, category,
                    price_date, price, usd_price, unit, currency, price_type,
                    price_flag, latitude, longitude
                )
                inserted += 1
            except Exception as e:
                print(f"HDEX insert error: {e}")
                continue

    return {"records_inserted": inserted, "message": f"Synced {inserted} records from HDEX"}
