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
  detectVolumeExhaustion,
  getTradingSessionInfo
} from './src/lib/indicators';
import { fetchHistoricalKlines } from './src/lib/binance';
import { TradePredictor } from './src/lib/ai';
import { getMarketStatus } from './src/lib/market_hours';

// VPVR Calculation
export function calculateVPVR(klines: Kline[], bins: number = 50) {
  let min = Math.min(...klines.map(k => k.low));
  let max = Math.max(...klines.map(k => k.high));
  let step = (max - min) / bins;
  
  let profile = Array(bins).fill(0).map((_, i) => ({
    price: min + (step * i) + (step / 2),
    volume: 0
  }));

  klines.forEach(k => {
    for (let i = 0; i < bins; i++) {
      let binMin = min + (step * i);
      let binMax = min + (step * (i + 1));
      if ((k.low <= binMax && k.high >= binMin)) {
        profile[i].volume += k.volume;
      }
    }
  });

  return profile.sort((a, b) => b.volume - a.volume); 
}

// S/R Finder
export function findSupportResistance(klines: Kline[]): SRLevels {
  const supports: number[] = [];
  const resistances: number[] = [];
  
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

// 6 Institutional & High-Liquidity Pairs (Vantage MT5: BTCUSD, ETHUSD, XAUUSD, EURUSD, GBPUSD, SOLUSD)
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
  private lastEvaluationTime: Record<string, number> = {};
  
  private fundingRates: Record<string, number> = {};
  private obImbalances: Record<string, number> = {};
  private predictor: TradePredictor;
  
  constructor(db: DatabaseSync) {
    this.predictor = new TradePredictor();
    this.db = db;
    PAIRS.forEach(p => {
      this.data5m[p] = [];
      this.data15m[p] = [];
      this.data1h[p] = [];
      this.activeTrades[p] = null;
      this.pairCooldowns[p] = 0;
      this.lastEvaluationTime[p] = 0;
      this.fundingRates[p] = 0; // Default neutral
      this.obImbalances[p] = 0.5; // Default neutral
    });
  }

  public async start() {
    console.log("Fetching historical data (5m, 15m, 1h) for all pairs...");
    for (const p of PAIRS) {
      try {
        this.data5m[p] = await fetchHistoricalKlines(p, '5m', 150);
        this.data15m[p] = await fetchHistoricalKlines(p, '15m', 150);
        this.data1h[p] = await fetchHistoricalKlines(p, '1h', 100);
      } catch (err) {
        console.error(`Failed to fetch history for ${p}:`, err);
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
    this.startFundingMonitor();
    this.startOrderBookMonitor();
  }

  // Real-time tick ingestion from Vantage MT5 terminal
  public handleMT5Tick(symbol: string, bid: number, ask: number) {
    if (!PAIRS.includes(symbol)) return;
    const currentPrice = (bid + ask) / 2;
    this.manageActiveTrade(symbol, currentPrice);
  }

  // Real-time kline ingestion from Vantage MT5 terminal
  public handleMT5Klines(symbol: string, timeframe: string, klines: any[]) {
    if (!PAIRS.includes(symbol) || !Array.isArray(klines) || klines.length === 0) return;
    
    const formattedKlines: Kline[] = klines.map(k => ({
      time: typeof k.time === 'number' ? k.time : Date.now(),
      open: parseFloat(k.open) || 0,
      high: parseFloat(k.high) || 0,
      low: parseFloat(k.low) || 0,
      close: parseFloat(k.close) || 0,
      volume: parseFloat(k.volume) || 0
    }));

    if (timeframe === '5m') {
      this.data5m[symbol] = formattedKlines.slice(-200);
      const last = formattedKlines[formattedKlines.length - 1];
      if (last) {
        this.manageActiveTrade(symbol, last.close);
        const now = Date.now();
        const lastEval = this.lastEvaluationTime[symbol] || 0;
        if (now - lastEval >= 45000) {
          this.lastEvaluationTime[symbol] = now;
          this.evaluateNewTrade(symbol, last.close);
        }
      }
    } else if (timeframe === '15m') {
      this.data15m[symbol] = formattedKlines.slice(-200);
    } else if (timeframe === '1h') {
      this.data1h[symbol] = formattedKlines.slice(-200);
    }
  }

  private startFundingMonitor() {
    // All 6 pairs have active Binance futures funding rate endpoints
    setInterval(async () => {
      for (const p of PAIRS) {
        try {
          const binanceSym = toBinanceSymbol(p);
          const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binanceSym}`);
          const data = await res.json();
          if (data && data.lastFundingRate) {
            this.fundingRates[p] = parseFloat(data.lastFundingRate);
          }
        } catch (e) {
          // ignore silently
        }
      }
    }, 60000);
  }

  private startOrderBookMonitor() {
    const streams = PAIRS.map(p => `${toBinanceSymbol(p).toLowerCase()}@depth10@100ms`).join('/');
    const obWs = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    
    obWs.on('message', (data: Buffer) => {
      try {
        const payload = JSON.parse(data.toString());
        if (!payload.data || !payload.data.bids || !payload.data.asks) return;
        const binanceSymbol = payload.data.s; // e.g., BTCUSDT
        const symbol = fromBinanceSymbol(binanceSymbol); // e.g., BTCUSD
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
      } catch (err) {}
    });

    obWs.on('close', () => {
      setTimeout(() => this.startOrderBookMonitor(), 5000);
    });
    
    obWs.on('error', () => {});
  }

  private connectWebsocket() {
    const streams = PAIRS.map(p => {
      const b = toBinanceSymbol(p).toLowerCase();
      return `${b}@kline_5m/${b}@kline_15m/${b}@kline_1h`;
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

          // 1. Manage active trade on EVERY tick (Fixed SL & Algorithmic TP)
          this.manageActiveTrade(symbol, currentPrice);

          // 2. Evaluate entering a new trade on candle close (kline.x) OR every 45s during active market movement
          const now = Date.now();
          const lastEval = this.lastEvaluationTime[symbol] || 0;
          if (kline.x || (now - lastEval >= 45000)) {
            this.lastEvaluationTime[symbol] = now;
            this.evaluateNewTrade(symbol, currentPrice);
          }
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

  // Manage Active Trade: Fixed Stop Loss & Algorithmic Single Take Profit (No SL moving, No TP2)
  private manageActiveTrade(symbol: string, currentPrice: number) {
    const activeTrade = this.activeTrades[symbol];
    if (!activeTrade) return;

    // --- EXIT CONDITION EVALUATION (Fixed SL & Algorithmic TP) ---
    let result: 'WON' | 'LOST' | null = null;
    let exitReason = '';

    if (activeTrade.type === 'LONG') {
      if (currentPrice >= activeTrade.takeProfit) {
        result = 'WON';
        exitReason = 'TAKE_PROFIT';
      } else if (currentPrice <= activeTrade.stopLoss) {
        result = 'LOST';
        exitReason = 'STOP_LOSS';
      }
    } else { // SHORT
      if (currentPrice <= activeTrade.takeProfit) {
        result = 'WON';
        exitReason = 'TAKE_PROFIT';
      } else if (currentPrice >= activeTrade.stopLoss) {
        result = 'LOST';
        exitReason = 'STOP_LOSS';
      }
    }
    
    if (result) {
      const updateStmt = this.db.prepare("UPDATE trades SET status = ?, closeTimestamp = ?, exitReason = ? WHERE id = ?");
      updateStmt.run(result, Date.now(), exitReason, activeTrade.id);
      console.log(`Trade ${activeTrade.id} (${symbol}) Closed: ${result} [${exitReason}] at ${currentPrice}`);
      
      // Consecutive Loss Protection: 35 minute cooldown after an outright loss
      if (result === 'LOST') {
        const cooldownUntil = Date.now() + (35 * 60 * 1000);
        this.pairCooldowns[symbol] = cooldownUntil;
        console.log(`[Consecutive Loss Protection] Cooling down ${symbol} until ${new Date(cooldownUntil).toLocaleTimeString()} (35m)`);
      }

      if (activeTrade.aiFeatures) {
        this.predictor.recordResultAndTrain(activeTrade.aiFeatures, result);
      }
      
      // Save Trade Review Asynchronously
      const closedTradeId = activeTrade.id;
      const startTime = activeTrade.timestamp - (10 * 60000); 
      fetchHistoricalKlines(symbol, '1m', 1000, Date.now(), startTime).then(reviewCandles => {
        try {
          const stmt = this.db.prepare("INSERT OR REPLACE INTO trade_reviews VALUES (?, ?)");
          stmt.run(closedTradeId, JSON.stringify(reviewCandles));
          console.log(`Saved review for ${symbol} trade ${closedTradeId} with ${reviewCandles.length} candles.`);
        } catch (err) {
          console.error("Failed to save review:", err);
        }
      });

      this.activeTrades[symbol] = null; 
      return;
    }
  }

  // Redesigned Algorithmic Evaluation Engine:
  // Balanced, responsive, multi-factor confluence (Momentum Continuation + Dynamic S/R Pullbacks)
  private evaluateNewTrade(symbol: string, currentPrice: number) {
    if (this.activeTrades[symbol]) return;

    // 0. Market Open / Schedule Guard (Forex/Gold closed on weekends; Crypto 24/7)
    const marketStatus = getMarketStatus(symbol);
    if (!marketStatus.isOpen) {
      return;
    }

    // 1. Loss / Entry Cooldown Check (2 minutes)
    const cooldownUntil = this.pairCooldowns[symbol] || 0;
    if (Date.now() < cooldownUntil) {
      return;
    }

    // 2. Global Portfolio Exposure Guard (Max 4 concurrent trades)
    const activeList = Object.values(this.activeTrades).filter(t => t !== null);
    if (activeList.length >= 4) {
      return;
    }

    // Asset Class Correlation Limits
    const isCrypto = symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('SOL');
    const isForex = symbol.includes('EUR') || symbol.includes('GBP');
    const isGold = symbol.includes('XAU') || symbol.includes('PAXG') || symbol.includes('GOLD');

    const activeClassTrades = activeList.filter(t => {
      if (!t) return false;
      const tSymbol = t.pair;
      if (isCrypto && (tSymbol.includes('BTC') || tSymbol.includes('ETH') || tSymbol.includes('SOL'))) return true;
      if (isForex && (tSymbol.includes('EUR') || tSymbol.includes('GBP'))) return true;
      if (isGold && (tSymbol.includes('XAU') || tSymbol.includes('PAXG') || tSymbol.includes('GOLD'))) return true;
      return false;
    });

    if (isCrypto && activeClassTrades.length >= 3) return;
    if (isForex && activeClassTrades.length >= 2) return;
    if (isGold && activeClassTrades.length >= 1) return;

    const data5m = this.data5m[symbol];
    const data15m = this.data15m[symbol];
    const data1h = this.data1h[symbol];
    
    if (data5m.length < 25 || data15m.length < 20) return;

    // 3. Multi-Factor 5m Indicators
    const ema9 = calculateEMA(data5m, 9);
    const ema21 = calculateEMA(data5m, 21);
    const rsiArray = calculateRSI(data5m, 14);
    const atrArray = calculateATR(data5m, 14);
    const macdData = calculateMACD(data5m);
    const vwapArray = calculateVWAP(data5m);

    const c_ema9 = ema9[ema9.length - 1];
    const c_ema21 = ema21[ema21.length - 1];
    const p_ema9 = ema9[ema9.length - 2];
    const p_ema21 = ema21[ema21.length - 2];
    
    const c_rsi = rsiArray[rsiArray.length - 1] ?? 50;
    const p_rsi = rsiArray[rsiArray.length - 2] ?? 50;
    const c_atr = atrArray[atrArray.length - 1];
    const c_macd = macdData.hist[macdData.hist.length - 1] ?? 0;
    const p_macd = macdData.hist[macdData.hist.length - 2] ?? 0;
    const c_vwap = vwapArray[vwapArray.length - 1] ?? currentPrice;

    if (!c_atr || !c_ema9 || !c_ema21) return;

    // 4. Macro Trend Alignment (15m)
    let macroBullish = false;
    let macroBearish = false;
    if (data15m.length >= 20) {
      const ema21_15m = calculateEMA(data15m, 21);
      const ema50_15m = calculateEMA(data15m, Math.min(50, data15m.length - 1));
      const last_ema21 = ema21_15m[ema21_15m.length - 1];
      const last_ema50 = ema50_15m[ema50_15m.length - 1];
      if (last_ema21 && last_ema50) {
        macroBullish = last_ema21 >= last_ema50;
        macroBearish = last_ema21 <= last_ema50;
      }
    }

    // 5. Dynamic S/R Levels and Liquidity Proximity
    const srLevels = findSupportResistance(data5m);
    const validSupports = srLevels.supports.filter(s => s < currentPrice);
    const validResistances = srLevels.resistances.filter(r => r > currentPrice);
    const closestSupport = validSupports.length ? Math.max(...validSupports) : currentPrice - (c_atr * 1.5);
    const closestResistance = validResistances.length ? Math.min(...validResistances) : currentPrice + (c_atr * 1.5);

    const obRatio = this.obImbalances[symbol] ?? 0.5;

    // Candle Analysis (Wick rejections & structure)
    const lastCandle = data5m[data5m.length - 1];
    const candleRange = Math.max(0.00001, lastCandle.high - lastCandle.low);
    const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
    const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
    const isHammer = (lowerWick / candleRange) >= 0.35;
    const isShootingStar = (upperWick / candleRange) >= 0.35;

    // --- CONFLUENCE SCORING ENGINE ---
    let bullishScore = 0;
    let bearishScore = 0;

    // Component 1: Moving Average Trend Flow
    if (c_ema9 > c_ema21) {
      bullishScore += 25;
      if (p_ema9 <= p_ema21) bullishScore += 15; // Fresh Bullish Cross
    } else if (c_ema9 < c_ema21) {
      bearishScore += 25;
      if (p_ema9 >= p_ema21) bearishScore += 15; // Fresh Bearish Cross
    }

    // Component 2: MACD Histogram Momentum
    if (c_macd > 0) {
      bullishScore += 20;
      if (c_macd > p_macd) bullishScore += 10;
    } else if (c_macd < 0) {
      bearishScore += 20;
      if (c_macd < p_macd) bearishScore += 10;
    }

    // Component 3: Price vs VWAP Anchor
    if (currentPrice >= c_vwap * 0.998) {
      bullishScore += 15;
    }
    if (currentPrice <= c_vwap * 1.002) {
      bearishScore += 15;
    }

    // Component 4: RSI Positioning & Reversal Hooks
    if (c_rsi >= 38 && c_rsi <= 72) {
      bullishScore += 15;
    } else if (c_rsi < 40 && c_rsi > p_rsi) {
      bullishScore += 25; // Oversold Bullish Bounce
    }

    if (c_rsi >= 28 && c_rsi <= 62) {
      bearishScore += 15;
    } else if (c_rsi > 60 && c_rsi < p_rsi) {
      bearishScore += 25; // Overbought Bearish Rejection
    }

    // Component 5: Price Action & Support/Resistance Defense
    if (isHammer || (currentPrice - closestSupport) < c_atr * 1.3) {
      bullishScore += 15;
    }
    if (isShootingStar || (closestResistance - currentPrice) < c_atr * 1.3) {
      bearishScore += 15;
    }

    // Component 6: Macro 15m Alignment
    if (macroBullish) bullishScore += 15;
    if (macroBearish) bearishScore += 15;

    // Component 7: Orderbook Imbalance Flow
    if (obRatio > 0.52) bullishScore += 10;
    if (obRatio < 0.48) bearishScore += 10;

    // Trigger Decision (Responsive & Balanced: Confluence Threshold 55)
    let signalType: 'LONG' | 'SHORT' | null = null;
    const CONF_THRESHOLD = 55;

    if (bullishScore >= CONF_THRESHOLD && bullishScore > bearishScore + 5) {
      signalType = 'LONG';
    } else if (bearishScore >= CONF_THRESHOLD && bearishScore > bullishScore + 5) {
      signalType = 'SHORT';
    }

    if (signalType) {
      const actualEntry = currentPrice;
      const confidence = Math.max(58, Math.min(95, signalType === 'LONG' ? bullishScore : bearishScore));

      // Decimals and realistic minimum pip/target buffers
      let decimals = 4;
      let minSwingTarget = 0;
      let minSlDist = c_atr * 1.0;
      let maxSlDist = c_atr * 1.8;

      if (symbol.includes('EUR') || symbol.includes('GBP')) {
        decimals = 5;
        minSwingTarget = 0.0012; // 12 pips realistic target for 5m Forex
      } else if (symbol.includes('XAU') || symbol.includes('GOLD')) {
        decimals = 2;
        minSwingTarget = 5.00; // $5 move for Gold
      } else if (symbol.includes('BTC')) {
        decimals = 2;
        minSwingTarget = actualEntry * 0.008; // 0.8% move (~$680)
      } else if (symbol.includes('ETH')) {
        decimals = 2;
        minSwingTarget = actualEntry * 0.012; // 1.2% move (~$30)
      } else if (symbol.includes('SOL')) {
        decimals = 2;
        minSwingTarget = actualEntry * 0.015; // 1.5% move (~$1.80)
      } else {
        decimals = 4;
        minSwingTarget = actualEntry * 0.010;
      }

      let stopLoss = 0;
      let takeProfit = 0;

      // Realistic Risk-to-Reward (1.8:1 to 2.4:1)
      const targetRR = 2.0;

      if (signalType === 'LONG') {
        const distToSupport = actualEntry - closestSupport;
        const slDist = Math.max(minSlDist, Math.min(maxSlDist, distToSupport));
        stopLoss = actualEntry - slDist;

        const rawTpDist = slDist * targetRR;
        const tpDist = Math.max(minSwingTarget, Math.min(slDist * 2.6, rawTpDist));
        takeProfit = actualEntry + tpDist;
      } else {
        const distToResistance = closestResistance - actualEntry;
        const slDist = Math.max(minSlDist, Math.min(maxSlDist, distToResistance));
        stopLoss = actualEntry + slDist;

        const rawTpDist = slDist * targetRR;
        const tpDist = Math.max(minSwingTarget, Math.min(slDist * 2.6, rawTpDist));
        takeProfit = actualEntry - tpDist;
      }

      // Single Algorithmic Take Profit & Fixed Stop Loss
      const finalTp = parseFloat(takeProfit.toFixed(decimals));
      const finalSl = parseFloat(stopLoss.toFixed(decimals));
      const finalEntry = parseFloat(actualEntry.toFixed(decimals));

      const newTrade: Trade = {
        id: Math.random().toString(36).substr(2, 9),
        pair: symbol,
        type: signalType,
        entryPrice: finalEntry,
        takeProfit: finalTp,
        stopLoss: finalSl,
        tp1Price: finalTp,
        tp1Hit: false,
        status: 'ACTIVE',
        timestamp: Date.now(),
        confidence,
        aiFeatures: [c_rsi, c_macd, currentPrice - c_ema9, currentPrice - c_ema21, signalType === 'LONG' ? 1 : 0, macroBullish ? 1 : 0, c_atr, 1]
      };
      
      this.activeTrades[symbol] = newTrade;
      this.pairCooldowns[symbol] = Date.now() + (2 * 60 * 1000); // 2 min cooldown post trade

      const insertStmt = this.db.prepare(
        "INSERT INTO trades (id, pair, type, entryPrice, takeProfit, stopLoss, tp1Price, tp1Hit, status, timestamp, confidence, aiFeatures) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        JSON.stringify(newTrade.aiFeatures)
      );
      
      const rrRatio = Math.abs(finalTp - finalEntry) / Math.max(0.00001, Math.abs(finalEntry - finalSl));
      console.log(`[Quant Trade Opened] ${newTrade.pair} ${newTrade.type} @ ${newTrade.entryPrice} | Fixed SL: ${newTrade.stopLoss} | Algo TP: ${newTrade.takeProfit} (R:R: ${rrRatio.toFixed(2)}:1, Score: ${confidence}%)`);
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
        tp1Hit: !!t!.tp1Hit
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
      timeframes: ['5m (Execution)', '15m (Momentum)', '1h (Anchor Macro Trend)'],
      maxConcurrentTrades: 4,
      assetClassLimits: {
        crypto: 'Max 2 (BTC/ETH/SOL)',
        forex: 'Max 2 (EUR/GBP)',
        commodity: 'Max 1 (XAUUSD)'
      },
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
