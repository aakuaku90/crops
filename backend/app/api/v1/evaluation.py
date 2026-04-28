from fastapi import APIRouter

from app.services.evaluation_service import compare_maize_models

router = APIRouter()


@router.get("/maize")
async def maize_evaluation():
    """Return per-model metrics + pairwise comparisons across the common backtest set."""
    return await compare_maize_models()
