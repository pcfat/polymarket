"""Database management with SQLAlchemy"""
import os
import json
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from sqlalchemy import create_engine, Column, String, Float, Integer, DateTime, Text, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

# Database URL
DATABASE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "data")
os.makedirs(DATABASE_DIR, exist_ok=True)
DATABASE_URL = f"sqlite+aiosqlite:///{os.path.join(DATABASE_DIR, 'arbitrage.db')}"

# Create async engine
engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

Base = declarative_base()


# ============================================================================
# Database Models
# ============================================================================

class TradeRecordDB(Base):
    """Trade record database model"""
    __tablename__ = "trades"
    
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String, unique=True, index=True)
    mode = Column(String, index=True)  # "paper" or "live"
    strategy = Column(String, index=True)  # "intra_market", "cross_market", "multi_outcome"
    market_question = Column(String)
    status = Column(String, index=True)  # "pending", "executed", "failed", "cancelled"
    legs_json = Column(Text)  # JSON string of legs
    expected_profit_pct = Column(Float)
    expected_profit_usd = Column(Float)
    actual_profit_usd = Column(Float, nullable=True)
    execution_time_ms = Column(Integer, nullable=True)
    confidence = Column(Float)
    timestamp = Column(DateTime, default=datetime.now, index=True)
    error_message = Column(String, nullable=True)


class BalanceRecordDB(Base):
    """Balance tracking for paper trading"""
    __tablename__ = "balances"
    
    id = Column(Integer, primary_key=True, index=True)
    mode = Column(String, index=True)
    balance = Column(Float)
    total_pnl = Column(Float)
    timestamp = Column(DateTime, default=datetime.now, index=True)


# ============================================================================
# Database Initialization
# ============================================================================

async def init_db():
    """Initialize database tables"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ============================================================================
# CRUD Operations
# ============================================================================

async def get_db():
    """Get database session"""
    async with AsyncSessionLocal() as session:
        yield session


async def save_trade(trade_data: Dict[str, Any]) -> str:
    """Save trade record to database"""
    async with AsyncSessionLocal() as session:
        trade = TradeRecordDB(
            order_id=trade_data["order_id"],
            mode=trade_data["mode"],
            strategy=trade_data["strategy"],
            market_question=trade_data["market_question"],
            status=trade_data["status"],
            legs_json=json.dumps(trade_data["legs"]),
            expected_profit_pct=trade_data["expected_profit_pct"],
            expected_profit_usd=trade_data["expected_profit_usd"],
            actual_profit_usd=trade_data.get("actual_profit_usd"),
            execution_time_ms=trade_data.get("execution_time_ms"),
            confidence=trade_data["confidence"],
            timestamp=trade_data.get("timestamp", datetime.now()),
            error_message=trade_data.get("error_message"),
        )
        session.add(trade)
        await session.commit()
        return trade.order_id


async def update_trade(order_id: str, updates: Dict[str, Any]):
    """Update trade record"""
    from sqlalchemy import select
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TradeRecordDB).where(TradeRecordDB.order_id == order_id)
        )
        trade = result.scalar_one_or_none()
        if trade:
            for key, value in updates.items():
                setattr(trade, key, value)
            await session.commit()


async def get_trades(
    limit: int = 100,
    offset: int = 0,
    mode: Optional[str] = None,
    strategy: Optional[str] = None,
    status: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Get trade records with filtering and pagination"""
    from sqlalchemy import select, desc
    
    async with AsyncSessionLocal() as session:
        query = select(TradeRecordDB)
        
        if mode:
            query = query.where(TradeRecordDB.mode == mode)
        if strategy:
            query = query.where(TradeRecordDB.strategy == strategy)
        if status:
            query = query.where(TradeRecordDB.status == status)
        
        query = query.order_by(desc(TradeRecordDB.timestamp)).limit(limit).offset(offset)
        
        result = await session.execute(query)
        trades = result.scalars().all()
        
        return [
            {
                "order_id": trade.order_id,
                "mode": trade.mode,
                "strategy": trade.strategy,
                "market_question": trade.market_question,
                "status": trade.status,
                "legs_json": trade.legs_json,
                "expected_profit_pct": trade.expected_profit_pct,
                "expected_profit_usd": trade.expected_profit_usd,
                "actual_profit_usd": trade.actual_profit_usd,
                "execution_time_ms": trade.execution_time_ms,
                "confidence": trade.confidence,
                "timestamp": trade.timestamp,
                "error_message": trade.error_message,
            }
            for trade in trades
        ]


async def get_trade_stats(mode: Optional[str] = None) -> Dict[str, Any]:
    """Get trade statistics"""
    from sqlalchemy import select, func
    
    async with AsyncSessionLocal() as session:
        query = select(TradeRecordDB)
        if mode:
            query = query.where(TradeRecordDB.mode == mode)
        
        result = await session.execute(query)
        trades = result.scalars().all()
        
        if not trades:
            return {
                "total_trades": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "total_pnl": 0.0,
                "win_rate": 0.0,
                "avg_profit": 0.0,
                "best_trade": 0.0,
                "worst_trade": 0.0,
            }
        
        executed_trades = [t for t in trades if t.status == "executed" and t.actual_profit_usd is not None]
        
        if not executed_trades:
            return {
                "total_trades": len(trades),
                "winning_trades": 0,
                "losing_trades": 0,
                "total_pnl": 0.0,
                "win_rate": 0.0,
                "avg_profit": 0.0,
                "best_trade": 0.0,
                "worst_trade": 0.0,
            }
        
        profits = [t.actual_profit_usd for t in executed_trades]
        winning = [p for p in profits if p > 0]
        losing = [p for p in profits if p < 0]
        
        return {
            "total_trades": len(trades),
            "winning_trades": len(winning),
            "losing_trades": len(losing),
            "total_pnl": sum(profits),
            "win_rate": len(winning) / len(executed_trades) * 100 if executed_trades else 0,
            "avg_profit": sum(profits) / len(executed_trades) if executed_trades else 0,
            "best_trade": max(profits) if profits else 0,
            "worst_trade": min(profits) if profits else 0,
        }


async def get_pnl_series(
    mode: Optional[str] = None,
    days: int = 30
) -> List[Dict[str, Any]]:
    """Get PnL time series data"""
    from sqlalchemy import select
    
    start_date = datetime.now() - timedelta(days=days)
    
    async with AsyncSessionLocal() as session:
        query = select(TradeRecordDB).where(
            TradeRecordDB.timestamp >= start_date,
            TradeRecordDB.status == "executed"
        )
        
        if mode:
            query = query.where(TradeRecordDB.mode == mode)
        
        query = query.order_by(TradeRecordDB.timestamp)
        
        result = await session.execute(query)
        trades = result.scalars().all()
        
        pnl_series = []
        cumulative_pnl = 0
        trade_count = 0
        
        for trade in trades:
            if trade.actual_profit_usd is not None:
                cumulative_pnl += trade.actual_profit_usd
                trade_count += 1
                pnl_series.append({
                    "timestamp": trade.timestamp,
                    "cumulative_pnl": cumulative_pnl,
                    "trade_count": trade_count,
                })
        
        return pnl_series


async def save_balance(mode: str, balance: float, total_pnl: float):
    """Save balance snapshot"""
    async with AsyncSessionLocal() as session:
        balance_record = BalanceRecordDB(
            mode=mode,
            balance=balance,
            total_pnl=total_pnl,
        )
        session.add(balance_record)
        await session.commit()


async def get_latest_balance(mode: str) -> Optional[Dict[str, Any]]:
    """Get latest balance record"""
    from sqlalchemy import select, desc
    
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(BalanceRecordDB)
            .where(BalanceRecordDB.mode == mode)
            .order_by(desc(BalanceRecordDB.timestamp))
            .limit(1)
        )
        balance = result.scalar_one_or_none()
        
        if balance:
            return {
                "balance": balance.balance,
                "total_pnl": balance.total_pnl,
                "timestamp": balance.timestamp,
            }
        return None
