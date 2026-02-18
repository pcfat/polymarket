const cron = require('node-cron');
const PolymarketClient = require('./polymarketClient');

class TradingEngine {
  constructor(database, config, io) {
    this.db = database;
    this.config = config;
    this.io = io;
    this.polymarket = new PolymarketClient(
      process.env.GAMMA_API_URL,
      process.env.CLOB_API_URL
    );
    
    this.isRunning = false;
    this.markets = [];
    this.marketScanJob = null;
    this.tradeCheckJob = null;
    this.processedTrades = new Set(); // Track processed market+outcome combinations
  }

  start() {
    if (this.isRunning) {
      console.log('⚠️ Trading engine already running');
      return;
    }

    this.isRunning = true;
    this.db.updateStatus({ is_running: true, last_heartbeat: Date.now() });
    
    console.log('🚀 Starting trading engine...');
    
    // Scan markets every N seconds
    const scanInterval = parseInt(process.env.MARKET_SCAN_INTERVAL) || 30;
    this.marketScanJob = cron.schedule(`*/${scanInterval} * * * * *`, () => {
      this.scanMarkets();
    });

    // Check trading opportunities every N seconds
    const checkInterval = parseInt(process.env.TRADE_CHECK_INTERVAL) || 10;
    this.tradeCheckJob = cron.schedule(`*/${checkInterval} * * * * *`, () => {
      this.checkTradingOpportunities();
    });

    // Initial scan
    this.scanMarkets();
    
    this.emitStatus();
    console.log('✅ Trading engine started');
  }

  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Trading engine already stopped');
      return;
    }

    this.isRunning = false;
    this.db.updateStatus({ is_running: false });
    
    if (this.marketScanJob) {
      this.marketScanJob.stop();
      this.marketScanJob = null;
    }
    
    if (this.tradeCheckJob) {
      this.tradeCheckJob.stop();
      this.tradeCheckJob = null;
    }

    this.emitStatus();
    console.log('🛑 Trading engine stopped');
  }

  async scanMarkets() {
    try {
      console.log('🔍 Scanning 15-minute crypto markets...');
      const markets = await this.polymarket.get15MinuteCryptoMarkets();
      this.markets = markets;

      // Store market snapshots
      for (const market of markets) {
        const prices = await this.polymarket.getMarketPrices(market);
        
        this.db.insertSnapshot({
          timestamp: Date.now(),
          market_id: market.market_id,
          market_question: market.question,
          yes_price: prices.yes_price,
          no_price: prices.no_price,
          volume: market.volume,
          liquidity: market.liquidity
        });
      }

      this.db.updateStatus({ last_heartbeat: Date.now() });
      
      // Emit markets to frontend
      this.io.emit('markets', {
        markets: markets.map(m => ({
          market_id: m.market_id,
          question: m.question,
          end_date: m.end_date,
          active: m.active
        })),
        count: markets.length,
        timestamp: Date.now()
      });

      console.log(`✅ Found ${markets.length} active 15-minute markets`);
    } catch (error) {
      console.error('❌ Error scanning markets:', error.message);
      this.io.emit('error', { message: 'Failed to scan markets', error: error.message });
    }
  }

  async checkTradingOpportunities() {
    if (!this.isRunning) return;

    try {
      const status = this.db.getStatus();
      const mode = status.mode;
      const tradeWindowSeconds = parseInt(this.config.tradeWindowSeconds) || 120;
      const buyThreshold = parseFloat(this.config.buyThreshold) || 0.55;
      const sellThreshold = parseFloat(this.config.sellThreshold) || 0.45;

      for (const market of this.markets) {
        // Check if market is within trading window
        if (!this.polymarket.isInTradingWindow(market.end_date, tradeWindowSeconds)) {
          continue;
        }

        // Get current prices
        const prices = await this.polymarket.getMarketPrices(market);
        const yesProbability = prices.yes_price;

        // Determine trading signal
        let signal = null;
        let outcome = null;

        if (yesProbability >= buyThreshold) {
          signal = 'BUY';
          outcome = 'YES';
        } else if (yesProbability <= sellThreshold) {
          signal = 'BUY';
          outcome = 'NO';
        }

        if (signal && outcome) {
          const tradeKey = `${market.market_id}_${outcome}`;
          
          // Avoid duplicate trades for the same market+outcome
          if (this.processedTrades.has(tradeKey)) {
            continue;
          }

          this.processedTrades.add(tradeKey);
          await this.executeTrade(market, signal, outcome, prices, mode);
        }
      }

      this.db.updateStatus({ last_heartbeat: Date.now() });
    } catch (error) {
      console.error('❌ Error checking trading opportunities:', error.message);
    }
  }

  async executeTrade(market, side, outcome, prices, mode) {
    try {
      const tradeAmount = parseFloat(this.config.tradeAmount) || 10;
      const price = outcome === 'YES' ? prices.yes_price : prices.no_price;
      const shares = price > 0 ? tradeAmount / price : 0;

      console.log(`📊 [${mode.toUpperCase()}] Executing trade: ${side} ${outcome} on "${market.question}"`);

      const trade = {
        timestamp: Date.now(),
        mode: mode,
        market_id: market.market_id,
        market_question: market.question,
        side: side,
        outcome: outcome,
        price: price,
        amount: tradeAmount,
        shares: shares,
        status: 'pending',
        notes: `Auto-trade triggered. YES probability: ${prices.yes_price.toFixed(4)}`
      };

      if (mode === 'paper') {
        // Paper trading - simulate immediate fill
        trade.status = 'filled';
        trade.order_id = `PAPER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Simulate a small random PnL for paper trading
        // Formula: (random[0-1] - 0.4) * tradeAmount * 0.2
        // This creates a slight positive bias with small variance
        trade.pnl = (Math.random() - 0.4) * tradeAmount * 0.2;
      } else {
        // Live trading - would integrate with @polymarket/clob-client here
        trade.notes += ' | Live trading not implemented - placeholder';
        trade.status = 'failed';
      }

      const tradeId = this.db.insertTrade(trade);
      trade.id = tradeId;

      // Update stats
      const stats = this.db.getStats(mode);
      this.db.updateStatus({ 
        total_trades: stats.total_trades,
        total_pnl: stats.total_pnl
      });

      // Emit to frontend
      this.io.emit('newTrade', trade);
      this.io.emit('stats', stats);
      
      // Emit recent trades
      const recentTrades = this.db.getTrades(10, mode);
      this.io.emit('recentTrades', recentTrades);

      console.log(`✅ Trade executed: ID ${tradeId}, Status: ${trade.status}`);
    } catch (error) {
      console.error('❌ Error executing trade:', error.message);
      this.io.emit('error', { message: 'Failed to execute trade', error: error.message });
    }
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('⚙️ Configuration updated:', this.config);
  }

  emitStatus() {
    const status = this.db.getStatus();
    this.io.emit('status', {
      isRunning: status.is_running === 1,
      mode: status.mode,
      lastHeartbeat: status.last_heartbeat,
      totalTrades: status.total_trades,
      totalPnl: status.total_pnl
    });
  }

  getMarkets() {
    return this.markets;
  }
}

module.exports = TradingEngine;
