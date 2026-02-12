import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function Navbar() {
  const location = useLocation();
  const [mode, setMode] = useState('paper');
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Fetch current settings to get mode
    api.getSettings().then((settings) => {
      setMode(settings.system.mode);
    }).catch(console.error);

    // Check health periodically
    const checkHealth = () => {
      api.getHealth()
        .then(() => setIsConnected(true))
        .catch(() => setIsConnected(false));
    };

    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { path: '/', label: 'Dashboard' },
    { path: '/markets', label: 'Markets' },
    { path: '/trades', label: 'Trades' },
    { path: '/settings', label: 'Settings' },
  ];

  return (
    <nav className="bg-primary-card border-b border-primary-border">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-accent-blue rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">P</span>
            </div>
            <span className="text-white font-semibold text-lg">
              Polymarket Arbitrage
            </span>
          </div>

          {/* Navigation Links */}
          <div className="flex items-center space-x-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  location.pathname === item.path
                    ? 'bg-accent-blue text-white'
                    : 'text-gray-300 hover:bg-primary-border hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Status Indicators */}
          <div className="flex items-center space-x-4">
            {/* Mode Badge */}
            <div
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                mode === 'live'
                  ? 'bg-red-900/50 text-red-400 border border-red-700'
                  : 'bg-green-900/50 text-green-400 border border-green-700'
              }`}
            >
              {mode === 'live' ? '🔴 LIVE' : '🟢 PAPER'}
            </div>

            {/* Connection Status */}
            <div className="flex items-center space-x-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <span className="text-sm text-gray-400">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
