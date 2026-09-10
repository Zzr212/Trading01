import React, { useState, useEffect, useRef } from 'react';
import { Kline, Timeframe, Trade } from '../types';
import { fetchHistoricalKlines } from '../lib/binance';
import { calculateEMA, calculateRSI } from '../lib/indicators';
import CandlestickChart from './CandlestickChart';
import { ChevronDown } from 'lucide-react';

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'];

interface Props {
  apiKey: string;
  activeTrade: Trade | null;
  onPriceUpdate: (price: number) => void;
  onSentimentUpdate: (score: number) => void;
  onTradeCreated: (trade: Trade) => void;
}

export default function ChartContainer({ apiKey, activeTrade, onPriceUpdate, onSentimentUpdate, onTradeCreated }: Props) {
  const [data, setData] = useState<Kline[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>('1m');
  const [isLoading, setIsLoading] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const analyzingRef = useRef(false);

  // Derive indicators whenever data changes
  const enrichedData = React.useMemo(() => {
    if (data.length === 0) return [];
    const ema9 = calculateEMA(data, 9);
    const ema21 = calculateEMA(data, 21);
    const rsiArray = calculateRSI(data, 14);

    return data.map((d, i) => ({
      ...d,
      ema9: ema9[i],
      ema21: ema21[i],
      rsi: rsiArray[i]
    }));
  }, [data]);

  // Handle AI Trigger Logic
  useEffect(() => {
    if (enrichedData.length < 21) return;
    const current = enrichedData[enrichedData.length - 1];
    const prev = enrichedData[enrichedData.length - 2];
    
    onPriceUpdate(current.close);

    // Calculate overall sentiment (0-100)
    let score = 50;
    if (current.ema9 && current.ema21) {
      if (current.ema9 > current.ema21) score += 20;
      else score -= 20;
    }
    if (current.rsi) {
      if (current.rsi > 50) score += (current.rsi - 50); // max +50
      else score -= (50 - current.rsi); // max -50
    }
    onSentimentUpdate(Math.max(0, Math.min(100, score)));

    // Do not trigger a new trade if one is active or we are already analyzing
    if (activeTrade || analyzingRef.current) return;

    // Check for Crossover Signals (Trigger)
    let signalType: 'LONG' | 'SHORT' | null = null;
    
    if (current.ema9 && current.ema21 && prev.ema9 && prev.ema21) {
      // Golden Cross (LONG)
      if (prev.ema9 <= prev.ema21 && current.ema9 > current.ema21 && current.rsi && current.rsi < 60) {
        signalType = 'LONG';
      }
      // Death Cross (SHORT)
      else if (prev.ema9 >= prev.ema21 && current.ema9 < current.ema21 && current.rsi && current.rsi > 40) {
        signalType = 'SHORT';
      }
    }

    if (signalType) {
      analyzingRef.current = true;
      const recentCandles = enrichedData.slice(-5).map(c => ({
        close: c.close, volume: c.volume, ema9: c.ema9, ema21: c.ema21, rsi: c.rsi
      }));

      fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          type: signalType,
          currentPrice: current.close,
          ema9: current.ema9,
          ema21: current.ema21,
          rsi: current.rsi,
          recentCandles
        })
      })
      .then(r => r.json())
      .then(res => {
        if (res.trade && res.entryPrice && res.takeProfit && res.stopLoss) {
          const newTrade: Trade = {
            id: Date.now().toString(),
            pair: 'BTC/USDT',
            type: res.type,
            entryPrice: res.entryPrice,
            takeProfit: res.takeProfit,
            stopLoss: res.stopLoss,
            status: 'ACTIVE',
            timestamp: Date.now(),
            confidence: res.confidence || 80
          };
          
          // Save to DB
          fetch('/api/trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newTrade)
          }).then(() => {
            onTradeCreated(newTrade);
          }).catch(console.error);
        }
      })
      .catch(console.error)
      .finally(() => {
        analyzingRef.current = false;
      });
    }
  }, [enrichedData, activeTrade, apiKey, onPriceUpdate, onSentimentUpdate, onTradeCreated]);


  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setData([]); // Clear old data on timeframe switch
    
    // Close existing WebSocket
    if (wsRef.current) {
      wsRef.current.close();
    }

    const loadData = async () => {
      try {
        // 1. Fetch the latest 1000 candles instantly
        const initialData = await fetchHistoricalKlines('BTCUSDT', timeframe, 1000);
        if (!isMounted) return;
        setData(initialData);
        setIsLoading(false);

        // 2. Setup real-time WebSocket for current timeframe
        const wsUrl = `wss://stream.binance.com:9443/ws/btcusdt@kline_${timeframe}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.e === 'kline') {
            const kline = message.k;
            const newKline: Kline = {
              time: kline.t,
              open: parseFloat(kline.o),
              high: parseFloat(kline.h),
              low: parseFloat(kline.l),
              close: parseFloat(kline.c),
              volume: parseFloat(kline.v),
            };

            setData((prevData) => {
              if (prevData.length === 0) return [newKline];
              const lastKline = prevData[prevData.length - 1];
              
              if (lastKline.time === newKline.time) {
                // Update current candle
                return [...prevData.slice(0, -1), newKline];
              } else if (newKline.time > lastKline.time) {
                // Append new candle only if it's newer
                return [...prevData, newKline];
              }
              return prevData;
            });
          }
        };

        // 3. Background fetch older data (up to ~10,000 candles as requested)
        // We fetch 9 more pages of 1000
        let currentEarliest = initialData[0]?.time;
        if (!currentEarliest) return;

        const fetchMore = async () => {
          for (let i = 0; i < 9; i++) {
            if (!isMounted) break;
            try {
              const more = await fetchHistoricalKlines('BTCUSDT', timeframe, 1000, currentEarliest - 1);
              if (more.length === 0) break;
              currentEarliest = more[0].time;
              setData(prev => {
                if (!prev || prev.length === 0) return more;
                // Merge without duplicates at boundaries
                const filteredMore = more.filter(m => m.time < prev[0].time);
                return [...filteredMore, ...prev];
              });
            } catch (err) {
              console.warn('Background fetch interrupted', err);
              break; // Stop fetching on error/rate limit
            }
          }
        };
        
        // Delay background fetch slightly to keep UI thread smooth during initial render
        setTimeout(fetchMore, 1000);

      } catch (err) {
        console.error('Failed to load chart data', err);
        if (isMounted) setIsLoading(false);
      }
    };

    loadData();

    return () => {
      isMounted = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [timeframe]);

  return (
    <div className="w-full h-full flex flex-col border-b border-neutral-900 bg-neutral-950">
      {/* Timeframe Dropdown */}
      <div className="absolute top-4 right-4 z-20">
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-2 px-3 py-1.5 bg-neutral-900/80 backdrop-blur-sm border border-neutral-800 rounded-md text-sm font-semibold text-neutral-200 hover:bg-neutral-800 transition-colors"
        >
          {timeframe} <ChevronDown size={14} className={`transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
        
        {isDropdownOpen && (
          <div className="absolute top-full right-0 mt-1 flex flex-col bg-neutral-900/95 backdrop-blur-md border border-neutral-800 rounded-md shadow-xl overflow-hidden min-w-[80px]">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => {
                  setTimeframe(tf);
                  setIsDropdownOpen(false);
                }}
                className={`px-4 py-2 text-sm font-medium text-left transition-colors ${
                  timeframe === tf 
                    ? 'bg-blue-500/10 text-blue-400' 
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading && data.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950">
          <div className="text-neutral-500 font-mono text-sm animate-pulse">Loading {timeframe} data...</div>
        </div>
      )}
      
      <div className="flex-1 relative">
        <CandlestickChart data={enrichedData} timeframe={timeframe} activeTrade={activeTrade} />
      </div>
    </div>
  );
}
