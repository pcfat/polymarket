"""Risk Management and Circuit Breaker"""
import logging
from datetime import datetime, timedelta
from typing import Optional
from .config import settings
from .models import ArbitrageOpportunity

logger = logging.getLogger(__name__)


class RiskManager:
    """Risk management with circuit breaker mechanism"""
    
    def __init__(self):
        self.max_position_usd = settings.risk.max_position_usd
        self.max_total_exposure_usd = settings.risk.max_total_exposure_usd
        self.max_daily_loss_usd = settings.risk.max_daily_loss_usd
        self.max_open_orders = settings.risk.max_open_orders
        self.cooldown_after_loss_sec = settings.risk.cooldown_after_loss_sec
        
        # State tracking
        self.daily_pnl = 0.0
        self.current_exposure = 0.0
        self.open_orders_count = 0
        self.consecutive_losses = 0
        self.circuit_breaker_active = False
        self.cooldown_until: Optional[datetime] = None
        self.last_reset_date = datetime.now().date()
    
    def reset_daily_stats(self):
        """Reset daily statistics at day boundary"""
        today = datetime.now().date()
        if today != self.last_reset_date:
            logger.info("Resetting daily risk statistics")
            self.daily_pnl = 0.0
            self.last_reset_date = today
            
            # Reset circuit breaker if it was auto-triggered
            if self.circuit_breaker_active:
                logger.info("Auto-resetting circuit breaker for new day")
                self.circuit_breaker_active = False
    
    def check_opportunity(self, opportunity: ArbitrageOpportunity) -> tuple[bool, str]:
        """
        Check if opportunity passes risk management rules
        Returns: (allowed, reason)
        """
        self.reset_daily_stats()
        
        # Check circuit breaker
        if self.circuit_breaker_active:
            return False, "Circuit breaker is active"
        
        # Check cooldown period
        if self.cooldown_until and datetime.now() < self.cooldown_until:
            remaining = (self.cooldown_until - datetime.now()).seconds
            return False, f"In cooldown period ({remaining}s remaining)"
        
        # Check position size
        if opportunity.total_cost > self.max_position_usd:
            return False, f"Position size ${opportunity.total_cost:.2f} exceeds limit ${self.max_position_usd:.2f}"
        
        # Check total exposure
        new_exposure = self.current_exposure + opportunity.total_cost
        if new_exposure > self.max_total_exposure_usd:
            return False, f"Total exposure ${new_exposure:.2f} would exceed limit ${self.max_total_exposure_usd:.2f}"
        
        # Check daily loss limit
        if self.daily_pnl < -self.max_daily_loss_usd:
            logger.warning(f"Daily loss limit reached: ${self.daily_pnl:.2f}")
            self.trigger_circuit_breaker("Daily loss limit exceeded")
            return False, f"Daily loss limit exceeded: ${self.daily_pnl:.2f}"
        
        # Check open orders limit
        if self.open_orders_count >= self.max_open_orders:
            return False, f"Open orders limit reached: {self.open_orders_count}/{self.max_open_orders}"
        
        return True, "OK"
    
    def record_trade_result(self, profit: float):
        """Record trade result and update risk state"""
        self.daily_pnl += profit
        
        if profit < 0:
            self.consecutive_losses += 1
            logger.warning(f"Trade loss: ${profit:.2f}, Consecutive losses: {self.consecutive_losses}")
            
            # Trigger circuit breaker after 5 consecutive losses
            if self.consecutive_losses >= 5:
                self.trigger_circuit_breaker("5 consecutive losses")
            
            # Enter cooldown after loss
            if self.cooldown_after_loss_sec > 0:
                self.cooldown_until = datetime.now() + timedelta(seconds=self.cooldown_after_loss_sec)
                logger.info(f"Entering cooldown until {self.cooldown_until}")
        else:
            # Reset consecutive losses on win
            self.consecutive_losses = 0
            self.cooldown_until = None
    
    def update_exposure(self, delta: float):
        """Update current exposure"""
        self.current_exposure += delta
        self.current_exposure = max(0, self.current_exposure)  # Prevent negative
    
    def update_open_orders(self, delta: int):
        """Update open orders count"""
        self.open_orders_count += delta
        self.open_orders_count = max(0, self.open_orders_count)
    
    def trigger_circuit_breaker(self, reason: str):
        """Trigger circuit breaker to halt trading"""
        self.circuit_breaker_active = True
        logger.critical(f"🚨 CIRCUIT BREAKER TRIGGERED: {reason}")
    
    def reset_circuit_breaker(self):
        """Manually reset circuit breaker"""
        self.circuit_breaker_active = False
        self.consecutive_losses = 0
        self.cooldown_until = None
        logger.info("Circuit breaker manually reset")
    
    def get_status(self) -> dict:
        """Get current risk status"""
        self.reset_daily_stats()
        
        return {
            "circuit_breaker_active": self.circuit_breaker_active,
            "daily_pnl": self.daily_pnl,
            "daily_loss_limit": self.max_daily_loss_usd,
            "total_exposure": self.current_exposure,
            "max_exposure": self.max_total_exposure_usd,
            "open_orders": self.open_orders_count,
            "max_orders": self.max_open_orders,
            "consecutive_losses": self.consecutive_losses,
            "cooldown_until": self.cooldown_until,
        }


# Global risk manager instance
risk_manager = RiskManager()
