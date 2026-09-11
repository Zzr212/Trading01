import re

with open('server.ts', 'r') as f:
    content = f.read()

old_block = """  app.get("/api/reviews/:tradeId", (req, res) => {
    try {
      const stmt = db.prepare("SELECT candles FROM trade_reviews WHERE tradeId = ?");
      const row = stmt.get(req.params.tradeId) as any;
      if (row) {
        res.json({ success: true, candles: JSON.parse(row.candles) });
      } else {
        res.status(404).json({ error: "Review not found" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });"""

new_block = """  app.get("/api/reviews/:tradeId", async (req, res) => {
    try {
      const stmt = db.prepare("SELECT candles FROM trade_reviews WHERE tradeId = ?");
      const row = stmt.get(req.params.tradeId) as any;
      if (row) {
        res.json({ success: true, candles: JSON.parse(row.candles) });
      } else {
        // Try to fetch dynamically
        const tradeStmt = db.prepare("SELECT timestamp FROM trades WHERE id = ?");
        const trade = tradeStmt.get(req.params.tradeId) as any;
        if (trade) {
          const startTime = trade.timestamp - (10 * 60000);
          const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000&startTime=${startTime}`;
          const response = await fetch(url);
          const data = await response.json();
          if (Array.isArray(data)) {
            const candles = data.map((d: any) => ({
              time: d[0],
              open: parseFloat(d[1]),
              high: parseFloat(d[2]),
              low: parseFloat(d[3]),
              close: parseFloat(d[4]),
              volume: parseFloat(d[5]),
            }));
            
            const insertStmt = db.prepare("INSERT OR REPLACE INTO trade_reviews VALUES (?, ?)");
            insertStmt.run(req.params.tradeId, JSON.stringify(candles));
            
            res.json({ success: true, candles });
          } else {
            res.status(404).json({ error: "Review not found and could not fetch from Binance" });
          }
        } else {
          res.status(404).json({ error: "Trade not found" });
        }
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });"""

content = content.replace(old_block, new_block)

with open('server.ts', 'w') as f:
    f.write(content)
