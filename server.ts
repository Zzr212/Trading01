import express from "express";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { createServer as createViteServer } from "vite";
import { TradingBot } from './bot';


const db = new DatabaseSync("./trades.db");

db.exec(`CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  pair TEXT,
  type TEXT,
  entryPrice REAL,
  takeProfit REAL,
  stopLoss REAL,
  status TEXT,
  timestamp INTEGER,
  confidence INTEGER
)`);

db.exec(`CREATE TABLE IF NOT EXISTS trade_reviews (
  tradeId TEXT PRIMARY KEY,
  candles TEXT
)`);

async function startServer() {
  const bot = new TradingBot(db);
  bot.start();

  const app = express();
  const PORT = 3000;
  
  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get("/api/trades", (req, res) => {
    try {
      const stmt = db.prepare("SELECT * FROM trades ORDER BY timestamp DESC");
      const rows = stmt.all();
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/trades", (req, res) => {
    const t = req.body;
    try {
      const stmt = db.prepare(
        "INSERT INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      stmt.run(t.id, t.pair, t.type, t.entryPrice, t.takeProfit, t.stopLoss, t.status, t.timestamp, t.confidence);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/trades/:id", (req, res) => {
    const { status } = req.body;
    try {
      const stmt = db.prepare("UPDATE trades SET status = ? WHERE id = ?");
      stmt.run(status, req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/reviews/:tradeId", (req, res) => {
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
  });

  app.delete("/api/reset", (req, res) => {
    try {
      db.exec("DELETE FROM trades");
      db.exec("DELETE FROM trade_reviews");
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/reviews", (req, res) => {
    const { tradeId, candles } = req.body;
    try {
      const stmt = db.prepare("INSERT OR REPLACE INTO trade_reviews VALUES (?, ?)");
      stmt.run(tradeId, JSON.stringify(candles));
      
      // Keep only reviews for the last 50 trades
      db.exec(`
        DELETE FROM trade_reviews WHERE tradeId NOT IN (
          SELECT id FROM trades ORDER BY timestamp DESC LIMIT 50
        )
      `);
      
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
