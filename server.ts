import express from "express";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { createServer as createViteServer } from "vite";
import { TradingBot } from './bot';
import { DEFAULT_MT5_CONFIG, generateMql5EACode, MT5Config, MT5Heartbeat } from './src/mt5_bridge';
import { startCloudflareTunnel, getTunnelUrl } from './src/tunnel';


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

db.exec(`CREATE TABLE IF NOT EXISTS mt5_settings (
  id TEXT PRIMARY KEY,
  config TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS mt5_state (
  id TEXT PRIMARY KEY,
  lastHeartbeat INTEGER,
  accountNumber TEXT,
  broker TEXT,
  balance REAL,
  equity REAL,
  margin REAL,
  freeMargin REAL,
  openPositionsCount INTEGER
)`);

// Seed default MT5 settings if not present
try {
  const existingConfig = db.prepare("SELECT config FROM mt5_settings WHERE id = 'main'").get() as any;
  if (!existingConfig) {
    db.prepare("INSERT INTO mt5_settings (id, config) VALUES ('main', ?)").run(JSON.stringify(DEFAULT_MT5_CONFIG));
  }
} catch(e) {}

async function startServer() {
  const bot = new TradingBot(db);
  bot.start();

  const app = express();
  const PORT = 3000;
  
  // Resilient body parser for MT5 WebRequest (handles trailing \0 null bytes and raw text safely)
  app.use((req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json') || contentType.includes('text/plain')) {
      let rawData = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { rawData += chunk; });
      req.on('end', () => {
        try {
          const clean = rawData.replace(/\0/g, '').trim();
          req.body = clean ? JSON.parse(clean) : {};
        } catch (_) {
          req.body = {};
        }
        next();
      });
    } else {
      next();
    }
  });
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
        const pair = r.pair && r.pair.endsWith('USDT') ? r.pair.slice(0, -1) : r.pair;
        if (!stats[pair]) stats[pair] = { won: 0, lost: 0, active: 0 };
        if (r.status === 'WON') stats[pair].won += r.count;
        if (r.status === 'LOST') stats[pair].lost += r.count;
        if (r.status === 'ACTIVE') stats[pair].active += r.count;
      });
      
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/trades", (req, res) => {
    try {
      const stmt = db.prepare("SELECT * FROM trades ORDER BY timestamp DESC");
      const rows = stmt.all() as any[];
      const normalized = rows.map(r => ({
        ...r,
        pair: r.pair && r.pair.endsWith('USDT') ? r.pair.slice(0, -1) : r.pair
      }));
      res.json(normalized);
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

  // ==========================================
  // METATRADER 5 (MT5) BRIDGE API ENDPOINTS
  // ==========================================

  // 1. Get MT5 Configuration & Connection Status
  app.get("/api/mt5/config", (req, res) => {
    try {
      const row = db.prepare("SELECT config FROM mt5_settings WHERE id = 'main'").get() as any;
      const stateRow = db.prepare("SELECT * FROM mt5_state WHERE id = 'main'").get() as any;
      
      const config: MT5Config = row ? JSON.parse(row.config) : DEFAULT_MT5_CONFIG;
      const isConnected = stateRow && (Date.now() - stateRow.lastHeartbeat < 30000); // 30s timeout

      // Auto-detect server base url if not set
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
      const currentOrigin = `${protocol}://${host}`;
      const liveTunnel = getTunnelUrl();
      const configuredUrl = config.serverUrl && config.serverUrl.trim() !== '' ? config.serverUrl.trim() : null;
      const resolvedServerUrl = configuredUrl || (currentOrigin.includes('run.app') ? (liveTunnel || currentOrigin) : currentOrigin);

      res.json({
        config: {
          ...config,
          serverUrl: resolvedServerUrl
        },
        tunnelUrl: liveTunnel,
        status: {
          connected: !!isConnected,
          lastHeartbeat: stateRow ? stateRow.lastHeartbeat : 0,
          accountNumber: stateRow ? stateRow.accountNumber : null,
          broker: stateRow ? stateRow.broker : null,
          balance: stateRow ? stateRow.balance : 0,
          equity: stateRow ? stateRow.equity : 0,
          margin: stateRow ? stateRow.margin : 0,
          freeMargin: stateRow ? stateRow.freeMargin : 0,
          openPositionsCount: stateRow ? stateRow.openPositionsCount : 0
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Save MT5 Configuration (Lots, Mappings, etc.)
  app.post("/api/mt5/config", (req, res) => {
    try {
      const newConfig = req.body;
      const stmt = db.prepare("INSERT OR REPLACE INTO mt5_settings (id, config) VALUES ('main', ?)");
      stmt.run(JSON.stringify(newConfig));
      res.json({ success: true, config: newConfig });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2b. Check Public Tunnel Status
  app.get("/api/mt5/tunnel", (req, res) => {
    const liveTunnel = getTunnelUrl();
    res.json({
      tunnelUrl: liveTunnel,
      active: !!liveTunnel
    });
  });

  // 3. Polling Endpoint for MQL5 Expert Advisor
  // Returns active trades that need to be opened/trailed, and closed trades that need to be exited
  app.get("/api/mt5/poll", (req, res) => {
    try {
      const configRow = db.prepare("SELECT config FROM mt5_settings WHERE id = 'main'").get() as any;
      const config: MT5Config = configRow ? JSON.parse(configRow.config) : DEFAULT_MT5_CONFIG;

      // Active trades in bot
      const activeRows = db.prepare("SELECT * FROM trades WHERE status = 'ACTIVE'").all() as any[];
      
      // Closed trades in the last 2 hours (to ensure MT5 closes any matching positions)
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      const closedRows = db.prepare("SELECT id FROM trades WHERE status IN ('WON', 'LOST') AND closeTimestamp >= ?").all(twoHoursAgo) as any[];

      const activeTradesPayload = activeRows.map(t => {
        const cleanPair = t.pair && t.pair.endsWith('USDT') ? t.pair.slice(0, -1) : t.pair;
        const mt5Symbol = config.symbolMappings[cleanPair] || config.symbolMappings[t.pair] || cleanPair;
        const lotSize = config.lotSizes[cleanPair] || config.lotSizes[t.pair] || 0.01;
        return {
          id: t.id,
          symbol: cleanPair,
          mt5Symbol: mt5Symbol,
          type: t.type, // 'LONG' or 'SHORT'
          entryPrice: t.entryPrice,
          stopLoss: t.stopLoss,
          takeProfit: t.takeProfit,
          tp1Price: t.tp1Price,
          tp1Hit: !!t.tp1Hit,
          lotSize: lotSize,
          timestamp: t.timestamp
        };
      });

      res.json({
        success: true,
        serverTime: Date.now(),
        activeTrades: activeTradesPayload,
        closedTrades: closedRows.map(r => r.id)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Heartbeat from MT5 Expert Advisor (Terminal Telemetry - supports both POST and GET)
  const handleHeartbeat = (req: any, res: any) => {
    try {
      const hb = (req.method === 'GET' ? req.query : req.body) || {};
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO mt5_state (
          id, lastHeartbeat, accountNumber, broker, balance, equity, margin, freeMargin, openPositionsCount
        ) VALUES ('main', ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        Date.now(),
        hb.accountNumber ? String(hb.accountNumber) : "Unknown",
        hb.broker ? String(hb.broker) : "Vantage",
        parseFloat(hb.balance) || 0,
        parseFloat(hb.equity) || 0,
        parseFloat(hb.margin) || 0,
        parseFloat(hb.freeMargin) || 0,
        parseInt(hb.openPositionsCount) || 0
      );
      res.json({ success: true, acknowledged: true, connected: true, serverTime: Date.now() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  app.post("/api/mt5/heartbeat", handleHeartbeat);
  app.get("/api/mt5/heartbeat", handleHeartbeat);

  // 5. Download / Fetch Generated MQL5 EA Code
  app.get("/api/mt5/ea-code", (req, res) => {
    try {
      const configRow = db.prepare("SELECT config FROM mt5_settings WHERE id = 'main'").get() as any;
      const config: MT5Config = configRow ? JSON.parse(configRow.config) : DEFAULT_MT5_CONFIG;
      const liveTunnel = getTunnelUrl();
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
      const currentOrigin = `${protocol}://${host}`;
      const configuredUrl = config.serverUrl && config.serverUrl.trim() !== '' ? config.serverUrl.trim() : null;
      const origin = configuredUrl || (currentOrigin.includes('run.app') ? (liveTunnel || currentOrigin) : currentOrigin);
      
      const eaSource = generateMql5EACode(origin);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(eaSource);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/mt5/download-ea", (req, res) => {
    try {
      const configRow = db.prepare("SELECT config FROM mt5_settings WHERE id = 'main'").get() as any;
      const config: MT5Config = configRow ? JSON.parse(configRow.config) : DEFAULT_MT5_CONFIG;
      const liveTunnel = getTunnelUrl();
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
      const currentOrigin = `${protocol}://${host}`;
      const configuredUrl = config.serverUrl && config.serverUrl.trim() !== '' ? config.serverUrl.trim() : null;
      const origin = configuredUrl || (currentOrigin.includes('run.app') ? (liveTunnel || currentOrigin) : currentOrigin);
      
      const eaSource = generateMql5EACode(origin);
      res.setHeader('Content-Disposition', 'attachment; filename="AITrader_MT5_Bridge.mq5"');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(eaSource);
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
    startCloudflareTunnel(PORT).catch(err => {
      console.error("[Server] Tunnel startup error:", err?.message || err);
    });
  });
}

startServer();
