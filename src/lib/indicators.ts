import { Kline } from '../types';

export function calculateEMA(data: Kline[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema = new Array(data.length).fill(null);
  
  if (data.length < period) return ema;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  ema[period - 1] = sum / period;

  for (let i = period; i < data.length; i++) {
    ema[i] = data[i].close * k + ema[i - 1] * (1 - k);
  }
  
  return ema;
}

export function calculateRSI(data: Kline[], period: number = 14): number[] {
  const rsi = new Array(data.length).fill(null);
  if (data.length < period) return rsi;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  if (avgLoss === 0) rsi[period] = 100;
  else {
    const rs = avgGain / avgLoss;
    rsi[period] = 100 - (100 / (1 + rs));
  }

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) rsi[i] = 100;
    else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - (100 / (1 + rs));
    }
  }

  return rsi;
}

export function calculateATR(data: Kline[], period: number = 14): number[] {
  const atr = new Array(data.length).fill(null);
  if (data.length < period) return atr;

  const tr = new Array(data.length).fill(0);
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    tr[i] = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;

  for (let i = period + 1; i < data.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

export function calculateMACD(data: Kline[], fast: number = 12, slow: number = 26, signal: number = 9): { macd: number[], signal: number[], hist: number[] } {
  const fastEma = calculateEMA(data, fast);
  const slowEma = calculateEMA(data, slow);
  const macd = new Array(data.length).fill(null);

  for (let i = 0; i < data.length; i++) {
    if (fastEma[i] !== null && slowEma[i] !== null) {
      macd[i] = fastEma[i] - slowEma[i];
    }
  }

  // Calculate Signal line as EMA of MACD
  const signalLine = new Array(data.length).fill(null);
  let startIdx = 0;
  while (startIdx < macd.length && macd[startIdx] === null) startIdx++;

  if (startIdx + signal <= data.length) {
    let sum = 0;
    for (let i = startIdx; i < startIdx + signal; i++) sum += macd[i];
    signalLine[startIdx + signal - 1] = sum / signal;
    
    const k = 2 / (signal + 1);
    for (let i = startIdx + signal; i < data.length; i++) {
      signalLine[i] = macd[i] * k + signalLine[i - 1] * (1 - k);
    }
  }

  const hist = new Array(data.length).fill(null);
  for (let i = 0; i < data.length; i++) {
    if (macd[i] !== null && signalLine[i] !== null) {
      hist[i] = macd[i] - signalLine[i];
    }
  }

  return { macd, signal: signalLine, hist };
}

export function findSupportResistance(data: Kline[]): { supports: number[], resistances: number[] } {
  // Simple fractal based approach
  const supports: number[] = [];
  const resistances: number[] = [];
  
  if (data.length < 5) return { supports, resistances };

  for (let i = 2; i < data.length - 2; i++) {
    const p1 = data[i - 2], p2 = data[i - 1], p3 = data[i], p4 = data[i + 1], p5 = data[i + 2];
    
    // Resistance (Fractal High)
    if (p3.high > p1.high && p3.high > p2.high && p3.high > p4.high && p3.high > p5.high) {
      resistances.push(p3.high);
    }
    
    // Support (Fractal Low)
    if (p3.low < p1.low && p3.low < p2.low && p3.low < p4.low && p3.low < p5.low) {
      supports.push(p3.low);
    }
  }
  
  // Sort and keep most recent/relevant
  supports.sort((a, b) => b - a); // Highest support first
  resistances.sort((a, b) => a - b); // Lowest resistance first
  
  // Filter out clustered levels (keep only distinct ones)
  const distinct = (levels: number[]) => {
    const res: number[] = [];
    for (const l of levels) {
      if (res.length === 0 || Math.abs(res[res.length - 1] - l) / l > 0.001) {
        res.push(l);
      }
    }
    return res;
  }
  
  return { 
    supports: distinct(supports).slice(0, 3), 
    resistances: distinct(resistances).slice(0, 3)
  };
}

export function calculateVWAP(data: Kline[]): number[] {
  const vwap = new Array(data.length).fill(null);
  let cumulativeTPV = 0; // Typical Price * Volume
  let cumulativeVolume = 0;

  for (let i = 0; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    const tpv = typicalPrice * data[i].volume;
    
    cumulativeTPV += tpv;
    cumulativeVolume += data[i].volume;

    if (cumulativeVolume > 0) {
      vwap[i] = cumulativeTPV / cumulativeVolume;
    }
  }

  return vwap;
}

export function calculateVPVR(data: Kline[], bins: number = 50): { price: number, volume: number }[] {
  if (data.length === 0) return [];
  let minPrice = Math.min(...data.map(d => d.low));
  let maxPrice = Math.max(...data.map(d => d.high));
  if (maxPrice === minPrice) maxPrice += 1; // Prevent div by 0
  const binSize = (maxPrice - minPrice) / bins;
  
  const profile = new Array(bins).fill(0).map((_, i) => ({
    price: minPrice + (i * binSize) + (binSize / 2),
    volume: 0
  }));

  for (const candle of data) {
    const candleAvgPrice = (candle.high + candle.low + candle.close) / 3;
    let binIndex = Math.floor((candleAvgPrice - minPrice) / binSize);
    if (binIndex >= bins) binIndex = bins - 1;
    if (binIndex >= 0) {
      profile[binIndex].volume += candle.volume;
    }
  }

  return profile.sort((a, b) => b.volume - a.volume);
}

// Average Directional Index (ADX) with +DI and -DI (Wilder's Smoothing)
export function calculateADX(data: Kline[], period: number = 14): { adx: number[], pDi: number[], mDi: number[] } {
  const len = data.length;
  const adx = new Array(len).fill(null);
  const pDi = new Array(len).fill(null);
  const mDi = new Array(len).fill(null);

  if (len < period * 2) {
    return { adx, pDi, mDi };
  }

  const tr: number[] = new Array(len).fill(0);
  const pDm: number[] = new Array(len).fill(0);
  const mDm: number[] = new Array(len).fill(0);

  for (let i = 1; i < len; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    const prevHigh = data[i - 1].high;
    const prevLow = data[i - 1].low;

    tr[i] = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    pDm[i] = (upMove > downMove && upMove > 0) ? upMove : 0;
    mDm[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
  }

  // Initial sum for Wilder's smoothing
  let trSmooth = 0;
  let pDmSmooth = 0;
  let mDmSmooth = 0;

  for (let i = 1; i <= period; i++) {
    trSmooth += tr[i];
    pDmSmooth += pDm[i];
    mDmSmooth += mDm[i];
  }

  const dx: number[] = new Array(len).fill(null);

  if (trSmooth > 0) {
    const initialPDi = (pDmSmooth / trSmooth) * 100;
    const initialMDi = (mDmSmooth / trSmooth) * 100;
    pDi[period] = initialPDi;
    mDi[period] = initialMDi;
    const diSum = initialPDi + initialMDi;
    dx[period] = diSum > 0 ? (Math.abs(initialPDi - initialMDi) / diSum) * 100 : 0;
  }

  for (let i = period + 1; i < len; i++) {
    trSmooth = trSmooth - (trSmooth / period) + tr[i];
    pDmSmooth = pDmSmooth - (pDmSmooth / period) + pDm[i];
    mDmSmooth = mDmSmooth - (mDmSmooth / period) + mDm[i];

    if (trSmooth > 0) {
      const curPDi = (pDmSmooth / trSmooth) * 100;
      const curMDi = (mDmSmooth / trSmooth) * 100;
      pDi[i] = curPDi;
      mDi[i] = curMDi;

      const diSum = curPDi + curMDi;
      dx[i] = diSum > 0 ? (Math.abs(curPDi - curMDi) / diSum) * 100 : 0;
    }
  }

  // Calculate ADX from DX using Wilder's smoothing
  let dxStart = period;
  while (dxStart < len && dx[dxStart] === null) dxStart++;

  if (dxStart + period <= len) {
    let dxSum = 0;
    for (let i = dxStart; i < dxStart + period; i++) {
      dxSum += dx[i];
    }
    let adxSmooth = dxSum / period;
    adx[dxStart + period - 1] = adxSmooth;

    for (let i = dxStart + period; i < len; i++) {
      adxSmooth = (adxSmooth * (period - 1) + dx[i]) / period;
      adx[i] = adxSmooth;
    }
  }

  return { adx, pDi, mDi };
}

// Volume Spike and Climax Exhaustion Detection
// Detects institutional volume spikes with rejection wicks (liquidity traps / fakeouts)
export function detectVolumeExhaustion(data: Kline[], period: number = 20): { isSpike: boolean; isExhaustion: boolean; exhaustionDirection?: 'BULL_EXHAUSTION' | 'BEAR_EXHAUSTION' } {
  if (data.length < period + 1) {
    return { isSpike: false, isExhaustion: false };
  }

  const current = data[data.length - 1];
  let sumVol = 0;
  for (let i = data.length - 1 - period; i < data.length - 1; i++) {
    sumVol += data[i].volume;
  }
  const avgVol = sumVol / period;

  const isSpike = current.volume > avgVol * 2.8;

  // Candle range and wicks
  const candleRange = current.high - current.low;
  if (candleRange <= 0 || !isSpike) {
    return { isSpike, isExhaustion: false };
  }

  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;

  // Upper wick >= 45% of total candle range on 2.8x+ volume = Buyers exhausted / Bull trap
  if (upperWick / candleRange >= 0.45) {
    return { isSpike: true, isExhaustion: true, exhaustionDirection: 'BULL_EXHAUSTION' };
  }

  // Lower wick >= 45% of total candle range on 2.8x+ volume = Sellers exhausted / Bear trap
  if (lowerWick / candleRange >= 0.45) {
    return { isSpike: true, isExhaustion: true, exhaustionDirection: 'BEAR_EXHAUSTION' };
  }

  return { isSpike: true, isExhaustion: false };
}

// Global Trading Sessions (London & NY have highest liquidity and true trends)
export function getTradingSessionInfo(): { session: 'LONDON' | 'NEW_YORK' | 'LONDON_NY_OVERLAP' | 'ASIA' | 'OFF_PEAK'; isHighLiquidity: boolean; minAdxThreshold: number } {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // London & New York Overlap: 13:00 - 16:30 UTC (Prime Volatility)
  if (utcHour >= 13 && utcHour < 17) {
    return { session: 'LONDON_NY_OVERLAP', isHighLiquidity: true, minAdxThreshold: 20 };
  }
  // London Session: 08:00 - 13:00 UTC
  if (utcHour >= 8 && utcHour < 13) {
    return { session: 'LONDON', isHighLiquidity: true, minAdxThreshold: 22 };
  }
  // New York Session Afternoon: 17:00 - 21:00 UTC
  if (utcHour >= 17 && utcHour < 21) {
    return { session: 'NEW_YORK', isHighLiquidity: true, minAdxThreshold: 22 };
  }
  // Asian Session: 00:00 - 08:00 UTC
  if (utcHour >= 0 && utcHour < 8) {
    return { session: 'ASIA', isHighLiquidity: false, minAdxThreshold: 25 };
  }
  // Off-peak Dead Zone: 21:00 - 24:00 UTC (Prone to low-volume chops & manipulation)
  return { session: 'OFF_PEAK', isHighLiquidity: false, minAdxThreshold: 27 };
}

