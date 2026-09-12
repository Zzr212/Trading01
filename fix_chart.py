import re
with open('src/components/CandlestickChart.tsx', 'r') as f:
    content = f.read()

content = content.replace("interface ChartProps {\n  data: Kline[];", "interface ChartProps {\n  symbol?: string;\n  data: Kline[];")
content = content.replace("export default function CandlestickChart({ data, timeframe, activeTrade, isReplay }: ChartProps) {", "export default function CandlestickChart({ symbol = 'BTCUSDT', data, timeframe, activeTrade, isReplay }: ChartProps) {")

content = content.replace('<h1 className="text-xl font-bold tracking-tight text-white">BTC/USDT</h1>', '<h1 className="text-xl font-bold tracking-tight text-white">{symbol.replace("USDT", "/USDT")}</h1>')

# Fix entryCandleIndex logic
old_entry_idx = 'const entryCandleIndex = data.findIndex(d => d.time >= activeTrade.timestamp);'
new_entry_idx = '''let entryCandleIndex = data.length - 1;
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i].time <= activeTrade.timestamp) {
          entryCandleIndex = i;
          break;
        }
      }'''
content = content.replace(old_entry_idx, new_entry_idx)

with open('src/components/CandlestickChart.tsx', 'w') as f:
    f.write(content)
