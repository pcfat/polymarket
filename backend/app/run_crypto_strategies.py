import asyncio
import time
import signal as sig_module
from datetime import datetime
from crypto_strategy import CryptoStrategyEngine, Signal, SUPPORTED_COINS
from binance_ws import BinanceDataFeed
from paper_trader import PaperTrader
from polymarket_odds import fetch_all_odds, fetch_all_results

running = True


def handle_exit(sig, frame):
    global running
    running = False
    print("\n\nStopping gracefully...")


sig_module.signal(sig_module.SIGINT, handle_exit)
sig_module.signal(sig_module.SIGTERM, handle_exit)


def get_current_window_end() -> float:
    now = datetime.now()
    m = now.minute
    nb = ((m // 15) + 1) * 15
    if nb == 60:
        end = now.replace(minute=0, second=0, microsecond=0)
        end = datetime.fromtimestamp(end.timestamp() + 3600)
    else:
        end = now.replace(minute=nb, second=0, microsecond=0)
    return end.timestamp()


def get_window_label() -> str:
    now = datetime.now()
    m = now.minute
    ws = (m // 15) * 15
    we = ws + 15
    h = now.hour
    eh = h + 1 if we == 60 else h
    we = 0 if we == 60 else we
    return f"{h}:{ws:02d}-{eh}:{we:02d}"


def get_window_ts() -> int:
    now = int(time.time())
    return now - (now % 900)


def secs_into_window() -> float:
    now = time.time()
    return now - (now - now % 900)


def secs_left() -> float:
    return 900 - secs_into_window()


def get_interval() -> tuple[float, str]:
    left = secs_left()
    if left <= 30:
        return left + 1, "⛔ CUTOFF"
    elif left <= 120:
        return 5, "🔥 FINAL"
    elif left <= 300:
        return 10, "⚡ ACTIVE"
    else:
        return 20, "📊 SCAN"


MIN_WINDOW_SECS = 120


async def settle_with_polymarket(trader, pending, prices, prev_window_ts):
    """Try to settle trades using actual Polymarket results"""
    # Map coin symbols back to short codes
    sym_to_short = {"BTC": "btc", "ETH": "eth", "SOL": "sol", "XRP": "xrp"}

    results = await fetch_all_results(prev_window_ts)

    settled = []
    fallback = []

    for p in pending:
        coin_key = p["coin"]  # e.g. "bitcoin"
        trade = trader.trades[p["index"]]
        symbol = trade["coin"]  # e.g. "BTC"

        if symbol in results:
            result = results[symbol]
            exit_px = prices.get(coin_key, 0)
            trader.settle_trade_with_result(p["index"], result.winner, exit_px)
            settled.append(p)
        else:
            # Polymarket result not available yet, use price fallback
            if coin_key in prices:
                trader.settle_trade(p["index"], prices[coin_key])
                fallback.append(p)

    for p in settled + fallback:
        pending.remove(p)

    return len(settled), len(fallback)


async def main():
    global running

    print("=" * 70)
    print("  Polymarket Crypto 15-Min Strategy v3.2")
    print("  Data: Binance WebSocket (real-time)")
    print("  Orderbook: Smoothed (20-sample rolling average)")
    print("  Settlement: Polymarket actual results (not Binance price)")
    print("  Press Ctrl+C to stop")
    print("=" * 70)

    feed = BinanceDataFeed()
    await feed.start()
    print("\n  📡 Connecting to Binance WebSocket...")

    for i in range(10):
        await asyncio.sleep(1)
        if len(feed.get_all_prices()) == 4:
            print(f"  ✅ Connected! 4 coins")
            break

    engine = CryptoStrategyEngine(feed, {"min_edge": 0.08, "min_data_seconds": 60})
    trader = PaperTrader(data_dir="./data")
    pending: list[dict] = []
    window_coins: set[str] = set()
    window_end: float = get_current_window_end()
    prev_window_ts: int = get_window_ts()  # Track for settlement

    print(f"\n  Bankroll: ${trader.bankroll:.2f} | Bet: ${trader.bet_amount:.2f}")
    print(f"  Window: {get_window_label()} | Min edge: YES={engine.min_edge_yes:.0%} NO={engine.min_edge_no:.0%}")
    print(f"  Settlement: Via Polymarket results (UP/DOWN)\n")

    cycle = 0

    while running:
        try:
            interval, phase = get_interval()
            left = secs_left()
            into = secs_into_window()
            prices = feed.get_all_prices()

            if not prices:
                await asyncio.sleep(2)
                continue

            # New window → settle using Polymarket results
            new_end = get_current_window_end()
            if new_end != window_end:
                wl = get_window_label()
                print(f"\n  ⏰ New window: {wl}")
                print(f"  {'─' * 55}")

                if pending:
                    print(f"  Checking Polymarket results for {len(pending)} trades...")
                    # Wait a few seconds for Polymarket to update
                    await asyncio.sleep(5)
                    settled, fallback = await settle_with_polymarket(
                        trader, pending, prices, prev_window_ts
                    )
                    if settled:
                        print(f"  ✅ Settled {settled} trades via Polymarket results")
                    if fallback:
                        print(f"  ⚠️ {fallback} trades settled via price fallback")

                    # If any still pending, retry after more delay
                    if pending:
                        print(f"  ⏳ {len(pending)} trades still pending, retrying in 10s...")
                        await asyncio.sleep(10)
                        settled2, fallback2 = await settle_with_polymarket(
                            trader, pending, prices, prev_window_ts
                        )

                    # Force settle any remaining
                    for p in pending[:]:
                        coin_key = p["coin"]
                        if coin_key in prices:
                            print(f"  ⚠️ Force settling {trader.trades[p['index']]['coin']} via price")
                            trader.settle_trade(p["index"], prices[coin_key])
                        pending.remove(p)

                window_coins.clear()
                prev_window_ts = get_window_ts()
                window_end = new_end

            cycle += 1
            now = datetime.now()

            # Display
            parts = []
            for coin, info in SUPPORTED_COINS.items():
                sym = info["symbol"]
                px = prices.get(coin, 0)
                imb = feed.get_imbalance(coin)
                if px >= 1000:
                    parts.append(f"{sym}=${px:,.2f} ob:{imb:.2f}")
                elif px >= 1:
                    parts.append(f"{sym}=${px:.4f} ob:{imb:.2f}")
                else:
                    parts.append(f"{sym}=${px:.6f} ob:{imb:.2f}")

            data_s = min(len(feed.get_prices_array(c)) for c in SUPPORTED_COINS)
            can_trade = "✅" if into >= MIN_WINDOW_SECS else f"⏳{int(MIN_WINDOW_SECS - into)}s"
            print(f"[{now.strftime('%H:%M:%S')}] {phase} {int(left)}s {can_trade} | "
                  f"{' | '.join(parts)} | "
                  f"D:{data_s}s P:{len(pending)} ${trader.bankroll:.2f}")

            if phase == "⛔ CUTOFF":
                print(f"  ⛔ Waiting for settlement...")
                await asyncio.sleep(interval)
                continue

            # Fetch odds
            fetch = phase != "📊 SCAN" or cycle % 3 == 0
            odds = {}
            if fetch:
                odds = await fetch_all_odds()
                if odds:
                    parts = [f"{c}:↑{o.up_price:.0%}↓{o.down_price:.0%}" for c, o in odds.items()]
                    print(f"  📊 Mkt: {' | '.join(parts)}")

            # Don't trade in first 2 min
            if into < MIN_WINDOW_SECS:
                engine.evaluate_all_coins(odds=odds)
                for _ in range(int(interval)):
                    if not running:
                        break
                    await asyncio.sleep(1)
                continue

            signals = engine.evaluate_all_coins(odds=odds)
            for sig in signals:
                if sig.coin in window_coins:
                    continue

                if sig.signal == Signal.NO_TRADE:
                    if sig.edge > 0.04:
                        print(f"  ⏸ {sig.coin}: {sig.reason}")
                    continue

                coin_odds = odds.get(sig.coin)
                if not coin_odds:
                    continue

                buy_price = coin_odds.up_price if sig.signal == Signal.BUY_YES else coin_odds.down_price
                if buy_price > 0.80:
                    continue

                pot = trader.bet_amount * (1 - buy_price) / buy_price

                print(f"  🎯 {sig.coin} | {sig.signal.value} | "
                      f"edge={sig.edge:+.1%} | P(up)={sig.our_prob_up:.1%}")
                print(f"     {sig.reason}")
                print(f"     Buy@{buy_price:.3f} → Win:+${pot:.2f} / Lose:-${trader.bet_amount:.2f}")

                coin_key = next(
                    (k for k, v in SUPPORTED_COINS.items() if v["symbol"] == sig.coin), None
                )
                if coin_key and coin_key in prices:
                    trader.open_trade(
                        coin=sig.coin, signal=sig.signal.value,
                        strategy=sig.strategy, confidence=sig.confidence,
                        reason=sig.reason, entry_price=prices[coin_key],
                        up_odds=coin_odds.up_price, down_odds=coin_odds.down_price,
                        window_label=get_window_label(),
                        window_ts=get_window_ts(),
                    )
                    pending.append({"index": len(trader.trades) - 1, "coin": coin_key})
                    window_coins.add(sig.coin)

            if cycle % 60 == 0 and trader.trades:
                stats = trader.get_stats()
                print(f"\n{'='*70}")
                for k, v in stats.items():
                    if k == "coin_stats":
                        for c, cs in v.items():
                            print(f"  {c}: {cs['trades']}T WR:{cs['win_rate']} ${cs['pnl']:+.2f}")
                    else:
                        print(f"  {k}: {v}")
                print(f"{'='*70}\n")

            for _ in range(int(interval)):
                if not running:
                    break
                await asyncio.sleep(1)

        except Exception as e:
            if not running:
                break
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
            await asyncio.sleep(5)

    await feed.stop()
    print("\n" + "=" * 70)
    print("  FINAL RESULTS v3.2 - Polymarket Settlement")
    print("=" * 70)
    stats = trader.get_stats()
    for k, v in stats.items():
        if k == "coin_stats":
            for c, cs in v.items():
                print(f"  {c}: {cs['trades']}T WR:{cs['win_rate']} ${cs['pnl']:+.2f}")
        else:
            print(f"  {k}: {v}")
    print("=" * 70)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass