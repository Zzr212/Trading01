import { Kline } from '../types';

export async function fetchHistoricalKlines(symbol: string, interval: string, limit: number = 1000, endTime?: number, startTime?: number): Promise<Kline[]> {
  let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
  if (startTime) {
    url += `&startTime=${startTime}`;
  }
  if (endTime) {
    url += `&endTime=${endTime}`;
  }
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (!Array.isArray(data)) return [];

  return data.map((d: any) => ({
    time: d[0],
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
  }));
}
