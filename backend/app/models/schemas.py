from pydantic import BaseModel
from datetime import date
from typing import Optional


class FoodPriceRecord(BaseModel):
    id: int
    commodity_name: str
    market_name: str
    region: Optional[str]
    date: date
    price: float
    unit: Optional[str]
    currency: str
    price_type: Optional[str]
    source: str


class CommodityRecord(BaseModel):
    id: int
    name: str
    category: Optional[str]
    unit: Optional[str]


class MarketRecord(BaseModel):
    id: int
    name: str
    region: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]


class PriceSummary(BaseModel):
    commodity_name: str
    avg_price: float
    min_price: float
    max_price: float
    latest_price: float
    latest_date: date
    price_change_pct: Optional[float]
    unit: Optional[str]
    currency: str


class SyncResponse(BaseModel):
    status: str
    records_inserted: int
    message: str
