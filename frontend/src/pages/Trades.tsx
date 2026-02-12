import { useState, useEffect } from 'react';
import { api } from '../services/api';

interface Trade {
  order_id: string;
  mode: string;
  strategy: string;
  market_question: string;
  status: string;
  expected_profit_pct: number;
  expected_profit_usd: number;
  actual_profit_usd?: number;
  timestamp: string;
}

export default function Trades() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [modeFilter, setModeFilter] = useState<string>('');
  const [strategyFilter, setStrategyFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    fetchTrades();
    fetchStats();
  }, [modeFilter, strategyFilter, statusFilter]);

  const fetchTrades = async () => {
    try {
      setLoading(true);
      const data = await api.getTrades({
        limit: 100,
        mode: modeFilter || undefined,
        strategy: strategyFilter || undefined,
        status: statusFilter || undefined,
      });
      setTrades(data);
    } catch (error) {
      console.error('Failed to fetch trades:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const data = await api.getTradeStats(modeFilter || undefined);
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      executed: 'bg-green-900/50 text-green-400 border-green-700',
      pending: 'bg-yellow-900/50 text-yellow-400 border-yellow-700',
      failed: 'bg-red-900/50 text-red-400 border-red-700',
      cancelled: 'bg-gray-900/50 text-gray-400 border-gray-700',
    };

    return (
      <span
        className={`px-2 py-1 rounded text-xs font-medium border ${
          colors[status] || 'bg-gray-900/50 text-gray-400 border-gray-700'
        }`}
      >
        {status.toUpperCase()}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Trade History</h1>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-primary-card rounded-lg border border-primary-border p-4">
            <div className="text-gray-400 text-sm mb-1">Total Trades</div>
            <div className="text-white text-2xl font-bold">{stats.total_trades}</div>
          </div>
          <div className="bg-primary-card rounded-lg border border-green-700 p-4">
            <div className="text-gray-400 text-sm mb-1">Wins</div>
            <div className="text-green-400 text-2xl font-bold">
              {stats.winning_trades}
            </div>
          </div>
          <div className="bg-primary-card rounded-lg border border-red-700 p-4">
            <div className="text-gray-400 text-sm mb-1">Losses</div>
            <div className="text-red-400 text-2xl font-bold">
              {stats.losing_trades}
            </div>
          </div>
          <div className="bg-primary-card rounded-lg border border-primary-border p-4">
            <div className="text-gray-400 text-sm mb-1">Total PnL</div>
            <div
              className={`text-2xl font-bold ${
                stats.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              ${stats.total_pnl.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-primary-card rounded-lg border border-primary-border p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Mode</label>
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            >
              <option value="">All</option>
              <option value="paper">Paper</option>
              <option value="live">Live</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Strategy</label>
            <select
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            >
              <option value="">All</option>
              <option value="intra_market">Intra Market</option>
              <option value="cross_market">Cross Market</option>
              <option value="multi_outcome">Multi Outcome</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            >
              <option value="">All</option>
              <option value="executed">Executed</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Trades Table */}
      <div className="bg-primary-card rounded-lg border border-primary-border overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading trades...</div>
        ) : trades.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No trades found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-primary-bg">
                <tr className="text-gray-400 text-sm">
                  <th className="text-left py-4 px-4">Order ID</th>
                  <th className="text-left py-4 px-4">Mode</th>
                  <th className="text-left py-4 px-4">Strategy</th>
                  <th className="text-left py-4 px-4">Market</th>
                  <th className="text-center py-4 px-4">Status</th>
                  <th className="text-right py-4 px-4">Profit</th>
                  <th className="text-right py-4 px-4">Time</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => {
                  const profit = trade.actual_profit_usd ?? trade.expected_profit_usd;
                  return (
                    <tr
                      key={trade.order_id}
                      className="border-t border-primary-border hover:bg-primary-border/50"
                    >
                      <td className="py-3 px-4 font-mono text-xs text-gray-400">
                        {trade.order_id}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            trade.mode === 'live'
                              ? 'bg-red-900/50 text-red-400'
                              : 'bg-green-900/50 text-green-400'
                          }`}
                        >
                          {trade.mode.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-300">
                        {trade.strategy.replace('_', ' ')}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-300 max-w-xs truncate">
                        {trade.market_question}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {getStatusBadge(trade.status)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-bold ${
                          profit >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right text-sm text-gray-400">
                        {new Date(trade.timestamp).toLocaleString('zh-TW')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
