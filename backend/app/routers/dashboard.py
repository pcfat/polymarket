"""Dashboard API Router"""
from fastapi import APIRouter, HTTPException
from ..models import DashboardData, DashboardStats, RiskStatus, PnlDataPoint
from ..database import get_trade_stats, get_pnl_series
from ..scheduler import scheduler
from ..risk_manager import risk_manager
from ..config import settings

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def get_dashboard() -> DashboardData:
    """Get complete dashboard data"""
    try:
        # Get executor stats
        executor_stats = scheduler.executor.get_stats()
        
        # Get trade statistics
        trade_stats = await get_trade_stats(mode=None)  # All modes
        
        # Build stats
        stats = DashboardStats(
            balance=executor_stats.get("balance", 0),
            total_pnl=trade_stats.get("total_pnl", 0),
            roi_pct=(trade_stats.get("total_pnl", 0) / settings.paper_trading.initial_balance) * 100,
            win_rate=trade_stats.get("win_rate", 0),
            total_trades=trade_stats.get("total_trades", 0),
            winning_trades=trade_stats.get("winning_trades", 0),
            losing_trades=trade_stats.get("losing_trades", 0),
            avg_profit_per_trade=trade_stats.get("avg_profit", 0),
            best_trade=trade_stats.get("best_trade", 0),
            worst_trade=trade_stats.get("worst_trade", 0),
            daily_pnl=risk_manager.daily_pnl,
            open_orders=risk_manager.open_orders_count,
        )
        
        # Get risk status
        risk_status_data = risk_manager.get_status()
        risk = RiskStatus(**risk_status_data)
        
        # Get opportunities
        opportunities = scheduler.get_opportunities()
        
        # Get recent trades (from database)
        from ..database import get_trades
        recent_trades_data = await get_trades(limit=10)
        
        # Get PnL series
        pnl_series_data = await get_pnl_series(days=30)
        pnl_series = [PnlDataPoint(**point) for point in pnl_series_data]
        
        return DashboardData(
            stats=stats,
            risk=risk,
            opportunities=opportunities,
            recent_trades=[],  # Will be populated from DB
            pnl_series=pnl_series,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_stats() -> DashboardStats:
    """Get dashboard statistics only"""
    try:
        executor_stats = scheduler.executor.get_stats()
        trade_stats = await get_trade_stats(mode=None)
        
        return DashboardStats(
            balance=executor_stats.get("balance", 0),
            total_pnl=trade_stats.get("total_pnl", 0),
            roi_pct=(trade_stats.get("total_pnl", 0) / settings.paper_trading.initial_balance) * 100,
            win_rate=trade_stats.get("win_rate", 0),
            total_trades=trade_stats.get("total_trades", 0),
            winning_trades=trade_stats.get("winning_trades", 0),
            losing_trades=trade_stats.get("losing_trades", 0),
            avg_profit_per_trade=trade_stats.get("avg_profit", 0),
            best_trade=trade_stats.get("best_trade", 0),
            worst_trade=trade_stats.get("worst_trade", 0),
            daily_pnl=risk_manager.daily_pnl,
            open_orders=risk_manager.open_orders_count,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/risk")
async def get_risk_status() -> RiskStatus:
    """Get risk management status"""
    risk_data = risk_manager.get_status()
    return RiskStatus(**risk_data)
