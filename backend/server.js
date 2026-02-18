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
  buyThreshold: process.env.BUY_THRESHOLD || 0.55,
  sellThreshold: process.env.SELL_THRESHOLD || 0.45,
  tradeWindowSeconds: process.env.TRADE_WINDOW_SECONDS || 120
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

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

  // Send markets
  socket.emit('markets', {
    markets: engine.getMarkets().map(m => ({
      market_id: m.market_id,
      question: m.question,
      end_date: m.end_date,
      active: m.active
    })),
    count: engine.getMarkets().length,
    timestamp: Date.now()
  });

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
app.post('/api/start', (req, res) => {
  try {
    engine.start();
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
    const { tradeAmount, buyThreshold, sellThreshold, tradeWindowSeconds } = req.body;
    
    const newConfig = {};
    if (tradeAmount !== undefined) newConfig.tradeAmount = parseFloat(tradeAmount);
    if (buyThreshold !== undefined) newConfig.buyThreshold = parseFloat(buyThreshold);
    if (sellThreshold !== undefined) newConfig.sellThreshold = parseFloat(sellThreshold);
    if (tradeWindowSeconds !== undefined) newConfig.tradeWindowSeconds = parseInt(tradeWindowSeconds);

    Object.assign(tradingConfig, newConfig);
    engine.updateConfig(tradingConfig);

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
