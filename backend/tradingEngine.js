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

          // Odds range filter - skip trades at extreme prices
          const ODDS_MIN_PRICE = parseFloat(this.config.oddsMinPrice) || 0.30;
          const ODDS_MAX_PRICE = parseFloat(this.config.oddsMaxPrice) || 0.75;
          
          const tokenPrice = analysis.outcome === 'YES' ? prices.yes_price : prices.no_price;
          
          if (tokenPrice < ODDS_MIN_PRICE || tokenPrice > ODDS_MAX_PRICE) {
            console.log(`⚠️ Skipping trade: ${market.coin} ${analysis.outcome} price ${tokenPrice.toFixed(4)} outside range [${ODDS_MIN_PRICE}-${ODDS_MAX_PRICE}]`);
            this.io.emit('tradeSkipped', {
              market_id: market.market_id,
              coin: market.coin,
              reason: `Price ${tokenPrice.toFixed(4)} outside odds range [${ODDS_MIN_PRICE}-${ODDS_MAX_PRICE}]`,
              timestamp: Date.now()
            });
            continue;
          }

          // Risk-reward ratio guard
          const MAX_RISK_REWARD_RATIO = parseFloat(this.config.maxRiskReward) || 5;
          
          const potentialGain = (1.0 - tokenPrice); // Max gain per $1 of token
          const potentialLoss = tokenPrice;          // Max loss per $1 of token
          const riskRewardRatio = potentialLoss / potentialGain;
          
          if (riskRewardRatio > MAX_RISK_REWARD_RATIO) {
            console.log(`⚠️ Skipping trade: ${market.coin} risk/reward ratio ${riskRewardRatio.toFixed(1)}:1 exceeds max ${MAX_RISK_REWARD_RATIO}:1`);
            this.io.emit('tradeSkipped', {
              market_id: market.market_id,
              coin: market.coin,
              reason: `Risk/reward ${riskRewardRatio.toFixed(1)}:1 exceeds max ${MAX_RISK_REWARD_RATIO}:1`,
              timestamp: Date.now()
            });
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
      const baseAmount = parseFloat(this.config.tradeAmount) || 10;
      const bankroll = parseFloat(this.config.bankroll) || 100;
      
      const price = outcome === 'YES' ? prices.yes_price : prices.no_price;
      
      // Half Kelly position sizing
      // Kelly fraction = (p * (odds - 1) - (1 - p)) / (odds - 1)
      // where p = estimated probability of winning, odds = decimal odds
      // Half Kelly = Kelly / 2 (more conservative)
      
      // Market price represents implied probability for binary outcome tokens (0-1 range)
      const impliedProb = price;
      
      // Use compositeScore to adjust probability
      // For YES: positive score means we think YES is more likely than market
      // For NO: negative score means we think NO is more likely (YES less likely)
      const compositeScore = analysis.compositeScore;
      const direction = outcome === 'YES' ? 1 : -1;
      const alignedEdge = compositeScore * direction; // Edge aligned with our trade direction
      
      // If edge is negative (we're betting against our signal), skip trade
      if (alignedEdge <= 0) {
        console.log(`⚠️ Trade direction misaligned with signal: compositeScore=${compositeScore.toFixed(3)}, outcome=${outcome}, skipping`);
        this.io.emit('tradeSkipped', {
          market_id: market.market_id,
          coin: market.coin,
          reason: `Signal misalignment: score=${compositeScore.toFixed(3)} for ${outcome}`,
          timestamp: Date.now()
        });
        return;
      }
      
      // Estimate our probability using the aligned edge
      // Clamp between 0.05 and 0.95 to avoid extreme Kelly sizing
      const estimatedProb = Math.min(0.95, Math.max(0.05, impliedProb + alignedEdge));
      
      const odds = 1 / price; // Decimal odds
      const kellyFraction = ((estimatedProb * (odds - 1)) - (1 - estimatedProb)) / (odds - 1);
      const halfKelly = Math.max(0, kellyFraction / 2); // Half Kelly, minimum 0
      
      let tradeAmount = halfKelly * bankroll;
      
      // Apply min/max bounds
      const MIN_TRADE = 1;   // Minimum $1 trade
      const MAX_TRADE_MULTIPLIER = 2; // Maximum trade size as multiplier of base amount
      const MAX_TRADE = baseAmount * MAX_TRADE_MULTIPLIER;
      tradeAmount = Math.min(MAX_TRADE, Math.max(MIN_TRADE, tradeAmount));
      
      // If Kelly says don't bet (fraction <= 0), skip the trade
      if (kellyFraction <= 0) {
        console.log(`⚠️ Kelly criterion says no edge: fraction=${kellyFraction.toFixed(4)}, skipping trade`);
        this.io.emit('tradeSkipped', {
          market_id: market.market_id,
          coin: market.coin,
          reason: `Kelly criterion shows no edge (fraction=${kellyFraction.toFixed(4)})`,
          timestamp: Date.now()
        });
        return;
      }
      
      // Adjust based on analysis confidence level
      const HIGH_CONFIDENCE_MULTIPLIER = 1.3;
      const LOW_CONFIDENCE_MULTIPLIER = 0.5;
      
      if (analysis && analysis.tradeAmount === 'increased') {
        tradeAmount = Math.min(MAX_TRADE, tradeAmount * HIGH_CONFIDENCE_MULTIPLIER);
      } else if (analysis && analysis.tradeAmount === 'reduced') {
        tradeAmount = tradeAmount * LOW_CONFIDENCE_MULTIPLIER;
      }
      
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

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('⚙️ Configuration updated:', this.config);
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
