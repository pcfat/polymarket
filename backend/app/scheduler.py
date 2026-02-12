"""24-Hour Background Scheduler for Arbitrage Scanning"""
import asyncio
import logging
from datetime import datetime
from .polymarket_client import polymarket_client
from .arbitrage_engine import ArbitrageEngine
from .executor import OrderExecutor
from .risk_manager import risk_manager
from .websocket_manager import websocket_manager
from .database import save_trade, save_balance
from .config import settings

logger = logging.getLogger(__name__)


class ArbitrageScheduler:
    """Background scheduler for continuous arbitrage monitoring"""
    
    def __init__(self):
        self.running = False
        self.task = None
        self.arbitrage_engine = ArbitrageEngine(polymarket_client)
        self.executor = OrderExecutor(polymarket_client)
        self.scan_interval = settings.arbitrage.scan_interval_seconds
        self.opportunities_cache = []
    
    async def start(self):
        """Start the scheduler"""
        if self.running:
            logger.warning("Scheduler already running")
            return
        
        self.running = True
        self.task = asyncio.create_task(self._run_loop())
        logger.info("Arbitrage scheduler started")
    
    async def stop(self):
        """Stop the scheduler"""
        self.running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        logger.info("Arbitrage scheduler stopped")
    
    async def _run_loop(self):
        """Main scheduler loop"""
        while self.running:
            try:
                await self._execute_cycle()
            except Exception as e:
                logger.error(f"Error in scheduler cycle: {e}", exc_info=True)
            
            # Wait for next scan
            await asyncio.sleep(self.scan_interval)
    
    async def _execute_cycle(self):
        """Execute one cycle of arbitrage scanning and execution"""
        cycle_start = datetime.now()
        logger.debug(f"Starting arbitrage cycle at {cycle_start}")
        
        # Step 1: Scan for opportunities
        opportunities = await self.arbitrage_engine.scan_opportunities()
        self.opportunities_cache = opportunities
        
        # Broadcast opportunities to WebSocket clients
        if settings.arbitrage.ws_enabled:
            await websocket_manager.broadcast_opportunities(
                [opp.model_dump(mode='json') for opp in opportunities]
            )
        
        # Step 2: Execute opportunities (if any)
        for opportunity in opportunities:
            # Check risk management
            allowed, reason = risk_manager.check_opportunity(opportunity)
            
            if not allowed:
                logger.info(f"Opportunity rejected by risk manager: {reason}")
                continue
            
            # Update exposure before execution
            risk_manager.update_exposure(opportunity.total_cost)
            risk_manager.update_open_orders(1)
            
            # Execute
            result = await self.executor.execute(opportunity)
            
            # Record result
            trade_data = {
                "order_id": result["order_id"],
                "mode": self.executor.mode,
                "strategy": opportunity.strategy,
                "market_question": opportunity.market_question,
                "status": result["status"],
                "legs": [leg.model_dump() for leg in opportunity.legs],
                "expected_profit_pct": opportunity.expected_profit_pct,
                "expected_profit_usd": opportunity.expected_profit_usd,
                "actual_profit_usd": result.get("actual_profit_usd"),
                "execution_time_ms": result.get("execution_time_ms"),
                "confidence": opportunity.confidence,
                "timestamp": datetime.now(),
                "error_message": result.get("error"),
            }
            
            # Save to database
            try:
                await save_trade(trade_data)
            except Exception as e:
                logger.error(f"Failed to save trade to database: {e}")
            
            # Update risk manager
            if result["status"] == "executed":
                profit = result.get("actual_profit_usd", 0)
                risk_manager.record_trade_result(profit)
            else:
                risk_manager.record_trade_result(-opportunity.expected_profit_usd * 0.1)  # Small penalty for failed trades
            
            # Release exposure
            risk_manager.update_exposure(-opportunity.total_cost)
            risk_manager.update_open_orders(-1)
            
            # Broadcast trade result
            if settings.arbitrage.ws_enabled:
                await websocket_manager.broadcast_trade(trade_data)
            
            # Alert on circuit breaker
            if risk_manager.circuit_breaker_active:
                await websocket_manager.broadcast_alert(
                    "error",
                    "Circuit breaker triggered - trading halted"
                )
                break
        
        # Step 3: Update balance snapshot
        try:
            stats = self.executor.get_stats()
            if "balance" in stats and "total_pnl" in stats:
                await save_balance(
                    mode=self.executor.mode,
                    balance=stats["balance"],
                    total_pnl=stats.get("total_pnl", 0)
                )
        except Exception as e:
            logger.error(f"Failed to save balance: {e}")
        
        cycle_duration = (datetime.now() - cycle_start).total_seconds()
        logger.debug(f"Cycle completed in {cycle_duration:.2f}s, found {len(opportunities)} opportunities")
    
    def get_status(self) -> dict:
        """Get scheduler status"""
        return {
            "running": self.running,
            "scan_interval": self.scan_interval,
            "last_opportunities_count": len(self.opportunities_cache),
            "executor_mode": self.executor.mode,
        }
    
    def get_opportunities(self) -> list:
        """Get cached opportunities"""
        return self.opportunities_cache


# Global scheduler instance
scheduler = ArbitrageScheduler()
