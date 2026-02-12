"""Markets API Router"""
from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from ..models import Market, ArbitrageOpportunity
from ..polymarket_client import polymarket_client
from ..scheduler import scheduler

router = APIRouter(prefix="/api/markets", tags=["markets"])


@router.get("")
async def get_markets(
    limit: int = Query(default=100, ge=1, le=500),
    active_only: bool = Query(default=True)
) -> List[Market]:
    """Get list of markets"""
    try:
        markets = await polymarket_client.get_markets(limit=limit, active_only=active_only)
        return [Market(**market) for market in markets]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/opportunities")
async def get_opportunities() -> List[ArbitrageOpportunity]:
    """Get current arbitrage opportunities"""
    try:
        return scheduler.get_opportunities()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
