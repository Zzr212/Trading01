import express from "express";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

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

// Fallback logic for Gemini to avoid rate limits or outages
async function callGeminiWithFallback(ai: GoogleGenAI, prompt: string, isJson = true) {
  const models = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"];
  let lastError: any = null;
  
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: isJson ? { responseMimeType: "application/json" } : undefined
      });
      return response.text;
    } catch (e: any) {
      console.warn(`Model ${model} failed: ${e.message}. Trying next...`);
      lastError = e;
    }
  }
  
  throw new Error(`All models failed. Last error: ${lastError?.message}`);
}

async function startServer() {
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

  app.post("/api/verify-key", async (req, res) => {
    const apiKey = req.headers.authorization?.replace("Bearer ", "");
    if (!apiKey) return res.status(401).json({ error: "No key" });
    try {
      const ai = new GoogleGenAI({ apiKey });
      await callGeminiWithFallback(ai, "Respond with exactly 'ok'.", false);
      res.json({ valid: true });
    } catch (e: any) {
      res.status(400).json({ valid: false, error: e.message || "Invalid key" });
    }
  });

  app.post("/api/analyze-sr", async (req, res) => {
    const apiKey = req.headers.authorization?.replace("Bearer ", "");
    if (!apiKey) return res.status(401).json({ error: "No key" });
    
    try {
      const ai = new GoogleGenAI({ apiKey });
      const { tf1h, tf15m, tf5m } = req.body;
      
      const prompt = `You are a master crypto analyst specializing in short-term scalping. 
      Analyze the following BTC/USDT price data from 3 short-term timeframes (1H, 15m, 5m).
      Identify the top 3 strongest Support levels and top 3 strongest Resistance levels relevant for immediate day-trading/scalping.
      
      1H Data (Last 30): ${JSON.stringify(tf1h)}
      15m Data (Last 30): ${JSON.stringify(tf15m)}
      5m Data (Last 30): ${JSON.stringify(tf5m)}
      
      Return ONLY a JSON object with:
      {
        "supports": [price1, price2, price3],
        "resistances": [price1, price2, price3]
      }`;

      const responseText = await callGeminiWithFallback(ai, prompt, true);
      let result = JSON.parse(responseText || '{}');
      res.json(result);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    const apiKey = req.headers.authorization?.replace("Bearer ", "");
    if (!apiKey) return res.status(401).json({ error: "No key" });
    
    try {
      const ai = new GoogleGenAI({ apiKey });
      const { type, currentPrice, ema9, ema21, rsi, recentCandles, srLevels } = req.body;
      
      const prompt = `You are an expert crypto technical analyst and scalper.
      The market for BTC/USDT has triggered a potential ${type} signal for a short-term trade.
      Current Price: ${currentPrice}
      EMA9: ${ema9}
      EMA21: ${ema21}
      RSI: ${rsi}
      Key Support/Resistance Levels: ${JSON.stringify(srLevels)}
      
      Recent price action (last 5 candles):
      ${JSON.stringify(recentCandles)}
      
      Analyze this data for a quick scalp. Only confirm if it's a high-probability trade (e.g. price is reacting well to a key local SR level).
      Return a JSON object with:
      {
        "trade": true|false,
        "type": "${type}",
        "entryPrice": <suggested entry price around current price>,
        "takeProfit": <suggested take profit for a scalp>,
        "stopLoss": <suggested tight stop loss>,
        "confidence": <integer 0-100>
      }
      Reply ONLY in valid JSON.`;

      const responseText = await callGeminiWithFallback(ai, prompt, true);
      let result = JSON.parse(responseText || '{}');
      res.json(result);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
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
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
