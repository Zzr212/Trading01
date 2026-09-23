import { Kline } from '../types';

export async function fetchHistoricalKlines(symbol: string, interval: string, limit: number = 1000, endTime?: number, startTime?: number): Promise<Kline[]> {
  // GBPUSD special case: Binance delisted GBP pairs in 2023. Kraken provides live 2026 OHLC.
  if (symbol === 'GBPUSD' || symbol === 'GBPUSDT') {
    try {
      const krakenIntervalMap: Record<string, number> = {
        '1m': 1,
        '5m': 5,
        '15m': 15,
        '30m': 30,
        '1h': 60,
        '1d': 1440
      };
      const kInterval = krakenIntervalMap[interval] || 5;
      const krakenUrl = `https://api.kraken.com/0/public/OHLC?pair=GBPUSD&interval=${kInterval}`;
      const kRes = await fetch(krakenUrl);
      const kData = await kRes.json();
      if (kData && kData.result) {
        const key = Object.keys(kData.result).find(k => k !== 'last');
        if (key && Array.isArray(kData.result[key])) {
          const raw = kData.result[key];
          const klines: Kline[] = raw.map((c: any) => ({
            time: c[0] * 1000,
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[6])
          }));
          return klines.slice(-Math.min(limit, 1000));
        }
      }
    } catch (err) {
      console.warn('Kraken GBPUSD fetch error, trying fallback:', err);
    }
  }

  let binanceSymbol = symbol;
  if (symbol === 'XAUUSD' || symbol === 'GOLD' || symbol === 'XAUUSDT') {
    binanceSymbol = 'PAXGUSDT';
  } else if (symbol === 'EURUSD' || symbol === 'EURUSDT') {
    binanceSymbol = 'EURUSDT';
  } else if (symbol === 'GBPUSD' || symbol === 'GBPUSDT') {
    binanceSymbol = 'GBPUSDT';
  } else if (symbol.endsWith('USD') && !symbol.endsWith('USDT')) {
    binanceSymbol = `${symbol}T`;
  } else if (!symbol.endsWith('USDT')) {
    binanceSymbol = `${symbol}USDT`;
  }

  let url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
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
