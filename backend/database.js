const Database = require('better-sqlite3');
const path = require('path');

class DatabaseManager {
  constructor(dbPath = './polymarket.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  initTables() {
    // Trades table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('paper', 'live')),
        market_id TEXT NOT NULL,
        market_question TEXT NOT NULL,
        side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
        outcome TEXT NOT NULL CHECK(outcome IN ('YES', 'NO')),
        price REAL NOT NULL,
        amount REAL NOT NULL,
        shares REAL NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'filled', 'failed', 'cancelled')),
        order_id TEXT,
        pnl REAL DEFAULT 0,
        notes TEXT
      )
    `);

    // Market snapshots table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS market_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        market_id TEXT NOT NULL,
        market_question TEXT NOT NULL,
        yes_price REAL NOT NULL,
        no_price REAL NOT NULL,
        volume REAL DEFAULT 0,
        liquidity REAL DEFAULT 0
      )
    `);

    // Bot status table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bot_status (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        is_running INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'paper' CHECK(mode IN ('paper', 'live')),
        last_heartbeat INTEGER,
        total_trades INTEGER DEFAULT 0,
        total_pnl REAL DEFAULT 0
      )
    `);

    // Initialize bot status if not exists
    const status = this.db.prepare('SELECT * FROM bot_status WHERE id = 1').get();
    if (!status) {
      this.db.prepare('INSERT INTO bot_status (id, is_running, mode) VALUES (1, 0, ?)').run('paper');
    }

    console.log('✅ Database tables initialized');
  }

  // Bot Status Operations
  getStatus() {
    return this.db.prepare('SELECT * FROM bot_status WHERE id = 1').get();
  }

  updateStatus(updates) {
    const fields = [];
    const values = [];
    
    if (updates.is_running !== undefined) {
      fields.push('is_running = ?');
      values.push(updates.is_running ? 1 : 0);
    }
    if (updates.mode !== undefined) {
      fields.push('mode = ?');
      values.push(updates.mode);
    }
    if (updates.last_heartbeat !== undefined) {
      fields.push('last_heartbeat = ?');
      values.push(updates.last_heartbeat);
    }
    if (updates.total_trades !== undefined) {
      fields.push('total_trades = ?');
      values.push(updates.total_trades);
    }
    if (updates.total_pnl !== undefined) {
      fields.push('total_pnl = ?');
      values.push(updates.total_pnl);
    }

    if (fields.length > 0) {
      values.push(1);
      this.db.prepare(`UPDATE bot_status SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  // Trade Operations
  insertTrade(trade) {
    const stmt = this.db.prepare(`
      INSERT INTO trades (timestamp, mode, market_id, market_question, side, outcome, price, amount, shares, status, order_id, pnl, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const info = stmt.run(
      trade.timestamp || Date.now(),
      trade.mode,
      trade.market_id,
      trade.market_question,
      trade.side,
      trade.outcome,
      trade.price,
      trade.amount,
      trade.shares,
      trade.status,
      trade.order_id || null,
      trade.pnl || 0,
      trade.notes || null
    );
    
    return info.lastInsertRowid;
  }

  getTrades(limit = 100, mode = null) {
    let query = 'SELECT * FROM trades';
    const params = [];
    
    if (mode) {
      query += ' WHERE mode = ?';
      params.push(mode);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    
    return this.db.prepare(query).all(...params);
  }

  getTradeById(id) {
    return this.db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  }

  updateTrade(id, updates) {
    const fields = [];
    const values = [];
    
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.order_id !== undefined) {
      fields.push('order_id = ?');
      values.push(updates.order_id);
    }
    if (updates.pnl !== undefined) {
      fields.push('pnl = ?');
      values.push(updates.pnl);
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      values.push(updates.notes);
    }

    if (fields.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE trades SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  // Market Snapshot Operations
  insertSnapshot(snapshot) {
    const stmt = this.db.prepare(`
      INSERT INTO market_snapshots (timestamp, market_id, market_question, yes_price, no_price, volume, liquidity)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      snapshot.timestamp || Date.now(),
      snapshot.market_id,
      snapshot.market_question,
      snapshot.yes_price,
      snapshot.no_price,
      snapshot.volume || 0,
      snapshot.liquidity || 0
    ).lastInsertRowid;
  }

  getSnapshots(limit = 200) {
    return this.db.prepare('SELECT * FROM market_snapshots ORDER BY timestamp DESC LIMIT ?').all(limit);
  }

  // Statistics Operations
  getStats(mode = null) {
    let query = 'SELECT COUNT(*) as total_trades, SUM(pnl) as total_pnl, AVG(pnl) as avg_pnl FROM trades';
    const params = [];
    
    if (mode) {
      query += ' WHERE mode = ?';
      params.push(mode);
    }
    
    const stats = this.db.prepare(query).get(...params);
    
    // Calculate win rate
    let winRateQuery = 'SELECT COUNT(*) as wins FROM trades WHERE pnl > 0';
    const winRateParams = [];
    
    if (mode) {
      winRateQuery += ' AND mode = ?';
      winRateParams.push(mode);
    }
    
    const wins = this.db.prepare(winRateQuery).get(...winRateParams);
    const winRate = stats.total_trades > 0 ? (wins.wins / stats.total_trades) * 100 : 0;
    
    return {
      total_trades: stats.total_trades || 0,
      total_pnl: stats.total_pnl || 0,
      avg_pnl: stats.avg_pnl || 0,
      win_rate: winRate
    };
  }

  // Clear all records
  clearAllRecords() {
    this.db.exec('DELETE FROM trades');
    this.db.exec('DELETE FROM market_snapshots');
    this.updateStatus({ total_trades: 0, total_pnl: 0 });
    console.log('🗑️ All records cleared');
  }

  close() {
    this.db.close();
  }
}

module.exports = DatabaseManager;
