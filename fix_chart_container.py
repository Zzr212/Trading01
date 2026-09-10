import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

# Replace props
content = content.replace(
"interface Props {\n  apiKey: string;\n  activeTrade: Trade | null;\n  onPriceUpdate: (price: number) => void;\n  onSentimentUpdate: (score: number) => void;\n  onTradeCreated: (trade: Trade) => void;\n  onError: (msg: string) => void;\n}",
"interface Props {\n  geminiKey: string;\n  groqKey: string;\n  activeTrade: Trade | null;\n  onPriceUpdate: (price: number) => void;\n  onSentimentUpdate: (score: number) => void;\n  onTradeCreated: (trade: Trade) => void;\n  onError: (msg: string) => void;\n}"
)

content = content.replace(
"export default function ChartContainer({ apiKey, activeTrade, onPriceUpdate, onSentimentUpdate, onTradeCreated, onError }: Props) {",
"export default function ChartContainer({ geminiKey, groqKey, activeTrade, onPriceUpdate, onSentimentUpdate, onTradeCreated, onError }: Props) {"
)

# Update fetchSR
old_fetchSR = """  useEffect(() => {
    if (!apiKey) return;
    const fetchSR = async () => {
      try {
        // Fetch shorter timeframes suitable for scalping
        const [tf1h, tf15m, tf5m] = await Promise.all([
          fetchHistoricalKlines('BTCUSDT', '1h', 30),
          fetchHistoricalKlines('BTCUSDT', '15m', 30),
          fetchHistoricalKlines('BTCUSDT', '5m', 30)
        ]);
        
        const res = await fetch('/api/analyze-sr', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({ tf1h, tf15m, tf5m })
        });"""

new_fetchSR = """  useEffect(() => {
    if (!geminiKey && !groqKey) return;
    const fetchSR = async () => {
      try {
        // Fetch shorter timeframes suitable for scalping
        const [tf1h, tf15m, tf5m] = await Promise.all([
          fetchHistoricalKlines('BTCUSDT', '1h', 30),
          fetchHistoricalKlines('BTCUSDT', '15m', 30),
          fetchHistoricalKlines('BTCUSDT', '5m', 30)
        ]);
        
        const res = await fetch('/api/analyze-sr', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-gemini-key': geminiKey,
            'x-groq-key': groqKey
          },
          body: JSON.stringify({ tf1h, tf15m, tf5m })
        });"""

content = content.replace(old_fetchSR, new_fetchSR)
content = content.replace("  }, [apiKey, onError]);", "  }, [geminiKey, groqKey, onError]);")

# Update analyze-trade
old_analyze_trade = """      try {
        const res = await fetch('/api/analyze-trade', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            type: potentialSignal,
            currentPrice: current.close,
            ema9: current.ema9,
            ema21: current.ema21,
            rsi: current.rsi,
            recentCandles,
            srLevels
          })
        });"""

new_analyze_trade = """      try {
        const res = await fetch('/api/analyze-trade', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-gemini-key': geminiKey,
            'x-groq-key': groqKey
          },
          body: JSON.stringify({
            type: potentialSignal,
            currentPrice: current.close,
            ema9: current.ema9,
            ema21: current.ema21,
            rsi: current.rsi,
            recentCandles,
            srLevels
          })
        });"""

content = content.replace(old_analyze_trade, new_analyze_trade)

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)
