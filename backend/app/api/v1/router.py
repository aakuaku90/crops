from fastapi import APIRouter
from app.api.v1 import (
    prices, commodities, markets, fao, gss, mofa,
    climate, predictions, predictions_lightgbm, predictions_rolling,
    price_forecast, evaluation, chat,
)

api_router = APIRouter()
api_router.include_router(prices.router, prefix="/prices", tags=["prices"])
api_router.include_router(commodities.router, prefix="/commodities", tags=["commodities"])
api_router.include_router(markets.router, prefix="/markets", tags=["markets"])
api_router.include_router(fao.router, prefix="/fao", tags=["fao"])
api_router.include_router(gss.router, prefix="/gss", tags=["gss"])
api_router.include_router(mofa.router, prefix="/mofa", tags=["mofa"])
api_router.include_router(climate.router, prefix="/climate", tags=["climate"])
api_router.include_router(predictions.router, prefix="/predictions", tags=["predictions"])
api_router.include_router(predictions_lightgbm.router, prefix="/predictions-lightgbm", tags=["predictions"])
api_router.include_router(predictions_rolling.router, prefix="/predictions-rolling", tags=["predictions"])
api_router.include_router(price_forecast.router, prefix="/price-forecast", tags=["price-forecast"])
api_router.include_router(evaluation.router, prefix="/evaluation", tags=["evaluation"])
api_router.include_router(chat.router, tags=["chat"])
