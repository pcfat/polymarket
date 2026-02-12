interface Opportunity {
  strategy: string;
  market_question: string;
  expected_profit_pct: number;
  expected_profit_usd: number;
  max_executable_size: number;
  confidence: number;
}

interface Props {
  opportunities: Opportunity[];
}

export default function OpportunityTable({ opportunities }: Props) {
  const getStrategyBadge = (strategy: string) => {
    const colors: Record<string, string> = {
      intra_market: 'bg-blue-900/50 text-blue-400 border-blue-700',
      cross_market: 'bg-purple-900/50 text-purple-400 border-purple-700',
      multi_outcome: 'bg-yellow-900/50 text-yellow-400 border-yellow-700',
    };

    return (
      <span
        className={`px-2 py-1 rounded text-xs font-medium border ${
          colors[strategy] || 'bg-gray-900/50 text-gray-400 border-gray-700'
        }`}
      >
        {strategy.replace('_', ' ').toUpperCase()}
      </span>
    );
  };

  return (
    <div className="bg-primary-card rounded-lg border border-primary-border p-6">
      <h3 className="text-xl font-semibold text-white mb-4">
        Arbitrage Opportunities
      </h3>

      {opportunities.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          No opportunities found
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-primary-border text-gray-400 text-sm">
                <th className="text-left py-3 px-2">Strategy</th>
                <th className="text-left py-3 px-2">Market</th>
                <th className="text-right py-3 px-2">Profit %</th>
                <th className="text-right py-3 px-2">Profit $</th>
                <th className="text-right py-3 px-2">Size</th>
                <th className="text-right py-3 px-2">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((opp, index) => (
                <tr
                  key={index}
                  className={`border-b border-primary-border hover:bg-primary-border/50 ${
                    opp.expected_profit_pct > 2
                      ? 'bg-green-900/10'
                      : ''
                  }`}
                >
                  <td className="py-3 px-2">{getStrategyBadge(opp.strategy)}</td>
                  <td className="py-3 px-2 text-sm text-gray-300 max-w-xs truncate">
                    {opp.market_question}
                  </td>
                  <td className="py-3 px-2 text-right text-green-400 font-medium">
                    {opp.expected_profit_pct.toFixed(2)}%
                  </td>
                  <td className="py-3 px-2 text-right text-green-400 font-medium">
                    ${opp.expected_profit_usd.toFixed(2)}
                  </td>
                  <td className="py-3 px-2 text-right text-gray-300 text-sm">
                    {opp.max_executable_size.toFixed(0)}
                  </td>
                  <td className="py-3 px-2 text-right">
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full"
                        style={{ width: `${opp.confidence * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
