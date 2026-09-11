import React, { useState, useEffect, useRef } from 'react';
import { Kline, Timeframe, Trade, SRLevels } from '../types';
import { fetchHistoricalKlines } from '../lib/binance';
import { calculateEMA, calculateRSI, calculateMACD, calculateATR, findSupportResistance } from '../lib/indicators';
import CandlestickChart from './CandlestickChart';
import { ChevronDown } from 'lucide-react';
const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'];
interface Props {
  activeTrade: Trade | null;
  onPriceUpdate: (price: number) => void;
  onSentimentUpdate: (score: number) => void;
  onTradeCreated: (trade: Trade) => void;
  onError: (msg: string) => void;
}
export default function ChartContainer({ activeTrade, onPriceUpdate, onSentimentUpdate, onTradeCreated, onError }: Props) {
  const [data, setData] = useState<Kline[]>([]);
  const enrichedData = React.useMemo(() => {
    if (data.length === 0) return [];
    const ema9 = calculateEMA(data, 9);
    const ema21 = calculateEMA(data, 21);
    const rsiArray = calculateRSI(data, 14);
    const atrArray = calculateATR(data, 14);
    const macdData = calculateMACD(data);
    
    return data.map((d, i) => ({
      ...d,
      ema9: ema9[i],
      ema21: ema21[i],
      rsi: rsiArray[i],
      atr: atrArray[i],
      macd: macdData.macd[i],
      macdSignal: macdData.signal[i],
      macdHist: macdData.hist[i]
    }));
  }, [data]);
  const [timeframe, setTimeframe] = useState<Timeframe>('1m');
  const [isLoading, setIsLoading] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [srLevels, setSrLevels] = useState<SRLevels | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const analyzingRef = useRef(false);
  const recordedCandlesRef = useRef<Kline[]>([]);

  // Initial Multi-Timeframe S/R Analysis
  useEffect(() => {
    const fetchSR = async () => {
      try {
        const tf15m = await fetchHistoricalKlines('BTCUSDT', '15m', 100);
        const sr = findSupportResistance(tf15m);
        setSrLevels(sr);
      } catch (err: any) {
        onError("Failed to fetch S/R levels: " + err.message);
      }
    };
    fetchSR();
  }, [onError]);

  // Handle active trade recording (Tick by Tick)
  useEffect(() => {
    if (activeTrade && enrichedData.length > 0) {
      // Record every distinct tick (WS update) during the trade
      const current = enrichedData[enrichedData.length - 1];
      const lastRecorded = recordedCandlesRef.current[recordedCandlesRef.current.length - 1];
      
      if (!lastRecorded || lastRecorded !== current) {
        recordedCandlesRef.current.push(current);
      }
    } else if (!activeTrade && recordedCandlesRef.current.length > 0) {
      // Handled in next useEffect
    }
  }, [enrichedData, activeTrade]);

  const lastActiveTradeIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (activeTrade) {
      lastActiveTradeIdRef.current = activeTrade.id;
    } else if (lastActiveTradeIdRef.current && recordedCandlesRef.current.length > 0) {
      // Trade just ended! Let's save the review data.
      fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId: lastActiveTradeIdRef.current,
          candles: recordedCandlesRef.current
        })
      }).catch(e => onError("Failed to save trade review: " + e.message));
      
      lastActiveTradeIdRef.current = null;
      recordedCandlesRef.current = []; // Clear for next trade
    }
  }, [activeTrade, onError]);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setData([]);
    
    if (wsRef.current) wsRef.current.close();

    const loadData = async () => {
      try {
        const initialData = await fetchHistoricalKlines('BTCUSDT', timeframe, 1000);
        if (!isMounted) return;
        setData(initialData);
        setIsLoading(false);

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
                return [...prevData.slice(0, -1), newKline];
              } else if (newKline.time > lastKline.time) {
                return [...prevData, newKline];
              }
              return prevData;
            });
          }
        };

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
                const filteredMore = more.filter(m => m.time < prev[0].time);
                return [...filteredMore, ...prev];
              });
            } catch (err: any) {
              onError("Background fetch interrupted: " + err.message);
              break;
            }
          }
        };
        
        setTimeout(fetchMore, 1000);
      } catch (err: any) {
        onError('Failed to load chart data: ' + err.message);
        if (isMounted) setIsLoading(false);
      }
    };

    loadData();

    return () => {
      isMounted = false;
      if (wsRef.current) wsRef.current.close();
    };
  }, [timeframe, onError]);




  return (
    <div className="w-full h-full flex flex-col border-b border-neutral-900 bg-neutral-950">
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
