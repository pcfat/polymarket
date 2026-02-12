import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface PnlDataPoint {
  timestamp: string;
  cumulative_pnl: number;
  trade_count: number;
}

interface Props {
  data: PnlDataPoint[];
}

export default function PnlChart({ data }: Props) {
  const chartData = data.map((point) => ({
    time: new Date(point.timestamp).toLocaleDateString('zh-TW', {
      month: 'short',
      day: 'numeric',
    }),
    pnl: point.cumulative_pnl,
    trades: point.trade_count,
  }));

  return (
    <div className="bg-primary-card rounded-lg border border-primary-border p-6">
      <h3 className="text-xl font-semibold text-white mb-4">Cumulative PnL</h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#252547" />
          <XAxis dataKey="time" stroke="#9ca3af" />
          <YAxis stroke="#9ca3af" />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1a1a2e',
              border: '1px solid #252547',
              borderRadius: '8px',
            }}
            labelStyle={{ color: '#e5e7eb' }}
            itemStyle={{ color: '#10b981' }}
          />
          <Area
            type="monotone"
            dataKey="pnl"
            stroke="#10b981"
            fillOpacity={1}
            fill="url(#colorPnl)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
