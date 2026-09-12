import WebSocket from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { Trade, Kline, SRLevels } from './src/types';
import { calculateEMA, calculateRSI, calculateATR, calculateMACD, calculateVWAP } from './src/lib/indicators';
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

export const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'EURUSDT', 'PAXGUSDT'];

export class TradingBot {
  private ws!: WebSocket;
  private db: DatabaseSync;
  
  private data5m: Record<string, Kline[]> = {};
  private data15m: Record<string, Kline[]> = {};
  private activeTrades: Record<string, Trade | null> = {};
  
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
      if (PAIRS.includes(r.pair)) {
        this.activeTrades[r.pair] = r;
      }
    });

    this.connectWebsocket();
    this.startFundingMonitor();
    this.startOrderBookMonitor();
  }

  private startFundingMonitor() {
    // Only poll funding rate for standard crypto pairs on futures
    const futuresPairs = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
    setInterval(async () => {
      for (const p of futuresPairs) {
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
          if (kline.x) { // only process tick on closed candle or just continuously, let's do continuously to manage SL/TP
            this.processTick(symbol, currentPrice);
          } else {
             // Always process tick to hit SL/TP
             this.processTick(symbol, currentPrice);
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

  private processTick(symbol: string, currentPrice: number) {
    const activeTrade = this.activeTrades[symbol];
    if (activeTrade) {
      let result: 'WON' | 'LOST' | null = null;
      if (activeTrade.type === 'LONG') {
        if (currentPrice >= activeTrade.takeProfit) result = 'WON';
        else if (currentPrice <= activeTrade.stopLoss) result = 'LOST';
      } else {
        if (currentPrice <= activeTrade.takeProfit) result = 'WON';
        else if (currentPrice >= activeTrade.stopLoss) result = 'LOST';
      }
      
      if (result) {
        const updateStmt = this.db.prepare("UPDATE trades SET status = ?, closeTimestamp = ? WHERE id = ?");
        updateStmt.run(result, Date.now(), activeTrade.id);
        console.log(`Trade ${activeTrade.id} (${symbol}) Closed: ${result} at ${currentPrice}`);
        
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
      }
      return; 
    }

    const data5m = this.data5m[symbol];
    const data15m = this.data15m[symbol];
    
    if (data5m.length < 50 || data15m.length < 50) return;

    const ema21_15m = calculateEMA(data15m, 21);
    const ema50_15m = calculateEMA(data15m, 50);
    const last_ema21_15m = ema21_15m[ema21_15m.length - 1];
    const last_ema50_15m = ema50_15m[ema50_15m.length - 1];
    const macroBullish = last_ema21_15m > last_ema50_15m && currentPrice > last_ema21_15m;
    const macroBearish = last_ema21_15m < last_ema50_15m && currentPrice < last_ema21_15m;

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
    
    const c_rsi = rsiArray[rsiArray.length - 1];
    const c_atr = atrArray[atrArray.length - 1];
    const c_macd = macdData.hist[macdData.hist.length - 1];
    const p_macd = macdData.hist[macdData.hist.length - 2];
    const c_vwap = vwapArray[vwapArray.length - 1];

    const isUptrend = macroBullish && currentPrice > c_vwap;
    const isDowntrend = macroBearish && currentPrice < c_vwap;
    
    const isMacdBullishCross = c_macd > 0 && p_macd <= 0;
    const isMacdBearishCross = c_macd < 0 && p_macd >= 0;
    
    const isEmaBullishCross = c_ema9 > c_ema21 && p_ema9 <= p_ema21;
    const isEmaBearishCross = c_ema9 < c_ema21 && p_ema9 >= p_ema21;

    const validLongRsi = c_rsi > 40 && c_rsi < 70;
    const validShortRsi = c_rsi < 60 && c_rsi > 30;

    let isLongSetup = isUptrend && validLongRsi && (isMacdBullishCross || isEmaBullishCross);
    let isShortSetup = isDowntrend && validShortRsi && (isMacdBearishCross || isEmaBearishCross);

    // --- INSTITUTIONAL QUANT FILTERS ---
    const fundingRate = this.fundingRates[symbol];
    const obImbalance = this.obImbalances[symbol];
    
    if (isLongSetup && fundingRate > 0.0005) isLongSetup = false;
    if (isShortSetup && fundingRate < -0.0005) isShortSetup = false;
    
    if (isLongSetup && obImbalance < 0.45) isLongSetup = false;
    if (isShortSetup && obImbalance > 0.55) isShortSetup = false;

    let signalType = null;
    if (isLongSetup) signalType = 'LONG';
    if (isShortSetup) signalType = 'SHORT';

    if (signalType && c_atr) {
      // SLIPPAGE SIMULATION (0.05%)
      const slippage = 0.0005;
      const actualEntry = signalType === 'LONG' ? currentPrice * (1 + slippage) : currentPrice * (1 - slippage);
      
      const features = [c_rsi, c_macd, currentPrice - c_ema9, currentPrice - c_ema21, signalType === 'LONG' ? 1 : 0, macroBullish ? 1 : 0];
      const aiConfidence = this.predictor.predict(features);

      // Require AI confidence to be > 40 to enter trade, otherwise skip
      if (aiConfidence < 40) return;

      const srLevels = findSupportResistance(data15m);
      const vpvr = calculateVPVR(data15m, 50);
      const topNodes = vpvr.slice(0, 3).map(n => n.price);
      
      let stopLoss = 0;
      let takeProfit = 0;
      
      // Dynamic spacing based on pair price to make reasonable SL/TP distances
      // A generic approach: use ATR heavily instead of fixed 200/600 constraints
      if (signalType === 'LONG') {
        const validSupports = srLevels.supports.filter(s => s < actualEntry);
        let closestSupport = validSupports.length > 0 ? Math.max(...validSupports) : actualEntry - (c_atr * 2);
        
        let slDistance = actualEntry - closestSupport;
        slDistance = Math.max(c_atr, Math.min(c_atr * 3, slDistance)); // Dynamic constraint
        stopLoss = actualEntry - slDistance;

        const validResistances = srLevels.resistances.filter(r => r > actualEntry);
        let closestResistance = validResistances.length > 0 ? Math.min(...validResistances) : actualEntry + (slDistance * 2);
        
        const nodesAbove = topNodes.filter(n => n > actualEntry);
        if (nodesAbove.length) {
          const pocDistance = Math.min(...nodesAbove) - actualEntry;
          if (pocDistance > slDistance) closestResistance = Math.min(...nodesAbove);
        }
        
        let tpDistance = closestResistance - actualEntry;
        const minProfitable = actualEntry * 0.0025; tpDistance = Math.max(slDistance * 1.5, Math.max(minProfitable, Math.min(slDistance * 3, tpDistance)));
        takeProfit = actualEntry + tpDistance;

      } else {
        const validResistances = srLevels.resistances.filter(r => r > actualEntry);
        let closestResistance = validResistances.length > 0 ? Math.min(...validResistances) : actualEntry + (c_atr * 2);
        
        let slDistance = closestResistance - actualEntry;
        slDistance = Math.max(c_atr, Math.min(c_atr * 3, slDistance));
        stopLoss = actualEntry + slDistance;

        const validSupports = srLevels.supports.filter(s => s < actualEntry);
        let closestSupport = validSupports.length > 0 ? Math.max(...validSupports) : actualEntry - (slDistance * 2);
        
        const nodesBelow = topNodes.filter(n => n < actualEntry);
        if (nodesBelow.length) {
          const pocDistance = actualEntry - Math.max(...nodesBelow);
          if (pocDistance > slDistance) closestSupport = Math.max(...nodesBelow);
        }

        let tpDistance = actualEntry - closestSupport;
        const minProfitable = actualEntry * 0.0025; tpDistance = Math.max(slDistance * 1.5, Math.max(minProfitable, Math.min(slDistance * 3, tpDistance)));
        takeProfit = actualEntry - tpDistance;
      }

      const newTrade: Trade = {
        id: Math.random().toString(36).substr(2, 9),
        pair: symbol,
        type: signalType as 'LONG' | 'SHORT',
        entryPrice: parseFloat(actualEntry.toFixed(4)),
        takeProfit: parseFloat(takeProfit.toFixed(4)),
        stopLoss: parseFloat(stopLoss.toFixed(4)),
        status: 'ACTIVE',
        timestamp: Date.now(),
        confidence: aiConfidence,
        aiFeatures: features
      };
      
      this.activeTrades[symbol] = newTrade;

      const insertStmt = this.db.prepare(
        "INSERT INTO trades (id, pair, type, entryPrice, takeProfit, stopLoss, status, timestamp, confidence, aiFeatures) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      insertStmt.run(newTrade.id, newTrade.pair, newTrade.type, newTrade.entryPrice, newTrade.takeProfit, newTrade.stopLoss, newTrade.status, newTrade.timestamp, newTrade.confidence, JSON.stringify(newTrade.aiFeatures));
      
      console.log(`[Quant V2] New Trade: ${newTrade.pair} ${newTrade.type} @ ${newTrade.entryPrice}. SL: ${newTrade.stopLoss}, TP: ${newTrade.takeProfit}`);
    }
  }
}
