"""
Binance WebSocket v2 - Real-time price + smoothed orderbook
"""

import asyncio
import json
import time
import websockets
from dataclasses import dataclass, field
from collections import deque


BINANCE_SYMBOLS = {
    "bitcoin": "btcusdt",
    "ethereum": "ethusdt",
    "solana": "solusdt",
    "xrp": "xrpusdt",
}

SYMBOL_TO_COIN = {v: k for k, v in BINANCE_SYMBOLS.items()}


@dataclass
class OrderbookSnapshot:
    bids_volume: float = 0.0
    asks_volume: float = 0.0
    best_bid: float = 0.0
    best_ask: float = 0.0
    timestamp: float = 0.0

    @property
    def imbalance(self) -> float:
        total = self.bids_volume + self.asks_volume
        if total == 0:
            return 0.5
        return self.bids_volume / total

    @property
    def spread_pct(self) -> float:
        if self.best_bid == 0:
            return 0
        return (self.best_ask - self.best_bid) / self.best_bid


@dataclass
class CoinData:
    price: float = 0.0
    prices_1s: deque = field(default_factory=lambda: deque(maxlen=900))
    orderbook: OrderbookSnapshot = field(default_factory=OrderbookSnapshot)
    # Smoothed orderbook: rolling window of recent imbalance readings
    ob_history: deque = field(default_factory=lambda: deque(maxlen=20))
    trade_count_1m: int = 0
    buy_volume_1m: float = 0.0
    sell_volume_1m: float = 0.0
    last_update: float = 0.0
    vwap_sum: float = 0.0
    vwap_vol: float = 0.0


class BinanceDataFeed:
    """Real-time Binance data with smoothed orderbook"""

    def __init__(self):
        self.coins: dict[str, CoinData] = {
            coin: CoinData() for coin in BINANCE_SYMBOLS
        }
        self._running = False
        self._connected = False
        self._tasks: list[asyncio.Task] = []

    @property
    def is_connected(self) -> bool:
        return self._connected

    def get_price(self, coin: str) -> float:
        return self.coins.get(coin, CoinData()).price

    def get_all_prices(self) -> dict[str, float]:
        return {
            coin: data.price
            for coin, data in self.coins.items()
            if data.price > 0
        }

    def get_orderbook(self, coin: str) -> OrderbookSnapshot:
        return self.coins.get(coin, CoinData()).orderbook

    def get_imbalance(self, coin: str) -> float:
        """Smoothed imbalance - average of last 20 snapshots"""
        data = self.coins.get(coin)
        if not data or len(data.ob_history) == 0:
            return 0.5
        return sum(data.ob_history) / len(data.ob_history)

    def get_imbalance_raw(self, coin: str) -> float:
        """Raw instant imbalance"""
        return self.get_orderbook(coin).imbalance

    def get_imbalance_trend(self, coin: str) -> float | None:
        """Is imbalance increasing or decreasing? +1 = more buying, -1 = more selling"""
        data = self.coins.get(coin)
        if not data or len(data.ob_history) < 10:
            return None
        recent = list(data.ob_history)
        first_half = sum(recent[:len(recent)//2]) / (len(recent)//2)
        second_half = sum(recent[len(recent)//2:]) / (len(recent) - len(recent)//2)
        return second_half - first_half

    def get_vwap(self, coin: str) -> float:
        data = self.coins.get(coin)
        if not data or data.vwap_vol == 0:
            return data.price if data else 0
        return data.vwap_sum / data.vwap_vol

    def get_trade_pressure(self, coin: str) -> float:
        data = self.coins.get(coin)
        if not data:
            return 0.5
        total = data.buy_volume_1m + data.sell_volume_1m
        if total == 0:
            return 0.5
        return data.buy_volume_1m / total

    def get_prices_array(self, coin: str) -> list[float]:
        data = self.coins.get(coin)
        if not data:
            return []
        return list(data.prices_1s)

    async def start(self):
        self._running = True
        await self._run_trades_ws()
        await self._run_depth_ws()
        self._tasks.append(asyncio.create_task(self._run_1s_aggregator()))
        self._tasks.append(asyncio.create_task(self._run_1m_reset()))

    async def stop(self):
        self._running = False
        for task in self._tasks:
            task.cancel()

    async def _run_trades_ws(self):
        for coin, symbol in BINANCE_SYMBOLS.items():
            self._tasks.append(
                asyncio.create_task(self._watch_trades(coin, symbol))
            )

    async def _watch_trades(self, coin: str, symbol: str):
        url = f"wss://stream.binance.com:9443/ws/{symbol}@aggTrade"
        while self._running:
            try:
                async with websockets.connect(url, ping_interval=20) as ws:
                    self._connected = True
                    while self._running:
                        msg = await asyncio.wait_for(ws.recv(), timeout=30)
                        payload = json.loads(msg)
                        price = float(payload["p"])
                        qty = float(payload["q"])
                        is_buyer_maker = payload.get("m", False)

                        cd = self.coins[coin]
                        cd.price = price
                        cd.last_update = time.time()
                        cd.vwap_sum += price * qty
                        cd.vwap_vol += qty

                        if is_buyer_maker:
                            cd.sell_volume_1m += qty
                        else:
                            cd.buy_volume_1m += qty
                        cd.trade_count_1m += 1

            except asyncio.CancelledError:
                break
            except Exception:
                self._connected = False
                if self._running:
                    await asyncio.sleep(2)

    async def _run_depth_ws(self):
        for coin, symbol in BINANCE_SYMBOLS.items():
            self._tasks.append(
                asyncio.create_task(self._watch_depth(coin, symbol))
            )

    async def _watch_depth(self, coin: str, symbol: str):
        url = f"wss://stream.binance.com:9443/ws/{symbol}@depth20@100ms"
        while self._running:
            try:
                async with websockets.connect(url, ping_interval=20) as ws:
                    while self._running:
                        msg = await asyncio.wait_for(ws.recv(), timeout=30)
                        data = json.loads(msg)
                        bids = data.get("bids", [])
                        asks = data.get("asks", [])
                        if not bids or not asks:
                            continue

                        bids_vol = sum(float(b[1]) for b in bids)
                        asks_vol = sum(float(a[1]) for a in asks)
                        best_bid = float(bids[0][0])
                        best_ask = float(asks[0][0])

                        ob = OrderbookSnapshot(
                            bids_volume=bids_vol,
                            asks_volume=asks_vol,
                            best_bid=best_bid,
                            best_ask=best_ask,
                            timestamp=time.time(),
                        )
                        cd = self.coins[coin]
                        cd.orderbook = ob
                        cd.ob_history.append(ob.imbalance)

            except asyncio.CancelledError:
                break
            except Exception:
                if self._running:
                    await asyncio.sleep(2)

    async def _run_1s_aggregator(self):
        while self._running:
            try:
                await asyncio.sleep(1)
                for coin, data in self.coins.items():
                    if data.price > 0:
                        data.prices_1s.append(data.price)
            except asyncio.CancelledError:
                break

    async def _run_1m_reset(self):
        while self._running:
            try:
                await asyncio.sleep(60)
                for coin, data in self.coins.items():
                    data.trade_count_1m = 0
                    data.buy_volume_1m = 0.0
                    data.sell_volume_1m = 0.0
                    data.vwap_sum = 0.0
                    data.vwap_vol = 0.0
            except asyncio.CancelledError:
                break