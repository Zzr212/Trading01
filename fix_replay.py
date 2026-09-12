import re
with open('src/components/TradeReplayModal.tsx', 'r') as f:
    content = f.read()

content = content.replace('<CandlestickChart \n            data={visibleCandles}', '<CandlestickChart \n            symbol={trade.pair}\n            data={visibleCandles}')

with open('src/components/TradeReplayModal.tsx', 'w') as f:
    f.write(content)
