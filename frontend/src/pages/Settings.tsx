import { useState, useEffect } from 'react';
import { api } from '../services/api';
import ModeSwitch from '../components/ModeSwitch';

export default function Settings() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const data = await api.getSettings();
      setSettings(data);
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveMessage('');
      await api.updateSettings(settings);
      setSaveMessage('Settings saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveMessage('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleModeChange = async (mode: string) => {
    const updatedSettings = {
      ...settings,
      system: { ...settings.system, mode },
    };
    setSettings(updatedSettings);
    
    try {
      await api.updateSettings({ system: { mode } });
      setSaveMessage(`Switched to ${mode} mode`);
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      console.error('Failed to change mode:', error);
    }
  };

  const updateSetting = (section: string, key: string, value: any) => {
    setSettings({
      ...settings,
      [section]: {
        ...settings[section],
        [key]: value,
      },
    });
  };

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-white text-xl">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-accent-blue text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {saveMessage && (
        <div
          className={`p-4 rounded-lg ${
            saveMessage.includes('success')
              ? 'bg-green-900/30 border border-green-700 text-green-400'
              : 'bg-red-900/30 border border-red-700 text-red-400'
          }`}
        >
          {saveMessage}
        </div>
      )}

      {/* Trading Mode */}
      <div className="bg-primary-card rounded-lg border border-primary-border p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Trading Mode</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-gray-300 mb-1">Current Mode</div>
            <div className="text-sm text-gray-400">
              Switch between paper trading (simulated) and live trading (real funds)
            </div>
          </div>
          <ModeSwitch
            currentMode={settings.system.mode}
            onModeChange={handleModeChange}
          />
        </div>
      </div>

      {/* Arbitrage Parameters */}
      <div className="bg-primary-card rounded-lg border border-primary-border p-6">
        <h2 className="text-xl font-semibold text-white mb-4">
          Arbitrage Parameters
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Minimum Profit % (0.1-10)
            </label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="10"
              value={settings.arbitrage.min_profit_pct}
              onChange={(e) =>
                updateSetting('arbitrage', 'min_profit_pct', parseFloat(e.target.value))
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Minimum Profit USD ($0.10-$100)
            </label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="100"
              value={settings.arbitrage.min_profit_usd}
              onChange={(e) =>
                updateSetting('arbitrage', 'min_profit_usd', parseFloat(e.target.value))
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Scan Interval (seconds)
            </label>
            <input
              type="number"
              min="1"
              max="60"
              value={settings.arbitrage.scan_interval_seconds}
              onChange={(e) =>
                updateSetting(
                  'arbitrage',
                  'scan_interval_seconds',
                  parseInt(e.target.value)
                )
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Minimum Liquidity ($)
            </label>
            <input
              type="number"
              min="100"
              max="10000"
              step="100"
              value={settings.arbitrage.min_liquidity_usd}
              onChange={(e) =>
                updateSetting(
                  'arbitrage',
                  'min_liquidity_usd',
                  parseFloat(e.target.value)
                )
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>
        </div>
      </div>

      {/* Risk Management */}
      <div className="bg-primary-card rounded-lg border border-primary-border p-6">
        <h2 className="text-xl font-semibold text-white mb-4">
          Risk Management
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Max Position Size ($)
            </label>
            <input
              type="number"
              min="10"
              max="10000"
              step="10"
              value={settings.risk.max_position_usd}
              onChange={(e) =>
                updateSetting('risk', 'max_position_usd', parseFloat(e.target.value))
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Max Total Exposure ($)
            </label>
            <input
              type="number"
              min="100"
              max="50000"
              step="100"
              value={settings.risk.max_total_exposure_usd}
              onChange={(e) =>
                updateSetting(
                  'risk',
                  'max_total_exposure_usd',
                  parseFloat(e.target.value)
                )
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Max Daily Loss ($)
            </label>
            <input
              type="number"
              min="10"
              max="5000"
              step="10"
              value={settings.risk.max_daily_loss_usd}
              onChange={(e) =>
                updateSetting('risk', 'max_daily_loss_usd', parseFloat(e.target.value))
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Max Open Orders
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={settings.risk.max_open_orders}
              onChange={(e) =>
                updateSetting('risk', 'max_open_orders', parseInt(e.target.value))
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Cooldown After Loss (seconds)
            </label>
            <input
              type="number"
              min="0"
              max="3600"
              step="30"
              value={settings.risk.cooldown_after_loss_sec}
              onChange={(e) =>
                updateSetting(
                  'risk',
                  'cooldown_after_loss_sec',
                  parseInt(e.target.value)
                )
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>
        </div>
      </div>

      {/* Paper Trading Settings */}
      <div className="bg-primary-card rounded-lg border border-primary-border p-6">
        <h2 className="text-xl font-semibold text-white mb-4">
          Paper Trading Settings
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Initial Balance ($)
            </label>
            <input
              type="number"
              min="1000"
              max="100000"
              step="1000"
              value={settings.paper_trading.initial_balance}
              onChange={(e) =>
                updateSetting(
                  'paper_trading',
                  'initial_balance',
                  parseFloat(e.target.value)
                )
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Slippage (BPS)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={settings.paper_trading.slippage_bps}
              onChange={(e) =>
                updateSetting(
                  'paper_trading',
                  'slippage_bps',
                  parseInt(e.target.value)
                )
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Simulated Latency (ms)
            </label>
            <input
              type="number"
              min="0"
              max="2000"
              step="50"
              value={settings.paper_trading.simulate_latency_ms}
              onChange={(e) =>
                updateSetting(
                  'paper_trading',
                  'simulate_latency_ms',
                  parseInt(e.target.value)
                )
              }
              className="w-full px-4 py-2 bg-primary-bg text-white rounded-lg border border-primary-border focus:outline-none focus:border-accent-blue"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
