"""Polymarket CLOB API Client"""
import httpx
import logging
from typing import List, Dict, Any, Optional
from py_clob_client.client import ClobClient
from py_clob_client.clob_types import OrderArgs, OrderType
from .config import settings

logger = logging.getLogger(__name__)


class PolymarketClient:
    """Client for interacting with Polymarket APIs"""
    
    def __init__(self):
        self.gamma_api_url = settings.polymarket.gamma_api_url
        self.clob_url = settings.polymarket.clob_base_url
        self.chain_id = settings.polymarket.chain_id
        self.client = None
        
        # Initialize py-clob-client if credentials are available
        if settings.polymarket.private_key:
            try:
                self.client = ClobClient(
                    host=self.clob_url,
                    chain_id=self.chain_id,
                    key=settings.polymarket.private_key,
                    signature_type=0,  # EOA
                )
                logger.info("Polymarket CLOB client initialized")
            except Exception as e:
                logger.error(f"Failed to initialize CLOB client: {e}")
                self.client = None
    
    async def get_markets(self, limit: int = 100, active_only: bool = True) -> List[Dict[str, Any]]:
        """Fetch markets from Gamma API"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as http_client:
                params = {
                    "limit": limit,
                    "archived": "false" if active_only else "true",
                }
                response = await http_client.get(
                    f"{self.gamma_api_url}/markets",
                    params=params
                )
                response.raise_for_status()
                data = response.json()
                
                # Parse market data
                markets = []
                for market in data:
                    if isinstance(market, dict):
                        markets.append({
                            "condition_id": market.get("condition_id", ""),
                            "question": market.get("question", ""),
                            "description": market.get("description", ""),
                            "tokens": market.get("tokens", []),
                            "volume": float(market.get("volume", 0)),
                            "liquidity": float(market.get("liquidity", 0)),
                            "active": market.get("active", True),
                            "closed": market.get("closed", False),
                        })
                
                return markets
        except Exception as e:
            logger.error(f"Error fetching markets: {e}")
            return []
    
    async def get_orderbook(self, token_id: str) -> Dict[str, Any]:
        """Get orderbook for a specific token"""
        try:
            async with httpx.AsyncClient(timeout=10.0) as http_client:
                response = await http_client.get(
                    f"{self.clob_url}/book",
                    params={"token_id": token_id}
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Error fetching orderbook for {token_id}: {e}")
            return {"bids": [], "asks": []}
    
    async def get_midpoint(self, token_id: str) -> Optional[float]:
        """Get midpoint price for a token"""
        try:
            async with httpx.AsyncClient(timeout=10.0) as http_client:
                response = await http_client.get(
                    f"{self.clob_url}/midpoint",
                    params={"token_id": token_id}
                )
                response.raise_for_status()
                data = response.json()
                return float(data.get("mid", 0))
        except Exception as e:
            logger.error(f"Error fetching midpoint for {token_id}: {e}")
            return None
    
    async def get_best_prices(self, token_id: str) -> Dict[str, Optional[float]]:
        """Get best bid and ask prices"""
        orderbook = await self.get_orderbook(token_id)
        
        best_bid = None
        best_ask = None
        
        if orderbook.get("bids"):
            best_bid = float(orderbook["bids"][0]["price"])
        
        if orderbook.get("asks"):
            best_ask = float(orderbook["asks"][0]["price"])
        
        return {
            "best_bid": best_bid,
            "best_ask": best_ask,
            "bid_size": float(orderbook["bids"][0]["size"]) if orderbook.get("bids") else 0,
            "ask_size": float(orderbook["asks"][0]["size"]) if orderbook.get("asks") else 0,
        }
    
    def place_order(
        self,
        token_id: str,
        side: str,
        price: float,
        size: float,
        order_type: str = "GTC"
    ) -> Optional[Dict[str, Any]]:
        """Place an order (live trading only)"""
        if not self.client:
            logger.error("CLOB client not initialized - cannot place order")
            return None
        
        try:
            order_args = OrderArgs(
                token_id=token_id,
                price=price,
                size=size,
                side=side.upper(),
                order_type=OrderType.GTC if order_type == "GTC" else OrderType.FOK,
            )
            
            response = self.client.create_order(order_args)
            logger.info(f"Order placed: {response}")
            return response
        except Exception as e:
            logger.error(f"Error placing order: {e}")
            return None
    
    def cancel_order(self, order_id: str) -> bool:
        """Cancel an order"""
        if not self.client:
            logger.error("CLOB client not initialized - cannot cancel order")
            return False
        
        try:
            self.client.cancel_order(order_id)
            logger.info(f"Order cancelled: {order_id}")
            return True
        except Exception as e:
            logger.error(f"Error cancelling order: {e}")
            return False
    
    def cancel_all(self) -> bool:
        """Cancel all open orders"""
        if not self.client:
            logger.error("CLOB client not initialized - cannot cancel orders")
            return False
        
        try:
            self.client.cancel_all()
            logger.info("All orders cancelled")
            return True
        except Exception as e:
            logger.error(f"Error cancelling all orders: {e}")
            return False
    
    def get_balance(self) -> Optional[float]:
        """Get account balance (USDC on Polygon)"""
        if not self.client:
            logger.error("CLOB client not initialized")
            return None
        
        try:
            # This would need proper implementation based on py-clob-client API
            # For now, return a placeholder
            return 10000.0
        except Exception as e:
            logger.error(f"Error fetching balance: {e}")
            return None


# Global client instance
polymarket_client = PolymarketClient()
