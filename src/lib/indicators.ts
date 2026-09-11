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
