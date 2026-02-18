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
    this.settlementJob = null;
    this.processedTrades = new Set(); // Track processed market+outcome combinations
    this.strategyWeights = DEFAULT_WEIGHTS; // Strategy weights for composite analysis
    this.latestAnalysis = {}; // Store latest analysis for each market
    
    // Settlement constants
    this.RESOLUTION_PRICE_THRESHOLD = 0.95; // Price threshold to determine market resolution
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

    // Settle paper trades every 30 seconds
    this.settlementJob = cron.schedule('*/30 * * * * *', () => {
      this.settlePaperTrades();
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

    if (this.settlementJob) {
      this.settlementJob.stop();
      this.settlementJob = null;
    }

    this.emitStatus();
    console.log('🛑 Trading engine stopped');
  }

  async scanMarkets() {
    try {
      console.log('🔍 Scanning 15-minute crypto markets...');
      const markets = await this.polymarket.get15MinuteCryptoMarkets();
      this.markets = markets;

      // Get prices for all markets and emit to frontend
      const marketsWithPrices = [];
      
      for (const market of markets) {
        const prices = await this.polymarket.getMarketPrices(market);
        
        // Log market prices for debugging
        console.log(`[Market] ${market.coin}: YES=${prices.yes_price.toFixed(4)} NO=${prices.no_price.toFixed(4)} tokens=[${market.yes_token_id || 'null'}, ${market.no_token_id || 'null'}]`);
        
        // Store market snapshots
        this.db.insertSnapshot({
          timestamp: Date.now(),
          market_id: market.market_id,
          market_question: market.question,
          yes_price: prices.yes_price,
          no_price: prices.no_price,
          volume: market.volume,
          liquidity: null // Liquidity not available in slug-based API response
        });
        
        // Add market with prices for frontend
        marketsWithPrices.push({
          market_id: market.market_id,
          question: market.question,
          coin: market.coin,
          end_date: market.end_date, // Already in milliseconds
          yes_price: prices.yes_price,
          no_price: prices.no_price,
          volume: market.volume,
          active: market.active
        });
      }

      this.db.updateStatus({ last_heartbeat: Date.now() });
      
      // Emit markets with prices to frontend
      this.io.emit('markets', {
        markets: marketsWithPrices,
        count: marketsWithPrices.length,
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
      const bankroll = parseFloat(this.config.bankroll) || 100;
      const maxExposure = parseFloat(this.config.maxExposure) || 0.5;

      // Constants
      const MIN_REMAINING_BUDGET = 1;
      const MIN_TRADE = 1;

      // ===== Phase 1: Collect all candidates that pass filters =====
      const candidates = [];

      for (const market of this.markets) {
        if (!this.polymarket.isInTradingWindow(market.end_date, tradeWindowSeconds)) {
          continue;
        }

        const prices = await this.polymarket.getMarketPrices(market);
        const yesTokenId = prices.yes_token || market.tokens?.[0]?.token_id;
        const noTokenId = prices.no_token || market.tokens?.[1]?.token_id;

        const analysis = await analyzeMarket(
          market.question, yesTokenId, noTokenId, this.strategyWeights
        );

        // Store & emit analysis (unchanged)
        this.latestAnalysis[market.market_id] = {
          ...analysis, market_id: market.market_id,
          coin: market.question, timestamp: Date.now()
        };
        this.io.emit('analysis', {
          market_id: market.market_id, coin: market.question,
          ...analysis, timestamp: Date.now()
        });

        if (analysis.decision !== 'BUY' || !analysis.outcome) continue;

        const tradeKey = `${market.market_id}_${analysis.outcome}`;
        if (this.processedTrades.has(tradeKey)) continue;

        const tokenPrice = analysis.outcome === 'YES' ? prices.yes_price : prices.no_price;

        // --- Odds range filter ---
        const oddsMin = parseFloat(this.config.oddsMinPrice) || 0.30;
        const oddsMax = parseFloat(this.config.oddsMaxPrice) || 0.75;
        if (tokenPrice < oddsMin || tokenPrice > oddsMax) {
          console.log(`⚠️ Skipping: ${market.question} price ${tokenPrice.toFixed(4)} outside [${oddsMin}-${oddsMax}]`);
          this.io.emit('tradeSkipped', {
            market_id: market.market_id, coin: market.question,
            reason: `價格 ${tokenPrice.toFixed(4)} 超出範圍 [${oddsMin}-${oddsMax}]`,
            timestamp: Date.now()
          });
          continue;
        }

        // --- Risk-reward ratio filter ---
        const maxRR = parseFloat(this.config.maxRiskReward) || 5;
        const potentialGain = 1.0 - tokenPrice;
        const riskRewardRatio = potentialGain > 0 ? tokenPrice / potentialGain : Infinity;
        if (riskRewardRatio > maxRR) {
          console.log(`⚠️ Skipping: ${market.question} R/R ${riskRewardRatio.toFixed(1)}:1 > max ${maxRR}:1`);
          this.io.emit('tradeSkipped', {
            market_id: market.market_id, coin: market.question,
            reason: `風險回報比 ${riskRewardRatio.toFixed(1)}:1 超過上限 ${maxRR}:1`,
            timestamp: Date.now()
          });
          continue;
        }

        // --- Calculate raw Half Kelly fraction ---
        const edge = Math.abs(analysis.compositeScore);
        const estProb = Math.min(0.95, Math.max(0.05, tokenPrice + edge));
        const odds = 1 / tokenPrice;
        const kellyFraction = ((estProb * (odds - 1)) - (1 - estProb)) / (odds - 1);
        const halfKelly = Math.max(0, kellyFraction / 2);

        if (halfKelly <= 0) {
          console.log(`⚠️ Skipping: ${market.question} Kelly says no edge (f=${kellyFraction.toFixed(4)})`);
          this.io.emit('tradeSkipped', {
            market_id: market.market_id, coin: market.question,
            reason: `Kelly 無 edge (f=${kellyFraction.toFixed(4)})`,
            timestamp: Date.now()
          });
          continue;
        }

        candidates.push({
          market, analysis, prices, tokenPrice,
          halfKelly, tradeKey, mode
        });
      }

      // ===== Phase 2: Sort by Half Kelly (highest edge first) =====
      candidates.sort((a, b) => b.halfKelly - a.halfKelly);

      // ===== Phase 3: Allocate budget and execute trades =====
      const totalBudget = bankroll * maxExposure;
      let usedBudget = 0;

      for (const candidate of candidates) {
        const remainingBudget = totalBudget - usedBudget;
        if (remainingBudget <= MIN_REMAINING_BUDGET) {
          console.log(`⚠️ Budget exhausted ($${usedBudget.toFixed(2)}/$${totalBudget.toFixed(2)}), skipping remaining`);
          this.io.emit('tradeSkipped', {
            market_id: candidate.market.market_id,
            coin: candidate.market.question,
            reason: `併發預算已用盡 ($${usedBudget.toFixed(2)}/$${totalBudget.toFixed(2)})`,
            timestamp: Date.now()
          });
          break;
        }

        // Calculate trade amount from Kelly
        let tradeAmount = candidate.halfKelly * bankroll;

        // Apply min/max bounds
        const baseAmount = parseFloat(this.config.tradeAmount) || 10;
        const MAX_TRADE = baseAmount * 2;
        tradeAmount = Math.min(MAX_TRADE, Math.max(MIN_TRADE, tradeAmount));

        // Cap to remaining budget
        tradeAmount = Math.min(tradeAmount, remainingBudget);

        // Confidence adjustment
        if (candidate.analysis.tradeAmount === 'increased') {
          tradeAmount = Math.min(MAX_TRADE, Math.min(remainingBudget, tradeAmount * 1.3));
        } else if (candidate.analysis.tradeAmount === 'reduced') {
          tradeAmount = tradeAmount * 0.5;
        }

        // Final min check after adjustments
        if (tradeAmount < MIN_TRADE) {
          console.log(`⚠️ Trade amount $${tradeAmount.toFixed(2)} below minimum, skipping`);
          continue;
        }

        usedBudget += tradeAmount;
        this.processedTrades.add(candidate.tradeKey);

        // Pass the Kelly-calculated amount to executeTrade
        this.config._kellyAmount = tradeAmount;
        await this.executeTrade(
          candidate.market, candidate.analysis.decision,
          candidate.analysis.outcome, candidate.prices,
          candidate.mode, candidate.analysis
        );
        delete this.config._kellyAmount;

        console.log(`💰 Budget: $${usedBudget.toFixed(2)} / $${totalBudget.toFixed(2)} used`);
      }

      this.db.updateStatus({ last_heartbeat: Date.now() });
    } catch (error) {
      console.error('❌ Error checking trading opportunities:', error.message);
    }
  }

  async executeTrade(market, side, outcome, prices, mode, analysis) {
    try {
      // Use Kelly-calculated amount if available, otherwise fall back to base config
      let tradeAmount;
      if (this.config._kellyAmount) {
        tradeAmount = this.config._kellyAmount;
        // Kelly adjustments already applied in checkTradingOpportunities
      } else {
        tradeAmount = parseFloat(this.config.tradeAmount) || 10;
        // Apply old adjustment logic as fallback
        if (analysis && analysis.tradeAmount === 'increased') {
          tradeAmount = tradeAmount * 1.5;
        } else if (analysis && analysis.tradeAmount === 'reduced') {
          tradeAmount = tradeAmount * 0.5;
        }
      }
      
      const price = outcome === 'YES' ? prices.yes_price : prices.no_price;
      const shares = price > 0 ? tradeAmount / price : 0;

      console.log(`📊 [${mode.toUpperCase()}] Executing trade: ${side} ${outcome} on "${market.question}"`);
      if (analysis) {
        console.log(`   📈 Composite Score: ${analysis.compositeScore.toFixed(3)}, Confidence: ${(analysis.confidence * 100).toFixed(1)}%`);
      }

      // Create analysis summary for notes with settlement info
      let analysisNotes = '';
      if (analysis) {
        analysisNotes = JSON.stringify({
          end_date: market.end_date,
          slug: market.slug,
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
      } else {
        // Even without analysis, store settlement info for paper trades
        analysisNotes = JSON.stringify({
          end_date: market.end_date,
          slug: market.slug
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
        // Paper trading - mark as filled with pending settlement
        trade.status = 'filled';
        trade.order_id = `PAPER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        trade.pnl = 0; // Will be settled after market expiration
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

  // Helper function to determine market winner from Gamma API response
  getMarketWinner(marketData) {
    if (!marketData) return null;
    const market = Array.isArray(marketData) ? marketData[0] : marketData;
    
    // Check outcomePrices (most reliable — settled to [1,0] or [0,1])
    let prices = market.outcomePrices;
    if (typeof prices === 'string') {
      try { 
        prices = JSON.parse(prices); 
      } catch(e) { 
        prices = null; 
      }
    }
    if (Array.isArray(prices) && prices.length >= 2) {
      const yesPrice = parseFloat(prices[0]);
      const noPrice = parseFloat(prices[1]);
      if (yesPrice >= this.RESOLUTION_PRICE_THRESHOLD) return 'YES';
      if (noPrice >= this.RESOLUTION_PRICE_THRESHOLD) return 'NO';
    }
    
    // Check closed/resolved status
    if (market.closed || market.resolved) {
      if (market.winning_side) return market.winning_side.toUpperCase();
      if (market.resolution) return market.resolution.toUpperCase();
    }
    
    return null; // Not yet resolved
  }

  // Settle paper trades after market expiration
  async settlePaperTrades() {
    if (!this.isRunning) return;

    try {
      const unsettledTrades = this.db.getUnsettledPaperTrades();
      
      if (unsettledTrades.length === 0) {
        return;
      }

      console.log(`🔍 Checking ${unsettledTrades.length} unsettled paper trades...`);

      for (const trade of unsettledTrades) {
        try {
          // Parse notes to get settlement info
          let settlementInfo = {};
          if (trade.notes) {
            try {
              settlementInfo = JSON.parse(trade.notes);
            } catch (e) {
              console.error(`Failed to parse notes for trade ${trade.id}`);
              continue;
            }
          }

          const endDate = settlementInfo.end_date;
          const slug = settlementInfo.slug;

          if (!endDate || !slug) {
            console.log(`⚠️ Trade ${trade.id} missing settlement info, skipping`);
            continue;
          }

          // Check if market has expired
          const now = Date.now();
          if (now <= endDate) {
            // Market not yet expired
            continue;
          }

          console.log(`📊 Settling trade ${trade.id} for market ${slug}...`);

          // Query Gamma API for market resolution
          const marketData = await this.polymarket.getMarketBySlug(slug);
          const winner = this.getMarketWinner(marketData);

          if (!winner) {
            console.log(`⏳ Market ${slug} not yet resolved, will retry later`);
            continue;
          }

          console.log(`✅ Market ${slug} resolved: winner = ${winner}`);

          // Calculate PnL based on outcome
          let calculatedPnl;
          if (trade.outcome === winner) {
            // Win: shares - amount (shares settle at $1.00 each)
            calculatedPnl = trade.shares - trade.amount;
          } else {
            // Loss: -amount (complete loss of investment)
            calculatedPnl = -trade.amount;
          }

          console.log(`💰 Trade ${trade.id}: outcome=${trade.outcome}, winner=${winner}, PnL=${calculatedPnl.toFixed(2)}`);

          // Update trade in database
          this.db.updateTrade(trade.id, { pnl: calculatedPnl });

          // Update stats
          const stats = this.db.getStats('paper');
          this.db.updateStatus({ 
            total_trades: stats.total_trades,
            total_pnl: stats.total_pnl
          });

          // Emit updates to frontend
          const updatedTrade = this.db.getTradeById(trade.id);
          this.io.emit('tradeSettled', updatedTrade);
          this.io.emit('stats', stats);
          
          // Emit recent trades
          const recentTrades = this.db.getTrades(10, 'paper');
          this.io.emit('recentTrades', recentTrades);

          console.log(`✅ Trade ${trade.id} settled successfully`);
        } catch (error) {
          console.error(`❌ Error settling trade ${trade.id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('❌ Error in settlePaperTrades:', error.message);
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
