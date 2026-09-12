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
          
          // Since these are 1m closed candles from historical API, just add them one by one
          rawData.forEach(kline => {
            currentFrame.push(kline);
            builtFrames.push([...currentFrame]);
          });
          
          setFrames(builtFrames);
          
          // Find the frame where the trade started
          let startIdx = 0;
          for (let i = 0; i < builtFrames.length; i++) {
            const frame = builtFrames[i];
            if (frame[frame.length - 1].time >= trade.timestamp) {
              startIdx = i;
              break;
            }
          }
          
          // If we can't find it exactly, or it's early, fallback to index 10 (as backend gives 10 prior)
          if (startIdx === 0 && builtFrames.length > 10) startIdx = 10;
          
          setCurrentIndex(startIdx);
          setVisibleCandles(builtFrames[startIdx].slice(-100)); // Show max 100 candles
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
             activeTrade={trade} 
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
      <div className="bg-neutral-900 p-6 border-t border-neutral-800 flex flex-col gap-4">
        {/* Timeline Slider */}
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
