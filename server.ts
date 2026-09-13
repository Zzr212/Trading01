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
  tp1Price REAL,
  tp1Hit INTEGER,
  status TEXT,
  timestamp INTEGER,
  closeTimestamp INTEGER,
  confidence INTEGER,
  exitReason TEXT,
  aiFeatures TEXT
)`);

try {
  db.exec("ALTER TABLE trades ADD COLUMN aiFeatures TEXT;");
} catch(e) {}

try {
  db.exec("ALTER TABLE trades ADD COLUMN closeTimestamp INTEGER;");
} catch(e) {}

try {
  db.exec("ALTER TABLE trades ADD COLUMN tp1Price REAL;");
} catch(e) {}

try {
  db.exec("ALTER TABLE trades ADD COLUMN tp1Hit INTEGER;");
} catch(e) {}

try {
  db.exec("ALTER TABLE trades ADD COLUMN exitReason TEXT;");
} catch(e) {}

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

  // System Diagnostics & Health Check
  app.get("/api/system-health", (req, res) => {
    try {
      const startDb = Date.now();
      const countRow = db.prepare("SELECT COUNT(*) as count FROM trades").get() as any;
      const dbLatencyMs = Date.now() - startDb;
      
      const botDiagnostics = bot.getDiagnostics();
      
      res.json({
        timestamp: Date.now(),
        serverUptime: Math.floor(process.uptime()),
        database: {
          status: 'CONNECTED',
          type: 'SQLite3 (Sync)',
          latencyMs: dbLatencyMs,
          totalTrades: countRow ? countRow.count : 0
        },
        ...botDiagnostics
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API Routes
  app.get("/api/stats", (req, res) => {
    try {
      const stmt = db.prepare("SELECT pair, status, COUNT(*) as count FROM trades GROUP BY pair, status");
      const rows = stmt.all() as any[];
      
      const stats: Record<string, { won: number, lost: number, active: number }> = {};
      
      rows.forEach(r => {
        if (!stats[r.pair]) stats[r.pair] = { won: 0, lost: 0, active: 0 };
        if (r.status === 'WON') stats[r.pair].won = r.count;
        if (r.status === 'LOST') stats[r.pair].lost = r.count;
        if (r.status === 'ACTIVE') stats[r.pair].active = r.count;
      });
      
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

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

  app.get("/api/reviews/:tradeId", async (req, res) => {
    try {
      const stmt = db.prepare("SELECT candles FROM trade_reviews WHERE tradeId = ?");
      const row = stmt.get(req.params.tradeId) as any;
      if (row) {
        res.json({ success: true, candles: JSON.parse(row.candles) });
      } else {
        // Try to fetch dynamically
        const tradeStmt = db.prepare("SELECT timestamp, pair FROM trades WHERE id = ?");
        const trade = tradeStmt.get(req.params.tradeId) as any;
        if (trade) {
          const startTime = trade.timestamp - (10 * 60000);
          const url = `https://api.binance.com/api/v3/klines?symbol=${trade.pair}&interval=1m&limit=1000&startTime=${startTime}`;
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
      if (req.path.startsWith("/assets/") || req.path.match(/\.(js|css|map|png|svg|ico)$/)) {
        return res.status(404).send("Not found");
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
