import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Kline, Trade } from '../types';

interface ChartProps {
  data: Kline[];
  timeframe: string;
  activeTrade?: Trade | null;
}

export default function CandlestickChart({ data, timeframe, activeTrade }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<'up' | 'down'>('up');
  
  // High-performance state stored in refs to avoid re-renders during interactions
  const stateRef = useRef({
    offset: 0, // Number of candles shifted from the right edge
    zoom: 1, // Zoom level (multiplier for candle width)
    isDragging: false,
    lastX: 0,
    pinchDistance: 0,
    width: 0,
    height: 0,
  });

  const BASE_CANDLE_WIDTH = 8;
  const CANDLE_SPACING_RATIO = 0.2; // 20% of width is spacing

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = stateRef.current;
    const { width, height, offset, zoom } = state;
    
    // Support high DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    const candleTotalWidth = BASE_CANDLE_WIDTH * zoom;
    const candleSpacing = candleTotalWidth * CANDLE_SPACING_RATIO;
    const candleWidth = candleTotalWidth - candleSpacing;
    
    const maxVisibleCandles = Math.ceil(width / candleTotalWidth);
    
    // Calculate visible range
    const rightIndex = data.length - 1 - Math.floor(offset);
    const leftIndex = Math.max(0, rightIndex - maxVisibleCandles - 1);
    
    if (leftIndex > rightIndex) return;
    
    const visibleData = data.slice(leftIndex, rightIndex + 1);
    if (!visibleData.length) return;

    // Find min/max for Y scale
    const minPrice = Math.min(...visibleData.map(d => Math.min(d.low, d.ema9 || Infinity, d.ema21 || Infinity)));
    const maxPrice = Math.max(...visibleData.map(d => Math.max(d.high, d.ema9 || -Infinity, d.ema21 || -Infinity)));
    
    // Adjust scale if active trade exists to keep TP/SL in view
    let finalMin = minPrice;
    let finalMax = maxPrice;
    
    if (activeTrade) {
      finalMin = Math.min(minPrice, activeTrade.stopLoss, activeTrade.takeProfit);
      finalMax = Math.max(maxPrice, activeTrade.stopLoss, activeTrade.takeProfit);
    }
    
    const priceRange = finalMax - finalMin || 1;
    
    const paddingY = height * 0.1;
    const drawableHeight = height - paddingY * 2;
    
    const getY = (price: number) => paddingY + drawableHeight - ((price - finalMin) / priceRange) * drawableHeight;

    // 1. Draw Active Trade Overlay
    if (activeTrade) {
      const entryY = getY(activeTrade.entryPrice);
      const tpY = getY(activeTrade.takeProfit);
      const slY = getY(activeTrade.stopLoss);
      
      // Find X coordinate of the trade entry (roughly)
      // Since we just have 'timestamp' we approximate or draw across the whole screen
      // We'll draw across the whole visible screen for simplicity, from left to right
      
      ctx.globalAlpha = 0.15;
      
      // Profit Area (Green)
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(0, Math.min(entryY, tpY), width, Math.abs(entryY - tpY));
      
      // Loss Area (Red)
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, Math.min(entryY, slY), width, Math.abs(entryY - slY));
      
      ctx.globalAlpha = 1.0;
      
      // Entry Line
      ctx.strokeStyle = '#3b82f6';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, entryY);
      ctx.lineTo(width, entryY);
      ctx.stroke();
      
      ctx.setLineDash([]);
    }

    // 2. Draw Grid Lines (horizontal)
    ctx.strokeStyle = '#262626'; // neutral-800
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.fillStyle = '#737373'; // neutral-500
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const price = finalMin + ((finalMax - finalMin) * i) / steps;
      const y = getY(price);
      
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      
      ctx.fillText(price.toFixed(2), width - 5, y - 5);
    }
    ctx.setLineDash([]);

    // 3. Draw Candles
    visibleData.forEach((d, i) => {
      const actualIndex = leftIndex + i;
      const distanceFromRightEdge = (data.length - 1 - actualIndex) - offset;
      const x = width - (distanceFromRightEdge * candleTotalWidth) - candleTotalWidth / 2;
      
      const openY = getY(d.open);
      const closeY = getY(d.close);
      const highY = getY(d.high);
      const lowY = getY(d.low);
      
      const isUp = d.close >= d.open;
      const color = isUp ? '#22c55e' : '#ef4444'; // green-500 : red-500
      
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      
      // Draw wick
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();
      
      // Draw body
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(1, Math.abs(openY - closeY));
      
      ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
    });

    // 4. Draw EMAs
    ctx.lineWidth = 1.5;
    
    // EMA9 (Blue)
    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath();
    let isFirst = true;
    visibleData.forEach((d, i) => {
      if (d.ema9) {
        const actualIndex = leftIndex + i;
        const distanceFromRightEdge = (data.length - 1 - actualIndex) - offset;
        const x = width - (distanceFromRightEdge * candleTotalWidth) - candleTotalWidth / 2;
        const y = getY(d.ema9);
        if (isFirst) { ctx.moveTo(x, y); isFirst = false; }
        else ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // EMA21 (Orange)
    ctx.strokeStyle = '#f97316';
    ctx.beginPath();
    isFirst = true;
    visibleData.forEach((d, i) => {
      if (d.ema21) {
        const actualIndex = leftIndex + i;
        const distanceFromRightEdge = (data.length - 1 - actualIndex) - offset;
        const x = width - (distanceFromRightEdge * candleTotalWidth) - candleTotalWidth / 2;
        const y = getY(d.ema21);
        if (isFirst) { ctx.moveTo(x, y); isFirst = false; }
        else ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

  }, [data, activeTrade]);

  // Handle Resize
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        stateRef.current.width = entry.contentRect.width;
        stateRef.current.height = entry.contentRect.height;
        requestAnimationFrame(draw);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [draw]);

  // Update chart when data changes
  useEffect(() => {
    if (data.length > 0) {
      const last = data[data.length - 1];
      setCurrentPrice(last.close);
      if (data.length > 1) {
        setPriceChange(last.close >= data[data.length - 2].close ? 'up' : 'down');
      }
    }
    requestAnimationFrame(draw);
  }, [data, draw]);

  // Event Listeners for Interaction (Pan & Zoom)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = stateRef.current;
      
      if (e.ctrlKey || e.metaKey) {
        // Zoom
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        state.zoom = Math.max(0.1, Math.min(state.zoom * zoomDelta, 10));
      } else {
        // Pan
        const candleTotalWidth = BASE_CANDLE_WIDTH * state.zoom;
        const shift = e.deltaX / candleTotalWidth;
        state.offset = Math.max(0, Math.min(state.offset + shift, data.length - 1));
      }
      requestAnimationFrame(draw);
    };

    const handlePointerDown = (e: PointerEvent) => {
      const state = stateRef.current;
      state.isDragging = true;
      state.lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const state = stateRef.current;
      if (!state.isDragging) return;
      
      const deltaX = e.clientX - state.lastX;
      state.lastX = e.clientX;
      
      const candleTotalWidth = BASE_CANDLE_WIDTH * state.zoom;
      const shift = deltaX / candleTotalWidth;
      
      state.offset = Math.max(0, Math.min(state.offset + shift, data.length - 1));
      requestAnimationFrame(draw);
    };

    const handlePointerUp = (e: PointerEvent) => {
      const state = stateRef.current;
      state.isDragging = false;
      canvas.releasePointerCapture(e.pointerId);
    };

    // Touch events for pinch to zoom
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        stateRef.current.pinchDistance = dist;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const state = stateRef.current;
        const scale = dist / state.pinchDistance;
        state.pinchDistance = dist;
        state.zoom = Math.max(0.1, Math.min(state.zoom * scale, 10));
        requestAnimationFrame(draw);
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
    
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerUp);
      
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
    };
  }, [data.length, draw]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-neutral-950 overflow-hidden select-none cursor-crosshair touch-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block"
        style={{ touchAction: 'none' }}
      />
      
      {/* Price Overlay */}
      {currentPrice !== null && (
        <div className="absolute top-4 left-4 z-10 flex flex-col items-start gap-1 pointer-events-none">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">BTC/USDT</h1>
            <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-neutral-800 text-neutral-400">{timeframe}</span>
          </div>
          <div className="text-2xl font-light text-white font-mono flex items-center">
            ${currentPrice.toFixed(2)}
            <span className={`ml-2 text-sm ${priceChange === 'up' ? 'text-green-500' : 'text-red-500'}`}>
              {priceChange === 'up' ? 'â²' : 'â¼'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

