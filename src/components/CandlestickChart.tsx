import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Kline, Trade } from '../types';

interface ChartProps {
  symbol?: string;
  data: Kline[];
  timeframe: string;
  activeTrade?: Trade | null;
  isReplay?: boolean;
}

export default function CandlestickChart({ symbol = 'BTCUSDT', data, timeframe, activeTrade, isReplay }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<'up' | 'down'>('up');
  
  // High-performance state stored in refs to avoid re-renders during interactions
  const stateRef = useRef({
    offset: isReplay ? 0 : -8, // Default -8 candles offset for clean right-side breathing room
    zoom: 1,
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
    if (width <= 0 || height <= 0) return;
    
    // Support high DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw Watermark
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 100px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fillText('TradingView', width / 2, height / 2);
    ctx.restore();

    const candleTotalWidth = BASE_CANDLE_WIDTH * zoom;
    const candleSpacing = candleTotalWidth * CANDLE_SPACING_RATIO;
    const candleWidth = candleTotalWidth - candleSpacing;
    
    const maxVisibleCandles = Math.ceil(width / candleTotalWidth);
    
    // Calculate visible range (allow offset to be negative to show blank space on right)
    const rightIndex = Math.min(data.length - 1, data.length - 1 - Math.floor(offset));
    const leftIndex = Math.max(0, rightIndex - maxVisibleCandles - Math.max(0, Math.ceil(-offset)));
    
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
      finalMin = Math.min(minPrice, activeTrade.stopLoss, activeTrade.takeProfit, activeTrade.entryPrice);
      finalMax = Math.max(maxPrice, activeTrade.stopLoss, activeTrade.takeProfit, activeTrade.entryPrice);
    }
    
    const priceRange = finalMax - finalMin || 1;
    const paddingY = height * 0.12;
    const drawableHeight = height - paddingY * 2;
    
    const getY = (price: number) => paddingY + drawableHeight - ((price - finalMin) / priceRange) * drawableHeight;

    // Estimate candle interval in milliseconds from dataset
    let intervalMs = 60 * 1000;
    if (data.length > 1) {
      intervalMs = Math.max(1000, data[1].time - data[0].time);
    }

    // 1. Draw Grid Lines (horizontal)
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
      ctx.lineTo(width - 55, y); // Leave space for axis tags
      ctx.stroke();
      
      ctx.fillText(price.toFixed(2), width - 5, y - 5);
    }
    ctx.setLineDash([]);

    // Calculate Trade Geometry
    let tradeMetrics: {
      startX: number;
      endX: number;
      entryY: number;
      tpY: number;
      slY: number;
      tp1Y: number | null;
      isLong: boolean;
      entryFound: boolean;
    } | null = null;

    if (activeTrade) {
      const entryY = getY(activeTrade.entryPrice);
      const tpY = getY(activeTrade.takeProfit);
      const slY = getY(activeTrade.stopLoss);
      const isLong = activeTrade.type === 'LONG';

      // Find exact entry candle whose open-close window contains activeTrade.timestamp
      let entryCandleIndex = -1;
      for (let i = 0; i < data.length; i++) {
        const cOpen = data[i].time;
        const cClose = (i + 1 < data.length) ? data[i + 1].time : cOpen + intervalMs;
        if (activeTrade.timestamp >= cOpen && activeTrade.timestamp < cClose) {
          entryCandleIndex = i;
          break;
        }
      }

      const lastCandleX = width - (-offset * candleTotalWidth) - candleTotalWidth / 2;

      let startX = 0;
      let entryFound = false;

      if (entryCandleIndex !== -1) {
        entryFound = true;
        const distanceFromRightEdge = (data.length - 1 - entryCandleIndex) - offset;
        startX = width - (distanceFromRightEdge * candleTotalWidth) - candleTotalWidth / 2;
      } else if (activeTrade.timestamp < data[0].time) {
        // Trade started before currently loaded data
        startX = 0;
      } else {
        // Trade timestamp is at or near the last candle
        startX = lastCandleX;
      }

      // Find exit candle if trade is closed
      let endX = width;
      if (activeTrade.closeTimestamp && activeTrade.closeTimestamp >= activeTrade.timestamp) {
        let exitCandleIndex = -1;
        for (let i = 0; i < data.length; i++) {
          const cOpen = data[i].time;
          const cClose = (i + 1 < data.length) ? data[i + 1].time : cOpen + intervalMs;
          if (activeTrade.closeTimestamp >= cOpen && activeTrade.closeTimestamp < cClose) {
            exitCandleIndex = i;
            break;
          }
        }
        if (exitCandleIndex !== -1) {
          const distFromRight = (data.length - 1 - exitCandleIndex) - offset;
          endX = width - (distFromRight * candleTotalWidth) - candleTotalWidth / 2;
        } else if (activeTrade.closeTimestamp < data[0].time) {
          endX = 0;
        } else {
          endX = Math.max(startX + candleTotalWidth, lastCandleX);
        }
      } else {
        // Active trade: extends from startX to last candle plus breathing room into offset space
        endX = Math.max(startX + candleTotalWidth * 2, Math.min(width - 5, lastCandleX + candleTotalWidth * 4));
      }

      const tp1Y = activeTrade.tp1Price ? getY(activeTrade.tp1Price) : null;
      tradeMetrics = { startX, endX, entryY, tpY, slY, tp1Y, isLong, entryFound };

      // 2. Draw Translucent Profit & Loss Areas (Background)
      const boxWidth = Math.max(candleTotalWidth, endX - startX);
      ctx.globalAlpha = 0.15;
      
      // Profit Area (Green)
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(startX, Math.min(entryY, tpY), boxWidth, Math.abs(entryY - tpY));
      
      // Loss Area (Red)
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(startX, Math.min(entryY, slY), boxWidth, Math.abs(entryY - slY));
      ctx.globalAlpha = 1.0;
    }

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

    // 5. Draw Trade Lines, Badges & Indicators (Foreground)
    if (activeTrade && tradeMetrics) {
      const { startX, endX, entryY, tpY, slY, tp1Y, isLong } = tradeMetrics;

      // Take Profit 2 Line (Full Target - Dashed Green)
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, tpY);
      ctx.lineTo(endX, tpY);
      ctx.stroke();

      // Take Profit 1 Line (Partial 50% Target - Dotted Emerald)
      if (tp1Y !== null) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(startX, tp1Y);
        ctx.lineTo(endX, tp1Y);
        ctx.stroke();
      }

      // Stop Loss Line (Dashed Red)
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, slY);
      ctx.lineTo(endX, slY);
      ctx.stroke();

      // Entry Line (Sharp Cyan/Blue)
      ctx.strokeStyle = '#38bdf8'; // sky-400
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(startX, entryY);
      ctx.lineTo(endX, entryY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Vertical guideline anchor at entry candle
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(startX, Math.min(entryY, tpY, slY) - 10);
      ctx.lineTo(startX, Math.max(entryY, tpY, slY) + 10);
      ctx.stroke();
      ctx.setLineDash([]);

      // Entry Pin Dot at (startX, entryY)
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(startX, entryY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Entry Badge directly at the entry candle
      const entryText = `${activeTrade.type} @ $${activeTrade.entryPrice.toFixed(2)}`;
      ctx.font = 'bold 10px monospace';
      const textW = ctx.measureText(entryText).width;
      const badgeW = textW + 16;
      const badgeH = 18;
      const badgeY = isLong ? entryY + 8 : entryY - badgeH - 8;
      const badgeX = Math.max(4, Math.min(width - badgeW - 60, startX - badgeW / 2));
      const badgeColor = isLong ? '#22c55e' : '#ef4444';

      ctx.fillStyle = 'rgba(10, 10, 10, 0.9)';
      ctx.strokeStyle = badgeColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = badgeColor;
      ctx.textAlign = 'left';
      ctx.fillText(`${isLong ? '▲' : '▼'} ${entryText}`, badgeX + 6, badgeY + 13);

      // Exit Marker if trade is finished
      if (activeTrade.status === 'WON' || activeTrade.status === 'LOST') {
        const isWon = activeTrade.status === 'WON';
        const exitColor = isWon ? '#22c55e' : '#ef4444';
        const exitY = isWon ? tpY : slY;
        const exitText = isWon ? '✓ TP HIT' : '✕ SL HIT';

        ctx.fillStyle = exitColor;
        ctx.beginPath();
        ctx.arc(endX, exitY, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = 'bold 10px monospace';
        const eTextW = ctx.measureText(exitText).width;
        const eBadgeW = eTextW + 12;
        const eBadgeH = 18;
        const eBadgeY = isWon ? exitY - eBadgeH - 6 : exitY + 6;
        const eBadgeX = Math.max(4, Math.min(width - eBadgeW - 60, endX - eBadgeW / 2));

        ctx.fillStyle = 'rgba(10, 10, 10, 0.9)';
        ctx.strokeStyle = exitColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(eBadgeX, eBadgeY, eBadgeW, eBadgeH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = exitColor;
        ctx.textAlign = 'left';
        ctx.fillText(exitText, eBadgeX + 6, eBadgeY + 13);
      }

      // 6. Right-Axis Price Pills for TP, Entry, SL
      const drawAxisPill = (y: number, label: string, priceStr: string, bg: string, textCol: string = '#ffffff') => {
        const labelText = `${label} ${priceStr}`;
        ctx.font = 'bold 9px monospace';
        const pillW = ctx.measureText(labelText).width + 10;
        const pillH = 16;
        const pillX = width - pillW - 2;
        const pillY = y - pillH / 2;

        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 3);
        ctx.fill();

        ctx.fillStyle = textCol;
        ctx.textAlign = 'center';
        ctx.fillText(labelText, pillX + pillW / 2, pillY + 11);
      };

      drawAxisPill(tpY, 'TP2', `$${activeTrade.takeProfit.toFixed(2)}`, '#16a34a');
      if (activeTrade.tp1Price && tp1Y !== null) {
        drawAxisPill(tp1Y, activeTrade.tp1Hit ? 'TP1 [✓]' : 'TP1', `$${activeTrade.tp1Price.toFixed(2)}`, '#10b981', '#022c22');
      }
      drawAxisPill(slY, 'SL', `$${activeTrade.stopLoss.toFixed(2)}`, '#dc2626');
      drawAxisPill(entryY, 'ENTRY', `$${activeTrade.entryPrice.toFixed(2)}`, '#0284c7');
    }

    // Live Current Price Tag on Right Axis
    if (currentPrice !== null) {
      const curY = getY(currentPrice);
      const curPriceStr = `$${currentPrice.toFixed(2)}`;
      ctx.font = 'bold 10px monospace';
      const curW = ctx.measureText(curPriceStr).width + 10;
      const curH = 18;
      const curX = width - curW - 2;
      const curYPos = curY - curH / 2;

      ctx.fillStyle = priceChange === 'up' ? '#22c55e' : '#ef4444';
      ctx.beginPath();
      ctx.roundRect(curX, curYPos, curW, curH, 3);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(curPriceStr, curX + curW / 2, curYPos + 12);
    }

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

  const prevDataLengthRef = useRef(0);

  // Update chart when data changes
  useEffect(() => {
    if (data.length > 0) {
      const last = data[data.length - 1];
      setCurrentPrice(last.close);
      if (data.length > 1) {
        setPriceChange(last.close >= data[data.length - 2].close ? 'up' : 'down');
      }
      
      // Keep historical view stable when new data arrives
      if (prevDataLengthRef.current > 0 && data.length > prevDataLengthRef.current && (data.length - prevDataLengthRef.current < 50)) {
        const diff = data.length - prevDataLengthRef.current;
        // If the user has scrolled into the past (offset > 0), increment offset to maintain their visual position
        if (stateRef.current.offset > 0) {
          stateRef.current.offset += diff;
        }
      } else if (prevDataLengthRef.current === 0 || Math.abs(data.length - prevDataLengthRef.current) > 50) {
        // Data completely changed or first load, reset offset
        const defaultOffset = isReplay ? 0 : (stateRef.current.width > 640 ? -12 : -6);
        stateRef.current.offset = defaultOffset;
      }
      prevDataLengthRef.current = data.length;
    } else {
      prevDataLengthRef.current = 0;
    }
    
    requestAnimationFrame(draw);
  }, [data, draw, isReplay]);

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
        // Allow negative offset (blank space on right) up to -100 candles
        state.offset = Math.max(-100, Math.min(state.offset + shift, data.length - 1));
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
      
      state.offset = Math.max(-100, Math.min(state.offset + shift, data.length - 1));
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
            <h1 className="text-xl font-bold tracking-tight text-white">{symbol.replace("USDT", "/USDT")}</h1>
            <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-neutral-800 text-neutral-400">{timeframe}</span>
          </div>
          <div className="text-2xl font-light text-white font-mono flex items-center">
            ${currentPrice.toFixed(2)}
            <span className={`ml-2 text-sm ${priceChange === 'up' ? 'text-green-500' : 'text-red-500'}`}>
              {priceChange === 'up' ? '▲' : '▼'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

