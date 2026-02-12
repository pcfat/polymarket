import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import StatsCards from '../components/StatsCards';
import PnlChart from '../components/PnlChart';
import OpportunityTable from '../components/OpportunityTable';
import TradeHistory from '../components/TradeHistory';
import RiskPanel from '../components/RiskPanel';

export default function Dashboard() {
  const [stats, setStats] = useState({
    balance: 0,
    total_pnl: 0,
    roi_pct: 0,
    win_rate: 0,
  });
  const [pnlSeries, setPnlSeries] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [recentTrades, setRecentTrades] = useState([]);
  const [riskStatus, setRiskStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const { data: wsData } = useWebSocket();

  // Initial data fetch
  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Handle WebSocket updates
  useEffect(() => {
    if (!wsData) return;

    switch (wsData.type) {
      case 'dashboard':
        // Update dashboard data
        if (wsData.data.stats) setStats(wsData.data.stats);
        if (wsData.data.risk) setRiskStatus(wsData.data.risk);
        break;
      case 'opportunities':
        // Update opportunities
        if (wsData.data.opportunities) {
          setOpportunities(wsData.data.opportunities);
        }
        break;
      case 'trade':
        // Add new trade to recent trades
        fetchDashboardData(); // Refresh all data
        break;
      default:
        break;
    }
  }, [wsData]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);

      // Fetch all dashboard data
      const [statsData, pnlData, opportunitiesData, tradesData, riskData] =
        await Promise.all([
          api.getDashboardStats(),
          api.getPnl(undefined, 30),
          api.getOpportunities(),
          api.getTrades({ limit: 10 }),
          api.getRiskStatus(),
        ]);

      setStats(statsData);
      setPnlSeries(pnlData);
      setOpportunities(opportunitiesData);
      setRecentTrades(tradesData);
      setRiskStatus(riskData);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <StatsCards stats={stats} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - PnL Chart */}
        <div className="lg:col-span-2">
          <PnlChart data={pnlSeries} />
        </div>

        {/* Right Column - Risk Panel */}
        <div>{riskStatus && <RiskPanel status={riskStatus} />}</div>
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Opportunities */}
        <OpportunityTable opportunities={opportunities} />

        {/* Recent Trades */}
        <TradeHistory trades={recentTrades} />
      </div>
    </div>
  );
}
