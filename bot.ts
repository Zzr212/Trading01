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
export const CRYPTO_PAIRS = ['BTCUSD', 'ETHUSD', 'SOLUSD'];
export const MT5_SOURCE_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD'];

export const toBinanceSymbol = (p: string): string => {
  if (p.endsWith('USDT')) return p;
  if (p.endsWith('USD')) return `${p}T`;
  return `${p}USDT`;
};

export const fromBinanceSymbol = (s: string): string => {
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
  private lastProcessedCandleTime: Record<string, number> = {};
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
      this.lastProcessedCandleTime[p] = 0;
    });
  }

  public async start() {
    console.log("Fetching historical data (5m, 15m, 1h) for Crypto pairs (BTC, ETH, SOL)...");
    for (const p of CRYPTO_PAIRS) {
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
  }

  private connectWebsocket() {
    // Only subscribe to Crypto pairs on Binance (forex and gold feed directly from Vantage MT5)
    const streams = CRYPTO_PAIRS.map(p => {
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

        if (!CRYPTO_PAIRS.includes(symbol)) return;

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

          // 1. Manage active trade on EVERY tick
          this.manageActiveTrade(symbol, currentPrice);

          // 2. ONLY evaluate entering a new trade when 5m candle officially CLOSES (kline.x)
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

  // --- Vantage MT5 Real-Time Ingestion (Tick and Klines) ---
  public handleMT5Tick(symbol: string, bid: number, ask: number) {
    if (!symbol || !PAIRS.includes(symbol)) return;
    const currentPrice = (bid + ask) / 2;
    this.manageActiveTrade(symbol, currentPrice);
  }

  public handleMT5Klines(symbol: string, timeframe: string, klines: Kline[]) {
    if (!symbol || !PAIRS.includes(symbol) || !Array.isArray(klines) || klines.length === 0) return;

    if (timeframe === '5m') {
      klines.forEach(k => this.updateDataArray(this.data5m[symbol], k));
      const latest = this.data5m[symbol][this.data5m[symbol].length - 1];
      if (latest) {
        this.manageActiveTrade(symbol, latest.close);
        this.evaluateNewTrade(symbol, latest.close);
      }
    } else if (timeframe === '15m') {
      klines.forEach(k => this.updateDataArray(this.data15m[symbol], k));
    } else if (timeframe === '1h') {
      klines.forEach(k => this.updateDataArray(this.data1h[symbol], k));
    }
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

  // Manage Active Trade: Dynamic TP1 (1R partial profit), Break-Even, Trailing Stop (1.5R - 2R), and TP
  private manageActiveTrade(symbol: string, currentPrice: number) {
    const activeTrade = this.activeTrades[symbol];
    if (!activeTrade) return;

    const initialRisk = Math.abs(activeTrade.entryPrice - activeTrade.stopLoss);
    if (initialRisk <= 0) return;

    // --- 1. DYNAMIC TP1 PARTIAL PROFIT & BREAK-EVEN CHECK (1R) ---
    if (!activeTrade.tp1Hit && activeTrade.tp1Price) {
      const isLong = activeTrade.type === 'LONG';
      const profitDistance = isLong ? currentPrice - activeTrade.entryPrice : activeTrade.entryPrice - currentPrice;
      
      // When price reaches 1R profit: lock in TP1 and move SL to entry (Break-Even)
      if (profitDistance >= initialRisk) {
        activeTrade.tp1Hit = true;
        activeTrade.stopLoss = activeTrade.entryPrice;
        try {
          this.db.prepare("UPDATE trades SET tp1Hit = 1, stopLoss = ? WHERE id = ?")
            .run(activeTrade.stopLoss, activeTrade.id);
          console.log(`🎯 [TP1 Secured (1R)] ${symbol} ${activeTrade.type}: 50% Profit Locked @ $${currentPrice}! SL moved to Break-Even ($${activeTrade.entryPrice})`);
        } catch (e) {
          console.error("Failed to update TP1 state:", e);
        }
      }
    }

    // --- 2. TRAILING STOP STAGES (1.5R and 2.0R) ---
    if (activeTrade.tp1Hit) {
      const isLong = activeTrade.type === 'LONG';
      const profitDistance = isLong ? currentPrice - activeTrade.entryPrice : activeTrade.entryPrice - currentPrice;
      const decimals = (symbol.includes('EUR') || symbol.includes('GBP')) ? 5 : (symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('XAU') || symbol.includes('GOLD')) ? 2 : 4;

      if (isLong) {
        // Stage 1: At 1.5R profit -> Move SL to +0.5R profit
        if (profitDistance >= initialRisk * 1.5 && activeTrade.stopLoss < (activeTrade.entryPrice + initialRisk * 0.5)) {
          activeTrade.stopLoss = parseFloat((activeTrade.entryPrice + initialRisk * 0.5).toFixed(decimals));
          this.db.prepare("UPDATE trades SET stopLoss = ? WHERE id = ?").run(activeTrade.stopLoss, activeTrade.id);
          console.log(`[SL Trailed to +0.5R] ${symbol} LONG: SL moved to $${activeTrade.stopLoss}`);
        }
        // Stage 2: Above 2.0R profit -> Trailing stop follows 0.5R behind current price
        if (profitDistance >= initialRisk * 2.0) {
          const desiredSL = parseFloat((currentPrice - initialRisk * 0.5).toFixed(decimals));
          const maxAllowedLongSL = Math.min(currentPrice * 0.999, activeTrade.takeProfit * 0.999);
          const safeSL = parseFloat(Math.min(desiredSL, maxAllowedLongSL).toFixed(decimals));
          if (safeSL > activeTrade.stopLoss && safeSL < currentPrice) {
            activeTrade.stopLoss = safeSL;
            this.db.prepare("UPDATE trades SET stopLoss = ? WHERE id = ?").run(activeTrade.stopLoss, activeTrade.id);
            console.log(`[Trailing SL Follow 0.5R] ${symbol} LONG: Trailed to $${activeTrade.stopLoss}`);
          }
        }
      } else { // SHORT
        // Stage 1: At 1.5R profit -> Move SL to +0.5R profit
        if (profitDistance >= initialRisk * 1.5 && activeTrade.stopLoss > (activeTrade.entryPrice - initialRisk * 0.5)) {
          activeTrade.stopLoss = parseFloat((activeTrade.entryPrice - initialRisk * 0.5).toFixed(decimals));
          this.db.prepare("UPDATE trades SET stopLoss = ? WHERE id = ?").run(activeTrade.stopLoss, activeTrade.id);
          console.log(`[SL Trailed to +0.5R] ${symbol} SHORT: SL moved to $${activeTrade.stopLoss}`);
        }
        // Stage 2: Above 2.0R profit -> Trailing stop follows 0.5R behind current price
        if (profitDistance >= initialRisk * 2.0) {
          const desiredSL = parseFloat((currentPrice + initialRisk * 0.5).toFixed(decimals));
          const minAllowedShortSL = Math.max(currentPrice * 1.001, activeTrade.takeProfit * 1.001);
          const safeSL = parseFloat(Math.max(desiredSL, minAllowedShortSL).toFixed(decimals));
          if (safeSL < activeTrade.stopLoss && safeSL > currentPrice) {
            activeTrade.stopLoss = safeSL;
            this.db.prepare("UPDATE trades SET stopLoss = ? WHERE id = ?").run(activeTrade.stopLoss, activeTrade.id);
            console.log(`[Trailing SL Follow 0.5R] ${symbol} SHORT: Trailed to $${activeTrade.stopLoss}`);
          }
        }
      }
    }

    // --- 3. EXIT CONDITION EVALUATION ---
    let result: 'WON' | 'LOST' | null = null;
    let exitReason = '';

    if (activeTrade.type === 'LONG') {
      if (currentPrice >= activeTrade.takeProfit) {
        result = 'WON';
        exitReason = 'TAKE_PROFIT';
      } else if (currentPrice <= activeTrade.stopLoss) {
        result = activeTrade.tp1Hit ? 'WON' : 'LOST';
        exitReason = activeTrade.tp1Hit ? 'TP1_THEN_BREAKEVEN' : 'STOP_LOSS';
      }
    } else { // SHORT
      if (currentPrice <= activeTrade.takeProfit) {
        result = 'WON';
        exitReason = 'TAKE_PROFIT';
      } else if (currentPrice >= activeTrade.stopLoss) {
        result = activeTrade.tp1Hit ? 'WON' : 'LOST';
        exitReason = activeTrade.tp1Hit ? 'TP1_THEN_BREAKEVEN' : 'STOP_LOSS';
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

  // Evaluates a new trade ONLY when a 5m candle closes
  private evaluateNewTrade(symbol: string, currentPrice: number) {
    if (this.activeTrades[symbol]) return;

    const data5m = this.data5m[symbol];
    const data15m = this.data15m[symbol];
    const data1h = this.data1h[symbol];
    
    if (data5m.length < 50 || data15m.length < 50) return;

    // 0. Double-Signal Check on Same Candle
    const candleTime = data5m[data5m.length - 1].time;
    if (this.lastProcessedCandleTime[symbol] === candleTime) return;
    this.lastProcessedCandleTime[symbol] = candleTime;

    // Market Open / Weekend Schedule Guard
    const marketStatus = getMarketStatus(symbol);
    if (!marketStatus.isOpen) {
      return;
    }

    // 1. Loss Cooldown Check
    const cooldownUntil = this.pairCooldowns[symbol] || 0;
    if (Date.now() < cooldownUntil) {
      return;
    }

    // 2. SMART MULTI-ASSET EXPOSURE & CORRELATION SHIELD
    const activeList = Object.values(this.activeTrades).filter(t => t !== null);
    if (activeList.length >= 4) {
      return; // Absolute max portfolio exposure reached
    }

    const isCrypto = symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('SOL');
    const isForex = symbol.includes('EUR') || symbol.includes('GBP');
    const isGold = symbol.includes('XAU') || symbol.includes('PAXG') || symbol.includes('GOLD');

    const activeClassTrades = activeList.filter(t => {
      if (!t) return false;
      const tSymbol = t.pair || '';
      if (isCrypto && (tSymbol.includes('BTC') || tSymbol.includes('ETH') || tSymbol.includes('SOL'))) return true;
      if (isForex && (tSymbol.includes('EUR') || tSymbol.includes('GBP'))) return true;
      if (isGold && (tSymbol.includes('XAU') || tSymbol.includes('PAXG') || tSymbol.includes('GOLD'))) return true;
      return false;
    });

    if (isCrypto && activeClassTrades.length >= 2) return;
    if (isForex && activeClassTrades.length >= 2) return;
    if (isGold && activeClassTrades.length >= 1) return;

    const sessionInfo = getTradingSessionInfo();

    // 3. Macro Trend (15m timeframe)
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

    // Priority 2.3: Upgraded ADX Trend Strength Filter (ADX >= 20)
    if (c_adx !== null && c_adx < 20) {
      return;
    }

    // Trend alignment with VWAP
    const isUptrend = macroBullish && currentPrice >= (c_vwap * 0.999);
    const isDowntrend = macroBearish && currentPrice <= (c_vwap * 1.001);
    
    // Priority 2.4: Fresh Crossover Requirement (no stale continuous triggers)
    const isFreshMacdBullCross = c_macd > 0 && p_macd <= 0;
    const isFreshMacdBearCross = c_macd < 0 && p_macd >= 0;
    const isFreshEmaBullCross = c_ema9 > c_ema21 && p_ema9 <= p_ema21;
    const isFreshEmaBearCross = c_ema9 < c_ema21 && p_ema9 >= p_ema21;

    // Priority 2.2: Tightened, Higher-Quality RSI Windows (45-65 for LONG, 35-55 for SHORT)
    const validLongRsi = c_rsi >= 45 && c_rsi <= 65;
    const validShortRsi = c_rsi <= 55 && c_rsi >= 35;

    const isLongSetup = isUptrend && validLongRsi && (isFreshMacdBullCross || isFreshEmaBullCross);
    const isShortSetup = isDowntrend && validShortRsi && (isFreshMacdBearCross || isFreshEmaBearCross);

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
        minSwingTarget = 0.0028; // Min 28 pips target for Forex
        decimals = 5;
      } else if (symbol.includes('XAU') || symbol.includes('GOLD')) {
        spreadBuffer = 0.60; // $0.60 spread buffer for Gold
        minSwingTarget = 15.00; // Min $15.00 move for Gold
        decimals = 2;
      } else if (symbol.includes('BTC')) {
        spreadBuffer = actualEntry * 0.0004;
        minSwingTarget = actualEntry * 0.016; // Min 1.6% move
        decimals = 2;
      } else if (symbol.includes('ETH')) {
        spreadBuffer = actualEntry * 0.0005;
        minSwingTarget = actualEntry * 0.024;
        decimals = 2;
      } else if (symbol.includes('SOL')) {
        spreadBuffer = actualEntry * 0.0008;
        minSwingTarget = actualEntry * 0.032;
        decimals = 2;
      } else {
        spreadBuffer = actualEntry * 0.0006;
        minSwingTarget = actualEntry * 0.020;
        decimals = 4;
      }

      let stopLoss = 0;
      let takeProfit = 0;
      
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

        // Priority 2.5: Real S/R Target Validation & Strict 5x Cap Check
        if (tpDistance > slDistance * 5.0) {
          console.log(`[Skip] ${symbol}: TP target is too far from S/R (${(tpDistance/slDistance).toFixed(1)}R)`);
          return;
        }

        const minTargetDistance = Math.max(slDistance * 2.1 + spreadBuffer, minSwingTarget);
        tpDistance = Math.max(minTargetDistance, Math.min(slDistance * 5.0, tpDistance));
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

        // Priority 2.5: Real S/R Target Validation & Strict 5x Cap Check
        if (tpDistance > slDistance * 5.0) {
          console.log(`[Skip] ${symbol}: TP target is too far from S/R (${(tpDistance/slDistance).toFixed(1)}R)`);
          return;
        }

        const minTargetDistance = Math.max(slDistance * 2.1 + spreadBuffer, minSwingTarget);
        tpDistance = Math.max(minTargetDistance, Math.min(slDistance * 5.0, tpDistance));
        takeProfit = actualEntry - tpDistance;
      }

      // Compute TP1 at 1.0x Risk distance (Securing 50% partial profit & moving SL to BE)
      const riskDistance = Math.abs(actualEntry - stopLoss);
      const tp1Price = signalType === 'LONG' 
        ? actualEntry + riskDistance 
        : actualEntry - riskDistance;

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
      
      const rrRatio = Math.abs(finalTp - finalEntry) / Math.max(0.00001, Math.abs(finalEntry - finalSl));
      console.log(`[Quant Trade Opened] ${newTrade.pair} ${newTrade.type} @ ${newTrade.entryPrice} | Initial SL: ${newTrade.stopLoss} | TP1 (1R): ${newTrade.tp1Price} | Full TP: ${newTrade.takeProfit} (R:R: ${rrRatio.toFixed(2)}:1, Score: ${quantConfidence}%)`);
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
      cryptoPairs: CRYPTO_PAIRS,
      mt5Pairs: MT5_SOURCE_PAIRS,
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
      aiModel: this.predictor.getStatus(),
      uptimeSeconds: Math.floor(process.uptime()),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    };
  }
}

