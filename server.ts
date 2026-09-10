import express from "express";
import path from "path";
import sqlite3 from "sqlite3";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const db = new sqlite3.Database("./trades.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS trades (
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
});

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  app.use(express.json());

  // API Routes
  app.get("/api/trades", (req, res) => {
    db.all("SELECT * FROM trades ORDER BY timestamp DESC", (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.post("/api/trades", (req, res) => {
    const t = req.body;
    db.run(
      "INSERT INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [t.id, t.pair, t.type, t.entryPrice, t.takeProfit, t.stopLoss, t.status, t.timestamp, t.confidence],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  });

  app.put("/api/trades/:id", (req, res) => {
    const { status } = req.body;
    db.run("UPDATE trades SET status = ? WHERE id = ?", [status, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });

  app.post("/api/verify-key", async (req, res) => {
    const apiKey = req.headers.authorization?.replace("Bearer ", "");
    if (!apiKey) return res.status(401).json({ error: "No key" });
    try {
      const ai = new GoogleGenAI({ apiKey });
      await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Respond with exactly 'ok'."
      });
      res.json({ valid: true });
    } catch (e: any) {
      res.status(400).json({ valid: false, error: e.message || "Invalid key" });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    const apiKey = req.headers.authorization?.replace("Bearer ", "");
    if (!apiKey) return res.status(401).json({ error: "No key" });
    
    try {
      const ai = new GoogleGenAI({ apiKey });
      const { type, currentPrice, ema9, ema21, rsi, recentCandles } = req.body;
      
      const prompt = `You are an expert crypto technical analyst.
      The market for BTC/USDT has triggered a potential ${type} signal based on our local indicators.
      Current Price: ${currentPrice}
      EMA9: ${ema9}
      EMA21: ${ema21}
      RSI: ${rsi}
      
      Recent price action (last 5 candles):
      ${JSON.stringify(recentCandles)}
      
      Analyze this data. If it looks like a high-probability trade setup, return a JSON object with:
      {
        "trade": true,
        "type": "${type}",
        "entryPrice": <suggested entry price around current price>,
        "takeProfit": <suggested take profit>,
        "stopLoss": <suggested stop loss>,
        "confidence": <integer 0-100 representing confidence in this trade>
      }
      If the signal is weak or risky, return { "trade": false }.
      Reply ONLY in valid JSON.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });
      
      let result = JSON.parse(response.text || '{}');
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
