"""Pydantic Models for API and Data Structures"""
from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


# ============================================================================
# Market Models
# ============================================================================

class TokenPrice(BaseModel):
    """Token price information"""
    price: float
    liquidity: float = 0


class Market(BaseModel):
    """Market information"""
    condition_id: str
    question: str
    description: Optional[str] = None
    tokens: List[Dict[str, Any]] = []
    volume: float = 0
    liquidity: float = 0
    active: bool = True
    closed: bool = False


# ============================================================================
# Arbitrage Models
# ============================================================================

class ArbitrageLeg(BaseModel):
    """Single leg of an arbitrage opportunity"""
    market_id: str
    token_id: str
    side: str  # "BUY" or "SELL"
    price: float
    size: float
    outcome: str  # "YES" or "NO" or specific outcome


class ArbitrageOpportunity(BaseModel):
    """Arbitrage opportunity"""
    id: str = Field(default_factory=lambda: f"opp_{datetime.now().timestamp()}")
    strategy: str  # "intra_market", "cross_market", "multi_outcome"
    market_question: str
    legs: List[ArbitrageLeg]
    expected_profit_pct: float
    expected_profit_usd: float
    total_cost: float
    max_executable_size: float
    confidence: float  # 0-1
    timestamp: datetime = Field(default_factory=datetime.now)


# ============================================================================
# Trade Models
# ============================================================================

class TradeStatus(BaseModel):
    """Trade execution status"""
    status: str  # "pending", "executed", "failed", "cancelled"
    message: Optional[str] = None


class TradeRecord(BaseModel):
    """Complete trade record"""
    order_id: str
    mode: str  # "paper" or "live"
    strategy: str
    market_question: str
    status: str
    legs_json: str  # JSON string of legs
    expected_profit_pct: float
    expected_profit_usd: float
    actual_profit_usd: Optional[float] = None
    execution_time_ms: Optional[int] = None
    confidence: float
    timestamp: datetime
    error_message: Optional[str] = None


# ============================================================================
# Dashboard Models
# ============================================================================

class DashboardStats(BaseModel):
    """Dashboard statistics"""
    balance: float
    total_pnl: float
    roi_pct: float
    win_rate: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    avg_profit_per_trade: float
    best_trade: float
    worst_trade: float
    daily_pnl: float
    open_orders: int


class RiskStatus(BaseModel):
    """Risk management status"""
    circuit_breaker_active: bool
    daily_pnl: float
    daily_loss_limit: float
    total_exposure: float
    max_exposure: float
    open_orders: int
    max_orders: int
    consecutive_losses: int
    cooldown_until: Optional[datetime] = None


class PnlDataPoint(BaseModel):
    """PnL time series data point"""
    timestamp: datetime
    cumulative_pnl: float
    trade_count: int


class DashboardData(BaseModel):
    """Complete dashboard data"""
    stats: DashboardStats
    risk: RiskStatus
    opportunities: List[ArbitrageOpportunity]
    recent_trades: List[TradeRecord]
    pnl_series: List[PnlDataPoint]


# ============================================================================
# Settings Models
# ============================================================================

class SettingsUpdate(BaseModel):
    """Settings update request"""
    system: Optional[Dict[str, Any]] = None
    arbitrage: Optional[Dict[str, Any]] = None
    risk: Optional[Dict[str, Any]] = None
    paper_trading: Optional[Dict[str, Any]] = None


class SettingsResponse(BaseModel):
    """Settings response"""
    system: Dict[str, Any]
    arbitrage: Dict[str, Any]
    risk: Dict[str, Any]
    paper_trading: Dict[str, Any]


# ============================================================================
# WebSocket Models
# ============================================================================

class WebSocketMessage(BaseModel):
    """WebSocket message format"""
    type: str  # "dashboard", "opportunities", "trade", "alert"
    data: Dict[str, Any]
    timestamp: datetime = Field(default_factory=datetime.now)


# ============================================================================
# Response Models
# ============================================================================

class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    version: str
    mode: str
    scheduler_running: bool
    timestamp: datetime = Field(default_factory=datetime.now)


class ErrorResponse(BaseModel):
    """Error response"""
    error: str
    detail: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.now)
