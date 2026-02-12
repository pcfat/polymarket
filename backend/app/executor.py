"""Trade Execution Engine - Paper and Live Trading"""
import asyncio
import logging
import time
import uuid
from typing import Dict, Any, Optional
from datetime import datetime
from .models import ArbitrageOpportunity, TradeStatus
from .config import settings

logger = logging.getLogger(__name__)


class PaperTradingEngine:
    """Simulated trading engine for paper trading"""
    
    def __init__(self, initial_balance: float):
        self.balance = initial_balance
        self.initial_balance = initial_balance
        self.total_pnl = 0.0
        self.positions = {}
        self.open_orders = []
        self.slippage_bps = settings.paper_trading.slippage_bps
        self.latency_ms = settings.paper_trading.simulate_latency_ms
        self.simulate_slippage = settings.paper_trading.simulate_slippage
    
    async def execute_opportunity(
        self,
        opportunity: ArbitrageOpportunity
    ) -> Dict[str, Any]:
        """Execute arbitrage opportunity in paper mode"""
        order_id = f"paper_{uuid.uuid4().hex[:8]}"
        start_time = time.time()
        
        # Simulate network latency
        if self.latency_ms > 0:
            await asyncio.sleep(self.latency_ms / 1000)
        
        try:
            # Calculate total cost
            total_cost = opportunity.total_cost
            
            # Check if we have enough balance
            if total_cost > self.balance:
                return {
                    "order_id": order_id,
                    "status": "failed",
                    "error": f"Insufficient balance: ${self.balance:.2f} < ${total_cost:.2f}",
                    "execution_time_ms": 0,
                }
            
            # Simulate slippage
            actual_profit = opportunity.expected_profit_usd
            if self.simulate_slippage:
                slippage_factor = 1 - (self.slippage_bps / 10000)
                actual_profit *= slippage_factor
            
            # Execute trade
            self.balance -= total_cost
            self.balance += (total_cost + actual_profit)  # Return capital + profit
            self.total_pnl += actual_profit
            
            # Track order
            self.open_orders.append({
                "order_id": order_id,
                "opportunity": opportunity,
                "executed_at": datetime.now(),
            })
            
            execution_time = int((time.time() - start_time) * 1000)
            
            logger.info(
                f"Paper trade executed: {order_id}, "
                f"Profit: ${actual_profit:.2f}, "
                f"Balance: ${self.balance:.2f}"
            )
            
            return {
                "order_id": order_id,
                "status": "executed",
                "actual_profit_usd": actual_profit,
                "execution_time_ms": execution_time,
                "balance": self.balance,
                "total_pnl": self.total_pnl,
            }
        
        except Exception as e:
            logger.error(f"Paper trade execution failed: {e}")
            return {
                "order_id": order_id,
                "status": "failed",
                "error": str(e),
                "execution_time_ms": int((time.time() - start_time) * 1000),
            }
    
    def get_stats(self) -> Dict[str, Any]:
        """Get paper trading statistics"""
        return {
            "mode": "paper",
            "balance": self.balance,
            "initial_balance": self.initial_balance,
            "total_pnl": self.total_pnl,
            "roi_pct": (self.total_pnl / self.initial_balance) * 100,
            "open_orders": len(self.open_orders),
        }


class LiveTradingEngine:
    """Live trading engine using Polymarket CLOB API"""
    
    def __init__(self, polymarket_client):
        self.client = polymarket_client
        self.open_orders = []
    
    async def execute_opportunity(
        self,
        opportunity: ArbitrageOpportunity
    ) -> Dict[str, Any]:
        """Execute arbitrage opportunity in live mode"""
        order_id = f"live_{uuid.uuid4().hex[:8]}"
        start_time = time.time()
        
        if not self.client.client:
            return {
                "order_id": order_id,
                "status": "failed",
                "error": "CLOB client not initialized - check API credentials",
                "execution_time_ms": 0,
            }
        
        placed_orders = []
        
        try:
            # Place all legs of the arbitrage
            for leg in opportunity.legs:
                order_response = self.client.place_order(
                    token_id=leg.token_id,
                    side=leg.side,
                    price=leg.price,
                    size=leg.size,
                    order_type="GTC"
                )
                
                if not order_response:
                    raise Exception(f"Failed to place order for leg: {leg.outcome}")
                
                placed_orders.append(order_response)
            
            # All orders placed successfully
            execution_time = int((time.time() - start_time) * 1000)
            
            logger.info(f"Live trade executed: {order_id}, Orders: {len(placed_orders)}")
            
            # Track orders
            self.open_orders.append({
                "order_id": order_id,
                "opportunity": opportunity,
                "placed_orders": placed_orders,
                "executed_at": datetime.now(),
            })
            
            return {
                "order_id": order_id,
                "status": "executed",
                "actual_profit_usd": opportunity.expected_profit_usd,  # Estimate
                "execution_time_ms": execution_time,
                "placed_orders": placed_orders,
            }
        
        except Exception as e:
            logger.error(f"Live trade execution failed: {e}")
            
            # Rollback: Cancel all placed orders
            for order_response in placed_orders:
                try:
                    if "orderId" in order_response:
                        self.client.cancel_order(order_response["orderId"])
                except Exception as cancel_error:
                    logger.error(f"Failed to cancel order during rollback: {cancel_error}")
            
            return {
                "order_id": order_id,
                "status": "failed",
                "error": str(e),
                "execution_time_ms": int((time.time() - start_time) * 1000),
            }
    
    def get_stats(self) -> Dict[str, Any]:
        """Get live trading statistics"""
        balance = self.client.get_balance() or 0
        return {
            "mode": "live",
            "balance": balance,
            "open_orders": len(self.open_orders),
        }


class OrderExecutor:
    """Main executor that switches between paper and live trading"""
    
    def __init__(self, polymarket_client):
        self.paper_engine = PaperTradingEngine(
            settings.paper_trading.initial_balance
        )
        self.live_engine = LiveTradingEngine(polymarket_client)
        self.mode = settings.system.mode
    
    async def execute(
        self,
        opportunity: ArbitrageOpportunity
    ) -> Dict[str, Any]:
        """Execute opportunity based on current mode"""
        if self.mode == "paper":
            return await self.paper_engine.execute_opportunity(opportunity)
        elif self.mode == "live":
            return await self.live_engine.execute_opportunity(opportunity)
        else:
            return {
                "order_id": f"error_{uuid.uuid4().hex[:8]}",
                "status": "failed",
                "error": f"Unknown mode: {self.mode}",
                "execution_time_ms": 0,
            }
    
    def set_mode(self, mode: str):
        """Change trading mode"""
        if mode in ["paper", "live"]:
            self.mode = mode
            settings.system.mode = mode
            logger.info(f"Trading mode switched to: {mode}")
        else:
            logger.error(f"Invalid mode: {mode}")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get current engine statistics"""
        if self.mode == "paper":
            return self.paper_engine.get_stats()
        else:
            return self.live_engine.get_stats()
