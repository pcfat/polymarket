const cron = require('node-cron');
const PolymarketClient = require('./polymarketClient');
const { analyzeMarket, DEFAULT_WEIGHTS } = require('./strategies/compositeStrategy');

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
    this.strategyWeights = DEFAULT_WEIGHTS; // Strategy weights for composite analysis
    this.latestAnalysis = {}; // Store latest analysis for each market
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

      for (const market of this.markets) {
        // Check if market is within trading window
        if (!this.polymarket.isInTradingWindow(market.end_date, tradeWindowSeconds)) {
          continue;
        }

        // Get current prices to extract token IDs
        const prices = await this.polymarket.getMarketPrices(market);
        const yesTokenId = prices.yes_token || market.tokens?.[0]?.token_id;
        const noTokenId = prices.no_token || market.tokens?.[1]?.token_id;

        // Run composite strategy analysis
        const analysis = await analyzeMarket(
          market.question, // Pass the question which contains coin info
          yesTokenId,
          noTokenId,
          this.strategyWeights
        );

        // Store latest analysis for this market
        this.latestAnalysis[market.market_id] = {
          ...analysis,
          market_id: market.market_id,
          coin: market.question,
          timestamp: Date.now()
        };

        // Emit analysis data to frontend via Socket.IO
        this.io.emit('analysis', {
          market_id: market.market_id,
          coin: market.question,
          ...analysis,
          timestamp: Date.now()
        });

        // Use analysis decision to determine trades
        if (analysis.decision === 'BUY' && analysis.outcome) {
          const tradeKey = `${market.market_id}_${analysis.outcome}`;
          
          // Avoid duplicate trades for the same market+outcome
          if (this.processedTrades.has(tradeKey)) {
            continue;
          }

          this.processedTrades.add(tradeKey);
          await this.executeTrade(market, analysis.decision, analysis.outcome, prices, mode, analysis);
        }
      }

      this.db.updateStatus({ last_heartbeat: Date.now() });
    } catch (error) {
      console.error('❌ Error checking trading opportunities:', error.message);
    }
  }

  async executeTrade(market, side, outcome, prices, mode, analysis) {
    try {
      let tradeAmount = parseFloat(this.config.tradeAmount) || 10;
      
      // Adjust trade amount based on analysis recommendation
      if (analysis && analysis.tradeAmount === 'increased') {
        tradeAmount = tradeAmount * 1.5; // 50% increase for high confidence
      } else if (analysis && analysis.tradeAmount === 'reduced') {
        tradeAmount = tradeAmount * 0.5; // 50% reduction for low confidence
      }
      
      const price = outcome === 'YES' ? prices.yes_price : prices.no_price;
      const shares = price > 0 ? tradeAmount / price : 0;

      console.log(`📊 [${mode.toUpperCase()}] Executing trade: ${side} ${outcome} on "${market.question}"`);
      if (analysis) {
        console.log(`   📈 Composite Score: ${analysis.compositeScore.toFixed(3)}, Confidence: ${(analysis.confidence * 100).toFixed(1)}%`);
      }

      // Create analysis summary for notes
      let analysisNotes = '';
      if (analysis) {
        analysisNotes = JSON.stringify({
          compositeScore: analysis.compositeScore,
          confidence: analysis.confidence,
          decision: analysis.decision,
          tradeAmount: analysis.tradeAmount,
          breakdown: {
            technical: { score: analysis.breakdown?.technical?.score ?? 0 },
            news: { score: analysis.breakdown?.news?.score ?? 0 },
            orderFlow: { 
              score: analysis.breakdown?.orderFlow?.score ?? 0,
              confidence: analysis.breakdown?.orderFlow?.confidence ?? 0
            }
          },
          weights: analysis.weights
        });
      }

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
        notes: analysisNotes || `Auto-trade triggered. YES probability: ${prices.yes_price.toFixed(4)}`
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

  updateWeights(newWeights) {
    this.strategyWeights = { ...this.strategyWeights, ...newWeights };
    console.log('⚙️ Strategy weights updated:', this.strategyWeights);
  }

  getLatestAnalysis() {
    return Object.values(this.latestAnalysis);
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
