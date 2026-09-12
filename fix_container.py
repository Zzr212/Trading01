import re
with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

content = content.replace('<CandlestickChart data={enrichedData} timeframe={timeframe} activeTrade={activeTrade} />', '<CandlestickChart symbol={symbol} data={enrichedData} timeframe={timeframe} activeTrade={activeTrade} />')

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)
