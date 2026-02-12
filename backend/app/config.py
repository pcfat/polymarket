"""Configuration Management - Load from YAML and Environment Variables"""
import os
from pathlib import Path
from typing import List, Optional
import yaml
from pydantic import Field
from pydantic_settings import BaseSettings


class SystemConfig(BaseSettings):
    """System configuration"""
    mode: str = "paper"  # paper or live
    log_level: str = "INFO"
    jwt_secret: str = "change-me-in-production"


class PolymarketConfig(BaseSettings):
    """Polymarket API configuration"""
    clob_base_url: str = "https://clob.polymarket.com"
    gamma_api_url: str = "https://gamma-api.polymarket.com"
    ws_url: str = "wss://ws-subscriptions-clob.polymarket.com/ws/"
    chain_id: int = 137
    private_key: Optional[str] = Field(default=None, alias="POLYMARKET_PRIVATE_KEY")
    api_key: Optional[str] = Field(default=None, alias="POLYMARKET_API_KEY")
    api_secret: Optional[str] = Field(default=None, alias="POLYMARKET_API_SECRET")
    api_passphrase: Optional[str] = Field(default=None, alias="POLYMARKET_API_PASSPHRASE")

    class Config:
        env_prefix = ""


class ArbitrageConfig(BaseSettings):
    """Arbitrage strategy configuration"""
    strategies: List[str] = ["intra_market", "cross_market", "multi_outcome"]
    min_profit_pct: float = 0.5
    min_profit_usd: float = 0.50
    max_slippage_pct: float = 0.3
    min_liquidity_usd: float = 500
    scan_interval_seconds: int = 5
    ws_enabled: bool = True


class RiskConfig(BaseSettings):
    """Risk management configuration"""
    max_position_usd: float = 500
    max_total_exposure_usd: float = 5000
    max_daily_loss_usd: float = 200
    max_open_orders: int = 20
    cooldown_after_loss_sec: int = 300


class PaperTradingConfig(BaseSettings):
    """Paper trading simulation configuration"""
    initial_balance: float = 10000
    simulate_slippage: bool = True
    slippage_bps: int = 10
    simulate_latency_ms: int = 200


class TelegramConfig(BaseSettings):
    """Telegram notification configuration"""
    bot_token: Optional[str] = Field(default=None, alias="TELEGRAM_BOT_TOKEN")
    chat_id: Optional[str] = Field(default=None, alias="TELEGRAM_CHAT_ID")

    class Config:
        env_prefix = ""


class Settings:
    """Main settings class that loads from YAML and environment variables"""
    
    def __init__(self, config_path: str = None):
        if config_path is None:
            config_path = os.path.join(
                Path(__file__).parent.parent, "config", "settings.yaml"
            )
        
        self.config_path = config_path
        self._load_config()
    
    def _load_config(self):
        """Load configuration from YAML file"""
        if os.path.exists(self.config_path):
            with open(self.config_path, "r", encoding="utf-8") as f:
                config_data = yaml.safe_load(f) or {}
        else:
            config_data = {}
        
        # Load each section
        self.system = SystemConfig(**config_data.get("system", {}))
        self.polymarket = PolymarketConfig(**config_data.get("polymarket", {}))
        self.arbitrage = ArbitrageConfig(**config_data.get("arbitrage", {}))
        self.risk = RiskConfig(**config_data.get("risk", {}))
        self.paper_trading = PaperTradingConfig(**config_data.get("paper_trading", {}))
        self.telegram = TelegramConfig(**config_data.get("telegram", {}))
    
    def save_config(self):
        """Save current configuration back to YAML file"""
        config_data = {
            "system": {
                "mode": self.system.mode,
                "log_level": self.system.log_level,
                "jwt_secret": self.system.jwt_secret,
            },
            "polymarket": {
                "clob_base_url": self.polymarket.clob_base_url,
                "gamma_api_url": self.polymarket.gamma_api_url,
                "ws_url": self.polymarket.ws_url,
                "chain_id": self.polymarket.chain_id,
            },
            "arbitrage": {
                "strategies": self.arbitrage.strategies,
                "min_profit_pct": self.arbitrage.min_profit_pct,
                "min_profit_usd": self.arbitrage.min_profit_usd,
                "max_slippage_pct": self.arbitrage.max_slippage_pct,
                "min_liquidity_usd": self.arbitrage.min_liquidity_usd,
                "scan_interval_seconds": self.arbitrage.scan_interval_seconds,
                "ws_enabled": self.arbitrage.ws_enabled,
            },
            "risk": {
                "max_position_usd": self.risk.max_position_usd,
                "max_total_exposure_usd": self.risk.max_total_exposure_usd,
                "max_daily_loss_usd": self.risk.max_daily_loss_usd,
                "max_open_orders": self.risk.max_open_orders,
                "cooldown_after_loss_sec": self.risk.cooldown_after_loss_sec,
            },
            "paper_trading": {
                "initial_balance": self.paper_trading.initial_balance,
                "simulate_slippage": self.paper_trading.simulate_slippage,
                "slippage_bps": self.paper_trading.slippage_bps,
                "simulate_latency_ms": self.paper_trading.simulate_latency_ms,
            },
        }
        
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as f:
            yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)
    
    def update(self, updates: dict):
        """Update configuration dynamically"""
        for section, values in updates.items():
            if hasattr(self, section):
                section_obj = getattr(self, section)
                for key, value in values.items():
                    if hasattr(section_obj, key):
                        setattr(section_obj, key, value)
        self.save_config()


# Global settings instance
settings = Settings()
