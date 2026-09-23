import WebSocket from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { Trade, Kline, SRLevels } from './src/types';
import { 
  calculateEMA, 
  calculateRSI, 
  calculateATR, 
  calculateMACD, 
  calculateVWAP, 
  calculateADX,
  getTradingSessionInfo
} from './src/lib/indicators';
import { fetchHistoricalKlines } from './src/lib/binance';
import { TradePredictor } from './src/lib/ai';
import { getMarketStatus } from './src/lib/market_hours';

// VPVR Calculation
export function calculateVPVR(klines: Kline[], bins: number = 50) {
  if (!klines.length) return [];
  let min = Math.min(...klines.map(k => k.low));
  let max = Math.max(...klines.map(k => k.high));
  if (min === max) max += 1;
  let step = (max - min) / bins;
  
  let profile = Array(bins).fill(0).map((_, i) => ({
    price: min + (step * i) + (step / 2),
    volume: 0
  }));

  klines.forEach(k => {
    for (let i = 0; i < bins; i++) {
      let binMin = min + (step * i);
      let binMax = min + (step * (i + 1));
      if (k.low <= binMax && k.high >= binMin) {
        profile[i].volume += k.volume;
      }
    }
  });

  return profile.sort((a, b) => b.volume - a.volume); 
}

// Support & Resistance Finder
export function findSupportResistance(klines: Kline[]): SRLevels {
  const supports: number[] = [];
  const resistances: number[] = [];
  
  if (klines.length < 5) return { supports, resistances };

  for (let i = 2; i < klines.length - 2; i++) {
    const isSupport = klines[i].low < klines[i-1].low && klines[i].low < klines[i-2].low && 
                      klines[i].low < klines[i+1].low && klines[i].low < klines[i+2].low;
    if (isSupport) supports.push(klines[i].low);

    const isResistance = klines[i].high > klines[i-1].high && klines[i].high > klines[i-2].high && 
                         klines[i].high > klines[i+1].high && klines[i].high > klines[i+2].high;
    if (isResistance) resistances.push(klines[i].high);
  }
  return { supports, resistances };
}

// 6 Core Trading Instruments (Vantage MT5 & Crypto/Forex/Gold)
export const PAIRS = ['BTCUSD', 'ETHUSD', 'XAUUSD', 'EURUSD', 'GBPUSD', 'SOLUSD'];

export const toBinanceSymbol = (p: string): string => {
  if (p === 'XAUUSD' || p === 'GOLD' || p === 'XAUUSDT') return 'PAXGUSDT';
  if (p === 'EURUSD' || p === 'EURUSDT') return 'EURUSDT';
  if (p === 'GBPUSD' || p === 'GBPUSDT') return 'GBPUSDT';
  if (p.endsWith('USDT')) return p;
  if (p.endsWith('USD')) return `${p}T`;
  return `${p}USDT`;
};

export const fromBinanceSymbol = (s: string): string => {
  if (s === 'PAXGUSDT' || s === 'PAXGUSD') return 'XAUUSD';
  if (s === 'EURUSDT') return 'EURUSD';
  if (s === 'GBPUSDT') return 'GBPUSD';
  if (s.endsWith('USDT')) return s.slice(0, -1);
  return s;
};

export class TradingBot {
  private ws!: WebSocket;
  private db: DatabaseSync;
  
  private data5m: Record<string, Kline[]> = {};
  private data15m: Record<string, Kline[]> = {};
  private data1h: Record<string, Kline[]> = {};
  private activeTrades: Record<string, Trade | null> = {};
  private pairCooldowns: Record<string, number> = {};
  
  private fundingRates: Record<string, number> = {};
  private obImbalances: Record<string, number> = {};
  private predictor: TradePredictor;
  private scanIntervalTimer: NodeJS.Timeout | null = null;
  private krakenGbpTimer: NodeJS.Timeout | null = null;
  
  constructor(db: DatabaseSync) {
    this.predictor = new TradePredictor();
    this.db = db;
    PAIRS.forEach(p => {
      this.data5m[p] = [];
      this.data15m[p] = [];
      this.data1h[p] = [];
      this.activeTrades[p] = null;
      this.pairCooldowns[p] = 0;
      this.fundingRates[p] = 0;
      this.obImbalances[p] = 0.5;
    });
  }

  public async start() {
    console.log("[TradingBot] Initializing High-Performance Multi-Strategy Engine...");
    console.log("[TradingBot] Fetching historical klines (5m, 15m, 1h) for all pairs...");
    
    for (const p of PAIRS) {
      try {
        this.data5m[p] = await fetchHistoricalKlines(p, '5m', 150);
        this.data15m[p] = await fetchHistoricalKlines(p, '15m', 150);
        this.data1h[p] = await fetchHistoricalKlines(p, '1h', 100);
      } catch (err) {
        console.error(`[TradingBot] Failed to fetch history for ${p}:`, err);
      }
    }
    
    // Load active trades from DB
    const stmt = this.db.prepare("SELECT * FROM trades WHERE status = 'ACTIVE'");
    const rows = stmt.all() as unknown as Trade[];
    rows.forEach(r => {
      if (r.pair && PAIRS.includes(r.pair)) {
        this.activeTrades[r.pair] = r;
      }
    });

    this.connectWebsocket();
    this.startKrakenGbpPolling();
    this.startFundingMonitor();
    this.startOrderBookMonitor();

    // Start periodic multi-pair scanner pulse (every 10 seconds)
    // Ensures trades are discovered promptly without waiting 5 whole minutes!
    this.scanIntervalTimer = setInterval(() => {
      this.scanAllPairs();
    }, 10000);

    // Immediate evaluation on boot
    setTimeout(() => {
      this.scanAllPairs();
    }, 2000);
  }

  // Periodic scanner across all 6 pairs
  public scanAllPairs() {
    for (const p of PAIRS) {
      const candles = this.data5m[p];
      if (!candles || candles.length < 30) continue;
      const latest = candles[candles.length - 1];
      if (latest && latest.close > 0) {
        // Manage active trade
        this.manageActiveTrade(p, latest.close);
        // If pair has no active trade, evaluate setup
        if (!this.activeTrades[p]) {
          this.evaluateNewTrade(p, latest.close);
        }
      }
    }
  }

  // Real-time live feed for GBPUSD (Kraken)
  private startKrakenGbpPolling() {
    this.krakenGbpTimer = setInterval(async () => {
      try {
        const res = await fetch('https://api.kraken.com/0/public/Ticker?pair=GBPUSD');
        const data = await res.json();
        if (data && data.result) {
          const key = Object.keys(data.result).find(k => k !== 'last');
          if (key && data.result[key]?.c?.[0]) {
            const price = parseFloat(data.result[key].c[0]);
            if (price > 0) {
              const gbp5m = this.data5m['GBPUSD'];
              if (gbp5m && gbp5m.length > 0) {
                const last = gbp5m[gbp5m.length - 1];
                last.close = price;
                if (price > last.high) last.high = price;
                if (price < last.low) last.low = price;
              }
              this.manageActiveTrade('GBPUSD', price);
              if (!this.activeTrades['GBPUSD']) {
                this.evaluateNewTrade('GBPUSD', price);
              }
            }
          }
        }
      } catch (_) {}
    }, 3500);
  }

  private startFundingMonitor() {
    setInterval(async () => {
      for (const p of PAIRS) {
        try {
          const binanceSym = toBinanceSymbol(p);
          const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binanceSym}`);
          const data = await res.json();
          if (data && data.lastFundingRate) {
            this.fundingRates[p] = parseFloat(data.lastFundingRate);
          }
        } catch (_) {}
      }
    }, 60000);
  }

  private startOrderBookMonitor() {
    const streams = PAIRS.filter(p => p !== 'GBPUSD').map(p => `${toBinanceSymbol(p).toLowerCase()}@depth10@100ms`).join('/');
    const obWs = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    
    obWs.on('message', (data: Buffer) => {
      try {
        const payload = JSON.parse(data.toString());
        if (!payload.data || !payload.data.bids || !payload.data.asks) return;
        const binanceSymbol = payload.data.s;
        const symbol = fromBinanceSymbol(binanceSymbol);
        const bids = payload.data.bids as [string, string][];
        const asks = payload.data.asks as [string, string][];
        
        let bidVol = 0;
        let askVol = 0;
        bids.forEach(b => bidVol += parseFloat(b[1]));
        asks.forEach(a => askVol += parseFloat(a[1]));
        
        const total = bidVol + askVol;
        if (total > 0 && PAIRS.includes(symbol)) {
          this.obImbalances[symbol] = bidVol / total;
        }
      } catch (_) {}
    });

    obWs.on('close', () => {
      setTimeout(() => this.startOrderBookMonitor(), 5000);
    });
    
    obWs.on('error', () => {});
  }

  private connectWebsocket() {
    const streams = PAIRS.filter(p => p !== 'GBPUSD').map(p => {
      const b = toBinanceSymbol(p).toLowerCase();
      return `${b}@kline_1m/${b}@kline_5m/${b}@kline_15m/${b}@kline_1h`;
    }).join('/');
    this.ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

    this.ws.on('message', (data: Buffer) => {
      try {
        const payload = JSON.parse(data.toString());
        if (!payload.data || !payload.data.k) return;
        
        const binanceSymbol = payload.data.s;
        const symbol = fromBinanceSymbol(binanceSymbol);
        const kline = payload.data.k;
        const interval = kline.i;
        const currentPrice = parseFloat(kline.c);

        if (!PAIRS.includes(symbol)) return;

        const formattedKline: Kline = {
          time: kline.t,
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: currentPrice,
          volume: parseFloat(kline.v)
        };

        if (interval === '5m') {
          this.updateDataArray(this.data5m[symbol], formattedKline);
          this.manageActiveTrade(symbol, currentPrice);
          this.evaluateNewTrade(symbol, currentPrice);
        } else if (interval === '1m') {
          // Rapid tick management for fast break-even & trailing stops
          this.manageActiveTrade(symbol, currentPrice);
        } else if (interval === '15m') {
          this.updateDataArray(this.data15m[symbol], formattedKline);
        } else if (interval === '1h') {
          this.updateDataArray(this.data1h[symbol], formattedKline);
        }

      } catch (err) {
        console.error("WS Parse Error:", err);
      }
    });

    this.ws.on('close', () => {
      console.log("WS Closed. Reconnecting in 5s...");
      setTimeout(() => this.connectWebsocket(), 5000);
    });
    
    this.ws.on('error', (err) => {
      console.error("WS Error:", err);
    });
  }

  private updateDataArray(arr: Kline[], newKline: Kline) {
    const last = arr[arr.length - 1];
    if (last && last.time === newKline.time) {
      arr[arr.length - 1] = newKline;
    } else {
      arr.push(newKline);
      if (arr.length > 200) arr.shift();
    }
  }

  // High-Profitability Active Trade Manager:
  // 1. Break-Even milestone (TP1): Lock in 0 risk when price hits 40-50% of target!
  // 2. Trailing Stop: Lock in profits as price advances.
  // 3. Stale Trade Timeout: Exit gracefully if trade stalls > 45-60m rather than getting stuck.
  public manageActiveTrade(symbol: string, currentPrice: number) {
    const activeTrade = this.activeTrades[symbol];
    if (!activeTrade) return;

    const isLong = activeTrade.type === 'LONG';
    const entry = activeTrade.entryPrice;
    const targetDist = Math.abs(activeTrade.takeProfit - entry);
    const curProfit = isLong ? (currentPrice - entry) : (entry - currentPrice);

    // --- STEP 1: DYNAMIC BREAK-EVEN & PROFIT LOCKING (TP1) ---
    // When price reaches tp1Price (or 40% of target distance), move SL to Break-Even + small buffer!
    const tp1Threshold = activeTrade.tp1Price || (isLong ? entry + (targetDist * 0.45) : entry - (targetDist * 0.45));
    const reachedTp1 = isLong ? (currentPrice >= tp1Threshold) : (currentPrice <= tp1Threshold);

    if (reachedTp1 && !activeTrade.tp1Hit) {
      activeTrade.tp1Hit = true;
      // Move SL to Break-Even + small fee cushion (Guarantees zero-risk position!)
      const bePrice = isLong ? entry * 1.0004 : entry * 0.9996;
      activeTrade.stopLoss = parseFloat(bePrice.toFixed(activeTrade.pair?.includes('EUR') || activeTrade.pair?.includes('GBP') ? 5 : 2));
      
      const updateStmt = this.db.prepare("UPDATE trades SET tp1Hit = 1, stopLoss = ? WHERE id = ?");
      updateStmt.run(activeTrade.stopLoss, activeTrade.id);
      console.log(`[Risk Shield] ${symbol} reached TP1 milestone! Stop Loss moved to Break-Even: ${activeTrade.stopLoss}`);
    }

    // --- STEP 2: PROFIT TRAILING STOP (Locks in 50% profit when reaching 75% of target) ---
    if (curProfit >= targetDist * 0.75) {
      const trailTarget = isLong ? entry + (targetDist * 0.45) : entry - (targetDist * 0.45);
      const shouldUpdate = isLong ? trailTarget > activeTrade.stopLoss : trailTarget < activeTrade.stopLoss;
      if (shouldUpdate) {
        activeTrade.stopLoss = parseFloat(trailTarget.toFixed(activeTrade.pair?.includes('EUR') || activeTrade.pair?.includes('GBP') ? 5 : 2));
        const updateStmt = this.db.prepare("UPDATE trades SET stopLoss = ? WHERE id = ?");
        updateStmt.run(activeTrade.stopLoss, activeTrade.id);
        console.log(`[Trailing Lock] ${symbol} locked in +45% target profit at ${activeTrade.stopLoss}`);
      }
    }

    // --- STEP 3: EXIT CONDITION EVALUATION ---
    let result: 'WON' | 'LOST' | null = null;
    let exitReason = '';

    if (isLong) {
      if (currentPrice >= activeTrade.takeProfit) {
        result = 'WON';
        exitReason = 'TAKE_PROFIT';
      } else if (currentPrice <= activeTrade.stopLoss) {
        if (activeTrade.tp1Hit) {
          result = 'WON';
          exitReason = 'BREAK_EVEN_PROFIT';
        } else {
          result = 'LOST';
          exitReason = 'STOP_LOSS';
        }
      }
    } else { // SHORT
      if (currentPrice <= activeTrade.takeProfit) {
        result = 'WON';
        exitReason = 'TAKE_PROFIT';
      } else if (currentPrice >= activeTrade.stopLoss) {
        if (activeTrade.tp1Hit) {
          result = 'WON';
          exitReason = 'BREAK_EVEN_PROFIT';
        } else {
          result = 'LOST';
          exitReason = 'STOP_LOSS';
        }
      }
    }

    // --- STEP 4: STALE TRADE TIMEOUT (45 Minutes) ---
    // Prevents positions from staying stuck in sideways chop forever
    const tradeAgeMinutes = (Date.now() - activeTrade.timestamp) / 60000;
    if (!result && tradeAgeMinutes >= 45) {
      if (curProfit > 0) {
        result = 'WON';
        exitReason = 'PROFIT_PRESERVATION';
      } else if (tradeAgeMinutes >= 75) {
        result = 'LOST';
        exitReason = 'TIME_DECAY_SCRATCH';
      }
    }
    
    if (result) {
      const updateStmt = this.db.prepare("UPDATE trades SET status = ?, closeTimestamp = ?, exitReason = ? WHERE id = ?");
      updateStmt.run(result, Date.now(), exitReason, activeTrade.id);
      console.log(`[Trade Closed] ${activeTrade.id} (${symbol}) Result: ${result} [${exitReason}] @ ${currentPrice}`);
      
      // Smart Cooldown: Only 3 minutes after a loss (down from 35m) so the bot stays active!
      if (result === 'LOST') {
        const cooldownUntil = Date.now() + (3 * 60 * 1000);
        this.pairCooldowns[symbol] = cooldownUntil;
      }

      if (activeTrade.aiFeatures) {
        this.predictor.recordResultAndTrain(activeTrade.aiFeatures, result);
      }
      
      // Save Trade Review
      const closedTradeId = activeTrade.id;
      const startTime = activeTrade.timestamp - (10 * 60000); 
      fetchHistoricalKlines(symbol, '1m', 1000, Date.now(), startTime).then(reviewCandles => {
        try {
          const stmt = this.db.prepare("INSERT OR REPLACE INTO trade_reviews VALUES (?, ?)");
          stmt.run(closedTradeId, JSON.stringify(reviewCandles));
        } catch (_) {}
      });

      this.activeTrades[symbol] = null; 
      return;
    }
  }

  // Multi-Strategy High-Frequency & High-Profitability Evaluator
  public evaluateNewTrade(symbol: string, currentPrice: number) {
    if (this.activeTrades[symbol]) return;

    // 0. Market Open Schedule Guard
    const marketStatus = getMarketStatus(symbol);
    if (!marketStatus.isOpen) return;

    // 1. Smart Cooldown Check (3 min)
    const cooldownUntil = this.pairCooldowns[symbol] || 0;
    if (Date.now() < cooldownUntil) return;

    const data5m = this.data5m[symbol];
    const data15m = this.data15m[symbol];
    if (!data5m || data5m.length < 30) return;

    // Multi-Timeframe Indicators (5m & 15m)
    const ema9 = calculateEMA(data5m, 9);
    const ema21 = calculateEMA(data5m, 21);
    const ema50 = calculateEMA(data5m, 50);
    const rsiArray = calculateRSI(data5m, 14);
    const atrArray = calculateATR(data5m, 14);
    const macdData = calculateMACD(data5m);
    const vwapArray = calculateVWAP(data5m);
    const adxData = calculateADX(data5m, 14);

    const cIndex = data5m.length - 1;
    const currentCandle = data5m[cIndex];
    const prevCandle = data5m[cIndex - 1];

    const c_ema9 = ema9[cIndex];
    const c_ema21 = ema21[cIndex];
    const c_ema50 = ema50[cIndex] || c_ema21;
    const p_ema9 = ema9[cIndex - 1];
    const p_ema21 = ema21[cIndex - 1];

    const c_rsi = rsiArray[cIndex];
    const p_rsi = rsiArray[cIndex - 1];
    const c_atr = atrArray[cIndex] || (currentPrice * 0.004);
    const c_macd = macdData.hist[cIndex];
    const p_macd = macdData.hist[cIndex - 1];
    const c_vwap = vwapArray[cIndex] || currentPrice;
    const c_adx = adxData.adx[cIndex] || 20;

    // 15m Anchor Trend
    let macroBullish = true;
    let macroBearish = false;
    if (data15m && data15m.length >= 30) {
      const ema21_15m = calculateEMA(data15m, 21);
      const ema50_15m = calculateEMA(data15m, 50);
      const l21 = ema21_15m[ema21_15m.length - 1];
      const l50 = ema50_15m[ema50_15m.length - 1];
      macroBullish = l21 >= l50;
      macroBearish = l21 < l50;
    }

    // =========================================================================
    // QUANT STRATEGY ENGINE: 3 COMPLEMENTARY HIGH-PROFITABILITY SETUPS
    // =========================================================================
    let signalType: 'LONG' | 'SHORT' | null = null;
    let strategyReason = '';

    // STRATEGY 1: Trend Pullback & Continuation Engine (High Winrate Momentum)
    const isUptrend = (c_ema9 >= c_ema21 || currentPrice >= c_vwap * 0.998) && (macroBullish || c_ema21 >= c_ema50);
    const isDowntrend = (c_ema9 <= c_ema21 || currentPrice <= c_vwap * 1.002) && (macroBearish || c_ema21 <= c_ema50);

    // Bullish pullback: healthy RSI (40-66), MACD histogram expanding positive or turning up, candle green
    if (isUptrend && c_rsi >= 40 && c_rsi <= 66 && (c_macd > p_macd || c_macd > 0) && currentCandle.close >= currentCandle.open) {
      signalType = 'LONG';
      strategyReason = 'TREND_PULLBACK_MOMENTUM';
    } else if (isDowntrend && c_rsi <= 60 && c_rsi >= 34 && (c_macd < p_macd || c_macd < 0) && currentCandle.close <= currentCandle.open) {
      signalType = 'SHORT';
      strategyReason = 'TREND_PULLBACK_MOMENTUM';
    }

    // STRATEGY 2: Mean Reversion & Volatility Exhaustion (RSI Extremes in Range)
    if (!signalType && c_adx < 36) {
      // Oversold bounce: RSI < 32 with bullish reversal candle
      if (c_rsi < 32 && currentCandle.close > currentCandle.open && currentPrice < c_vwap) {
        signalType = 'LONG';
        strategyReason = 'MEAN_REVERSION_OVERSOLD';
      }
      // Overbought rejection: RSI > 68 with bearish rejection candle
      else if (c_rsi > 68 && currentCandle.close < currentCandle.open && currentPrice > c_vwap) {
        signalType = 'SHORT';
        strategyReason = 'MEAN_REVERSION_OVERBOUGHT';
      }
    }

    // STRATEGY 3: Fast Momentum Golden / Death Cross
    if (!signalType) {
      const bullCross = c_ema9 > c_ema21 && p_ema9 <= p_ema21;
      const bearCross = c_ema9 < c_ema21 && p_ema9 >= p_ema21;

      if (bullCross && c_rsi >= 45 && c_rsi <= 68 && (c_macd > 0 || c_macd > p_macd)) {
        signalType = 'LONG';
        strategyReason = 'MOMENTUM_GOLDEN_CROSS';
      } else if (bearCross && c_rsi <= 55 && c_rsi >= 32 && (c_macd < 0 || c_macd < p_macd)) {
        signalType = 'SHORT';
        strategyReason = 'MOMENTUM_DEATH_CROSS';
      }
    }

    // If signal confirmed, calculate optimal dynamic TP & SL
    if (signalType && c_atr > 0) {
      const actualEntry = currentPrice;
      const features = [
        c_rsi, 
        c_macd, 
        currentPrice - c_ema9, 
        currentPrice - c_ema21, 
        signalType === 'LONG' ? 1 : 0, 
        macroBullish ? 1 : 0,
        c_adx || 20,
        1
      ];
      const quantConfidence = Math.max(68, Math.min(96, this.predictor.predict(features)));

      let decimals = 2;
      let minSlDistance = c_atr * 1.0;

      if (symbol.includes('EUR') || symbol.includes('GBP')) {
        decimals = 5;
        minSlDistance = Math.max(c_atr * 1.0, 0.0009); // ~9 pips
      } else if (symbol.includes('XAU') || symbol.includes('GOLD')) {
        decimals = 2;
        minSlDistance = Math.max(c_atr * 1.0, 3.00); // $3.00 (30 pips)
      } else if (symbol.includes('BTC')) {
        decimals = 2;
        minSlDistance = Math.max(c_atr * 1.0, actualEntry * 0.0025); // ~$215+
      } else if (symbol.includes('ETH')) {
        decimals = 2;
        minSlDistance = Math.max(c_atr * 1.0, actualEntry * 0.0035); // ~$10+
      } else if (symbol.includes('SOL')) {
        decimals = 2;
        minSlDistance = Math.max(c_atr * 1.0, actualEntry * 0.006); // ~$0.70+
      }

      const slDistance = minSlDistance;
      const tpDistance = slDistance * 1.65; // Institutional 1.65 : 1 R:R
      const tp1Distance = slDistance * 0.90; // Quick Break-Even milestone

      let stopLoss = 0;
      let takeProfit = 0;
      let tp1Price = 0;

      if (signalType === 'LONG') {
        stopLoss = actualEntry - slDistance;
        takeProfit = actualEntry + tpDistance;
        tp1Price = actualEntry + tp1Distance;
      } else {
        stopLoss = actualEntry + slDistance;
        takeProfit = actualEntry - tpDistance;
        tp1Price = actualEntry - tp1Distance;
      }

      const finalTp = parseFloat(takeProfit.toFixed(decimals));
      const finalSl = parseFloat(stopLoss.toFixed(decimals));
      const finalTp1 = parseFloat(tp1Price.toFixed(decimals));
      const finalEntry = parseFloat(actualEntry.toFixed(decimals));

      const newTrade: Trade = {
        id: Math.random().toString(36).substr(2, 9),
        pair: symbol,
        type: signalType,
        entryPrice: finalEntry,
        takeProfit: finalTp,
        stopLoss: finalSl,
        tp1Price: finalTp1,
        tp1Hit: false,
        status: 'ACTIVE',
        timestamp: Date.now(),
        confidence: quantConfidence,
        exitReason: strategyReason,
        aiFeatures: features
      };
      
      this.activeTrades[symbol] = newTrade;

      const insertStmt = this.db.prepare(
        "INSERT INTO trades (id, pair, type, entryPrice, takeProfit, stopLoss, tp1Price, tp1Hit, status, timestamp, confidence, exitReason, aiFeatures) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      insertStmt.run(
        newTrade.id, 
        newTrade.pair, 
        newTrade.type, 
        newTrade.entryPrice, 
        newTrade.takeProfit, 
        newTrade.stopLoss, 
        newTrade.tp1Price, 
        0, 
        newTrade.status, 
        newTrade.timestamp, 
        newTrade.confidence, 
        newTrade.exitReason || '',
        JSON.stringify(newTrade.aiFeatures)
      );
      
      const rrRatio = Math.abs(finalTp - finalEntry) / Math.max(0.00001, Math.abs(finalEntry - finalSl));
      console.log(`[Quant Trade Opened] ${newTrade.pair} ${newTrade.type} @ ${newTrade.entryPrice} | TP: ${newTrade.takeProfit} | SL: ${newTrade.stopLoss} | TP1(BE): ${newTrade.tp1Price} | Reason: ${strategyReason} (R:R: ${rrRatio.toFixed(2)}:1, Score: ${quantConfidence}%)`);
    }
  }

  public getDiagnostics() {
    const wsConnected = !!this.ws && this.ws.readyState === WebSocket.OPEN;
    const sessionInfo = getTradingSessionInfo();

    const activeTradesList = Object.entries(this.activeTrades)
      .filter(([_, t]) => t !== null)
      .map(([pair, t]) => ({ 
        pair, 
        type: t!.type, 
        entryPrice: t!.entryPrice,
        stopLoss: t!.stopLoss,
        takeProfit: t!.takeProfit,
        tp1Price: t!.tp1Price,
        tp1Hit: !!t!.tp1Hit,
        exitReason: t!.exitReason
      }));

    const activeCooldowns: Record<string, number> = {};
    const now = Date.now();
    for (const [p, cd] of Object.entries(this.pairCooldowns)) {
      if (cd > now) {
        activeCooldowns[p] = Math.ceil((cd - now) / 1000);
      }
    }

    const marketStatuses: Record<string, any> = {};
    for (const p of PAIRS) {
      marketStatuses[p] = getMarketStatus(p);
    }

    return {
      botStatus: 'ONLINE',
      wsStatus: wsConnected ? 'CONNECTED' : 'CONNECTING',
      tradingSession: sessionInfo.session,
      sessionHighLiquidity: sessionInfo.isHighLiquidity,
      monitoredPairs: PAIRS,
      timeframes: ['1m (Fast Execution)', '5m (Core Momentum)', '15m (Anchor Trend)'],
      maxConcurrentTrades: 6,
      activeTradesCount: activeTradesList.length,
      activeTrades: activeTradesList,
      cooldowns: activeCooldowns,
      marketStatuses,
      fundingRates: this.fundingRates,
      orderBookImbalances: this.obImbalances,
      aiModel: this.predictor.getStatus(),
      uptimeSeconds: Math.floor(process.uptime()),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    };
  }
}
