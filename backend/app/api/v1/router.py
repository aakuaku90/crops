from fastapi import APIRouter
from app.api.v1 import prices, commodities, markets, fao

api_router = APIRouter()
api_router.include_router(prices.router, prefix="/prices", tags=["prices"])
api_router.include_router(commodities.router, prefix="/commodities", tags=["commodities"])
api_router.include_router(markets.router, prefix="/markets", tags=["markets"])
api_router.include_router(fao.router, prefix="/fao", tags=["fao"])
