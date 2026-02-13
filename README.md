# Polymarket Crypto 15-Min Strategy

Automated paper trading bot for Polymarket's crypto 15-minute Up/Down markets.

## How It Works

- **Binance WebSocket**: Real-time price, orderbook, and trade flow data
- **Polymarket CLOB API**: Live market odds (midpoint pricing)
- **Strategy**: Buy the cheap side when our signals disagree with the market
- **Settlement**: Based on actual Polymarket results

## Quick Start (Windows)

```bash
# 1. Clone
git clone https://github.com/pcfat/polymarket.git
cd polymarket

# 2. Install Python 3.12+ from python.org (check "Add to PATH")

# 3. Install dependencies
pip install -r backend/requirements.txt

# 4. Run
cd backend/app
python run_crypto_strategies.py
```

## Review Performance

```bash
cd backend/app
python test_strategy_review.py
```