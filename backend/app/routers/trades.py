"""Trades API Router"""
from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional, Dict, Any
from ..database import get_trades, get_trade_stats, get_pnl_series
from ..models import PnlDataPoint

router = APIRouter(prefix="/api/trades", tags=["trades"])


@router.get("")
async def list_trades(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    mode: Optional[str] = Query(default=None),
    strategy: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
) -> List[Dict[str, Any]]:
    """Get trade history with filtering and pagination"""
    try:
        trades = await get_trades(
            limit=limit,
            offset=offset,
            mode=mode,
            strategy=strategy,
            status=status,
        )
        return trades
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_stats(
    mode: Optional[str] = Query(default=None)
) -> Dict[str, Any]:
    """Get trade statistics"""
    try:
        stats = await get_trade_stats(mode=mode)
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pnl")
async def get_pnl(
    mode: Optional[str] = Query(default=None),
    days: int = Query(default=30, ge=1, le=365)
) -> List[PnlDataPoint]:
    """Get PnL time series data"""
    try:
        pnl_data = await get_pnl_series(mode=mode, days=days)
        return [PnlDataPoint(**point) for point in pnl_data]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
