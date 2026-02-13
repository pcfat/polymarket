"""
Paper Trader - Uses actual Polymarket settlement results
"""

import json
from datetime import datetime
from pathlib import Path


class PaperTrader:
    def __init__(self, data_dir: str = "./data", bankroll: float = 1000.0, bet_amount: float = 10.0):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.trades_file = self.data_dir / "paper_trades.json"
        self.default_bankroll = bankroll
        self.bet_amount = bet_amount
        self.trades = self._load_trades()
        self.bankroll = self._calculate_bankroll()

    def _load_trades(self) -> list[dict]:
        if self.trades_file.exists():
            try:
                with open(self.trades_file, "r") as f:
                    return json.load(f)
            except (json.JSONDecodeError, FileNotFoundError):
                return []
        return []

    def _save_trades(self):
        with open(self.trades_file, "w") as f:
            json.dump(self.trades, f, indent=2, default=str)

    def _calculate_bankroll(self) -> float:
        bankroll = self.default_bankroll
        for t in self.trades:
            if t["result"] != "pending":
                bankroll += t["profit_usd"]
        return bankroll

    def open_trade(
        self,
        coin: str,
        signal: str,
        strategy: str,
        confidence: float,
        reason: str,
        entry_price: float,
        up_odds: float = 0.5,
        down_odds: float = 0.5,
        window_label: str = "",
        window_ts: int = 0,
    ):
        """Open a new paper trade with real Polymarket odds"""
        if signal == "BUY_YES":
            buy_price = up_odds
        else:
            buy_price = down_odds

        if buy_price > 0 and buy_price < 1:
            potential_profit = self.bet_amount * (1 - buy_price) / buy_price
        else:
            potential_profit = 0

        trade = {
            "timestamp": datetime.now().isoformat(),
            "coin": coin,
            "strategy": strategy,
            "signal": signal,
            "confidence": confidence,
            "reason": reason,
            "entry_price": entry_price,
            "exit_price": 0.0,
            "result": "pending",
            "profit_usd": 0.0,
            "bet_amount": self.bet_amount,
            "up_odds": up_odds,
            "down_odds": down_odds,
            "buy_price": buy_price,
            "potential_profit": round(potential_profit, 2),
            "window": window_label,
            "window_ts": window_ts,
            "polymarket_result": "",  # Will be "UP" or "DOWN"
        }

        self.trades.append(trade)
        self._save_trades()

        odds_str = f"UP:{up_odds:.1%} DOWN:{down_odds:.1%}"
        print(f"  [PAPER] {coin} | {signal} | ${entry_price:,.2f} | "
              f"Odds: {odds_str} | Buy@{buy_price:.3f} | "
              f"Potential: +${potential_profit:.2f}")

    def settle_trade_with_result(self, index: int, polymarket_winner: str, exit_price: float = 0):
        """Settle using actual Polymarket result (UP or DOWN)"""
        if index >= len(self.trades):
            return

        trade = self.trades[index]
        if trade["result"] != "pending":
            return

        trade["exit_price"] = exit_price
        trade["polymarket_result"] = polymarket_winner
        buy_price = trade.get("buy_price", 0.5)
        signal = trade["signal"]

        # Did WE win?
        if signal == "BUY_YES":
            won = polymarket_winner == "UP"
        else:  # BUY_NO
            won = polymarket_winner == "DOWN"

        if won:
            trade["result"] = "win"
            if buy_price > 0 and buy_price < 1:
                profit = trade["bet_amount"] * (1 - buy_price) / buy_price
            else:
                profit = 0
            trade["profit_usd"] = round(profit, 2)
        else:
            trade["result"] = "lose"
            trade["profit_usd"] = -trade["bet_amount"]

        self.bankroll += trade["profit_usd"]
        self._save_trades()

        emoji = "✅" if won else "❌"
        result_str = "WIN" if won else "LOSE"
        pnl = trade["profit_usd"]
        pnl_sign = "+" if pnl >= 0 else ""
        print(f"  {emoji} {trade['coin']} | {result_str} | "
              f"We bet {signal} | Market={polymarket_winner} | "
              f"P&L: ${pnl_sign}{pnl:.2f} | Buy@{buy_price:.3f} | "
              f"Bankroll: ${self.bankroll:.2f}")

    def settle_trade(self, index: int, exit_price: float):
        """Legacy: settle using price comparison (fallback)"""
        if index >= len(self.trades):
            return
        trade = self.trades[index]
        if trade["result"] != "pending":
            return

        trade["exit_price"] = exit_price
        entry = trade["entry_price"]
        signal = trade["signal"]
        buy_price = trade.get("buy_price", 0.5)

        price_went_up = exit_price >= entry
        if signal == "BUY_YES":
            won = price_went_up
        else:
            won = not price_went_up

        if won:
            trade["result"] = "win"
            if buy_price > 0 and buy_price < 1:
                profit = trade["bet_amount"] * (1 - buy_price) / buy_price
            else:
                profit = 0
            trade["profit_usd"] = round(profit, 2)
        else:
            trade["result"] = "lose"
            trade["profit_usd"] = -trade["bet_amount"]

        self.bankroll += trade["profit_usd"]
        self._save_trades()

        emoji = "✅" if won else "❌"
        pnl = trade["profit_usd"]
        pnl_sign = "+" if pnl >= 0 else ""
        print(f"  {emoji} {trade['coin']} | {'WIN' if won else 'LOSE'} (price-based fallback) | "
              f"P&L: ${pnl_sign}{pnl:.2f} | Bankroll: ${self.bankroll:.2f}")

    def get_recent_trades(self, limit: int = 50) -> list[dict]:
        return self.trades[-limit:]

    def get_stats(self) -> dict:
        completed = [t for t in self.trades if t["result"] != "pending"]
        if not completed:
            return {
                "total_trades": 0,
                "message": "No completed trades yet",
                "bankroll": self.bankroll,
            }

        wins = [t for t in completed if t["result"] == "win"]
        losses = [t for t in completed if t["result"] == "lose"]
        total_pnl = sum(t["profit_usd"] for t in completed)

        coin_stats = {}
        for t in completed:
            coin = t["coin"]
            if coin not in coin_stats:
                coin_stats[coin] = {"trades": 0, "wins": 0, "pnl": 0.0}
            coin_stats[coin]["trades"] += 1
            if t["result"] == "win":
                coin_stats[coin]["wins"] += 1
            coin_stats[coin]["pnl"] += t["profit_usd"]

        for coin in coin_stats:
            cs = coin_stats[coin]
            cs["pnl"] = round(cs["pnl"], 2)
            cs["win_rate"] = f"{cs['wins']/cs['trades']*100:.1f}%" if cs["trades"] > 0 else "0%"

        strat_pnl = {}
        for t in completed:
            s = t["strategy"]
            strat_pnl[s] = strat_pnl.get(s, 0) + t["profit_usd"]
        best_strat = max(strat_pnl, key=strat_pnl.get) if strat_pnl else "N/A"

        return {
            "total_trades": len(completed),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": f"{len(wins)/len(completed)*100:.1f}%",
            "total_pnl": round(total_pnl, 2),
            "bankroll": round(self.bankroll, 2),
            "best_strategy": best_strat,
            "coin_stats": coin_stats,
        }