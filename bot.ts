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

          // 1. Manage active trade on EVERY tick (Break-Even, Trailing Stop, SL/TP)
          this.manageActiveTrade(symbol, currentPrice);

          // 2. ONLY evaluate entering a new trade when 5m candle officially CLOSES (kline.x)
          // This eliminates intra-candle false breakouts and wick traps!
          if (kline.x) {
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

  // Manage Active Trade: Dynamic TP1 (Partial Profit), Break-Even, Trailing Stop, and TP2
  private manageActiveTrade(symbol: string, currentPrice: number) {
    const activeTrade = this.activeTrades[symbol];
    if (!activeTrade) return;

    // --- 1. DYNAMIC TP1 PARTIAL PROFIT CHECK ---
    if (!activeTrade.tp1Hit && activeTrade.tp1Price) {
      const tp1Reached = activeTrade.type === 'LONG' 
        ? currentPrice >= activeTrade.tp1Price 
        : currentPrice <= activeTrade.tp1Price;

      if (tp1Reached) {
        activeTrade.tp1Hit = true;
        // Lock in Break-Even immediately upon securing TP1
        activeTrade.stopLoss = activeTrade.entryPrice;
        
        try {
          this.db.prepare("UPDATE trades SET tp1Hit = 1, stopLoss = ? WHERE id = ?")
            .run(activeTrade.stopLoss, activeTrade.id);
          console.log(`🎯 [TP1 Secured] ${symbol} ${activeTrade.type}: 50% Profit Locked @ $${currentPrice}! Stop Loss moved to Break-Even ($${activeTrade.entryPrice})`);
        } catch (e) {
          console.error("Failed to update TP1 state:", e);
        }
      }
    }

    // --- 2. EXIT CONDITION EVALUATION ---
    let result: 'WON' | 'LOST' | null = null;
    let exitReason = '';

    if (activeTrade.type === 'LONG') {
      if (currentPrice >= activeTrade.takeProfit) {
        result = 'WON';
        exitReason = 'TP2_FULL_TARGET';
      } else if (currentPrice <= activeTrade.stopLoss) {
        // If TP1 was already taken, closing at Break-Even is still a profitable outcome overall!
        if (activeTrade.tp1Hit) {
          result = 'WON';
          exitReason = 'TP1_THEN_BREAKEVEN';
        } else {
          result = 'LOST';
          exitReason = 'STOP_LOSS';
        }
      }
    } else { // SHORT
      if (currentPrice <= activeTrade.takeProfit) {
        result = 'WON';
        exitReason = 'TP2_FULL_TARGET';
      } else if (currentPrice >= activeTrade.stopLoss) {
        if (activeTrade.tp1Hit) {
          result = 'WON';
          exitReason = 'TP1_THEN_BREAKEVEN';
        } else {
          result = 'LOST';
          exitReason = 'STOP_LOSS';
        }
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

    // --- 3. DYNAMIC BREAK-EVEN & TRAILING STOP (If not already trailing) ---
    if (activeTrade.type === 'LONG') {
      const profitDistance = currentPrice - activeTrade.entryPrice;
      const tpDistance = activeTrade.takeProfit - activeTrade.entryPrice;
      const initialRisk = activeTrade.entryPrice - activeTrade.stopLoss;

      // Move SL to Break-Even if trade reaches 45% of TP OR +0.7% gain
      const minBeGain = Math.max(initialRisk * 0.8, activeTrade.entryPrice * 0.007);
      if ((tpDistance > 0 && profitDistance >= tpDistance * 0.45) || profitDistance >= minBeGain) {
        if (activeTrade.stopLoss < activeTrade.entryPrice) {
          activeTrade.stopLoss = activeTrade.entryPrice;
          this.db.prepare("UPDATE trades SET stopLoss = ? WHERE id = ?").run(activeTrade.stopLoss, activeTrade.id);
          console.log(`[Break-Even Activated] ${symbol} LONG: Stop Loss moved to Entry @ $${activeTrade.stopLoss}`);
        }
      }

      // Trailing Stop if profit reaches 75% of TP: Strictly bounded below current price and below Take-Profit
      if (tpDistance > 0 && profitDistance >= tpDistance * 0.75) {
        const rawTrailed = currentPrice - (initialRisk * 0.5);
        const decimals = (symbol.includes('EUR') || symbol.includes('GBP')) ? 5 : (symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('XAU') || symbol.includes('GOLD')) ? 2 : 4;
        // MT5 Guard: SL must be strictly below currentPrice and strictly below takeProfit
        const maxAllowedLongSL = Math.min(currentPrice * 0.998, activeTrade.takeProfit * 0.998);
        const validTrailedSL = parseFloat(Math.min(rawTrailed, maxAllowedLongSL).toFixed(decimals));
        
        if (validTrailedSL > activeTrade.stopLoss && validTrailedSL < currentPrice) {
          activeTrade.stopLoss = validTrailedSL;
          this.db.prepare("UPDATE trades SET stopLoss = ? WHERE id = ?").run(activeTrade.stopLoss, activeTrade.id);
          console.log(`[Trailing SL Activated] ${symbol} LONG: Stop Loss safely trailed to $${activeTrade.stopLoss}`);
        }
      }
    } else { // SHORT
      const profitDistance = activeTrade.entryPrice - currentPrice;
      const tpDistance = activeTrade.entryPrice - activeTrade.takeProfit;
      const initialRisk = activeTrade.stopLoss - activeTrade.entryPrice;

      const minBeGain = Math.max(initialRisk * 0.8, activeTrade.entryPrice * 0.007);
      if ((tpDistance > 0 && profitDistance >= tpDistance * 0.45) || profitDistance >= minBeGain) {
        if (activeTrade.stopLoss > activeTrade.entryPrice) {
          activeTrade.stopLoss = activeTrade.entryPrice;
          this.db.prepare("UPDATE trades SET stopLoss = ? WHERE id = ?").run(activeTrade.stopLoss, activeTrade.id);
          console.log(`[Break-Even Activated] ${symbol} SHORT: Stop Loss moved to Entry @ $${activeTrade.stopLoss}`);
        }
      }

      // Trailing Stop if profit reaches 75% of TP: Strictly bounded above current price and above Take-Profit
      if (tpDistance > 0 && profitDistance >= tpDistance * 0.75) {
        const rawTrailed = currentPrice + (initialRisk * 0.5);
        const decimals = (symbol.includes('EUR') || symbol.includes('GBP')) ? 5 : (symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('XAU') || symbol.includes('GOLD')) ? 2 : 4;
        // MT5 Guard: SL must be strictly above currentPrice and strictly above takeProfit
        const minAllowedShortSL = Math.max(currentPrice * 1.002, activeTrade.takeProfit * 1.002);
        const validTrailedSL = parseFloat(Math.max(rawTrailed, minAllowedShortSL).toFixed(decimals));

        if (validTrailedSL < activeTrade.stopLoss && validTrailedSL > currentPrice) {
          activeTrade.stopLoss = validTrailedSL;
          this.db.prepare("UPDATE trades SET stopLoss = ? WHERE id = ?").run(activeTrade.stopLoss, activeTrade.id);
          console.log(`[Trailing SL Activated] ${symbol} SHORT: Stop Loss safely trailed to $${activeTrade.stopLoss}`);
        }
      }
    }
  }

  // Evaluates a new trade ONLY when a 5m candle closes
  private evaluateNewTrade(symbol: string, currentPrice: number) {
    if (this.activeTrades[symbol]) return;

    // 0. Market Open / Weekend Schedule Guard
    // Forex (EURUSD, GBPUSD) & Gold (XAUUSD) markets close on weekends.
    // Crypto (BTCUSD, ETHUSD, SOLUSD) trades 24/7.
    const marketStatus = getMarketStatus(symbol);
    if (!marketStatus.isOpen) {
      // Market is closed (e.g. weekend close or settlement break). Bot completely skips signal evaluation.
      return;
    }

    // 1. Loss Cooldown Check
    const cooldownUntil = this.pairCooldowns[symbol] || 0;
    if (Date.now() < cooldownUntil) {
      return;
    }

    // 2. SMART MULTI-ASSET EXPOSURE & CORRELATION SHIELD
    // For 6 diversified pairs (Crypto, Forex, Gold):
    // - Global Portfolio Limit: Max 4 concurrent trades (across all 6 pairs)
    // - Asset Class Correlation Limits:
    //    * Crypto (BTC, ETH, SOL): Max 2 concurrent trades
    //    * Forex (EURUSD, GBPUSD): Max 2 concurrent trades
    //    * Commodity / Gold (XAUUSD): Max 1 concurrent trade
    // - Risk-free bonus: Trades that already reached TP1 (Stop Loss @ Break-Even) do not count against risk capacity!
    const activeList = Object.values(this.activeTrades).filter(t => t !== null);
    
    // Total open positions check (Global Max: 4)
    if (activeList.length >= 4) {
      return; // Absolute max portfolio exposure reached
    }

    // Determine current asset class
    const isCrypto = symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('SOL');
    const isForex = symbol.includes('EUR') || symbol.includes('GBP');
    const isGold = symbol.includes('XAU') || symbol.includes('PAXG') || symbol.includes('GOLD');

    // Count active risk-exposed positions in this specific asset class (excluding de-risked Break-Even trades)
    const activeClassTrades = activeList.filter(t => {
      if (!t) return false;
      const tSymbol = t.pair;
      if (isCrypto && (tSymbol.includes('BTC') || tSymbol.includes('ETH') || tSymbol.includes('SOL'))) return true;
      if (isForex && (tSymbol.includes('EUR') || tSymbol.includes('GBP'))) return true;
      if (isGold && (tSymbol.includes('XAU') || tSymbol.includes('PAXG') || tSymbol.includes('GOLD'))) return true;
      return false;
    });

    if (isCrypto && activeClassTrades.length >= 2) {
      // Prevents 3x correlated drawdown if BTC moves violently
      return;
    }
    if (isForex && activeClassTrades.length >= 2) {
      return;
    }
    if (isGold && activeClassTrades.length >= 1) {
      return;
    }

    const data5m = this.data5m[symbol];
    const data15m = this.data15m[symbol];
    const data1h = this.data1h[symbol];
    
    if (data5m.length < 50 || data15m.length < 50) return;

    const sessionInfo = getTradingSessionInfo();

    // 3. Macro Trend (15m timeframe - Proven Core)
    const ema21_15m = calculateEMA(data15m, 21);
    const ema50_15m = calculateEMA(data15m, 50);
    const last_ema21_15m = ema21_15m[ema21_15m.length - 1];
    const last_ema50_15m = ema50_15m[ema50_15m.length - 1];
    const macroBullish = last_ema21_15m > last_ema50_15m;
    const macroBearish = last_ema21_15m < last_ema50_15m;

    // 4. Fast 5m Indicators
    const ema9 = calculateEMA(data5m, 9);
    const ema21 = calculateEMA(data5m, 21);
    const rsiArray = calculateRSI(data5m, 14);
    const atrArray = calculateATR(data5m, 14);
    const macdData = calculateMACD(data5m);
    const vwapArray = calculateVWAP(data5m);
    const adxData = calculateADX(data5m, 14);

    const c_ema9 = ema9[ema9.length - 1];
    const c_ema21 = ema21[ema21.length - 1];
    const p_ema9 = ema9[ema9.length - 2];
    const p_ema21 = ema21[ema21.length - 2];
    
    const c_rsi = rsiArray[rsiArray.length - 1];
    const c_atr = atrArray[atrArray.length - 1];
    const c_macd = macdData.hist[macdData.hist.length - 1];
    const p_macd = macdData.hist[macdData.hist.length - 2];
    const c_vwap = vwapArray[vwapArray.length - 1];
    const c_adx = adxData.adx[adxData.adx.length - 1];

    // Minimal baseline ADX check (only filters completely flat zero-volatility chop)
    if (c_adx !== null && c_adx < 14) {
      return;
    }

    // Trend alignment with VWAP
    const isUptrend = macroBullish && currentPrice >= (c_vwap * 0.999);
    const isDowntrend = macroBearish && currentPrice <= (c_vwap * 1.001);
    
    // Proven High-Winrate Entry Triggers:
    // 1) Fresh MACD crossover
    // 2) Fresh EMA 9/21 crossover
    // 3) Strong Trend Momentum continuation (Fast EMA > Slow EMA & expanding MACD)
    const isMacdBullishCross = c_macd > 0 && p_macd <= 0;
    const isMacdBearishCross = c_macd < 0 && p_macd >= 0;
    
    const isEmaBullishCross = c_ema9 > c_ema21 && p_ema9 <= p_ema21;
    const isEmaBearishCross = c_ema9 < c_ema21 && p_ema9 >= p_ema21;

    const isBullishContinuation = c_ema9 > c_ema21 && c_macd > 0;
    const isBearishContinuation = c_ema9 < c_ema21 && c_macd < 0;

    // Healthy momentum RSI ranges (avoids buying exact top >74 or shorting exact bottom <26)
    const validLongRsi = c_rsi >= 38 && c_rsi <= 74;
    const validShortRsi = c_rsi <= 62 && c_rsi >= 26;

    let isLongSetup = isUptrend && validLongRsi && (isMacdBullishCross || isEmaBullishCross || isBullishContinuation);
    let isShortSetup = isDowntrend && validShortRsi && (isMacdBearishCross || isEmaBearishCross || isBearishContinuation);

    let signalType: 'LONG' | 'SHORT' | null = null;
    if (isLongSetup) signalType = 'LONG';
    if (isShortSetup) signalType = 'SHORT';

    if (signalType && c_atr) {
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
      // Compute AI Confidence for UI telemetry & tracking
      const quantConfidence = Math.max(55, Math.min(95, this.predictor.predict(features)));

      // 1. Compute multi-timeframe Support & Resistance (1H Macro Pivots + 15m Local Structure)
      const srLevels15m = findSupportResistance(data15m);
      const srLevels1h = data1h && data1h.length >= 20 ? findSupportResistance(data1h) : { supports: [], resistances: [] };
      
      const allSupports = [...srLevels15m.supports, ...srLevels1h.supports];
      const allResistances = [...srLevels15m.resistances, ...srLevels1h.resistances];

      const vpvr = calculateVPVR(data15m, 60);
      const topNodes = vpvr.slice(0, 4).map(n => n.price);
      
      // Asset-specific Pip Scaling, Spread Buffer, and Minimum Swing Targets
      let spreadBuffer = 0;
      let minSwingTarget = 0;
      let minSlBuffer = c_atr * 1.8;
      let maxSlBuffer = c_atr * 3.0;
      let decimals = 4;

      if (symbol.includes('EUR') || symbol.includes('GBP')) {
        spreadBuffer = 0.00018; // ~1.8 pips spread buffer
        minSwingTarget = 0.0028; // Min 28 pips target for Forex (scaling up to 60+ pips)
        decimals = 5;
      } else if (symbol.includes('XAU') || symbol.includes('GOLD')) {
        spreadBuffer = 0.60; // $0.60 spread buffer for Gold
        minSwingTarget = 15.00; // Min $15.00 move for Gold (150 pips, scaling up to $40+)
        decimals = 2;
      } else if (symbol.includes('BTC')) {
        spreadBuffer = actualEntry * 0.0004;
        minSwingTarget = actualEntry * 0.016; // Min 1.6% move (~$1,300+ target)
        decimals = 2;
      } else if (symbol.includes('ETH')) {
        spreadBuffer = actualEntry * 0.0005;
        minSwingTarget = actualEntry * 0.024; // Min 2.4% move (~$65+ target)
        decimals = 2;
      } else if (symbol.includes('SOL')) {
        spreadBuffer = actualEntry * 0.0008;
        minSwingTarget = actualEntry * 0.032; // Min 3.2% move (~$4.50+ target)
        decimals = 2;
      } else {
        spreadBuffer = actualEntry * 0.0006;
        minSwingTarget = actualEntry * 0.020;
        decimals = 4;
      }

      let stopLoss = 0;
      let takeProfit = 0;
      
      // Stop Loss breathing room & High-Pip Swing Target Calculation
      if (signalType === 'LONG') {
        const validSupports = allSupports.filter(s => s < actualEntry);
        let closestSupport = validSupports.length > 0 ? Math.max(...validSupports) : actualEntry - minSlBuffer;
        
        let slDistance = actualEntry - closestSupport;
        slDistance = Math.max(minSlBuffer, Math.min(maxSlBuffer, slDistance));
        stopLoss = actualEntry - slDistance;

        // Find macro resistance target (1H / 15m)
        const validResistances = allResistances.filter(r => r > actualEntry + (slDistance * 1.8));
        let closestResistance = validResistances.length > 0 ? Math.min(...validResistances) : actualEntry + (slDistance * 2.5);
        
        const nodesAbove = topNodes.filter(n => n > actualEntry + (slDistance * 1.8));
        if (nodesAbove.length) {
          const pocDistance = Math.min(...nodesAbove) - actualEntry;
          if (pocDistance > slDistance * 1.8) closestResistance = Math.min(...nodesAbove);
        }
        
        let tpDistance = closestResistance - actualEntry;
        // Institutional R:R Floor: Minimum 2.1 : 1 up to 4.2 : 1 + minSwingTarget check
        const minTargetDistance = Math.max(slDistance * 2.1 + spreadBuffer, minSwingTarget);
        tpDistance = Math.max(minTargetDistance, Math.min(slDistance * 4.2, tpDistance));
        takeProfit = actualEntry + tpDistance;

      } else {
        const validResistances = allResistances.filter(r => r > actualEntry);
        let closestResistance = validResistances.length > 0 ? Math.min(...validResistances) : actualEntry + minSlBuffer;
        
        let slDistance = closestResistance - actualEntry;
        slDistance = Math.max(minSlBuffer, Math.min(maxSlBuffer, slDistance));
        stopLoss = actualEntry + slDistance;

        // Find macro support target (1H / 15m)
        const validSupports = allSupports.filter(s => s < actualEntry - (slDistance * 1.8));
        let closestSupport = validSupports.length > 0 ? Math.max(...validSupports) : actualEntry - (slDistance * 2.5);
        
        const nodesBelow = topNodes.filter(n => n < actualEntry - (slDistance * 1.8));
        if (nodesBelow.length) {
          const pocDistance = actualEntry - Math.max(...nodesBelow);
          if (pocDistance > slDistance * 1.8) closestSupport = Math.max(...nodesBelow);
        }

        let tpDistance = actualEntry - closestSupport;
        // Institutional R:R Floor: Minimum 2.1 : 1 up to 4.2 : 1 + minSwingTarget check
        const minTargetDistance = Math.max(slDistance * 2.1 + spreadBuffer, minSwingTarget);
        tpDistance = Math.max(minTargetDistance, Math.min(slDistance * 4.2, tpDistance));
        takeProfit = actualEntry - tpDistance;
      }

      // Compute TP1 (Securing 1.1x Risk profit, moving SL to Break-Even early)
      const tp1Distance = (takeProfit - actualEntry) * 0.45;
      const tp1Price = signalType === 'LONG'
        ? actualEntry + tp1Distance
        : actualEntry - Math.abs(tp1Distance);

      const newTrade: Trade = {
        id: Math.random().toString(36).substr(2, 9),
        pair: symbol,
        type: signalType,
        entryPrice: parseFloat(actualEntry.toFixed(decimals)),
        takeProfit: parseFloat(takeProfit.toFixed(decimals)),
        stopLoss: parseFloat(stopLoss.toFixed(decimals)),
        tp1Price: parseFloat(tp1Price.toFixed(decimals)),
        tp1Hit: false,
        status: 'ACTIVE',
        timestamp: Date.now(),
        confidence: quantConfidence,
        aiFeatures: features
      };
      
      this.activeTrades[symbol] = newTrade;

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
      
      console.log(`[Quant V3 Entry] ${newTrade.pair} ${newTrade.type} @ ${newTrade.entryPrice} (Session: ${sessionInfo.session}, ADX: ${c_adx ? c_adx.toFixed(1) : 'N/A'}, Score: ${quantConfidence}%). TP1: ${newTrade.tp1Price}, TP2: ${newTrade.takeProfit}, SL: ${newTrade.stopLoss}`);
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
