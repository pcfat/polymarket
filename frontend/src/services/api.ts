/**
 * API Service - REST API calls
 */

const API_BASE = '/api';

async function fetchAPI(endpoint: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }

  return response.json();
}

export const api = {
  // Dashboard
  getDashboard: () => fetchAPI('/dashboard'),
  getDashboardStats: () => fetchAPI('/dashboard/stats'),
  getRiskStatus: () => fetchAPI('/dashboard/risk'),

  // Markets
  getMarkets: (limit = 100, activeOnly = true) =>
    fetchAPI(`/markets?limit=${limit}&active_only=${activeOnly}`),
  getOpportunities: () => fetchAPI('/markets/opportunities'),

  // Trades
  getTrades: (params?: {
    limit?: number;
    offset?: number;
    mode?: string;
    strategy?: string;
    status?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.offset) query.append('offset', params.offset.toString());
    if (params?.mode) query.append('mode', params.mode);
    if (params?.strategy) query.append('strategy', params.strategy);
    if (params?.status) query.append('status', params.status);
    return fetchAPI(`/trades?${query.toString()}`);
  },
  getTradeStats: (mode?: string) => {
    const query = mode ? `?mode=${mode}` : '';
    return fetchAPI(`/trades/stats${query}`);
  },
  getPnl: (mode?: string, days = 30) => {
    const query = new URLSearchParams();
    if (mode) query.append('mode', mode);
    query.append('days', days.toString());
    return fetchAPI(`/trades/pnl?${query.toString()}`);
  },

  // Settings
  getSettings: () => fetchAPI('/settings'),
  updateSettings: (settings: any) =>
    fetchAPI('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  // Health
  getHealth: () => fetchAPI('/health'),
};
