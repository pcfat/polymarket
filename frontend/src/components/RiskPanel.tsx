interface RiskStatus {
  circuit_breaker_active: boolean;
  daily_pnl: number;
  daily_loss_limit: number;
  total_exposure: number;
  max_exposure: number;
  open_orders: number;
  max_orders: number;
  consecutive_losses: number;
  cooldown_until?: string;
}

interface Props {
  status: RiskStatus;
}

export default function RiskPanel({ status }: Props) {
  const getProgressBar = (
    current: number,
    max: number,
    label: string,
    reverse = false
  ) => {
    const percentage = (current / max) * 100;
    const isWarning = reverse ? percentage < 50 : percentage > 75;
    const isDanger = reverse ? percentage < 25 : percentage > 90;

    return (
      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-400">{label}</span>
          <span className="text-white font-medium">
            {current.toFixed(0)} / {max.toFixed(0)}
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              isDanger
                ? 'bg-red-500'
                : isWarning
                ? 'bg-yellow-500'
                : 'bg-green-500'
            }`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="bg-primary-card rounded-lg border border-primary-border p-6">
      <h3 className="text-xl font-semibold text-white mb-4">Risk Status</h3>

      {/* Circuit Breaker Alert */}
      {status.circuit_breaker_active && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg">
          <div className="flex items-center space-x-2">
            <span className="text-red-500 text-xl">🚨</span>
            <div>
              <div className="text-red-400 font-bold">Circuit Breaker Active</div>
              <div className="text-red-300 text-sm">Trading is halted</div>
            </div>
          </div>
        </div>
      )}

      {/* Cooldown Alert */}
      {status.cooldown_until && new Date(status.cooldown_until) > new Date() && (
        <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg">
          <div className="text-yellow-400 text-sm">
            ⏱️ Cooldown until{' '}
            {new Date(status.cooldown_until).toLocaleTimeString('zh-TW')}
          </div>
        </div>
      )}

      {/* Daily PnL */}
      <div className="mb-4 p-3 bg-primary-bg rounded-lg">
        <div className="text-gray-400 text-sm mb-1">Daily PnL</div>
        <div
          className={`text-2xl font-bold ${
            status.daily_pnl >= 0 ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {status.daily_pnl >= 0 ? '+' : ''}${status.daily_pnl.toFixed(2)}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Limit: ${status.daily_loss_limit.toFixed(0)}
        </div>
      </div>

      {/* Exposure */}
      {getProgressBar(
        status.total_exposure,
        status.max_exposure,
        'Total Exposure'
      )}

      {/* Open Orders */}
      {getProgressBar(status.open_orders, status.max_orders, 'Open Orders')}

      {/* Consecutive Losses */}
      {status.consecutive_losses > 0 && (
        <div className="mt-4 p-3 bg-orange-900/20 border border-orange-700 rounded-lg">
          <div className="text-orange-400 text-sm">
            ⚠️ {status.consecutive_losses} consecutive losses
          </div>
        </div>
      )}
    </div>
  );
}
