import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Trade, Kline } from '../types';
import CandlestickChart from './CandlestickChart';
import { X, Play, Pause, FastForward, Rewind } from 'lucide-react';

interface Props {
  trade: Trade;
  onClose: () => void;
}

export default function TradeReplayModal({ trade, onClose }: Props) {
  const [historyCandles, setHistoryCandles] = useState<Kline[]>([]);
  const [visibleCandles, setVisibleCandles] = useState<Kline[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Fetch historical data for this trade from server
    fetch(`/api/reviews/${trade.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.candles && data.candles.length > 0) {
          setHistoryCandles(data.candles);
          // Show the first 50 candles (before the trade) as context initially
          const entryIndex = data.candles.findIndex((c: Kline) => c.time >= trade.timestamp);
          const startIndex = Math.max(0, entryIndex - 50);
          setCurrentIndex(entryIndex);
          setVisibleCandles(data.candles.slice(startIndex, entryIndex + 1));
        }
      })
      .catch(console.error);
  }, [trade]);

  const playStep = useCallback(() => {
    setCurrentIndex(prev => {
      if (prev >= historyCandles.length - 1) {
        setIsPlaying(false);
        return prev;
      }
      const nextIndex = prev + 1;
      // Keep last 100 candles visible in the window
      const startIndex = Math.max(0, nextIndex - 100);
      setVisibleCandles(historyCandles.slice(startIndex, nextIndex + 1));
      return nextIndex;
    });
  }, [historyCandles]);

  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(playStep, 500 / speed);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, speed, playStep]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setCurrentIndex(val);
    const startIndex = Math.max(0, val - 100);
    setVisibleCandles(historyCandles.slice(startIndex, val + 1));
  };

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-neutral-900 border-b border-neutral-800">
        <div>
          <h2 className="text-white font-bold text-lg">Trade Replay: {trade.pair}</h2>
          <p className="text-neutral-400 text-sm">
            {new Date(trade.timestamp).toLocaleString()} • {trade.type} • {trade.status}
          </p>
        </div>
        <button onClick={onClose} className="p-2 text-neutral-400 hover:text-white bg-neutral-800 rounded-full">
          <X size={20} />
        </button>
      </div>

      {/* Chart */}
      <div className="flex-1 relative bg-neutral-950">
        {historyCandles.length > 0 ? (
          <CandlestickChart 
            data={visibleCandles} 
            timeframe="1m" 
            activeTrade={trade} 
            isReplay={true}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-500">
            Loading trade history...
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-neutral-900 p-6 border-t border-neutral-800 flex flex-col gap-4">
        {/* Timeline Slider */}
        <input 
          type="range" 
          min="0" 
          max={Math.max(0, historyCandles.length - 1)} 
          value={currentIndex}
          onChange={handleSliderChange}
          className="w-full accent-blue-500"
        />
        
        {/* Playback Buttons */}
        <div className="flex items-center justify-center gap-6">
          <button 
            onClick={() => setSpeed(s => Math.max(0.5, s - 0.5))}
            className="text-neutral-400 hover:text-white"
          >
            <Rewind size={24} />
          </button>
          
          <button 
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-14 h-14 bg-white text-black rounded-full flex items-center justify-center hover:bg-neutral-200"
          >
            {isPlaying ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
          </button>
          
          <button 
            onClick={() => setSpeed(s => Math.min(5, s + 1))}
            className="text-neutral-400 hover:text-white"
          >
            <FastForward size={24} />
          </button>
          
          <div className="absolute right-6 text-sm font-mono text-neutral-500">
            {speed}x
          </div>
        </div>
      </div>
    </div>
  );
}
