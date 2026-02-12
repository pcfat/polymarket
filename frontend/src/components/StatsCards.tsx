interface StatsCard {
  label: string;
  value: string | number;
  change?: number;
  icon: string;
  color: 'green' | 'red' | 'blue' | 'yellow';
}

interface Props {
  stats: {
    balance: number;
    total_pnl: number;
    roi_pct: number;
    win_rate: number;
  };
}

export default function StatsCards({ stats }: Props) {
  const cards: StatsCard[] = [
    {
      label: 'Balance',
      value: `$${stats.balance.toFixed(2)}`,
      icon: '💰',
      color: 'blue',
    },
    {
      label: 'Total PnL',
      value: `$${stats.total_pnl.toFixed(2)}`,
      change: stats.total_pnl,
      icon: '📊',
      color: stats.total_pnl >= 0 ? 'green' : 'red',
    },
    {
      label: 'ROI',
      value: `${stats.roi_pct.toFixed(2)}%`,
      change: stats.roi_pct,
      icon: '📈',
      color: stats.roi_pct >= 0 ? 'green' : 'red',
    },
    {
      label: 'Win Rate',
      value: `${stats.win_rate.toFixed(1)}%`,
      icon: '🎯',
      color: stats.win_rate >= 50 ? 'green' : 'yellow',
    },
  ];

  const getColorClasses = (color: string) => {
    switch (color) {
      case 'green':
        return 'border-green-700 bg-green-900/20';
      case 'red':
        return 'border-red-700 bg-red-900/20';
      case 'blue':
        return 'border-blue-700 bg-blue-900/20';
      case 'yellow':
        return 'border-yellow-700 bg-yellow-900/20';
      default:
        return 'border-gray-700 bg-gray-900/20';
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, index) => (
        <div
          key={index}
          className={`p-6 rounded-lg border ${getColorClasses(card.color)}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xl">{card.icon}</span>
            {card.change !== undefined && (
              <span
                className={`text-sm font-medium ${
                  card.change >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {card.change >= 0 ? '↑' : '↓'}{' '}
                {Math.abs(card.change).toFixed(2)}
              </span>
            )}
          </div>
          <div className="text-gray-400 text-sm mb-1">{card.label}</div>
          <div className="text-white text-2xl font-bold">{card.value}</div>
        </div>
      ))}
    </div>
  );
}
