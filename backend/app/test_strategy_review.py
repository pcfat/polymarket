import json
from pathlib import Path

trades_file = Path("./data/paper_trades.json")
if not trades_file.exists():
    print("No trades file found!")
    exit()

with open(trades_file) as f:
    trades = json.load(f)

completed = [t for t in trades if t["result"] != "pending"]
print(f"Total completed trades: {len(completed)}")
print()

wins = [t for t in completed if t["result"] == "win"]
losses = [t for t in completed if t["result"] == "lose"]
print(f"Wins: {len(wins)}  Losses: {len(losses)}")
print(f"Win rate: {len(wins)/len(completed)*100:.1f}%")
print(f"Total PnL: ${sum(t['profit_usd'] for t in completed):.2f}")
print()

# By coin
print("=== By Coin ===")
coins = set(t["coin"] for t in completed)
for coin in sorted(coins):
    ct = [t for t in completed if t["coin"] == coin]
    w = sum(1 for t in ct if t["result"] == "win")
    pnl = sum(t["profit_usd"] for t in ct)
    print(f"  {coin}: {len(ct)}T  {w}W/{len(ct)-w}L  WR:{w/len(ct)*100:.0f}%  PnL:${pnl:+.2f}")

print()

# By signal type
print("=== By Signal ===")
for sig in ["BUY_YES", "BUY_NO"]:
    ct = [t for t in completed if t["signal"] == sig]
    if not ct:
        continue
    w = sum(1 for t in ct if t["result"] == "win")
    pnl = sum(t["profit_usd"] for t in ct)
    avg_buy = sum(t.get("buy_price", 0.5) for t in ct) / len(ct)
    print(f"  {sig}: {len(ct)}T  {w}W/{len(ct)-w}L  WR:{w/len(ct)*100:.0f}%  PnL:${pnl:+.2f}  Avg buy:{avg_buy:.3f}")

print()

# By strategy
print("=== By Strategy ===")
strats = set(t["strategy"] for t in completed)
for s in sorted(strats):
    ct = [t for t in completed if t["strategy"] == s]
    w = sum(1 for t in ct if t["result"] == "win")
    pnl = sum(t["profit_usd"] for t in ct)
    print(f"  {s}: {len(ct)}T  WR:{w/len(ct)*100:.0f}%  PnL:${pnl:+.2f}")

print()

# Analyze timing
print("=== Trade Details ===")
for i, t in enumerate(completed):
    result = "✅" if t["result"] == "win" else "❌"
    buy_px = t.get("buy_price", 0.5)
    pm_result = t.get("polymarket_result", "?")
    print(f"  {result} {t['coin']:4s} {t['signal']:8s} buy@{buy_px:.3f} "
          f"pnl:${t['profit_usd']:+.2f} mkt_result:{pm_result} "
          f"strat:{t['strategy'][:30]}")