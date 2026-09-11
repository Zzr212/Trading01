import { fetchHistoricalKlines } from './src/lib/binance';
import { calculateEMA, calculateMACD, calculateRSI, calculateATR, calculateVWAP } from './src/lib/indicators';
import { DatabaseSync } from "node:sqlite";
import { Trade } from './src/types';

export class TradingBot {
  private db: DatabaseSync;
  private intervalId: NodeJS.Timeout | null = null;
  private analyzing: boolean = false;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  start() {
    console.log("Starting Algorithmic Trading Bot...");
    // Run every 10 seconds
    this.intervalId = setInterval(() => this.tick(), 10000);
    this.tick();
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private async tick() {
    if (this.analyzing) return;
    this.analyzing = true;

    try {
      // 1. Fetch latest data (e.g. 5m timeframe)
      const data = await fetchHistoricalKlines('BTCUSDT', '5m', 100);
      if (data.length < 50) return;

      const currentPrice = data[data.length - 1].close;

      // 2. Check if we have an active trade
      const stmt = this.db.prepare("SELECT * FROM trades WHERE status = 'ACTIVE' LIMIT 1");
      const activeTrade = stmt.get() as Trade | undefined;

      if (activeTrade) {
        // Evaluate SL/TP
        let result: 'WON' | 'LOST' | null = null;
        if (activeTrade.type === 'LONG') {
          if (currentPrice >= activeTrade.takeProfit) result = 'WON';
          else if (currentPrice <= activeTrade.stopLoss) result = 'LOST';
        } else {
          if (currentPrice <= activeTrade.takeProfit) result = 'WON';
          else if (currentPrice >= activeTrade.stopLoss) result = 'LOST';
        }

        if (result) {
          const updateStmt = this.db.prepare("UPDATE trades SET status = ? WHERE id = ?");
          updateStmt.run(result, activeTrade.id);
          console.log(`Trade ${activeTrade.id} Closed: ${result} at ${currentPrice}`);
        }
      } else {
        // 3. Run algorithm to find new entry
        // Calculate indicators
        const ema9 = calculateEMA(data, 9);
        const ema21 = calculateEMA(data, 21);
        const rsiArray = calculateRSI(data, 14);
        const atrArray = calculateATR(data, 14);
        const macdData = calculateMACD(data);
        const vwapArray = calculateVWAP(data);

        const current = data[data.length - 1];
        const prev = data[data.length - 2];
        const c_ema9 = ema9[ema9.length - 1];
        const c_ema21 = ema21[ema21.length - 1];
        const p_ema9 = ema9[ema9.length - 2];
        const p_ema21 = ema21[ema21.length - 2];
        const c_rsi = rsiArray[rsiArray.length - 1];
        const c_atr = atrArray[atrArray.length - 1];
        const c_macd = macdData.hist[macdData.hist.length - 1];
        const p_macd = macdData.hist[macdData.hist.length - 2];
        const c_vwap = vwapArray[vwapArray.length - 1];

        // Advanced Algorithm: VWAP + EMA Cross + RSI
        const isUptrend = current.close > c_vwap && c_ema9 > c_ema21;
        const isDowntrend = current.close < c_vwap && c_ema9 < c_ema21;
        
        // Momentum crossover
        const freshLongMomentum = (c_macd > 0 && p_macd <= 0) || (c_ema9 > c_ema21 && p_ema9 <= p_ema21);
        const freshShortMomentum = (c_macd < 0 && p_macd >= 0) || (c_ema9 < c_ema21 && p_ema9 >= p_ema21);

        const isLongSetup = isUptrend && freshLongMomentum && c_rsi > 40 && c_rsi < 65;
        const isShortSetup = isDowntrend && freshShortMomentum && c_rsi < 60 && c_rsi > 35;

        let signalType = null;
        if (isLongSetup) signalType = 'LONG';
        if (isShortSetup) signalType = 'SHORT';

        if (signalType && c_atr) {
          // Dynamic Risk calculation (1:2 R:R) with strict 200 - 600 pips constraints
          // For BTC, 1 pip is typically $1.
          // SL base is 1.5 * ATR
          let baseSLDistance = c_atr * 1.5;
          
          // Clamp SL between $200 and $600 (Requirement: razmak 200 do 600 pips)
          const slDistance = Math.max(200, Math.min(600, baseSLDistance));
          
          // TP is strictly set at 2x SL, but we also clamp it within reasonable limits 
          // (User said "trejdove da daje samo u razmaku od 200pips i 600pips" - this could mean TP/SL distance is strict)
          // Let's cap TP to max 600 as well, or base it strictly on 200-600.
          const tpDistance = Math.max(400, Math.min(600, slDistance * 2)); // e.g. SL=200->TP=400. SL=300->TP=600.

          let stopLoss, takeProfit;
          if (signalType === 'LONG') {
            stopLoss = currentPrice - slDistance;
            takeProfit = currentPrice + tpDistance;
          } else {
            stopLoss = currentPrice + slDistance;
            takeProfit = currentPrice - tpDistance;
          }

          const trade: Trade = {
            id: Math.random().toString(36).substr(2, 9),
            pair: 'BTCUSDT',
            type: signalType as 'LONG' | 'SHORT',
            entryPrice: parseFloat(currentPrice.toFixed(2)),
            takeProfit: parseFloat(takeProfit.toFixed(2)),
            stopLoss: parseFloat(stopLoss.toFixed(2)),
            status: 'ACTIVE',
            timestamp: Date.now(),
            confidence: 90,
          };

          const insertStmt = this.db.prepare(
            "INSERT INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
          );
          insertStmt.run(trade.id, trade.pair, trade.type, trade.entryPrice, trade.takeProfit, trade.stopLoss, trade.status, trade.timestamp, trade.confidence);
          console.log(`New Algorithmic Trade Executed: ${trade.type} at ${trade.entryPrice}. SL: ${trade.stopLoss}, TP: ${trade.takeProfit}`);
        }
      }

    } catch (e) {
      console.error("Bot Error:", e);
    } finally {
      this.analyzing = false;
    }
  }
}
