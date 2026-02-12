import { useState, useEffect } from 'react';
import { api } from '../services/api';

interface Market {
  condition_id: string;
  question: string;
  volume: number;
  liquidity: number;
  tokens: any[];
}

export default function Markets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchMarkets();
  }, []);

  const fetchMarkets = async () => {
    try {
      setLoading(true);
      const data = await api.getMarkets(100, true);
      setMarkets(data);
    } catch (error) {
      console.error('Failed to fetch markets:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredMarkets = markets.filter((market) =>
    market.question.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-white text-xl">Loading markets...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Markets</h1>
        <button
          onClick={fetchMarkets}
          className="px-4 py-2 bg-accent-blue text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="bg-primary-card rounded-lg border border-primary-border p-4">
        <input
          type="text"
          placeholder="Search markets..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
        />
      </div>

      {/* Markets Table */}
      <div className="bg-primary-card rounded-lg border border-primary-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-primary-bg">
              <tr className="text-gray-400 text-sm">
                <th className="text-left py-4 px-4">Question</th>
                <th className="text-right py-4 px-4">Volume</th>
                <th className="text-right py-4 px-4">Liquidity</th>
                <th className="text-right py-4 px-4">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {filteredMarkets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-gray-400">
                    No markets found
                  </td>
                </tr>
              ) : (
                filteredMarkets.map((market) => (
                  <tr
                    key={market.condition_id}
                    className="border-t border-primary-border hover:bg-primary-border/50 transition-colors"
                  >
                    <td className="py-4 px-4 text-white">{market.question}</td>
                    <td className="py-4 px-4 text-right text-gray-300">
                      ${market.volume.toLocaleString()}
                    </td>
                    <td className="py-4 px-4 text-right text-gray-300">
                      ${market.liquidity.toLocaleString()}
                    </td>
                    <td className="py-4 px-4 text-right text-gray-300">
                      {market.tokens.length}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-sm text-gray-500 text-center">
        Showing {filteredMarkets.length} of {markets.length} markets
      </div>
    </div>
  );
}
