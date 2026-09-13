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

// 6 Top-Tier Liquid Crypto Pairs (Replaced illiquid EURUSDT and PAXGUSDT with BNBUSDT and DOGEUSDT)
export const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];

export class TradingBot {
  private ws!: WebSocket;
  private db: DatabaseSync;
  
  private data5m: Record<string, Kline[]> = {};
  private data15m: Record<string, Kline[]> = {};
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
      this.activeTrades[p] = null;
      this.pairCooldowns[p] = 0;
      this.fundingRates[p] = 0; // Default neutral
      this.obImbalances[p] = 0.5; // Default neutral
    });
  }

  public async start() {
    console.log("Fetching historical data for all pairs...");
    for (const p of PAIRS) {
      try {
        this.data5m[p] = await fetchHistoricalKlines(p, '5m', 150);
        this.data15m[p] = await fetchHistoricalKlines(p, '15m', 150);
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
          const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${p}`);
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
    const streams = PAIRS.map(p => `${p.toLowerCase()}@depth10@100ms`).join('/');
    const obWs = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    
    obWs.on('message', (data: Buffer) => {
      try {
        const payload = JSON.parse(data.toString());
        if (!payload.data || !payload.data.bids || !payload.data.asks) return;
        const symbol = payload.data.s; // e.g., BTCUSDT
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
    const streams = PAIRS.map(p => `${p.toLowerCase()}@kline_5m/${p.toLowerCase()}@kline_15m`).join('/');
    this.ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

    this.ws.on('message', (data: Buffer) => {
      try {
        const payload = JSON.parse(data.toString());
        if (!payload.data || !payload.data.k) return;
        
        const symbol = payload.data.s;
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

      // Trailing Stop if profit reaches 75% of TP
      if (tpDistance > 0 && profitDistance >= tpDistance * 0.75) {
        const trailedSL = parseFloat((currentPrice - (initialRisk * 0.5)).toFixed(4));
        if (trailedSL > activeTrade.stopLoss) {
          activeTrade.stopLoss = trailedSL;
          this.db.prepare("UPDATE trades SET stopLoss = ? WHERE id = ?").run(activeTrade.stopLoss, activeTrade.id);
          console.log(`[Trailing SL Activated] ${symbol} LONG: Stop Loss trailed to $${activeTrade.stopLoss}`);
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

      // Trailing Stop if profit reaches 75% of TP
      if (tpDistance > 0 && profitDistance >= tpDistance * 0.75) {
        const trailedSL = parseFloat((currentPrice + (initialRisk * 0.5)).toFixed(4));
        if (trailedSL < activeTrade.stopLoss) {
          activeTrade.stopLoss = trailedSL;
          this.db.prepare("UPDATE trades SET stopLoss = ? WHERE id = ?").run(activeTrade.stopLoss, activeTrade.id);
          console.log(`[Trailing SL Activated] ${symbol} SHORT: Stop Loss trailed to $${activeTrade.stopLoss}`);
        }
      }
    }
  }

  // Evaluates a new trade ONLY when a 5m candle closes
  private evaluateNewTrade(symbol: string, currentPrice: number) {
    if (this.activeTrades[symbol]) return;

    // 1. Loss Cooldown Check
    const cooldownUntil = this.pairCooldowns[symbol] || 0;
    if (Date.now() < cooldownUntil) {
      return;
    }

    // 2. Global Exposure & Correlation Limit: Max 2 active trades across entire bot
    const openTradesCount = Object.values(this.activeTrades).filter(t => t !== null).length;
    if (openTradesCount >= 2) {
      return; // Reject 3rd trade to prevent concentrated portfolio risk
    }

    const data5m = this.data5m[symbol];
    const data15m = this.data15m[symbol];
    
    if (data5m.length < 50 || data15m.length < 50) return;

    // 3. BTC MASTER TREND GUARD (Crypto Benchmark)
    // If evaluating an altcoin (ETH, SOL, BNB, XRP, DOGE), align with Bitcoin macro trend
    let btcBullish = true;
    if (symbol !== 'BTCUSDT') {
      const btc15m = this.data15m['BTCUSDT'];
      if (btc15m && btc15m.length >= 30) {
        const btcEma21 = calculateEMA(btc15m, 21);
        const lastBtcEma21 = btcEma21[btcEma21.length - 1];
        const lastBtcClose = btc15m[btc15m.length - 1].close;
        btcBullish = lastBtcClose >= lastBtcEma21;
      }
    }

    // 4. VOLUME SPIKE & EXHAUSTION FILTER
    // Avoid entering at the tip of institutional liquidity grabs / exhaustion climaxes
    const volExhaustion = detectVolumeExhaustion(data5m, 20);

    // 5. SESSION & TIME FILTER
    const sessionInfo = getTradingSessionInfo();

    // Macro Trend (15m timeframe)
    const ema21_15m = calculateEMA(data15m, 21);
    const ema50_15m = calculateEMA(data15m, 50);
    const last_ema21_15m = ema21_15m[ema21_15m.length - 1];
    const last_ema50_15m = ema50_15m[ema50_15m.length - 1];
    const macroBullish = last_ema21_15m > last_ema50_15m && currentPrice > last_ema21_15m;
    const macroBearish = last_ema21_15m < last_ema50_15m && currentPrice < last_ema21_15m;

    // 5m Indicators
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
    const c_pDi = adxData.pDi[adxData.pDi.length - 1];
    const c_mDi = adxData.mDi[adxData.mDi.length - 1];

    // Dynamic ADX requirement based on current trading session
    const requiredAdx = sessionInfo.minAdxThreshold;
    if (c_adx === null || c_adx < requiredAdx) {
      return;
    }

    const isUptrend = macroBullish && currentPrice > c_vwap && c_pDi > c_mDi;
    const isDowntrend = macroBearish && currentPrice < c_vwap && c_mDi > c_pDi;
    
    const isMacdBullishCross = c_macd > 0 && p_macd <= 0;
    const isMacdBearishCross = c_macd < 0 && p_macd >= 0;
    
    const isEmaBullishCross = c_ema9 > c_ema21 && p_ema9 <= p_ema21;
    const isEmaBearishCross = c_ema9 < c_ema21 && p_ema9 >= p_ema21;

    // Filter extreme overbought/oversold
    const validLongRsi = c_rsi > 42 && c_rsi < 68;
    const validShortRsi = c_rsi < 58 && c_rsi > 32;

    let isLongSetup = isUptrend && validLongRsi && (isMacdBullishCross || isEmaBullishCross);
    let isShortSetup = isDowntrend && validShortRsi && (isMacdBearishCross || isEmaBearishCross);

    // Apply BTC Master Guard: Never buy an altcoin if BTC is Bearish, never short if BTC is Bullish
    if (symbol !== 'BTCUSDT') {
      if (isLongSetup && !btcBullish) {
        console.log(`[BTC Guard] ${symbol} LONG setup blocked because BTC is Bearish.`);
        isLongSetup = false;
      }
      if (isShortSetup && btcBullish) {
        console.log(`[BTC Guard] ${symbol} SHORT setup blocked because BTC is Bullish.`);
        isShortSetup = false;
      }
    }

    // Apply Volume Exhaustion Guard: Don't buy bull exhaustion wicks or short bear exhaustion wicks
    if (isLongSetup && volExhaustion.isExhaustion && volExhaustion.exhaustionDirection === 'BULL_EXHAUSTION') {
      console.log(`[Volume Exhaustion Guard] ${symbol} LONG blocked: Institutional upper wick rejection detected.`);
      isLongSetup = false;
    }
    if (isShortSetup && volExhaustion.isExhaustion && volExhaustion.exhaustionDirection === 'BEAR_EXHAUSTION') {
      console.log(`[Volume Exhaustion Guard] ${symbol} SHORT blocked: Institutional lower wick bounce detected.`);
      isShortSetup = false;
    }

    // --- INSTITUTIONAL QUANT FILTERS ---
    const fundingRate = this.fundingRates[symbol] || 0;
    const obImbalance = this.obImbalances[symbol] || 0.5;
    
    if (isLongSetup && fundingRate > 0.0005) isLongSetup = false;
    if (isShortSetup && fundingRate < -0.0005) isShortSetup = false;
    
    if (isLongSetup && obImbalance < 0.46) isLongSetup = false;
    if (isShortSetup && obImbalance > 0.54) isShortSetup = false;

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
        c_adx,
        symbol === 'BTCUSDT' ? 1 : (btcBullish === (signalType === 'LONG') ? 1 : 0)
      ];
      const quantConfidence = this.predictor.predict(features);

      // Session-sensitive Confluence threshold
      const minConfidence = sessionInfo.isHighLiquidity ? 48 : 58;
      if (quantConfidence < minConfidence) return;

      const srLevels = findSupportResistance(data15m);
      const vpvr = calculateVPVR(data15m, 50);
      const topNodes = vpvr.slice(0, 3).map(n => n.price);
      
      let stopLoss = 0;
      let takeProfit = 0;
      
      // Stop Loss breathing room: 1.5x to 3.2x ATR
      if (signalType === 'LONG') {
        const validSupports = srLevels.supports.filter(s => s < actualEntry);
        let closestSupport = validSupports.length > 0 ? Math.max(...validSupports) : actualEntry - (c_atr * 2);
        
        let slDistance = actualEntry - closestSupport;
        slDistance = Math.max(c_atr * 1.5, Math.min(c_atr * 3.2, slDistance));
        stopLoss = actualEntry - slDistance;

        const validResistances = srLevels.resistances.filter(r => r > actualEntry);
        let closestResistance = validResistances.length > 0 ? Math.min(...validResistances) : actualEntry + (slDistance * 2);
        
        const nodesAbove = topNodes.filter(n => n > actualEntry);
        if (nodesAbove.length) {
          const pocDistance = Math.min(...nodesAbove) - actualEntry;
          if (pocDistance > slDistance) closestResistance = Math.min(...nodesAbove);
        }
        
        let tpDistance = closestResistance - actualEntry;
        const minProfitable = actualEntry * 0.0035;
        tpDistance = Math.max(slDistance * 1.6, Math.max(minProfitable, Math.min(slDistance * 3.5, tpDistance)));
        takeProfit = actualEntry + tpDistance;

      } else {
        const validResistances = srLevels.resistances.filter(r => r > actualEntry);
        let closestResistance = validResistances.length > 0 ? Math.min(...validResistances) : actualEntry + (c_atr * 2);
        
        let slDistance = closestResistance - actualEntry;
        slDistance = Math.max(c_atr * 1.5, Math.min(c_atr * 3.2, slDistance));
        stopLoss = actualEntry + slDistance;

        const validSupports = srLevels.supports.filter(s => s < actualEntry);
        let closestSupport = validSupports.length > 0 ? Math.max(...validSupports) : actualEntry - (slDistance * 2);
        
        const nodesBelow = topNodes.filter(n => n < actualEntry);
        if (nodesBelow.length) {
          const pocDistance = actualEntry - Math.max(...nodesBelow);
          if (pocDistance > slDistance) closestSupport = Math.max(...nodesBelow);
        }

        let tpDistance = actualEntry - closestSupport;
        const minProfitable = actualEntry * 0.0035;
        tpDistance = Math.max(slDistance * 1.6, Math.max(minProfitable, Math.min(slDistance * 3.5, tpDistance)));
        takeProfit = actualEntry - tpDistance;
      }

      // Compute TP1 (First partial target: 50% distance to full TP, securing 1R profit)
      const tp1Price = signalType === 'LONG'
        ? actualEntry + ((takeProfit - actualEntry) * 0.5)
        : actualEntry - ((actualEntry - takeProfit) * 0.5);

      const newTrade: Trade = {
        id: Math.random().toString(36).substr(2, 9),
        pair: symbol,
        type: signalType,
        entryPrice: parseFloat(actualEntry.toFixed(4)),
        takeProfit: parseFloat(takeProfit.toFixed(4)),
        stopLoss: parseFloat(stopLoss.toFixed(4)),
        tp1Price: parseFloat(tp1Price.toFixed(4)),
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
      
      console.log(`[Quant V3 Entry] ${newTrade.pair} ${newTrade.type} @ ${newTrade.entryPrice} (Session: ${sessionInfo.session}, ADX: ${c_adx.toFixed(1)}, Score: ${quantConfidence}%). TP1: ${newTrade.tp1Price}, TP2: ${newTrade.takeProfit}, SL: ${newTrade.stopLoss}`);
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

    return {
      botStatus: 'ONLINE',
      wsStatus: wsConnected ? 'CONNECTED' : 'CONNECTING',
      tradingSession: sessionInfo.session,
      sessionHighLiquidity: sessionInfo.isHighLiquidity,
      monitoredPairs: PAIRS,
      maxConcurrentTrades: 2,
      activeTradesCount: activeTradesList.length,
      activeTrades: activeTradesList,
      cooldowns: activeCooldowns,
      fundingRates: this.fundingRates,
      orderBookImbalances: this.obImbalances,
      aiModel: this.predictor.getStatus(),
      uptimeSeconds: Math.floor(process.uptime()),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    };
  }
}
