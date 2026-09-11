import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

# Replace the TP/SL logic
old_logic = """    // Calculate dynamic risk
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
      pair: 'BTCUSDT',
      type: signalType as 'LONG' | 'SHORT',
      entryPrice: parseFloat(entryPrice.toFixed(2)),
      takeProfit: parseFloat(takeProfit.toFixed(2)),
      stopLoss: parseFloat(stopLoss.toFixed(2)),
      status: 'ACTIVE',
      timestamp: Date.now(),
      confidence: 80,
      reason: `Algorithmic ${signalType} Signal based on EMA+MACD confluence. Volatility scaled targets using ATR.`,
      result: 0
    };"""

new_logic = """    // Calculate dynamic risk with minimum gap safeguards
    const atr = current.atr || (current.close * 0.002);
    const entryPrice = current.close;
    
    // Prevent noise from instantly closing trades by enforcing a minimum gap (0.15% for SL)
    const minGap = entryPrice * 0.0015;
    const slDist = Math.max(atr * 2.0, minGap);
    const tpDist = Math.max(atr * 4.0, minGap * 2);
    
    // Risk:Reward = 1:2 minimum
    let stopLoss, takeProfit;
    if (signalType === 'LONG') {
      stopLoss = entryPrice - slDist;
      takeProfit = entryPrice + tpDist;
    } else {
      stopLoss = entryPrice + slDist;
      takeProfit = entryPrice - tpDist;
    }
    
    const trade: Trade = {
      id: Math.random().toString(36).substr(2, 9),
      pair: 'BTCUSDT',
      type: signalType as 'LONG' | 'SHORT',
      entryPrice: parseFloat(entryPrice.toFixed(2)),
      takeProfit: parseFloat(takeProfit.toFixed(2)),
      stopLoss: parseFloat(stopLoss.toFixed(2)),
      status: 'ACTIVE',
      timestamp: Date.now(),
      confidence: 80,
      reason: `Algorithmic ${signalType} Signal based on EMA+MACD confluence. Volatility scaled targets.`
    };"""

content = content.replace(old_logic, new_logic)

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)

