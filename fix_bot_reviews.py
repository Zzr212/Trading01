import re

with open('bot.ts', 'r') as f:
    content = f.read()

old_block = """      if (result) {
        const updateStmt = this.db.prepare("UPDATE trades SET status = ? WHERE id = ?");
        updateStmt.run(result, this.activeTrade.id);
        console.log(`Trade ${this.activeTrade.id} Closed: ${result} at ${currentPrice}`);
        this.activeTrade = null; 
      }"""

new_block = """      if (result) {
        const updateStmt = this.db.prepare("UPDATE trades SET status = ? WHERE id = ?");
        updateStmt.run(result, this.activeTrade.id);
        console.log(`Trade ${this.activeTrade.id} Closed: ${result} at ${currentPrice}`);
        
        // Save Trade Review Asynchronously (10 candles before entry)
        const closedTradeId = this.activeTrade.id;
        const startTime = this.activeTrade.timestamp - (10 * 60000); // 10 minutes prior for 10x 1m candles
        fetchHistoricalKlines('BTCUSDT', '1m', 1000, Date.now(), startTime).then(reviewCandles => {
          try {
            const stmt = this.db.prepare("INSERT OR REPLACE INTO trade_reviews VALUES (?, ?)");
            stmt.run(closedTradeId, JSON.stringify(reviewCandles));
            console.log(`Saved review for trade ${closedTradeId} with ${reviewCandles.length} candles.`);
          } catch (err) {
            console.error("Failed to save review:", err);
          }
        });

        this.activeTrade = null; 
      }"""

content = content.replace(old_block, new_block)

with open('bot.ts', 'w') as f:
    f.write(content)
