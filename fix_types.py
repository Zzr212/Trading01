import re

with open('src/types.ts', 'r') as f:
    content = f.read()

content = content.replace("  rsi?: number;", "  rsi?: number;\n  atr?: number;\n  macd?: number;\n  macdSignal?: number;\n  macdHist?: number;")
content = content.replace("  pair: string;", "  pair?: string;") # Because pair is optional, actually we didn't specify it in ChartContainer

with open('src/types.ts', 'w') as f:
    f.write(content)

