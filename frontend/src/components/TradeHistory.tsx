interface Trade {
  order_id: string;
  strategy: string;
  status: string;
  actual_profit_usd?: number;
  expected_profit_usd: number;
  timestamp: string;
}

interface Props {
  trades: Trade[];
}

export default function TradeHistory({ trades }: Props) {
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
    <div className="bg-primary-card rounded-lg border border-primary-border p-6">
      <h3 className="text-xl font-semibold text-white mb-4">Recent Trades</h3>

      {trades.length === 0 ? (
        <div className="text-center py-8 text-gray-400">No trades yet</div>
      ) : (
        <div className="space-y-3">
          {trades.map((trade) => {
            const profit =
              trade.actual_profit_usd ?? trade.expected_profit_usd;
            return (
              <div
                key={trade.order_id}
                className="flex items-center justify-between p-3 rounded-lg bg-primary-bg border border-primary-border hover:border-gray-600 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-xs text-gray-500 font-mono">
                      {trade.order_id}
                    </span>
                    {getStatusBadge(trade.status)}
                  </div>
                  <div className="text-sm text-gray-400">
                    {trade.strategy.replace('_', ' ')}
                  </div>
                </div>

                <div className="text-right">
                  <div
                    className={`text-lg font-bold ${
                      profit >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(trade.timestamp).toLocaleTimeString('zh-TW')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
