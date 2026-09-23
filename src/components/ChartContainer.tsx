import React, { useState, useEffect, useRef } from 'react';
import { Kline, Timeframe, Trade, SRLevels } from '../types';
import { fetchHistoricalKlines } from '../lib/binance';
import { calculateEMA, calculateRSI, calculateMACD, calculateATR, calculateVWAP, findSupportResistance } from '../lib/indicators';
import CandlestickChart from './CandlestickChart';
import { ChevronDown, Home } from 'lucide-react';
const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'];
interface Props {
  symbol: string;
  onBack: () => void;
  activeTrade: Trade | null;
  onPriceUpdate: (price: number) => void;
  onSentimentUpdate: (score: number) => void;
  onTradeCreated: (trade: Trade) => void;
  onError: (msg: string) => void;
}
export default function ChartContainer({ symbol, onBack, activeTrade, onPriceUpdate, onSentimentUpdate, onTradeCreated, onError }: Props) {
  const [data, setData] = useState<Kline[]>([]);
  const enrichedData = React.useMemo(() => {
    if (data.length === 0) return [];
    const ema9 = calculateEMA(data, 9);
    const ema21 = calculateEMA(data, 21);
    const rsiArray = calculateRSI(data, 14);
    const atrArray = calculateATR(data, 14);
    const macdData = calculateMACD(data);
    const vwapArray = calculateVWAP(data);
    
    return data.map((d, i) => {
      const e9 = ema9[i];
      const e21 = ema21[i];
      const pe9 = i > 0 ? ema9[i - 1] : null;
      const pe21 = i > 0 ? ema21[i - 1] : null;
      const macdHist = macdData.hist[i];
      const pMacdHist = i > 0 ? macdData.hist[i - 1] : null;
      const rsi = rsiArray[i];
      const atr = atrArray[i] ?? 0;
      const vwap = vwapArray[i] ?? d.close;

      let algoSignal: 'LONG' | 'SHORT' | null = null;
      if (e9 !== null && e21 !== null && pe9 !== null && pe21 !== null && macdHist !== null && rsi !== null) {
        const isBullishCross = (e9 > e21 && pe9 <= pe21) || (macdHist > 0 && (pMacdHist ?? 0) <= 0);
        const isBullishBounce = d.low <= vwap && d.close > vwap && rsi >= 38 && rsi <= 68;

        const isBearishCross = (e9 < e21 && pe9 >= pe21) || (macdHist < 0 && (pMacdHist ?? 0) >= 0);
        const isBearishRejection = d.high >= vwap && d.close < vwap && rsi >= 32 && rsi <= 62;

        if (isBullishCross || isBullishBounce) {
          algoSignal = 'LONG';
        } else if (isBearishCross || isBearishRejection) {
          algoSignal = 'SHORT';
        }
      }

      return {
        ...d,
        ema9: e9,
        ema21: e21,
        rsi,
        atr,
        macd: macdData.macd[i],
        macdSignal: macdData.signal[i],
        macdHist,
        vwap,
        vwapUpper: vwap + (atr * 1.5),
        vwapLower: vwap - (atr * 1.5),
        algoSignal
      };
    });
  }, [data]);
  const [timeframe, setTimeframe] = useState<Timeframe>('1m');
  const [isLoading, setIsLoading] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [srLevels, setSrLevels] = useState<SRLevels | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const analyzingRef = useRef(false);


  // Initial Multi-Timeframe S/R Analysis
  useEffect(() => {
    const fetchSR = async () => {
      try {
        const tf15m = await fetchHistoricalKlines(symbol, '15m', 100);
        const sr = findSupportResistance(tf15m);
        setSrLevels(sr);
      } catch (err: any) {
        onError("Failed to fetch S/R levels: " + err.message);
      }
    };
    fetchSR();
  }, [onError]);



  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setData([]);
    
    if (wsRef.current) wsRef.current.close();

    const loadData = async () => {
      try {
        const initialData = await fetchHistoricalKlines(symbol, timeframe, 1000);
        if (!isMounted) return;
        setData(initialData);
        setIsLoading(false);

        let binanceSym = symbol.endsWith('USDT') ? symbol.toLowerCase() : (symbol.endsWith('USD') ? `${symbol.toLowerCase()}t` : `${symbol.toLowerCase()}usdt`);
        if (symbol === 'XAUUSD' || symbol === 'GOLD' || symbol === 'XAUUSDT') {
          binanceSym = 'paxgusdt';
        } else if (symbol === 'EURUSD' || symbol === 'EURUSDT') {
          binanceSym = 'eurusdt';
        } else if (symbol === 'GBPUSD' || symbol === 'GBPUSDT') {
          binanceSym = 'gbpusdt';
        }
        const wsUrl = `wss://stream.binance.com:9443/ws/${binanceSym}@kline_${timeframe}`;
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
              const more = await fetchHistoricalKlines(symbol, timeframe, 1000, currentEarliest - 1);
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
  }, [timeframe, onError, symbol]);




  return (
    <div className="w-full h-full flex flex-col border-b border-neutral-900 bg-neutral-950">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <button 
          onClick={onBack}
          title="Back to Dashboard"
          className="flex items-center justify-center p-1.5 bg-neutral-900/80 backdrop-blur-sm border border-neutral-800 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
        >
          <Home size={18} />
        </button>
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
        <CandlestickChart symbol={symbol} data={enrichedData} timeframe={timeframe} activeTrade={activeTrade} />
      </div>
    </div>
  );
}
