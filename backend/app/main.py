from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import init_db, close_pool, get_pool
from app.api.v1.router import api_router
from app.services.sync_service import sync_from_hdex
from app.services.fao_service import (
    sync_fao_cpi,
    sync_fao_producer_prices,
    sync_fao_healthy_diet_cost,
    sync_fao_food_security,
    sync_fao_exchange_rates,
    sync_fao_crop_production,
    sync_fao_value_production,
    sync_fao_food_balances,
    sync_fao_supply_utilization,
    sync_fao_trade,
    sync_fao_population,
    sync_fao_fertilizer,
    sync_fao_land_use,
)
from app.models.schemas import SyncResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await close_pool()


app = FastAPI(
    title="Ghana Food Prices API",
    description="Dashboard API for WFP Ghana food market prices",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "Ghana Food Prices API"}


@app.post("/api/v1/sync/hdex", response_model=SyncResponse, tags=["sync"])
async def trigger_hdex_sync():
    """Trigger manual sync from HDEX public dataset (no credentials needed)."""
    result = await sync_from_hdex()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/cpi", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_cpi_sync():
    """Trigger manual sync of FAO FAOSTAT Consumer Price Indices from HDX."""
    result = await sync_fao_cpi()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/producer-prices", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_producer_sync():
    """Trigger manual sync of FAO FAOSTAT Producer Prices from HDX."""
    result = await sync_fao_producer_prices()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/healthy-diet-cost", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_healthy_diet_sync():
    """Trigger manual sync of FAO FAOSTAT Cost & Affordability of Healthy Diet."""
    result = await sync_fao_healthy_diet_cost()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/food-security", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_food_security_sync():
    """Trigger manual sync of FAO FAOSTAT Food Security Indicators."""
    result = await sync_fao_food_security()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/exchange-rates", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_exchange_rates_sync():
    """Trigger manual sync of FAO FAOSTAT Exchange Rates."""
    result = await sync_fao_exchange_rates()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/crop-production", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_crop_production_sync():
    """Trigger manual sync of FAO FAOSTAT Crops & Livestock Production."""
    result = await sync_fao_crop_production()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/value-production", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_value_production_sync():
    """Trigger manual sync of FAO FAOSTAT Value of Agricultural Production."""
    result = await sync_fao_value_production()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/food-balances", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_food_balances_sync():
    """Trigger manual sync of FAO FAOSTAT Food Balances."""
    result = await sync_fao_food_balances()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/supply-utilization", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_supply_utilization_sync():
    """Trigger manual sync of FAO FAOSTAT Supply Utilization Accounts."""
    result = await sync_fao_supply_utilization()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/trade", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_trade_sync():
    """Trigger manual sync of FAO FAOSTAT Crops & Livestock Trade."""
    result = await sync_fao_trade()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/population", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_population_sync():
    """Trigger manual sync of FAO Annual Population data."""
    result = await sync_fao_population()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/fertilizer", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_fertilizer_sync():
    """Trigger manual sync of FAO Fertilizer Use (RI domain)."""
    result = await sync_fao_fertilizer()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )


@app.post("/api/v1/sync/fao/land-use", response_model=SyncResponse, tags=["sync"])
async def trigger_fao_land_use_sync():
    """Trigger manual sync of FAO Land Use (RL domain)."""
    result = await sync_fao_land_use()
    return SyncResponse(
        status="success",
        records_inserted=result["records_inserted"],
        message=result["message"],
    )
