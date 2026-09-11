import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

# Fix interface Props
content = re.sub(r"interface Props \{.*?geminiKey: string;\n  groqKey: string;\n", "interface Props {\n", content, flags=re.DOTALL)
content = re.sub(r"export default function ChartContainer\(\{ geminiKey, groqKey, ", "export default function ChartContainer({ ", content)

# Fix imports
content = content.replace("calculateEMA, calculateRSI } from '../lib/indicators';", "calculateEMA, calculateRSI, calculateMACD, calculateATR, findSupportResistance } from '../lib/indicators';")

# Update enrichedData
new_enriched = """  const enrichedData = React.useMemo(() => {
    if (data.length === 0) return [];
    const ema9 = calculateEMA(data, 9);
    const ema21 = calculateEMA(data, 21);
    const rsiArray = calculateRSI(data, 14);
    const atrArray = calculateATR(data, 14);
    const macdData = calculateMACD(data);
    
    return data.map((d, i) => ({
      ...d,
      ema9: ema9[i],
      ema21: ema21[i],
      rsi: rsiArray[i],
      atr: atrArray[i],
      macd: macdData.macd[i],
      macdSignal: macdData.signal[i],
      macdHist: macdData.hist[i]
    }));
  }, [data]);"""
content = re.sub(r"  const enrichedData = React\.useMemo.*?\}, \[data\]\);", new_enriched, content, flags=re.DOTALL)

# Update Initial Multi-Timeframe S/R Analysis
new_sr = """  // Initial Multi-Timeframe S/R Analysis
  useEffect(() => {
    const fetchSR = async () => {
      try {
        const tf15m = await fetchHistoricalKlines('BTCUSDT', '15m', 100);
        const sr = findSupportResistance(tf15m);
        setSrLevels(sr);
      } catch (err: any) {
        onError("Failed to fetch S/R levels: " + err.message);
      }
    };
    fetchSR();
  }, [onError]);"""
content = re.sub(r"  // Initial Multi-Timeframe S/R Analysis\n  useEffect\(\(\) => \{.*?    fetchSR\(\);\n  \}, \[geminiKey, groqKey, onError\]\);", new_sr, content, flags=re.DOTALL)

# Now, the main AI trading logic.
ai_trade_logic_regex = r"  useEffect\(\(\) => \{\n    if \(enrichedData\.length < 21.*?\n  \}, \[enrichedData, activeTrade.*?\]\);"

new_trade_logic = """  // Algorithmic Trade Trigger Logic
  useEffect(() => {
    if (enrichedData.length < 35) return;
    const current = enrichedData[enrichedData.length - 1];
    const prev = enrichedData[enrichedData.length - 2];
    
    onPriceUpdate(current.close);

    if (activeTrade) return;
    if (analyzingRef.current) return;

    // ALGORITHMIC SCALPING STRATEGY
    // Trend: EMA9 & EMA21
    // Momentum: MACD & RSI
    // Volatility: ATR
    
    const isLongSetup = 
      current.ema9 > current.ema21 && // Uptrend
      prev.ema9 <= prev.ema21 && // Fresh crossover (or use MACD cross)
      current.rsi > 40 && current.rsi < 70; // Healthy momentum

    const isShortSetup = 
      current.ema9 < current.ema21 && // Downtrend
      prev.ema9 >= prev.ema21 && // Fresh crossover
      current.rsi < 60 && current.rsi > 30; // Healthy momentum
      
    // Alternate strategy: MACD Histogram crossover
    const isMacdLong = current.macdHist > 0 && prev.macdHist <= 0 && current.ema9 > current.ema21;
    const isMacdShort = current.macdHist < 0 && prev.macdHist >= 0 && current.ema9 < current.ema21;
    
    let signalType = null;
    if (isLongSetup || isMacdLong) signalType = 'LONG';
    if (isShortSetup || isMacdShort) signalType = 'SHORT';

    if (!signalType) return;

    analyzingRef.current = true;
    onSentimentUpdate(signalType === 'LONG' ? 85 : 15); // Set fake sentiment based on algo

    // Calculate dynamic risk
    const atr = current.atr || (current.close * 0.005);
    const entryPrice = current.close;
    
    // Risk:Reward = 1:2
    let stopLoss, takeProfit;
    if (signalType === 'LONG') {
      stopLoss = entryPrice - (atr * 1.5);
      takeProfit = entryPrice + (atr * 3.0);
    } else {
      stopLoss = entryPrice + (atr * 1.5);
      takeProfit = entryPrice - (atr * 3.0);
    }
    
    const trade: Trade = {
      id: Math.random().toString(36).substr(2, 9),
      type: signalType as 'LONG' | 'SHORT',
      entryPrice: parseFloat(entryPrice.toFixed(2)),
      takeProfit: parseFloat(takeProfit.toFixed(2)),
      stopLoss: parseFloat(stopLoss.toFixed(2)),
      status: 'ACTIVE',
      timestamp: Date.now(),
      confidence: 80,
      reason: `Algorithmic ${signalType} Signal based on EMA+MACD confluence. Volatility scaled targets using ATR.`,
      result: 0
    };
    
    onTradeCreated(trade);
    
    setTimeout(() => {
      analyzingRef.current = false;
    }, 5000); // Debounce
    
  }, [enrichedData, activeTrade, srLevels, onPriceUpdate, onSentimentUpdate, onTradeCreated, onError]);"""

content = re.sub(ai_trade_logic_regex, new_trade_logic, content, flags=re.DOTALL)

# Wait, let's make sure the type of `enrichedData` handles atr, macd, etc. in `CandlestickChart.tsx`?
# Actually CandlestickChart just gets the whole object. Let's see if it needs updates. It only plots candles, ema9, ema21. So we don't strictly have to change CandlestickChart unless we want to draw MACD.

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)
