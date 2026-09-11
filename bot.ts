import { fetchHistoricalKlines } from './src/lib/binance';
import { calculateEMA, calculateMACD, calculateRSI, calculateATR, calculateVWAP, findSupportResistance, calculateVPVR } from './src/lib/indicators';
import { DatabaseSync } from "node:sqlite";
import { Trade, Kline } from './src/types';
import WebSocket from 'ws';

export class TradingBot {
  private db: DatabaseSync;
  private ws: WebSocket | null = null;
  private data5m: Kline[] = [];
  private data15m: Kline[] = [];
  private isInitializing = true;
  private activeTrade: Trade | null = null;
  
  // Institutional Data
  private obImbalance: number = 0.5;
  private fundingRate: number = 0;
  private fundingInterval: NodeJS.Timeout | null = null;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async start() {
    console.log("Starting Quant V2 Trading Bot (OB Imbalance, Funding Rates, VPVR)...");
    
    this.data5m = await fetchHistoricalKlines('BTCUSDT', '5m', 150);
    this.data15m = await fetchHistoricalKlines('BTCUSDT', '15m', 150);
    
    await this.fetchFundingRate();
    this.fundingInterval = setInterval(() => this.fetchFundingRate(), 5 * 60 * 1000); // 5 mins
    
    this.isInitializing = false;
    this.connectWebsocket();
  }

  stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.fundingInterval) clearInterval(this.fundingInterval);
  }
  
  private async fetchFundingRate() {
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT');
      const data = await res.json();
      if (data && data.lastFundingRate) {
        this.fundingRate = parseFloat(data.lastFundingRate);
        console.log(`[Quant] Updated Funding Rate: ${(this.fundingRate * 100).toFixed(4)}%`);
      }
    } catch (e) {
      console.error("[Quant] Funding rate fetch error:", e);
    }
  }

  private connectWebsocket() {
    // Multi-stream: 5m, 15m, and depth10 for Order Book Imbalance
    const wsUrl = 'wss://stream.binance.com:9443/stream?streams=btcusdt@kline_5m/btcusdt@kline_15m/btcusdt@depth10@1000ms';
    this.ws = new WebSocket(wsUrl);
    
    this.ws.on('message', (data: string) => {
      if (this.isInitializing) return;
      
      try {
        const payload = JSON.parse(data);
        if (!payload || !payload.stream) return;
        
        if (payload.stream === 'btcusdt@depth10@1000ms') {
          const bids = payload.data.bids;
          const asks = payload.data.asks;
          let bidVol = 0; let askVol = 0;
          if (bids) bids.forEach((b: any[]) => bidVol += parseFloat(b[1]));
          if (asks) asks.forEach((a: any[]) => askVol += parseFloat(a[1]));
          if (bidVol + askVol > 0) {
            this.obImbalance = bidVol / (bidVol + askVol); // Ratio of buy pressure
          }
          return;
        }

        if (payload.data && payload.data.e === 'kline') {
          const kline = payload.data.k;
          const interval = kline.i; 
          
          const parsedKline: Kline = {
            time: kline.t,
            open: parseFloat(kline.o),
            high: parseFloat(kline.h),
            low: parseFloat(kline.l),
            close: parseFloat(kline.c),
            volume: parseFloat(kline.v),
          };

          if (interval === '5m') {
            this.updateDataArray(this.data5m, parsedKline);
            this.processTick(parsedKline.close);
          } else if (interval === '15m') {
            this.updateDataArray(this.data15m, parsedKline);
          }
        }
      } catch (err) {
        // Suppress parsing errors to keep console clean
      }
    });

    this.ws.on('close', () => {
      console.log("WS Disconnected. Reconnecting in 5s...");
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

  private processTick(currentPrice: number) {
    if (!this.activeTrade) {
      const stmt = this.db.prepare("SELECT * FROM trades WHERE status = 'ACTIVE' LIMIT 1");
      this.activeTrade = stmt.get() as Trade | undefined || null;
    }

    if (this.activeTrade) {
      let result: 'WON' | 'LOST' | null = null;
      if (this.activeTrade.type === 'LONG') {
        if (currentPrice >= this.activeTrade.takeProfit) result = 'WON';
        else if (currentPrice <= this.activeTrade.stopLoss) result = 'LOST';
      } else {
        if (currentPrice <= this.activeTrade.takeProfit) result = 'WON';
        else if (currentPrice >= this.activeTrade.stopLoss) result = 'LOST';
      }

      if (result) {
        const updateStmt = this.db.prepare("UPDATE trades SET status = ? WHERE id = ?");
        updateStmt.run(result, this.activeTrade.id);
        console.log(`Trade ${this.activeTrade.id} Closed: ${result} at ${currentPrice}`);
        this.activeTrade = null; 
      }
      return; 
    }

    if (this.data5m.length < 50 || this.data15m.length < 50) return;

    // Macro Trend (15m)
    const ema21_15m = calculateEMA(this.data15m, 21);
    const ema50_15m = calculateEMA(this.data15m, 50);
    const last_ema21_15m = ema21_15m[ema21_15m.length - 1];
    const last_ema50_15m = ema50_15m[ema50_15m.length - 1];
    const macroBullish = last_ema21_15m > last_ema50_15m;
    const macroBearish = last_ema21_15m < last_ema50_15m;

    // Micro Triggers (5m)
    const ema9 = calculateEMA(this.data5m, 9);
    const ema21 = calculateEMA(this.data5m, 21);
    const rsiArray = calculateRSI(this.data5m, 14);
    const atrArray = calculateATR(this.data5m, 14);
    const macdData = calculateMACD(this.data5m);
    const vwapArray = calculateVWAP(this.data5m);

    const current = this.data5m[this.data5m.length - 1];
    const prev = this.data5m[this.data5m.length - 2];
    
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
    
    // 1. Funding Rate Liquidation Hunt (Squeeze Filter)
    if (isLongSetup && this.fundingRate > 0.0005) {
      isLongSetup = false;
    }
    if (isShortSetup && this.fundingRate < -0.0005) {
      isShortSetup = false;
    }

    // 2. Order Book Imbalance Filter (Require > 45% pressure in our direction)
    if (isLongSetup && this.obImbalance < 0.45) { 
      isLongSetup = false;
    }
    if (isShortSetup && this.obImbalance > 0.55) { 
      isShortSetup = false;
    }

    let signalType = null;
    if (isLongSetup) signalType = 'LONG';
    if (isShortSetup) signalType = 'SHORT';

    if (signalType && c_atr) {
      const srLevels = findSupportResistance(this.data15m);
      
      // 3. VPVR (Volume Profile Visible Range) for Magnets
      const vpvr = calculateVPVR(this.data15m, 50);
      const topNodes = vpvr.slice(0, 3).map(n => n.price);

      let stopLoss = 0;
      let takeProfit = 0;

      if (signalType === 'LONG') {
        const validSupports = srLevels.supports.filter(s => s < currentPrice);
        let closestSupport = validSupports.length > 0 ? Math.max(...validSupports) : currentPrice - (c_atr * 2);
        
        let slDistance = currentPrice - closestSupport;
        slDistance = Math.max(200, Math.min(600, slDistance));
        stopLoss = currentPrice - slDistance;

        // VPVR Magnet for Take Profit
        const validResistances = srLevels.resistances.filter(r => r > currentPrice);
        let closestResistance = validResistances.length > 0 ? Math.min(...validResistances) : currentPrice + (slDistance * 2);
        
        const nodesAbove = topNodes.filter(n => n > currentPrice);
        if (nodesAbove.length) {
          const pocDistance = Math.min(...nodesAbove) - currentPrice;
          if (pocDistance > slDistance) closestResistance = Math.min(...nodesAbove); // Use VPVR POC
        }
        
        let tpDistance = closestResistance - currentPrice;
        tpDistance = Math.max(slDistance * 1.5, Math.min(slDistance * 3, tpDistance));
        takeProfit = currentPrice + tpDistance;
      } else {
        const validResistances = srLevels.resistances.filter(r => r > currentPrice);
        let closestResistance = validResistances.length > 0 ? Math.min(...validResistances) : currentPrice + (c_atr * 2);
        
        let slDistance = closestResistance - currentPrice;
        slDistance = Math.max(200, Math.min(600, slDistance));
        stopLoss = currentPrice + slDistance;

        const validSupports = srLevels.supports.filter(s => s < currentPrice);
        let closestSupport = validSupports.length > 0 ? Math.max(...validSupports) : currentPrice - (slDistance * 2);
        
        // VPVR Magnet for Take Profit
        const nodesBelow = topNodes.filter(n => n < currentPrice);
        if (nodesBelow.length) {
          const pocDistance = currentPrice - Math.max(...nodesBelow);
          if (pocDistance > slDistance) closestSupport = Math.max(...nodesBelow); // Use VPVR POC
        }

        let tpDistance = currentPrice - closestSupport;
        tpDistance = Math.max(slDistance * 1.5, Math.min(slDistance * 3, tpDistance));
        takeProfit = currentPrice - tpDistance;
      }

      this.activeTrade = {
        id: Math.random().toString(36).substr(2, 9),
        pair: 'BTCUSDT',
        type: signalType as 'LONG' | 'SHORT',
        entryPrice: parseFloat(currentPrice.toFixed(2)),
        takeProfit: parseFloat(takeProfit.toFixed(2)),
        stopLoss: parseFloat(stopLoss.toFixed(2)),
        status: 'ACTIVE',
        timestamp: Date.now(),
        confidence: 95,
      };

      const insertStmt = this.db.prepare(
        "INSERT INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      insertStmt.run(this.activeTrade.id, this.activeTrade.pair, this.activeTrade.type, this.activeTrade.entryPrice, this.activeTrade.takeProfit, this.activeTrade.stopLoss, this.activeTrade.status, this.activeTrade.timestamp, this.activeTrade.confidence);
      console.log(`[Quant V2] New Trade: ${this.activeTrade.type} @ ${this.activeTrade.entryPrice}. SL: ${this.activeTrade.stopLoss}, TP: ${this.activeTrade.takeProfit}`);
    }
  }
}
