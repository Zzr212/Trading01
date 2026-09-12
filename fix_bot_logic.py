import re

with open('bot.ts', 'r') as f:
    content = f.read()

# 1. Imports
content = content.replace("import { fetchHistoricalKlines } from './src/lib/binance';", 
                          "import { fetchHistoricalKlines } from './src/lib/binance';\nimport { TradePredictor } from './src/lib/ai';")

# 2. Add Predictor to TradingBot
content = content.replace("private obImbalances: Record<string, number> = {};",
                          "private obImbalances: Record<string, number> = {};\n  private predictor: TradePredictor;")

content = content.replace("constructor(db: DatabaseSync) {",
                          "constructor(db: DatabaseSync) {\n    this.predictor = new TradePredictor();")

# 3. Update Trade Resolution to include AI training
old_close = '''      if (result) {
        const updateStmt = this.db.prepare("UPDATE trades SET status = ?, closeTimestamp = ? WHERE id = ?");
        updateStmt.run(result, Date.now(), activeTrade.id);
        console.log(`Trade ${activeTrade.id} (${symbol}) Closed: ${result} at ${currentPrice}`);'''

new_close = '''      if (result) {
        const updateStmt = this.db.prepare("UPDATE trades SET status = ?, closeTimestamp = ? WHERE id = ?");
        updateStmt.run(result, Date.now(), activeTrade.id);
        console.log(`Trade ${activeTrade.id} (${symbol}) Closed: ${result} at ${currentPrice}`);
        
        if (activeTrade.aiFeatures) {
          this.predictor.recordResultAndTrain(activeTrade.aiFeatures, result);
        }'''

content = content.replace(old_close, new_close)

# 4. Enhance 15m logic (MTFA)
content = content.replace("const macroBullish = last_ema21_15m > last_ema50_15m;",
                          "const macroBullish = last_ema21_15m > last_ema50_15m && currentPrice > last_ema21_15m;")
content = content.replace("const macroBearish = last_ema21_15m < last_ema50_15m;",
                          "const macroBearish = last_ema21_15m < last_ema50_15m && currentPrice < last_ema21_15m;")

# 5. Add AI prediction and Slippage when opening trade
# Find: if (signalType && c_atr) {
old_signal_block = '''    if (signalType && c_atr) {
      const srLevels = findSupportResistance(data15m);'''

new_signal_block = '''    if (signalType && c_atr) {
      // SLIPPAGE SIMULATION (0.05%)
      const slippage = 0.0005;
      const actualEntry = signalType === 'LONG' ? currentPrice * (1 + slippage) : currentPrice * (1 - slippage);
      
      const features = [c_rsi, c_macd, currentPrice - c_ema9, currentPrice - c_ema21, signalType === 'LONG' ? 1 : 0, macroBullish ? 1 : 0];
      const aiConfidence = this.predictor.predict(features);

      // Require AI confidence to be > 40 to enter trade, otherwise skip
      if (aiConfidence < 40) return;

      const srLevels = findSupportResistance(data15m);'''
      
content = content.replace(old_signal_block, new_signal_block)

# 6. Update stop loss / take profit calculations to use actualEntry instead of currentPrice
# Wait, it's safer to just replace currentPrice with actualEntry in the SL/TP block
old_sl_tp_block = '''      if (signalType === 'LONG') {
        const validSupports = srLevels.supports.filter(s => s < currentPrice);
        let closestSupport = validSupports.length > 0 ? Math.max(...validSupports) : currentPrice - (c_atr * 2);
        
        let slDistance = currentPrice - closestSupport;
        slDistance = Math.max(c_atr, Math.min(c_atr * 3, slDistance)); // Dynamic constraint
        stopLoss = currentPrice - slDistance;

        const validResistances = srLevels.resistances.filter(r => r > currentPrice);
        let closestResistance = validResistances.length > 0 ? Math.min(...validResistances) : currentPrice + (slDistance * 2);
        
        const nodesAbove = topNodes.filter(n => n > currentPrice);
        if (nodesAbove.length) {
          const pocDistance = Math.min(...nodesAbove) - currentPrice;
          if (pocDistance > slDistance) closestResistance = Math.min(...nodesAbove);
        }
        
        let tpDistance = closestResistance - currentPrice;
        tpDistance = Math.max(slDistance * 1.5, Math.min(slDistance * 3, tpDistance));
        takeProfit = currentPrice + tpDistance;
      } else {
        const validResistances = srLevels.resistances.filter(r => r > currentPrice);
        let closestResistance = validResistances.length > 0 ? Math.min(...validResistances) : currentPrice + (c_atr * 2);
        
        let slDistance = closestResistance - currentPrice;
        slDistance = Math.max(c_atr, Math.min(c_atr * 3, slDistance));
        stopLoss = currentPrice + slDistance;

        const validSupports = srLevels.supports.filter(s => s < currentPrice);
        let closestSupport = validSupports.length > 0 ? Math.max(...validSupports) : currentPrice - (slDistance * 2);
        
        const nodesBelow = topNodes.filter(n => n < currentPrice);
        if (nodesBelow.length) {
          const pocDistance = currentPrice - Math.max(...nodesBelow);
          if (pocDistance > slDistance) closestSupport = Math.max(...nodesBelow);
        }
        
        let tpDistance = currentPrice - closestSupport;
        tpDistance = Math.max(slDistance * 1.5, Math.min(slDistance * 3, tpDistance));
        takeProfit = currentPrice - tpDistance;
      }

      const newTrade: Trade = {
        id: Math.random().toString(36).substr(2, 9),
        pair: symbol,
        type: signalType as 'LONG' | 'SHORT',
        entryPrice: parseFloat(currentPrice.toFixed(4)),
        takeProfit: parseFloat(takeProfit.toFixed(4)),
        stopLoss: parseFloat(stopLoss.toFixed(4)),
        status: 'ACTIVE',
        timestamp: Date.now(),
        confidence: 95,
      };'''

new_sl_tp_block = '''      if (signalType === 'LONG') {
        const validSupports = srLevels.supports.filter(s => s < actualEntry);
        let closestSupport = validSupports.length > 0 ? Math.max(...validSupports) : actualEntry - (c_atr * 2);
        
        let slDistance = actualEntry - closestSupport;
        slDistance = Math.max(c_atr, Math.min(c_atr * 3, slDistance)); 
        stopLoss = actualEntry - slDistance;

        const validResistances = srLevels.resistances.filter(r => r > actualEntry);
        let closestResistance = validResistances.length > 0 ? Math.min(...validResistances) : actualEntry + (slDistance * 2);
        
        const nodesAbove = topNodes.filter(n => n > actualEntry);
        if (nodesAbove.length) {
          const pocDistance = Math.min(...nodesAbove) - actualEntry;
          if (pocDistance > slDistance) closestResistance = Math.min(...nodesAbove);
        }
        
        let tpDistance = closestResistance - actualEntry;
        
        // Ensure TP accounts for 0.1% taker fee on entry and exit (approx 0.2% total)
        // so we don't set a TP that is too tight to be profitable.
        const minProfitableDistance = actualEntry * 0.0025; 
        tpDistance = Math.max(slDistance * 1.5, Math.max(minProfitableDistance, Math.min(slDistance * 3, tpDistance)));
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
        const minProfitableDistance = actualEntry * 0.0025;
        tpDistance = Math.max(slDistance * 1.5, Math.max(minProfitableDistance, Math.min(slDistance * 3, tpDistance)));
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
      };'''

content = content.replace(old_sl_tp_block, new_sl_tp_block)

# 7. Update INSERT query to include aiFeatures (JSON stringified)
old_insert = '''      const insertStmt = this.db.prepare(
        "INSERT INTO trades (id, pair, type, entryPrice, takeProfit, stopLoss, status, timestamp, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      insertStmt.run(newTrade.id, newTrade.pair, newTrade.type, newTrade.entryPrice, newTrade.takeProfit, newTrade.stopLoss, newTrade.status, newTrade.timestamp, newTrade.confidence);'''

new_insert = '''      const insertStmt = this.db.prepare(
        "INSERT INTO trades (id, pair, type, entryPrice, takeProfit, stopLoss, status, timestamp, confidence, aiFeatures) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      insertStmt.run(newTrade.id, newTrade.pair, newTrade.type, newTrade.entryPrice, newTrade.takeProfit, newTrade.stopLoss, newTrade.status, newTrade.timestamp, newTrade.confidence, JSON.stringify(newTrade.aiFeatures));'''

content = content.replace(old_insert, new_insert)

with open('bot.ts', 'w') as f:
    f.write(content)
