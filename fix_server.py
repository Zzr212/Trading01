import re

with open('server.ts', 'r') as f:
    content = f.read()

# 1. Add callAIWithFallback
fallback_func = """
async function callAIWithFallback(geminiKey: string | undefined, groqKey: string | undefined, prompt: string, isJson = true) {
  let lastError = null;
  
  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: isJson ? { responseMimeType: "application/json" } : undefined
      });
      return response.text;
    } catch (e: any) {
      console.warn(`Gemini failed: ${e.message}. Trying fallback...`);
      lastError = e;
    }
  }

  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${groqKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-70b-versatile",
          messages: [{ role: "user", content: prompt }],
          response_format: isJson ? { type: "json_object" } : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Groq API Error");
      return data.choices[0].message.content;
    } catch (e: any) {
      console.warn(`Groq failed: ${e.message}.`);
      lastError = e;
    }
  }
  
  throw new Error(`All AI providers failed. Last error: ${lastError?.message || 'No valid API keys provided.'}`);
}
"""

content = content.replace("async function startServer() {", fallback_func + "\nasync function startServer() {")

# 2. Update /api/verify-key
old_verify = """  app.post("/api/verify-key", async (req, res) => {
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
  });"""

new_verify = """  app.post("/api/verify-key", async (req, res) => {
    const geminiKey = req.headers['x-gemini-key'] as string;
    const groqKey = req.headers['x-groq-key'] as string;
    
    if (!geminiKey && !groqKey) return res.status(401).json({ error: "No keys provided" });
    
    try {
      await callAIWithFallback(geminiKey, groqKey, "Respond with exactly 'ok'.", false);
      res.json({ valid: true });
    } catch (e: any) {
      res.status(400).json({ valid: false, error: e.message || "Invalid keys or Quota exceeded." });
    }
  });"""

content = content.replace(old_verify, new_verify)

# 3. Update /api/analyze-sr
old_sr = """  app.post("/api/analyze-sr", async (req, res) => {
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

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });
      
      let result = JSON.parse(response.text || '{}');
      res.json(result);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });"""

new_sr = """  app.post("/api/analyze-sr", async (req, res) => {
    const geminiKey = req.headers['x-gemini-key'] as string;
    const groqKey = req.headers['x-groq-key'] as string;
    
    if (!geminiKey && !groqKey) return res.status(401).json({ error: "No keys provided" });
    
    try {
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

      const text = await callAIWithFallback(geminiKey, groqKey, prompt, true);
      let result = JSON.parse(text || '{}');
      res.json(result);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });"""

content = content.replace(old_sr, new_sr)

# 4. Update /api/analyze
old_analyze = """  app.post("/api/analyze", async (req, res) => {
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
  });"""

new_analyze = """  app.post("/api/analyze", async (req, res) => {
    const geminiKey = req.headers['x-gemini-key'] as string;
    const groqKey = req.headers['x-groq-key'] as string;
    
    if (!geminiKey && !groqKey) return res.status(401).json({ error: "No keys provided" });
    
    try {
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

      const text = await callAIWithFallback(geminiKey, groqKey, prompt, true);
      let result = JSON.parse(text || '{}');
      res.json(result);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });"""

content = content.replace(old_analyze, new_analyze)

with open('server.ts', 'w') as f:
    f.write(content)
