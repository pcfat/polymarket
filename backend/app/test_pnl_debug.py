import json
from pathlib import Path

trades_file = Path("./data/paper_trades.json")
with open(trades_file) as f:
    trades = json.load(f)

print("=== All trades with full details ===\n")
for i, t in enumerate(trades):
    result = "W" if t["result"] == "win" else "L" if t["result"] == "lose" else "P"

    buy_px = t.get("buy_price", 0)
    up_odds = t.get("up_odds", 0)
    down_odds = t.get("down_odds", 0)
    signal = t["signal"]
    bet = t.get("bet_amount", 10)
    pnl = t.get("profit_usd", 0)

    if buy_px > 0 and buy_px < 1:
        total_payout = bet / buy_px
        profit_if_win = total_payout - bet
    else:
        total_payout = 0
        profit_if_win = 0

    print(f"  {result} {t['coin']:4s} {signal:8s} | "
          f"up={up_odds:.3f} dn={down_odds:.3f} | "
          f"buy@{buy_px:.3f} | "
          f"pnl=${pnl:+.2f} | "
          f"$10 to win ${total_payout:.2f} (profit ${profit_if_win:.2f})")