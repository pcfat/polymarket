"""Settings API Router"""
from fastapi import APIRouter, HTTPException
from ..models import SettingsUpdate, SettingsResponse
from ..config import settings
from ..scheduler import scheduler

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def get_settings() -> SettingsResponse:
    """Get current settings"""
    return SettingsResponse(
        system={
            "mode": settings.system.mode,
            "log_level": settings.system.log_level,
        },
        arbitrage={
            "strategies": settings.arbitrage.strategies,
            "min_profit_pct": settings.arbitrage.min_profit_pct,
            "min_profit_usd": settings.arbitrage.min_profit_usd,
            "max_slippage_pct": settings.arbitrage.max_slippage_pct,
            "min_liquidity_usd": settings.arbitrage.min_liquidity_usd,
            "scan_interval_seconds": settings.arbitrage.scan_interval_seconds,
            "ws_enabled": settings.arbitrage.ws_enabled,
        },
        risk={
            "max_position_usd": settings.risk.max_position_usd,
            "max_total_exposure_usd": settings.risk.max_total_exposure_usd,
            "max_daily_loss_usd": settings.risk.max_daily_loss_usd,
            "max_open_orders": settings.risk.max_open_orders,
            "cooldown_after_loss_sec": settings.risk.cooldown_after_loss_sec,
        },
        paper_trading={
            "initial_balance": settings.paper_trading.initial_balance,
            "simulate_slippage": settings.paper_trading.simulate_slippage,
            "slippage_bps": settings.paper_trading.slippage_bps,
            "simulate_latency_ms": settings.paper_trading.simulate_latency_ms,
        },
    )


@router.put("")
async def update_settings(updates: SettingsUpdate) -> SettingsResponse:
    """Update settings"""
    try:
        # Update settings
        update_dict = updates.model_dump(exclude_none=True)
        settings.update(update_dict)
        
        # Update scheduler mode if changed
        if updates.system and "mode" in updates.system:
            scheduler.executor.set_mode(updates.system["mode"])
        
        # Update scan interval if changed
        if updates.arbitrage and "scan_interval_seconds" in updates.arbitrage:
            scheduler.scan_interval = updates.arbitrage["scan_interval_seconds"]
        
        # Return updated settings
        return await get_settings()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
