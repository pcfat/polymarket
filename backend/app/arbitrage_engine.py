"""Arbitrage Engine - Three Strategy Implementation"""
import logging
from typing import List, Dict, Any
from datetime import datetime
from .models import ArbitrageOpportunity, ArbitrageLeg
from .config import settings

logger = logging.getLogger(__name__)


class ArbitrageEngine:
    """Arbitrage opportunity scanner with three strategies"""
    
    def __init__(self, polymarket_client):
        self.client = polymarket_client
        self.min_profit_pct = settings.arbitrage.min_profit_pct
        self.min_profit_usd = settings.arbitrage.min_profit_usd
        self.min_liquidity = settings.arbitrage.min_liquidity_usd
    
    async def scan_opportunities(self) -> List[ArbitrageOpportunity]:
        """Scan all enabled strategies for arbitrage opportunities"""
        opportunities = []
        enabled_strategies = settings.arbitrage.strategies
        
        # Fetch markets
        markets = await self.client.get_markets()
        
        if "intra_market" in enabled_strategies:
            opportunities.extend(await self.scan_intra_market(markets))
        
        if "multi_outcome" in enabled_strategies:
            opportunities.extend(await self.scan_multi_outcome(markets))
        
        if "cross_market" in enabled_strategies:
            opportunities.extend(await self.scan_cross_market(markets))
        
        # Filter by minimum profit requirements
        filtered = [
            opp for opp in opportunities
            if opp.expected_profit_pct >= self.min_profit_pct
            and opp.expected_profit_usd >= self.min_profit_usd
        ]
        
        logger.info(f"Found {len(filtered)} arbitrage opportunities")
        return filtered
    
    async def scan_intra_market(self, markets: List[Dict[str, Any]]) -> List[ArbitrageOpportunity]:
        """
        Intra-market arbitrage: YES best_ask + NO best_ask < 1.00
        Buy both sides to lock in profit
        """
        opportunities = []
        
        for market in markets:
            if market.get("closed") or not market.get("active"):
                continue
            
            tokens = market.get("tokens", [])
            if len(tokens) != 2:
                continue
            
            # Get prices for YES and NO tokens
            yes_token = None
            no_token = None
            
            for token in tokens:
                outcome = token.get("outcome", "").upper()
                if outcome == "YES":
                    yes_token = token
                elif outcome == "NO":
                    no_token = token
            
            if not yes_token or not no_token:
                continue
            
            yes_token_id = yes_token.get("token_id")
            no_token_id = no_token.get("token_id")
            
            if not yes_token_id or not no_token_id:
                continue
            
            # Fetch orderbook prices
            yes_prices = await self.client.get_best_prices(yes_token_id)
            no_prices = await self.client.get_best_prices(no_token_id)
            
            yes_ask = yes_prices.get("best_ask")
            no_ask = no_prices.get("best_ask")
            
            if yes_ask is None or no_ask is None:
                continue
            
            # Check if arbitrage exists
            total_cost = yes_ask + no_ask
            if total_cost < 1.0:
                profit = 1.0 - total_cost
                profit_pct = (profit / total_cost) * 100
                
                # Calculate max executable size (limited by liquidity)
                max_size = min(
                    yes_prices.get("ask_size", 0),
                    no_prices.get("ask_size", 0)
                )
                
                if max_size * total_cost < self.min_liquidity:
                    continue
                
                legs = [
                    ArbitrageLeg(
                        market_id=market["condition_id"],
                        token_id=yes_token_id,
                        side="BUY",
                        price=yes_ask,
                        size=max_size,
                        outcome="YES"
                    ),
                    ArbitrageLeg(
                        market_id=market["condition_id"],
                        token_id=no_token_id,
                        side="BUY",
                        price=no_ask,
                        size=max_size,
                        outcome="NO"
                    ),
                ]
                
                opportunity = ArbitrageOpportunity(
                    strategy="intra_market",
                    market_question=market["question"],
                    legs=legs,
                    expected_profit_pct=profit_pct,
                    expected_profit_usd=profit * max_size,
                    total_cost=total_cost * max_size,
                    max_executable_size=max_size,
                    confidence=0.95,  # High confidence for intra-market
                )
                opportunities.append(opportunity)
        
        return opportunities
    
    async def scan_multi_outcome(self, markets: List[Dict[str, Any]]) -> List[ArbitrageOpportunity]:
        """
        Multi-outcome arbitrage: Sum of all outcome best_ask < 1.00
        Buy all outcomes to guarantee profit
        """
        opportunities = []
        
        for market in markets:
            if market.get("closed") or not market.get("active"):
                continue
            
            tokens = market.get("tokens", [])
            if len(tokens) < 3:  # Need at least 3 outcomes
                continue
            
            # Fetch prices for all outcomes
            legs = []
            total_cost = 0
            min_size = float('inf')
            
            for token in tokens:
                token_id = token.get("token_id")
                if not token_id:
                    continue
                
                prices = await self.client.get_best_prices(token_id)
                best_ask = prices.get("best_ask")
                ask_size = prices.get("ask_size", 0)
                
                if best_ask is None or ask_size == 0:
                    break
                
                total_cost += best_ask
                min_size = min(min_size, ask_size)
                
                legs.append(ArbitrageLeg(
                    market_id=market["condition_id"],
                    token_id=token_id,
                    side="BUY",
                    price=best_ask,
                    size=ask_size,
                    outcome=token.get("outcome", "")
                ))
            
            # Check if all tokens were processed
            if len(legs) != len(tokens):
                continue
            
            # Check for arbitrage
            if total_cost < 1.0 and min_size > 0:
                profit = 1.0 - total_cost
                profit_pct = (profit / total_cost) * 100
                
                if min_size * total_cost < self.min_liquidity:
                    continue
                
                # Update all legs with the same size
                for leg in legs:
                    leg.size = min_size
                
                opportunity = ArbitrageOpportunity(
                    strategy="multi_outcome",
                    market_question=market["question"],
                    legs=legs,
                    expected_profit_pct=profit_pct,
                    expected_profit_usd=profit * min_size,
                    total_cost=total_cost * min_size,
                    max_executable_size=min_size,
                    confidence=0.90,  # High confidence for multi-outcome
                )
                opportunities.append(opportunity)
        
        return opportunities
    
    async def scan_cross_market(self, markets: List[Dict[str, Any]]) -> List[ArbitrageOpportunity]:
        """
        Cross-market arbitrage: Related markets with pricing discrepancies
        This is a simplified implementation - real implementation would need
        semantic analysis to find related markets
        """
        opportunities = []
        
        # Simplified: Look for markets with similar keywords
        # In production, this would use NLP/embeddings for semantic similarity
        
        keywords_map = {}
        for market in markets:
            if market.get("closed") or not market.get("active"):
                continue
            
            question = market.get("question", "").lower()
            # Extract key terms (simplified)
            words = set(question.split())
            
            for word in words:
                if len(word) > 4:  # Only meaningful words
                    if word not in keywords_map:
                        keywords_map[word] = []
                    keywords_map[word].append(market)
        
        # Find markets with shared keywords
        checked_pairs = set()
        
        for keyword, related_markets in keywords_map.items():
            if len(related_markets) < 2:
                continue
            
            for i, market1 in enumerate(related_markets):
                for market2 in related_markets[i+1:]:
                    pair_key = tuple(sorted([market1["condition_id"], market2["condition_id"]]))
                    if pair_key in checked_pairs:
                        continue
                    checked_pairs.add(pair_key)
                    
                    # Compare YES token prices
                    tokens1 = market1.get("tokens", [])
                    tokens2 = market2.get("tokens", [])
                    
                    yes_token1 = next((t for t in tokens1 if t.get("outcome", "").upper() == "YES"), None)
                    yes_token2 = next((t for t in tokens2 if t.get("outcome", "").upper() == "YES"), None)
                    
                    if not yes_token1 or not yes_token2:
                        continue
                    
                    prices1 = await self.client.get_best_prices(yes_token1["token_id"])
                    prices2 = await self.client.get_best_prices(yes_token2["token_id"])
                    
                    ask1 = prices1.get("best_ask")
                    bid2 = prices2.get("best_bid")
                    
                    if ask1 is None or bid2 is None:
                        continue
                    
                    # If can buy in market1 cheaper than sell in market2
                    if ask1 < bid2:
                        profit_pct = ((bid2 - ask1) / ask1) * 100
                        
                        if profit_pct < self.min_profit_pct:
                            continue
                        
                        max_size = min(
                            prices1.get("ask_size", 0),
                            prices2.get("bid_size", 0)
                        )
                        
                        if max_size * ask1 < self.min_liquidity:
                            continue
                        
                        legs = [
                            ArbitrageLeg(
                                market_id=market1["condition_id"],
                                token_id=yes_token1["token_id"],
                                side="BUY",
                                price=ask1,
                                size=max_size,
                                outcome="YES"
                            ),
                            ArbitrageLeg(
                                market_id=market2["condition_id"],
                                token_id=yes_token2["token_id"],
                                side="SELL",
                                price=bid2,
                                size=max_size,
                                outcome="YES"
                            ),
                        ]
                        
                        opportunity = ArbitrageOpportunity(
                            strategy="cross_market",
                            market_question=f"{market1['question']} <-> {market2['question']}",
                            legs=legs,
                            expected_profit_pct=profit_pct,
                            expected_profit_usd=(bid2 - ask1) * max_size,
                            total_cost=ask1 * max_size,
                            max_executable_size=max_size,
                            confidence=0.70,  # Lower confidence due to complexity
                        )
                        opportunities.append(opportunity)
        
        return opportunities
