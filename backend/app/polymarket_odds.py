"""
Polymarket Odds - Using CLOB midpoint for accurate live prices
"""

import httpx
import json
import time
from dataclasses import dataclass


@dataclass
class MarketOdds:
    coin: str
    title: str
    up_price: float
    down_price: float
    slug: str
    up_token_id: str
    down_token_id: str
    timestamp: int

    @property
    def up_pct(self) -> str:
        return f"{self.up_price * 100:.1f}%"

    @property
    def down_pct(self) -> str:
        return f"{self.down_price * 100:.1f}%"


@dataclass
class MarketResult:
    coin: str
    slug: str
    winner: str
    closed: bool


SUPPORTED_COINS = ["btc", "eth", "sol", "xrp"]
COIN_SYMBOLS = {"btc": "BTC", "eth": "ETH", "sol": "SOL", "xrp": "XRP"}

_token_cache: dict[str, dict] = {}


def get_current_window_timestamp() -> int:
    now = int(time.time())
    return now - (now % 900)


async def _get_market_info(coin: str, window_ts: int) -> dict | None:
    cache_key = f"{coin}-{window_ts}"
    if cache_key in _token_cache:
        return _token_cache[cache_key]

    slug = f"{coin}-updown-15m-{window_ts}"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                f"https://gamma-api.polymarket.com/events?slug={slug}"
            )
            data = r.json()
            if not data:
                return None

            event = data[0]
            market = event.get("markets", [{}])[0]

            clob_ids_raw = market.get("clobTokenIds", "[]")
            if isinstance(clob_ids_raw, str):
                clob_ids = json.loads(clob_ids_raw)
            else:
                clob_ids = clob_ids_raw

            outcomes_raw = market.get("outcomes", '["Up","Down"]')
            if isinstance(outcomes_raw, str):
                outcomes = json.loads(outcomes_raw)
            else:
                outcomes = outcomes_raw

            if len(clob_ids) < 2 or len(outcomes) < 2:
                return None

            up_idx = 0
            down_idx = 1
            for i, o in enumerate(outcomes):
                if o.lower() == "up":
                    up_idx = i
                elif o.lower() == "down":
                    down_idx = i

            info = {
                "title": event.get("title", ""),
                "slug": slug,
                "up_token_id": clob_ids[up_idx],
                "down_token_id": clob_ids[down_idx],
                "closed": market.get("closed", False),
            }
            _token_cache[cache_key] = info
            return info

        except Exception:
            return None


async def _get_live_prices(up_token: str, down_token: str) -> tuple[float, float] | None:
    """Get live midpoint prices from CLOB - most accurate"""
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            # Try midpoint first (most accurate)
            r_up = await client.get(
                "https://clob.polymarket.com/midpoint",
                params={"token_id": up_token},
            )
            r_down = await client.get(
                "https://clob.polymarket.com/midpoint",
                params={"token_id": down_token},
            )

            up_mid = float(r_up.json().get("mid", 0))
            down_mid = float(r_down.json().get("mid", 0))

            if up_mid > 0 and down_mid > 0:
                return up_mid, down_mid

        except Exception:
            pass

        try:
            # Fallback to buy price
            r_up = await client.get(
                "https://clob.polymarket.com/price",
                params={"token_id": up_token, "side": "buy"},
            )
            r_down = await client.get(
                "https://clob.polymarket.com/price",
                params={"token_id": down_token, "side": "buy"},
            )

            up_price = float(r_up.json().get("price", 0))
            down_price = float(r_down.json().get("price", 0))

            if up_price > 0 and down_price > 0:
                return up_price, down_price

        except Exception:
            pass

    return None


async def fetch_market_odds(coin: str, window_ts: int = None) -> MarketOdds | None:
    if window_ts is None:
        window_ts = get_current_window_timestamp()

    info = await _get_market_info(coin, window_ts)
    if not info:
        return None

    prices = await _get_live_prices(info["up_token_id"], info["down_token_id"])
    if not prices:
        return None

    up_price, down_price = prices

    return MarketOdds(
        coin=COIN_SYMBOLS.get(coin, coin.upper()),
        title=info["title"],
        up_price=up_price,
        down_price=down_price,
        slug=info["slug"],
        up_token_id=info["up_token_id"],
        down_token_id=info["down_token_id"],
        timestamp=window_ts,
    )


async def fetch_all_odds(window_ts: int = None) -> dict[str, MarketOdds]:
    results = {}
    for coin in SUPPORTED_COINS:
        odds = await fetch_market_odds(coin, window_ts)
        if odds:
            results[COIN_SYMBOLS[coin]] = odds
    return results


async def fetch_market_result(coin: str, window_ts: int) -> MarketResult | None:
    slug = f"{coin}-updown-15m-{window_ts}"

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                f"https://gamma-api.polymarket.com/events?slug={slug}"
            )
            data = r.json()
            if not data:
                return None

            market = data[0].get("markets", [{}])[0]
            closed = market.get("closed", False)

            prices_raw = market.get("outcomePrices", '["0.5","0.5"]')
            if isinstance(prices_raw, str):
                prices = json.loads(prices_raw)
            else:
                prices = prices_raw

            up_price = float(prices[0])
            down_price = float(prices[1])

            if closed:
                if up_price >= 0.99:
                    winner = "UP"
                elif down_price >= 0.99:
                    winner = "DOWN"
                else:
                    winner = "UNKNOWN"
            else:
                if up_price >= 0.95:
                    winner = "UP"
                elif down_price >= 0.95:
                    winner = "DOWN"
                else:
                    return None

            return MarketResult(
                coin=COIN_SYMBOLS.get(coin, coin.upper()),
                slug=slug,
                winner=winner,
                closed=closed,
            )
        except Exception:
            return None


async def fetch_all_results(window_ts: int) -> dict[str, MarketResult]:
    results = {}
    for coin in SUPPORTED_COINS:
        result = await fetch_market_result(coin, window_ts)
        if result:
            results[COIN_SYMBOLS[coin]] = result
    return results