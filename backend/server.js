require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const DatabaseManager = require('./database');
const TradingEngine = require('./tradingEngine');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Database and engine will be initialized in async startup
let db;
let engine;
const tradingConfig = {
  tradeAmount: process.env.TRADE_AMOUNT || 10,
  tradeWindowSeconds: process.env.TRADE_WINDOW_SECONDS || 120,
  oddsMinPrice: parseFloat(process.env.ODDS_MIN_PRICE) || 0.30,
  oddsMaxPrice: parseFloat(process.env.ODDS_MAX_PRICE) || 0.75,
  maxRiskReward: parseFloat(process.env.MAX_RISK_REWARD) || 5,
  bankroll: parseFloat(process.env.BANKROLL) || 100,
  maxExposure: parseFloat(process.env.MAX_EXPOSURE) || null // Will default to bankroll * 0.5
};

// Socket.IO connection handling
io.on('connection', async (socket) => {
  console.log('🔌 Client connected:', socket.id);

  try {
    // Send initial status
    const status = db.getStatus();
    socket.emit('status', {
      isRunning: status.is_running === 1,
      mode: status.mode,
      lastHeartbeat: status.last_heartbeat,
      totalTrades: status.total_trades,
      totalPnl: status.total_pnl
    });

    // Send initial stats
    const stats = db.getStats(status.mode);
    socket.emit('stats', stats);

    // Send recent trades
    const recentTrades = db.getTrades(10, status.mode);
    socket.emit('recentTrades', recentTrades);

    // Send markets with prices
    const markets = engine.getMarkets();
    const marketsWithPrices = [];
    
    // Markets are cached from last scan and include prices
    for (const market of markets) {
      marketsWithPrices.push({
        market_id: market.market_id,
        question: market.question,
        coin: market.coin || '',
        end_date: market.end_date,
        yes_price: market.yes_price || 0,
        no_price: market.no_price || 0,
        volume: market.volume || 0,
        active: market.active
      });
    }
    
    socket.emit('markets', {
      markets: marketsWithPrices,
      count: marketsWithPrices.length,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('❌ Error in socket connection handler:', error.message);
    socket.emit('error', { message: 'Server error during connection', error: error.message });
  }

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// REST API Endpoints

// Get engine status
app.get('/api/status', (req, res) => {
  const status = db.getStatus();
  res.json({
    success: true,
    isRunning: status.is_running === 1,
    mode: status.mode,
    lastHeartbeat: status.last_heartbeat,
    totalTrades: status.total_trades,
    totalPnl: status.total_pnl,
    config: tradingConfig
  });
});

// Start engine
app.post('/api/start', async (req, res) => {
  try {
    await engine.start();
    res.json({ success: true, message: 'Engine started' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop engine
app.post('/api/stop', (req, res) => {
  try {
    engine.stop();
    res.json({ success: true, message: 'Engine stopped' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Switch mode (paper/live)
app.post('/api/mode', (req, res) => {
  try {
    const { mode } = req.body;
    
    if (!mode || !['paper', 'live'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'Invalid mode. Must be "paper" or "live"' });
    }

    db.updateStatus({ mode });
    io.emit('modeChanged', { mode });
    
    // Send updated stats for new mode
    const stats = db.getStats(mode);
    io.emit('stats', stats);
    
    // Send recent trades for new mode
    const recentTrades = db.getTrades(10, mode);
    io.emit('recentTrades', recentTrades);

    res.json({ success: true, mode });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get trades
app.get('/api/trades', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const mode = req.query.mode || null;
    const trades = db.getTrades(limit, mode);
    res.json({ success: true, trades, count: trades.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get market snapshots
app.get('/api/snapshots', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const snapshots = db.getSnapshots(limit);
    res.json({ success: true, snapshots, count: snapshots.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get statistics
app.get('/api/stats', (req, res) => {
  try {
    const mode = req.query.mode || null;
    const stats = db.getStats(mode);
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all records
app.delete('/api/records', (req, res) => {
  try {
    db.clearAllRecords();
    io.emit('recordsCleared', { timestamp: Date.now() });
    
    // Send updated stats
    const status = db.getStatus();
    const stats = db.getStats(status.mode);
    io.emit('stats', stats);
    io.emit('recentTrades', []);

    res.json({ success: true, message: 'All records cleared' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update strategy configuration
app.put('/api/config', (req, res) => {
  try {
    const { tradeAmount, tradeWindowSeconds, oddsMinPrice, oddsMaxPrice, maxRiskReward, bankroll, maxExposure } = req.body;
    
    const newConfig = {};
    if (tradeAmount !== undefined) newConfig.tradeAmount = parseFloat(tradeAmount);
    if (tradeWindowSeconds !== undefined) newConfig.tradeWindowSeconds = parseInt(tradeWindowSeconds);
    if (oddsMinPrice !== undefined) newConfig.oddsMinPrice = parseFloat(oddsMinPrice);
    if (oddsMaxPrice !== undefined) newConfig.oddsMaxPrice = parseFloat(oddsMaxPrice);
    if (maxRiskReward !== undefined) newConfig.maxRiskReward = parseFloat(maxRiskReward);
    if (bankroll !== undefined) newConfig.bankroll = parseFloat(bankroll);
    if (maxExposure !== undefined) newConfig.maxExposure = parseFloat(maxExposure);

    // If bankroll changed but maxExposure wasn't provided, auto-update maxExposure to 50% of bankroll
    // This matches the DEFAULT_MAX_EXPOSURE_RATIO constant in TradingEngine
    if (bankroll !== undefined && maxExposure === undefined) {
      newConfig.maxExposure = parseFloat(bankroll) * 0.5;
    }

    Object.assign(tradingConfig, newConfig);
    engine.updateConfig(newConfig); // Pass only the changes

    res.json({ success: true, config: tradingConfig });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get active markets
app.get('/api/markets', (req, res) => {
  try {
    const markets = engine.getMarkets();
    res.json({
      success: true,
      markets: markets.map(m => ({
        market_id: m.market_id,
        question: m.question,
        end_date: m.end_date,
        active: m.active,
        volume: m.volume,
        liquidity: m.liquidity
      })),
      count: markets.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get latest strategy analysis
app.get('/api/analysis', (req, res) => {
  try {
    const analysis = engine.getLatestAnalysis();
    res.json({
      success: true,
      analysis,
      count: analysis.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update strategy weights
app.put('/api/weights', (req, res) => {
  try {
    const { technical, news, orderFlow } = req.body;
    
    // Validate that all weights are provided
    if (technical === undefined || news === undefined || orderFlow === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'All weights must be provided (technical, news, orderFlow)' 
      });
    }
    
    // Validate that weights are numbers
    const techWeight = parseFloat(technical);
    const newsWeight = parseFloat(news);
    const ofWeight = parseFloat(orderFlow);
    
    if (isNaN(techWeight) || isNaN(newsWeight) || isNaN(ofWeight)) {
      return res.status(400).json({ 
        success: false, 
        error: 'All weights must be valid numbers' 
      });
    }
    
    // Validate that weights sum to approximately 1.0 (allow small tolerance)
    const sum = techWeight + newsWeight + ofWeight;
    if (Math.abs(sum - 1.0) > 0.01) {
      return res.status(400).json({ 
        success: false, 
        error: `Weights must sum to 1.0 (current sum: ${sum.toFixed(3)})` 
      });
    }
    
    // Validate that weights are positive
    if (techWeight < 0 || newsWeight < 0 || ofWeight < 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'All weights must be non-negative' 
      });
    }
    
    const newWeights = {
      technical: techWeight,
      news: newsWeight,
      orderFlow: ofWeight
    };
    
    engine.updateWeights(newWeights);
    
    res.json({ 
      success: true, 
      weights: newWeights,
      message: 'Strategy weights updated successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Async startup to initialize database
(async () => {
  try {
    // Initialize database
    const dbPath = process.env.DB_PATH || './trading.db';
    db = new DatabaseManager(dbPath);
    await db.initDatabase();
    
    // Reset is_running state on server restart (no cron jobs running yet)
    // This prevents stale state when server was killed without graceful shutdown
    db.updateStatus({ is_running: false });
    console.log('✅ Reset is_running state to false on startup');
    
    // Initialize trading engine
    engine = new TradingEngine(db, tradingConfig, io);
    
    // Start server
    const PORT = process.env.PORT || 3001;
    const HOST = process.env.HOST || 'localhost';
    server.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════╗
║  🤖 Polymarket 15分鐘加密貨幣自動交易系統                    ║
║  🌐 Server running on http://${HOST}:${PORT}             ║
║  📊 Database: ${dbPath}                                    ║
║  🎯 Mode: ${db.getStatus().mode.toUpperCase()}             ║
╚═══════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
})();

// Global error handlers to prevent silent crashes
const UNCAUGHT_EXCEPTION_EXIT_DELAY_MS = 1000;

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  console.error('Stack trace:', error.stack);
  // Uncaught exceptions leave the app in undefined state - must restart
  console.error(`⚠️ Process will exit in ${UNCAUGHT_EXCEPTION_EXIT_DELAY_MS}ms...`);
  setTimeout(() => {
    process.exit(1);
  }, UNCAUGHT_EXCEPTION_EXIT_DELAY_MS);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  // Log but don't crash for unhandled rejections - they're recoverable
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (engine) engine.stop();
  if (db) db.close();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  if (engine) engine.stop();
  if (db) db.close();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
