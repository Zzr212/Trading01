import React, { useState, useEffect, useCallback } from 'react';
import ChartContainer from './components/ChartContainer';
import TradePanel from './components/TradePanel';
import ApiKeyScreen from './components/ApiKeyScreen';
import { Trade, AppError } from './types';

type TabType = 'ACTIVE' | 'HISTORY' | 'ERRORS';

export default function App() {
  const [apiKey, setApiKey] = useState<string>(localStorage.getItem('gemini_api_key') || '');
  const [isKeyValid, setIsKeyValid] = useState<boolean>(false);
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
        setTrades(data);
      }
    } catch (e: any) {
      addError("Failed to fetch trades: " + e.message);
    }
  }, [addError]);

  const handleReboot = async () => {
    if (!window.confirm("Are you sure you want to reboot? All history will be deleted and the API key will be cleared.")) return;
    try {
      await fetch('/api/reset', { method: 'DELETE' });
      setTrades([]);
      setErrors([]);
      localStorage.removeItem('gemini_api_key');
      setApiKey('');
      setIsKeyValid(false);
      setActiveTab('ACTIVE');
    } catch (e: any) {
      addError("Failed to reset system: " + e.message);
    }
  };

  useEffect(() => {
    if (apiKey) {
      fetch('/api/verify-key', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })
      .then(r => r.json())
      .then(d => {
        if (d.valid) {
          setIsKeyValid(true);
          fetchTrades();
        } else {
          localStorage.removeItem('gemini_api_key');
          setApiKey('');
          addError("API Key validation failed. Please re-enter.");
        }
      })
      .catch(e => addError("Network error validating API key"));
    }
  }, [apiKey, fetchTrades, addError]);

  const handleValidKey = (key: string) => {
    localStorage.setItem('gemini_api_key', key);
    setApiKey(key);
    setIsKeyValid(true);
    fetchTrades();
  };

  // Evaluate Active Trade
  useEffect(() => {
    const activeTrade = trades.find(t => t.status === 'ACTIVE');
    if (!activeTrade || currentPrice === 0) return;

    let result: 'WON' | 'LOST' | null = null;

    if (activeTrade.type === 'LONG') {
      if (currentPrice >= activeTrade.takeProfit) result = 'WON';
      else if (currentPrice <= activeTrade.stopLoss) result = 'LOST';
    } else {
      if (currentPrice <= activeTrade.takeProfit) result = 'WON';
      else if (currentPrice >= activeTrade.stopLoss) result = 'LOST';
    }

    if (result) {
      // Optimistic update
      setTrades(prev => prev.map(t => t.id === activeTrade.id ? { ...t, status: result } : t));
      // Notify backend
      fetch(`/api/trades/${activeTrade.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: result })
      }).catch(e => addError("Failed to update trade status: " + e.message));
    }
  }, [currentPrice, trades, addError]);

  if (!isKeyValid) {
    return <ApiKeyScreen onValidKey={handleValidKey} />;
  }

  const activeTrade = trades.find(t => t.status === 'ACTIVE') || null;
  const historyTrades = trades.filter(t => t.status !== 'ACTIVE');

  const isHistoryTab = activeTab === 'HISTORY';

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-neutral-950 font-sans selection:bg-blue-500/30 overflow-hidden">
      {/* Top Half - Chart (Dynamically sized) */}
      <div className={`transition-all duration-500 ease-in-out ${isHistoryTab ? 'h-[40%]' : 'h-[70%]'} min-h-0 relative`}>
        <ChartContainer 
          apiKey={apiKey}
          activeTrade={activeTrade}
          onPriceUpdate={setCurrentPrice}
          onSentimentUpdate={setSentimentScore}
          onTradeCreated={(t) => setTrades(prev => [t, ...prev])}
          onError={addError}
        />
      </div>
      
      {/* Bottom Half - AI Suggestions & History (Dynamically sized) */}
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

