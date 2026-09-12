import React, { useState, useEffect, useCallback } from 'react';
import ChartContainer from './components/ChartContainer';
import TradePanel from './components/TradePanel';
import Dashboard from './components/Dashboard';
import { Trade, AppError } from './types';
import { ArrowLeft } from 'lucide-react';

type TabType = 'ACTIVE' | 'HISTORY' | 'ERRORS';

export default function App() {
  const [selectedPair, setSelectedPair] = useState<string | null>(null);

  if (!selectedPair) {
    return <Dashboard onSelectPair={setSelectedPair} />;
  }

  return <PairView pair={selectedPair} onBack={() => setSelectedPair(null)} />;
}

function PairView({ pair, onBack }: { pair: string, onBack: () => void }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [errors, setErrors] = useState<AppError[]>([]);
  const [sentimentScore, setSentimentScore] = useState(50);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [activeTab, setActiveTab] = useState<TabType>('ACTIVE');

  const addError = useCallback((msg: string) => {
    setErrors(prev => [{ id: Date.now().toString(), message: msg, timestamp: Date.now() }, ...prev]);
  }, []);

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch('/api/trades');
      const data = await res.json();
      if (Array.isArray(data)) {
        // Filter trades for this specific pair
        setTrades(data.filter(t => t.pair === pair));
      }
    } catch (e: any) {
      addError("Failed to fetch trades: " + e.message);
    }
  }, [addError, pair]);

  const handleReboot = async () => {
    if (!window.confirm("Are you sure you want to reboot? All history will be deleted.")) return;
    try {
      await fetch('/api/reset', { method: 'DELETE' });
      setTrades([]);
      setErrors([]);
      setActiveTab('ACTIVE');
    } catch (e: any) {
      addError("Failed to reset system: " + e.message);
    }
  };

  useEffect(() => {
    fetchTrades();
    const interval = setInterval(fetchTrades, 3000);
    return () => clearInterval(interval);
  }, [fetchTrades]);

  const activeTrade = trades.find(t => t.status === 'ACTIVE') || null;
  const historyTrades = trades.filter(t => t.status !== 'ACTIVE');
  const isHistoryTab = activeTab === 'HISTORY';

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-neutral-950 font-sans selection:bg-blue-500/30 overflow-hidden relative">
      {/* Top Header to go back */}
      <div className="absolute top-4 left-4 z-50 flex items-center gap-4">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 bg-neutral-900/80 hover:bg-neutral-800 text-white px-4 py-2 rounded-full backdrop-blur-sm border border-neutral-800 transition-colors shadow-lg"
        >
          <ArrowLeft size={16} />
          <span className="text-sm font-bold">Back</span>
        </button>
        <div className="px-4 py-2 bg-neutral-900/80 rounded-full border border-neutral-800 text-white font-bold backdrop-blur-sm shadow-lg">
          {pair} - Trading View
        </div>
      </div>

      {/* Top Half - Chart (Dynamically sized) */}
      <div className={`transition-all duration-500 ease-in-out ${isHistoryTab ? 'h-[40%]' : 'h-[70%]'} min-h-0 relative`}>
        <ChartContainer 
          symbol={pair}
          activeTrade={activeTrade}
          onPriceUpdate={setCurrentPrice}
          onSentimentUpdate={setSentimentScore}
          onTradeCreated={(t) => {
            setTrades(prev => [t, ...prev]);
            fetch('/api/trades', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(t)
            }).catch(e => addError("Failed to save trade: " + e.message));
          }}
          onError={addError}
        />
      </div>
      
      {/* Bottom Half - TA Suggestions & History (Dynamically sized) */}
      <div className={`transition-all duration-500 ease-in-out ${isHistoryTab ? 'h-[60%]' : 'h-[30%]'} min-h-0 border-t-2 border-neutral-900 shadow-[0_-8px_30px_rgba(0,0,0,0.5)] z-10 relative`}>
        <TradePanel 
          activeTrade={activeTrade} 
          history={historyTrades}
          sentimentScore={sentimentScore}
          errors={errors}
          onClearErrors={() => setErrors([])}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onReboot={handleReboot}
        />
      </div>
    </div>
  );
}
