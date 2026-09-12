import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Trade, Kline } from '../types';
import CandlestickChart from './CandlestickChart';
import { X, Play, Pause, FastForward, Rewind } from 'lucide-react';

interface Props {
  trade: Trade;
  onClose: () => void;
}

export default function TradeReplayModal({ trade, onClose }: Props) {
  const [frames, setFrames] = useState<Kline[][]>([]);
  const [visibleCandles, setVisibleCandles] = useState<Kline[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [entryIdx, setEntryIdx] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Fetch historical data for this trade from server
    fetch(`/api/reviews/${trade.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.candles && data.candles.length > 0) {
          const rawData = data.candles as Kline[];
          
          const builtFrames: Kline[][] = [];
          let currentFrame: Kline[] = [];
          
          // Since these are 1m closed candles from historical API, add them one by one
          rawData.forEach(kline => {
            currentFrame.push(kline);
            builtFrames.push([...currentFrame]);
          });
          
          setFrames(builtFrames);
          
          // Find the exact candle where the trade started
          let startIdx = -1;
          for (let i = 0; i < rawData.length; i++) {
            const k = rawData[i];
            const nextTime = (i + 1 < rawData.length) ? rawData[i + 1].time : k.time + 60000;
            if (trade.timestamp >= k.time && trade.timestamp < nextTime) {
              startIdx = i;
              break;
            }
          }
          
          // If not found by range, find closest candle
          if (startIdx === -1) {
            let minDiff = Infinity;
            rawData.forEach((k, i) => {
              const diff = Math.abs(k.time - trade.timestamp);
              if (diff < minDiff) {
                minDiff = diff;
                startIdx = i;
              }
            });
          }
          
          const finalStartIdx = Math.max(0, startIdx);
          setEntryIdx(finalStartIdx);
          setCurrentIndex(finalStartIdx);
          setVisibleCandles(builtFrames[finalStartIdx].slice(-100)); // Show max 100 candles
        } else {
          setErrorMsg("Review data not found for this trade.");
        }
      })
      .catch(err => {
        console.error(err);
        setErrorMsg("Failed to load review data.");
      });
  }, [trade]);

  const playStep = useCallback(() => {
    setCurrentIndex(prev => {
      if (prev >= frames.length - 1) {
        setIsPlaying(false);
        return prev;
      }
      const nextIndex = prev + 1;
      setVisibleCandles(frames[nextIndex].slice(-100));
      return nextIndex;
    });
  }, [frames]);

  useEffect(() => {
    if (isPlaying) {
      // 800ms base interval for candle playback
      timerRef.current = setInterval(playStep, 800 / speed);
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
    setVisibleCandles(frames[val].slice(-100));
  };

  const jumpToEntry = () => {
    setCurrentIndex(entryIdx);
    setVisibleCandles(frames[entryIdx].slice(-100));
  };

  // Dynamically compute trade state relative to replay playback position
  const currentCandle = visibleCandles.length > 0 ? visibleCandles[visibleCandles.length - 1] : null;
  const isAfterEntry = currentIndex >= entryIdx;
  const isClosedAtCurrentTime = trade.closeTimestamp && currentCandle && currentCandle.time >= trade.closeTimestamp;

  const currentReplayTrade = !isAfterEntry
    ? null
    : isClosedAtCurrentTime
    ? trade
    : { ...trade, status: 'ACTIVE' as const, closeTimestamp: undefined };

  const modalContent = (
    <div className="fixed inset-0 z-[100] bg-neutral-950 flex flex-col">
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
        {errorMsg ? (
          <div className="flex items-center justify-center h-full text-red-500">
            {errorMsg}
          </div>
        ) : frames.length > 0 ? (
          <CandlestickChart 
             data={visibleCandles} 
             timeframe="1m" 
             activeTrade={currentReplayTrade} 
             isReplay={true}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-500">
            <div className="w-6 h-6 rounded-full border-2 border-neutral-800 border-t-neutral-500 animate-spin mr-3" />
            Loading historical trade review...
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-neutral-900 p-4 border-t border-neutral-800 flex flex-col gap-3">
        {/* Timeline Slider with Status & Jump */}
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
              !isAfterEntry
                ? 'bg-neutral-800 text-neutral-400'
                : isClosedAtCurrentTime
                ? trade.status === 'WON' ? 'bg-green-950 text-green-400 border border-green-800' : 'bg-red-950 text-red-400 border border-red-800'
                : 'bg-blue-950 text-blue-400 border border-blue-800 animate-pulse'
            }`}>
              {!isAfterEntry ? 'Pre-Entry' : isClosedAtCurrentTime ? `Closed: ${trade.status}` : 'Active Trade'}
            </span>
            <span>{currentCandle ? new Date(currentCandle.time).toLocaleTimeString() : ''}</span>
          </div>

          <button
            onClick={jumpToEntry}
            className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-sky-400 rounded text-xs font-medium transition-colors"
          >
            Jump to Entry
          </button>
        </div>

        <input 
          type="range" 
          min="0" 
          max={Math.max(0, frames.length - 1)} 
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
            className="w-14 h-14 bg-white text-black rounded-full flex items-center justify-center hover:bg-neutral-200 transition-colors"
          >
            {isPlaying ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
          </button>
          
          <button 
            onClick={() => setSpeed(s => Math.min(10, s + 1))}
            className="text-neutral-400 hover:text-white"
          >
            <FastForward size={24} />
          </button>
          
          <div className="absolute right-6 text-sm font-mono text-neutral-500 bg-neutral-950 px-2 py-1 rounded">
            {speed}x
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
