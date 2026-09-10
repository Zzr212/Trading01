export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema9?: number;
  ema21?: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1w' | '1M';
export type TradeType = 'LONG' | 'SHORT';
export type TradeStatus = 'ACTIVE' | 'WON' | 'LOST';

export interface Trade {
  id: string;
  pair: string;
  type: TradeType;
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  status: TradeStatus;
  timestamp: number;
  confidence: number;
}

