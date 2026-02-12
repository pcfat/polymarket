import { useState } from 'react';

interface Props {
  currentMode: string;
  onModeChange: (mode: string) => void;
}

export default function ModeSwitch({ currentMode, onModeChange }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingMode, setPendingMode] = useState('');

  const handleToggle = () => {
    const newMode = currentMode === 'paper' ? 'live' : 'paper';

    if (newMode === 'live') {
      // Show confirmation for live mode
      setPendingMode(newMode);
      setShowConfirm(true);
    } else {
      // Switch to paper mode immediately
      onModeChange(newMode);
    }
  };

  const confirmSwitch = () => {
    onModeChange(pendingMode);
    setShowConfirm(false);
    setPendingMode('');
  };

  const cancelSwitch = () => {
    setShowConfirm(false);
    setPendingMode('');
  };

  return (
    <>
      <div className="flex items-center space-x-3">
        <span className="text-gray-400 text-sm">
          {currentMode === 'paper' ? 'Paper Trading' : 'Live Trading'}
        </span>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
            currentMode === 'live' ? 'bg-red-600' : 'bg-green-600'
          }`}
        >
          <span
            className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
              currentMode === 'live' ? 'translate-x-7' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-primary-card border-2 border-red-700 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="text-5xl mb-4">⚠️</div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Switch to Live Trading?
              </h2>
              <p className="text-gray-300">
                You are about to switch to live trading mode. Real funds will be
                used for trading. Are you sure?
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={cancelSwitch}
                className="flex-1 px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmSwitch}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-bold"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
